//! Fresh-only setup. SQLite migrations run in memory, never on a selected file.
//! All native mutation/publication uses a pinned parent dirfd and exclusive names.
use serde::{Deserialize, Serialize};
use crate::private_fs::{self, FileId, Walk};
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Selection {
    CreateNew,
    UseExisting,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinishInput {
    pub id: String,
    pub selection: Selection,
    pub settings: crate::settings::SaveInput,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub eligible: bool,
    pub database: String,
    pub tokens: String,
    pub database_committed: bool,
    pub settings_committed: bool,
}
pub struct State {
    pub id: String,
    pub eligible: bool,
    pub root: PathBuf,
    pub database: Option<OwnedDatabase>,
    pub settings_committed: bool,
    pub saved_settings: Option<OwnedSettings>,
}
impl State {
    pub fn new(settings: &Path, root: PathBuf) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            eligible: matches!(fs::symlink_metadata(settings), Err(e) if e.kind() == std::io::ErrorKind::NotFound),
            root,
            database: None,
            settings_committed: false,
            saved_settings: None,
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            id: self.id.clone(),
            eligible: self.eligible,
            database: self
                .database
                .as_ref()
                .map(|db| db.path.clone())
                .unwrap_or_else(|| self.root.join("trainer.sqlite"))
                .to_string_lossy()
                .into_owned(),
            tokens: self
                .root
                .join("garmin-tokens")
                .to_string_lossy()
                .into_owned(),
            database_committed: self.database.is_some(),
            settings_committed: self.settings_committed,
        }
    }
}
fn name(value: &OsStr) -> Result<OsString, &'static str> {
    private_fs::valid_name(value)
        .then(|| value.to_owned())
        .ok_or("Invalid private path.")
}
pub(crate) struct Parent {
    pub(crate) file: File,
    path: PathBuf,
}
impl Parent {
    pub(crate) fn open(path: &Path, create: bool) -> Result<Self, &'static str> {
        if !path.is_absolute()
            || path.as_os_str().len() > 4096
            || path
                .to_string_lossy()
                .chars()
                .any(|c| c.is_control() || c == '~' || c == '$')
        {
            return Err(
                "Choose a canonical absolute private parent, without aliases or expansion.",
            );
        }
        let file = private_fs::walk(path, create).map_err(|error| match error {
            Walk::Alias => "Path aliases are not allowed.",
            Walk::Create => "Cannot exclusively create private app storage.",
            Walk::Missing => "Private parent missing, aliased or inaccessible. Choose an existing private folder.",
            Walk::Unsafe => "Unsafe parent ownership or writable path component; no permissions were changed.",
        })?;
        let parent = Self {
            file,
            path: path.to_owned(),
        };
        parent.verify()?;
        Ok(parent)
    }
    pub(crate) fn verify(&self) -> Result<(), &'static str> {
        let safe = private_fs::meta(&self.file)
            .map(|meta| meta.private_dir())
            .map_err(|_| "Private parent unavailable.")?;
        if !safe
            || !private_fs::canonical(&self.path)
            || !private_fs::same_object(&self.path, &self.file)
        {
            return Err("Private parent changed or is unsafe; original inputs preserved.");
        }
        Ok(())
    }
    fn create(&self, part: &OsStr) -> Result<File, &'static str> {
        self.verify()?;
        private_fs::create_at(&self.file, part)
            .map_err(|_| "Fresh destination or writer lease already exists; nothing was replaced.")
    }
    fn absent(&self, part: &OsStr) -> bool {
        matches!(private_fs::exists_at(&self.file, part), Ok(false))
    }
    fn identity(&self, part: &OsStr, file: &File) -> bool {
        let Ok(current) = private_fs::open_at(&self.file, part) else {
            return false;
        };
        match (private_fs::id(file), private_fs::meta(&current)) {
            (Ok(id), Ok(meta)) => id == meta.id && meta.private_file(),
            _ => false,
        }
    }
    fn remove_owned(&self, part: &OsStr, file: &File) {
        if self.identity(part, file) {
            let _ = private_fs::remove_at(&self.file, part, file);
        }
    }
}
pub struct OwnedSettings {
    id: FileId,
    bytes: Vec<u8>,
}
impl OwnedSettings {
    pub fn capture(path: &Path) -> Result<Self, &'static str> {
        let (id, bytes) = crate::private_store::capture(path)?;
        Ok(Self { id, bytes })
    }
    pub fn verify(&self, path: &Path) -> Result<(), &'static str> {
        let current = Self::capture(path)?;
        if self.id != current.id || self.bytes != current.bytes {
            return Err("Committed settings changed outside this operation. Preserve them and reopen explicitly; retry refused.");
        }
        Ok(())
    }
}

