//! Fresh-only setup. SQLite migrations run in memory, never on a selected file.
//! All native mutation/publication uses a pinned parent dirfd and exclusive names.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::CString;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
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
fn name(value: &std::ffi::OsStr) -> Result<CString, &'static str> {
    CString::new(value.as_bytes()).map_err(|_| "Invalid private path.")
}
fn same(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.dev() == right.dev() && left.ino() == right.ino()
}
struct Parent {
    file: File,
    path: PathBuf,
}
impl Parent {
    fn open(path: &Path, create: bool) -> Result<Self, &'static str> {
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
        let mut file = File::open("/").map_err(|_| "Private root unavailable.")?;
        for component in path.components() {
            let Component::Normal(part) = component else {
                if matches!(component, Component::RootDir) {
                    continue;
                }
                return Err("Path aliases are not allowed.");
            };
            let part = name(part)?;
            let open = || unsafe {
                libc::openat(
                    file.as_raw_fd(),
                    part.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            let mut fd = open();
            if fd < 0
                && create
                && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
            {
                if unsafe { libc::mkdirat(file.as_raw_fd(), part.as_ptr(), 0o700) } != 0 {
                    return Err("Cannot exclusively create private app storage.");
                }
                fd = open();
            }
            if fd < 0 {
                return Err("Private parent missing, aliased or inaccessible. Choose an existing private folder.");
            }
            let next = unsafe { File::from_raw_fd(fd) };
            let meta = next.metadata().map_err(|_| "Private parent unavailable.")?;
            let root_sticky = meta.uid() == 0 && meta.mode() & u32::from(libc::S_ISVTX) != 0;
            if (meta.uid() != 0 && meta.uid() != unsafe { libc::getuid() })
                || (meta.mode() & 0o022 != 0 && !root_sticky)
            {
                return Err("Unsafe parent ownership or writable path component; no permissions were changed.");
            }
            file = next;
        }
        let parent = Self {
            file,
            path: path.to_owned(),
        };
        parent.verify()?;
        Ok(parent)
    }
    fn verify(&self) -> Result<(), &'static str> {
        let meta = self
            .file
            .metadata()
            .map_err(|_| "Private parent unavailable.")?;
        if meta.uid() != unsafe { libc::getuid() }
            || meta.mode() & 0o077 != 0
            || fs::canonicalize(&self.path).ok().as_deref() != Some(self.path.as_path())
            || !fs::symlink_metadata(&self.path)
                .map(|current| same(&meta, &current))
                .unwrap_or(false)
        {
            return Err("Private parent changed or is unsafe; original inputs preserved.");
        }
        Ok(())
    }
    fn create(&self, part: &CString) -> Result<File, &'static str> {
        self.verify()?;
        let fd = unsafe {
            libc::openat(
                self.file.as_raw_fd(),
                part.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err("Fresh destination or writer lease already exists; nothing was replaced.");
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    fn absent(&self, part: &CString) -> bool {
        let mut meta = std::mem::MaybeUninit::<libc::stat>::uninit();
        (unsafe {
            libc::fstatat(
                self.file.as_raw_fd(),
                part.as_ptr(),
                meta.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        }) != 0
            && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
    }
    fn identity(&self, part: &CString, file: &File) -> bool {
        let fd = unsafe {
            libc::openat(
                self.file.as_raw_fd(),
                part.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return false;
        }
        let current = unsafe { File::from_raw_fd(fd) };
        match (file.metadata(), current.metadata()) {
            (Ok(a), Ok(b)) => {
                same(&a, &b)
                    && b.is_file()
                    && b.nlink() == 1
                    && b.uid() == unsafe { libc::getuid() }
                    && b.mode() & 0o077 == 0
            }
            _ => false,
        }
    }
    fn remove_owned(&self, part: &CString, file: &File) {
        if self.identity(part, file) {
            unsafe {
                libc::unlinkat(self.file.as_raw_fd(), part.as_ptr(), 0);
            }
        }
    }
}
pub fn prepare_root(root: &Path) -> Result<(), &'static str> {
    Parent::open(root, true).map(|_| ())
}

pub struct OwnedSettings {
    dev: u64,
    ino: u64,
    bytes: Vec<u8>,
}
impl OwnedSettings {
    pub fn capture(path: &Path) -> Result<Self, &'static str> {
        crate::settings::private_file(path)?;
        let meta =
            fs::symlink_metadata(path).map_err(|_| "Committed settings identity unavailable.")?;
        let bytes = fs::read(path).map_err(|_| "Committed settings unreadable.")?;
        Ok(Self {
            dev: meta.dev(),
            ino: meta.ino(),
            bytes,
        })
    }
    pub fn verify(&self, path: &Path) -> Result<(), &'static str> {
        let current = Self::capture(path)?;
        if self.dev != current.dev || self.ino != current.ino || self.bytes != current.bytes {
            return Err("Committed settings changed outside this operation. Preserve them and reopen explicitly; retry refused.");
        }
        Ok(())
    }
}

pub struct OwnedDatabase {
    path: PathBuf,
    dev: u64,
    ino: u64,
}
impl OwnedDatabase {
    pub fn verify(&self, requested: &Path) -> Result<(), &'static str> {
        let meta = fs::symlink_metadata(&self.path)
            .map_err(|_| "Committed database missing; inspect it before retry.")?;
        if requested != self.path
            || meta.dev() != self.dev
            || meta.ino() != self.ino
            || meta.nlink() != 1
            || !meta.is_file()
            || meta.uid() != unsafe { libc::getuid() }
            || meta.mode() & 0o077 != 0
            || fs::canonicalize(requested).ok().as_deref() != Some(requested)
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
    let mut child = Command::new(resources.join("node"))
        .arg(resources.join("runtime/runtime.cjs"))
        .arg(mode)
        .current_dir(resources.join("runtime"))
        .env_clear()
        .env("NODE_ENV", "production")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| "Bundled setup resources unavailable. Rebuild the ARM64 app.")?;
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
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
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
    let sidecars: Vec<CString> = ["", "-wal", "-shm", "-journal"]
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
        let fields = BTreeMap::from([
            (
                "DATABASE_PATH".to_owned(),
                parent_path
                    .join(stage_name.to_str().map_err(|_| "Invalid staging.")?)
                    .to_string_lossy()
                    .into_owned(),
            ),
            (
                "GARMIN_HISTORY_START_DATE".to_owned(),
                "2000-01-01".to_owned(),
            ),
        ]);
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
        let meta = file.metadata().map_err(|_| "Fresh identity unavailable.")?;
        if unsafe {
            libc::renameatx_np(
                parent.file.as_raw_fd(),
                stage_name.as_ptr(),
                parent.file.as_raw_fd(),
                target_name.as_ptr(),
                libc::RENAME_EXCL,
            )
        } != 0
        {
            return Err("Fresh database publication refused. Existing destination preserved.");
        }
        // Record commit before durability/identity checks: failure is NOT rollback.
        *committed = Some(OwnedDatabase {
            path: target.to_owned(),
            dev: meta.dev(),
            ino: meta.ino(),
        });
        parent.file.sync_all().map_err(|_| "Database committed; directory durability confirmation unavailable. Inspect before retry.")?;
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
    use std::os::unix::fs::{symlink, PermissionsExt};
    fn root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("trainer-new-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        fs::canonicalize(root).unwrap()
    }
    #[test]
    fn committed_settings_retry_requires_exact_identity_and_content() {
        let root = root();
        let path = root.join("settings.json");
        fs::write(&path, "non-secret settings").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let committed = OwnedSettings::capture(&path).unwrap();
        committed.verify(&path).unwrap();
        fs::write(&path, "external change").unwrap();
        assert!(committed.verify(&path).is_err());
        fs::rename(&path, root.join("preserved")).unwrap();
        fs::write(&path, "non-secret settings").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
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
        let meta = file.metadata().unwrap();
        let owned = OwnedDatabase {
            path: root.join("fresh ü.sqlite"),
            dev: meta.dev(),
            ino: meta.ino(),
        };
        owned.verify(&owned.path).unwrap();
        fs::rename(&owned.path, root.join("retained")).unwrap();
        fs::write(&owned.path, "foreign").unwrap();
        assert!(owned.verify(&owned.path).is_err());
        parent.remove_owned(&part, &file);
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
        assert_eq!(fs::metadata(&target).unwrap().mode() & 0o777, 0o600);
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
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
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
        assert_ne!(
            unsafe {
                libc::renameatx_np(
                    parent.file.as_raw_fd(),
                    stage.as_ptr(),
                    parent.file.as_raw_fd(),
                    destination.as_ptr(),
                    libc::RENAME_EXCL,
                )
            },
            0
        );
        assert_eq!(fs::read(root.join("raced")).unwrap(), b"foreign");
        assert!(parent.identity(&stage, &file));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn aliases_unsafe_parent_and_pinned_parent_swap_fail_closed() {
        let root = root();
        let private = root.join("private");
        prepare_root(&private).unwrap();
        symlink(&private, root.join("alias")).unwrap();
        assert!(Parent::open(&root.join("alias"), false).is_err());
        let parent = Parent::open(&private, false).unwrap();
        fs::rename(&private, root.join("old")).unwrap();
        fs::create_dir(&private).unwrap();
        fs::set_permissions(&private, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(parent.verify().is_err());
        assert!(parent.create(&name("no-write".as_ref()).unwrap()).is_err());
        fs::set_permissions(&private, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(Parent::open(&private, false).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