pub struct OwnedDatabase {
    path: PathBuf,
    id: FileId,
}
impl OwnedDatabase {
    #[cfg(test)]
    pub(crate) fn capture_test_publication(path: &Path) -> Self {
        Self {
            path: path.to_owned(),
            id: private_fs::path_meta(path).unwrap().id,
        }
    }
    pub fn verify(&self, requested: &Path) -> Result<(), &'static str> {
        let meta = private_fs::path_meta(&self.path)
            .map_err(|_| "Committed database missing; inspect it before retry.")?;
        if requested != self.path
            || meta.id != self.id
            || !meta.private_file()
            || !private_fs::canonical(requested)
        {
            return Err("Committed database identity changed. Preserve it and select existing data explicitly after inspection.");
        }
        Ok(())
    }
}
// Bounded private request, no inherited secrets, arbitrary command or vendor output.
pub fn bundled(
    resources: &Path,
    mode: &str,
    input: &mut [u8],
    limit: u64,
    cancel: &AtomicBool,
    quitting: &AtomicBool,
) -> Result<Vec<u8>, &'static str> {
    let mut command = Command::new(crate::process_tree::node(resources));
    command
        .arg(resources.join("runtime/runtime.cjs"))
        .arg(mode)
        .current_dir(resources.join("runtime"))
        .env_clear()
        .env("NODE_ENV", "production")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::process_tree::system_environment(&mut command);
    let mut child = crate::process_tree::Tree::spawn(&mut command)
        .map_err(|_| "Bundled setup resources unavailable. Rebuild the desktop app.")?;
    let stdout = child.stdout.take().ok_or("Setup result unavailable.")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(limit + 1).read_to_end(&mut bytes);
        (result, bytes)
    });
    let mut stdin = child.stdin.take().ok_or("Setup pipe unavailable.")?;
    let mut frame = input.to_vec();
    input.fill(0);
    let sender = std::thread::spawn(move || {
        let sent = stdin.write_all(&frame);
        frame.fill(0);
        sent
    });
    let result = (|| {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if cancel.load(Ordering::SeqCst) || quitting.load(Ordering::SeqCst) {
                return Err(
                    "Setup cancelled. Already committed database, settings or tokens are retained.",
                );
            }
            if Instant::now() >= deadline {
                return Err(
                    "Setup resources timed out; inspect retained commit state before retry.",
                );
            }
            if let Some(exit) = child.try_wait().map_err(|_| "Setup interrupted.")? {
                return if exit.success() {
                    Ok(())
                } else {
                    Err("Setup validation refused. Check provider key, calendar date, paths, current schema and advanced values. No plaintext fallback.")
                };
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    })();
    input.fill(0);
    if result.is_err() {
        child.kill();
    }
    let _ = child.wait();
    let sent = sender.join().map_err(|_| "Setup input interrupted.")?;
    let (read, bytes) = reader.join().map_err(|_| "Setup result interrupted.")?;
    result?;
    sent.map_err(|_| "Setup input interrupted.")?;
    read.map_err(|_| "Setup result unavailable.")?;
    if bytes.len() as u64 > limit {
        return Err("Setup result exceeded its bound.");
    }
    Ok(bytes)
}

pub fn validate(
    resources: &Path,
    fields: &BTreeMap<String, String>,
    cancel: &AtomicBool,
    quitting: &AtomicBool,
) -> Result<BTreeMap<String, String>, &'static str> {
    let mut input = serde_json::to_vec(fields).map_err(|_| "Invalid settings.")?;
    if input.len() > 96 * 1024 {
        return Err("Settings too large.");
    }
    input.push(b'\n');
    let bytes = bundled(
        resources,
        "--validate-settings",
        &mut input,
        128 * 1024,
        cancel,
        quitting,
    )?;
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Validated {
        ok: bool,
        fields: BTreeMap<String, String>,
    }
    let result: Validated =
        serde_json::from_slice(&bytes).map_err(|_| "Settings validation protocol refused.")?;
    if !result.ok {
        return Err("Settings invalid.");
    }
    Ok(result.fields)
}

pub fn initialize(
    resources: &Path,
    target: &Path,
    default_root: &Path,
    committed: &mut Option<OwnedDatabase>,
    cancel: &AtomicBool,
    quitting: &AtomicBool,
) -> Result<(), &'static str> {
    if let Some(db) = committed {
        return db.verify(target);
    }
    let parent_path = target.parent().ok_or("Choose a private database parent.")?;
    let parent = Parent::open(parent_path, parent_path == default_root)?;
    let leaf = target
        .file_name()
        .ok_or("Choose a fresh database filename.")?;
    let target_name = name(leaf)?;
    let sidecars: Vec<OsString> = ["", "-wal", "-shm", "-journal"]
        .iter()
        .map(|suffix| name(format!("{}{suffix}", leaf.to_string_lossy()).as_ref()))
        .collect::<Result<_, _>>()?;
    if sidecars.iter().any(|part| !parent.absent(part)) {
        return Err("Database or sidecar already exists. Use existing data explicitly; no initialization was performed.");
    }
    let lease_name = name(format!("{}.trainer-writer", leaf.to_string_lossy()).as_ref())?;
    let mut lease = parent.create(&lease_name)?;
    let stage_name = name(format!(".trainer-new-{}", uuid::Uuid::new_v4()).as_ref())?;
    let mut stage: Option<File> = None;
    let result = (|| {
        lease.write_all(serde_json::json!({"version":1,"pid":std::process::id(),"id":uuid::Uuid::new_v4().to_string()}).to_string().as_bytes()).and_then(|_| lease.sync_all()).map_err(|_| "Cannot persist setup ownership.")?;
        let mut bytes = bundled(
            resources,
            "--initialize-database",
            &mut b"{\"version\":1}\n".to_vec(),
            8 * 1024 * 1024,
            cancel,
            quitting,
        )?;
        if !bytes.starts_with(b"SQLite format 3\0") {
            return Err("Fresh database resource protocol refused.");
        }
        let mut file = parent.create(&stage_name)?;
        let written = file.write_all(&bytes).and_then(|_| file.sync_all());
        bytes.fill(0);
        stage = Some(file);
        written.map_err(|_| "Cannot persist fresh database. No destination was replaced.")?;
        // Readonly compatibility verification of exact new output, never migration.
        let fields = BTreeMap::from([(
            "DATABASE_PATH".to_owned(),
            parent_path
                .join(&stage_name)
                .to_string_lossy()
                .into_owned(),
        )]);
        validate(resources, &fields, cancel, quitting)?;
        parent.verify()?;
        if cancel.load(Ordering::SeqCst) || quitting.load(Ordering::SeqCst) {
            return Err(
                "Setup cancelled before database publication; any independent tokens remain saved.",
            );
        }
        let file = stage.as_ref().ok_or("Fresh staging unavailable.")?;
        if !parent.identity(&stage_name, file)
            || !parent.identity(&lease_name, &lease)
            || sidecars.iter().any(|part| !parent.absent(part))
        {
            return Err("Fresh database identity or destination changed; publication refused.");
        }
        let id = private_fs::id(file).map_err(|_| "Fresh identity unavailable.")?;
        if private_fs::rename_at(&parent.file, &stage_name, file, &target_name, false).is_err() {
            return Err("Fresh database publication refused. Existing destination preserved.");
        }
        // Record commit before durability/identity checks: failure is NOT rollback.
        *committed = Some(OwnedDatabase {
            path: target.to_owned(),
            id,
        });
        if !private_fs::sync_dir(&parent.file) {
            return Err("Database committed; directory durability confirmation unavailable. Inspect before retry.");
        }
        parent.verify()?;
        committed
            .as_ref()
            .ok_or("Commit state unavailable.")?
            .verify(target)
    })();
    if let Some(file) = &stage {
        parent.remove_owned(&stage_name, file);
    }
    parent.remove_owned(&lease_name, &lease);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_fs::testing::{
        make_private, make_shared, private_dir, private_root, symlink, write_private,
    };
    fn root() -> PathBuf {
        private_root("trainer-new")
    }
    #[test]
    fn committed_settings_retry_requires_exact_identity_and_content() {
        let root = root();
        let path = root.join("settings.json");
        write_private(&path, b"non-secret settings");
        let committed = OwnedSettings::capture(&path).unwrap();
        committed.verify(&path).unwrap();
        fs::write(&path, "external change").unwrap();
        assert!(committed.verify(&path).is_err());
        fs::rename(&path, root.join("preserved")).unwrap();
        write_private(&path, b"non-secret settings");
        assert!(committed.verify(&path).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn genuine_absence_only_and_owned_identity() {
        let root = root();
        let settings = root.join("settings.json");
        assert!(State::new(&settings, root.clone()).eligible);
        symlink(root.join("missing"), &settings).unwrap();
        assert!(!State::new(&settings, root.clone()).eligible);
        fs::remove_file(&settings).unwrap();
        fs::write(&settings, "unsupported").unwrap();
        assert!(!State::new(&settings, root.clone()).eligible);
        let parent = Parent::open(&root, false).unwrap();
        let part = name("fresh ü.sqlite".as_ref()).unwrap();
        let file = parent.create(&part).unwrap();
        assert!(parent.create(&part).is_err());
        assert!(parent.identity(&part, &file));
        let owned = OwnedDatabase {
            path: root.join("fresh ü.sqlite"),
            id: private_fs::id(&file).unwrap(),
        };
        owned.verify(&owned.path).unwrap();
        let retained = private_fs::open_at(&parent.file, &part).unwrap();
        drop(file);
        fs::rename(&owned.path, root.join("retained")).unwrap();
        fs::write(&owned.path, "foreign").unwrap();
        assert!(owned.verify(&owned.path).is_err());
        parent.remove_owned(&part, &retained);
        assert_eq!(fs::read(&owned.path).unwrap(), b"foreign");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn packaged_initializer_commits_once_retries_exact_identity_and_settles_sidecars() {
        let root = root();
        let target = root.join("fresh space ü.sqlite");
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let cancel = AtomicBool::new(false);
        let quitting = AtomicBool::new(false);
        let mut committed = None;
        initialize(
            &resources,
            &target,
            &root,
            &mut committed,
            &cancel,
            &quitting,
        )
        .unwrap();
        let original = fs::read(&target).unwrap();
        assert!(original.starts_with(b"SQLite format 3\0"));
        assert!(private_fs::path_meta(&target).unwrap().private_file());
        initialize(
            &resources,
            &target,
            &root,
            &mut committed,
            &cancel,
            &quitting,
        )
        .unwrap();
        assert_eq!(fs::read(&target).unwrap(), original);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let mut another = None;
        assert!(initialize(&resources, &target, &root, &mut another, &cancel, &quitting).is_err());
        assert!(another.is_none());
        assert_eq!(fs::read(&target).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn original_file_alias_sidecar_and_unknown_lease_are_never_replaced() {
        let root = root();
        let resources = root.join("no-resources-needed");
        let target = root.join("existing.sqlite");
        let cancel = AtomicBool::new(false);
        let quitting = AtomicBool::new(false);
        for suffix in ["", "-wal", "-shm", "-journal", ".trainer-writer"] {
            let collision = root.join(format!("existing.sqlite{suffix}"));
            fs::write(&collision, "original bytes").unwrap();
            let mut committed = None;
            assert!(initialize(
                &resources,
                &target,
                &root,
                &mut committed,
                &cancel,
                &quitting
            )
            .is_err());
            assert_eq!(fs::read(&collision).unwrap(), b"original bytes");
            assert!(committed.is_none());
            fs::remove_file(collision).unwrap();
        }
        symlink(root.join("missing"), &target).unwrap();
        assert!(initialize(&resources, &target, &root, &mut None, &cancel, &quitting).is_err());
        assert_eq!(private_fs::path_meta(&target).unwrap().kind, private_fs::Kind::Other);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cancelled_or_failed_resources_leave_no_target_and_exclusive_publication_preserves_racer() {
        let root = root();
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let target = root.join("cancel.sqlite");
        let cancel = AtomicBool::new(true);
        let quitting = AtomicBool::new(false);
        let mut committed = None;
        assert!(initialize(
            &resources,
            &target,
            &root,
            &mut committed,
            &cancel,
            &quitting
        )
        .is_err());
        assert!(committed.is_none());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        cancel.store(false, Ordering::SeqCst);
        assert!(initialize(
            &root.join("missing-resources"),
            &target,
            &root,
            &mut committed,
            &cancel,
            &quitting
        )
        .is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        let parent = Parent::open(&root, false).unwrap();
        let stage = name("stage".as_ref()).unwrap();
        let destination = name("raced".as_ref()).unwrap();
        let mut file = parent.create(&stage).unwrap();
        file.write_all(b"new").unwrap();
        fs::write(root.join("raced"), "foreign").unwrap();
        assert!(private_fs::rename_at(&parent.file, &stage, &file, &destination, false).is_err());
        assert_eq!(fs::read(root.join("raced")).unwrap(), b"foreign");
        assert!(parent.identity(&stage, &file));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn aliases_unsafe_parent_and_pinned_parent_swap_fail_closed() {
        let root = root();
        let private = root.join("private");
        Parent::open(&private, true).unwrap();
        symlink(&private, root.join("alias")).unwrap();
        assert!(Parent::open(&root.join("alias"), false).is_err());
        let parent = Parent::open(&private, false).unwrap();
        fs::rename(&private, root.join("old")).unwrap();
        private_dir(&private);
        assert!(parent.verify().is_err());
        assert!(parent.create(&name("no-write".as_ref()).unwrap()).is_err());
        make_shared(&private);
        assert!(Parent::open(&private, false).is_err());
        make_private(&private);
        fs::remove_dir_all(root).unwrap();
    }
}
