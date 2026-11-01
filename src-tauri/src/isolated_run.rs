//! Explicit ordinary-artifact admission. No normal-state lookup or enabling environment.
use crate::{private_store, settings};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Read,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};
pub const CONTRACT: &str = "trainer-ordinary-isolated/v1";
const DENIED: &str = "Isolated ordinary-run admission refused; no normal-state fallback.";
const DIRECTORIES: [&str; 7] = [
    "config",
    "app-data",
    "profile",
    "setup-profile",
    "tmp",
    "screenshots",
    "tokens",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Descriptor {
    schema_version: u8,
    pub run_id: String,
    pub root: PathBuf,
    pub source_fingerprint: String,
    pub artifact_inventory_hash: String,
    pub control_port: u16,
    pub capability: String,
}

pub struct Admission {
    pub descriptor: Descriptor,
    pub boot: String,
    directories: Vec<private_store::PinnedDirectory>,
    database: (u64, u64),
    descriptor_capture: (u64, u64, Vec<u8>),
    owner_capture: (u64, u64, Vec<u8>),
}

fn hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// Intent is parsed before Tauri/plugins/window creation. Invalid intent is never ignored.
pub fn intent(args: &[std::ffi::OsString]) -> Result<Option<PathBuf>, &'static str> {
    if !args.iter().any(|arg| arg == "--isolated-smoke-run") {
        return if args
            .iter()
            .any(|arg| arg.to_string_lossy().starts_with("--isolated-smoke-run"))
        {
            Err(DENIED)
        } else {
            Ok(None)
        };
    }
    if args.len() != 2 || args[0] != "--isolated-smoke-run" {
        return Err(DENIED);
    }
    Ok(Some(PathBuf::from(&args[1])))
}

impl Descriptor {
    fn validate(&self, path: &Path) -> Result<(), &'static str> {
        if self.schema_version != 1
            || uuid::Uuid::parse_str(&self.run_id)
                .map(|id| id.to_string())
                .ok()
                .as_deref()
                != Some(self.run_id.as_str())
            || !hex(&self.capability)
            || !hex(&self.source_fingerprint)
            || !hex(&self.artifact_inventory_hash)
            || self.control_port < 1024
            || self.root.file_name().and_then(|p| p.to_str())
                != Some(format!("ordinary-{}", self.run_id).as_str())
            || path != self.root.join("launch.json")
        {
            return Err(DENIED);
        }
        Ok(())
    }
}

fn database_identity(path: &Path) -> Result<(u64, u64), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|_| DENIED)?;
    if !meta.is_file()
        || meta.nlink() != 1
        || meta.len() == 0
        || meta.uid() != unsafe { libc::getuid() }
        || meta.mode() & 0o777 != 0o600
        || fs::canonicalize(path).ok().as_deref() != Some(path)
    {
        return Err(DENIED);
    }
    Ok((meta.dev(), meta.ino()))
}

pub fn private_directory(path: &Path) -> Result<(), String> {
    private_store::PinnedDirectory::open(path)
        .map(|_| ())
        .map_err(str::to_owned)
}

pub fn sha_file(path: &Path) -> Result<String, &'static str> {
    let mut file = File::open(path).map_err(|_| DENIED)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|_| DENIED)?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn inventory(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, String>,
    bytes: &mut u64,
) -> Result<(), &'static str> {
    for item in fs::read_dir(directory).map_err(|_| DENIED)? {
        let item = item.map_err(|_| DENIED)?;
        let path = item.path();
        let meta = fs::symlink_metadata(&path).map_err(|_| DENIED)?;
        if meta.is_dir() {
            inventory(root, &path, files, bytes)?;
        } else if meta.is_file() && meta.nlink() == 1 {
            *bytes = bytes.checked_add(meta.len()).ok_or(DENIED)?;
            if files.len() >= 50_000 || *bytes > 8 * 1024 * 1024 * 1024 {
                return Err(DENIED);
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| DENIED)?
                .to_str()
                .ok_or(DENIED)?;
            if relative.contains(['\n', '\r', '\0']) {
                return Err(DENIED);
            }
            files.insert(relative.to_owned(), sha_file(&path)?);
        } else {
            return Err(DENIED);
        }
    }
    Ok(())
}

fn verify_artifact(descriptor: &Descriptor) -> Result<(), &'static str> {
    let executable = std::env::current_exe().map_err(|_| DENIED)?;
    if executable.file_name().and_then(|p| p.to_str()) != Some("garmin-trainer-desktop") {
        return Err(DENIED);
    }
    let contents = executable.parent().and_then(Path::parent).ok_or(DENIED)?;
    if executable.parent() != Some(contents.join("MacOS").as_path())
        || contents.file_name().and_then(|p| p.to_str()) != Some("Contents")
    {
        return Err(DENIED);
    }
    let bundle = contents.parent().ok_or(DENIED)?;
    if bundle.extension().and_then(|p| p.to_str()) != Some("app")
        || fs::canonicalize(bundle).ok().as_deref() != Some(bundle)
    {
        return Err(DENIED);
    }
    let mut files = BTreeMap::new();
    inventory(bundle, bundle, &mut files, &mut 0)?;
    let mut digest = Sha256::new();
    for (path, hash) in &files {
        digest.update(path.as_bytes());
        digest.update(b"\0");
        digest.update(hash.as_bytes());
        digest.update(b"\n");
    }
    if format!("{:x}", digest.finalize()) != descriptor.artifact_inventory_hash {
        return Err(DENIED);
    }
    let resources = contents.join("Resources/resources");
    let path = resources.join("provenance.json");
    if fs::metadata(&path).map_err(|_| DENIED)?.len() > 16 * 1024 * 1024 {
        return Err(DENIED);
    }
    let provenance: serde_json::Value =
        serde_json::from_slice(&fs::read(path).map_err(|_| DENIED)?).map_err(|_| DENIED)?;
    if provenance["sourceFingerprint"].as_str() != Some(descriptor.source_fingerprint.as_str())
        || option_env!("TRAINER_ORDINARY_SOURCE") != Some(descriptor.source_fingerprint.as_str())
    {
        return Err(DENIED);
    }
    for entry in provenance["files"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 50_000)
        .ok_or(DENIED)?
    {
        let path = entry["path"].as_str().ok_or(DENIED)?;
        if path.starts_with('/')
            || path
                .split('/')
                .any(|c| c.is_empty() || c == "." || c == "..")
        {
            return Err(DENIED);
        }
        if files
            .get(&format!("Contents/Resources/resources/{path}"))
            .map(String::as_str)
            != entry["sha256"].as_str()
        {
            return Err(DENIED);
        }
    }
    Ok(())
}

impl Admission {
    pub fn load(path: &Path) -> Result<Self, &'static str> {
        if cfg!(debug_assertions)
            || cfg!(feature = "release-probe")
            || std::env::var_os("TRAINER_SMOKE_CONFIG").is_some()
        {
            return Err(DENIED);
        }
        Self::admit(path, verify_artifact)
    }
    fn admit(
        path: &Path,
        artifact: impl FnOnce(&Descriptor) -> Result<(), &'static str>,
    ) -> Result<Self, &'static str> {
        let descriptor_capture = private_store::capture(path)?;
        let bytes = &descriptor_capture.2;
        if bytes.len() > 16 * 1024 {
            return Err(DENIED);
        }
        let descriptor: Descriptor = serde_json::from_slice(&bytes).map_err(|_| DENIED)?;
        descriptor.validate(path)?;
        let root = private_store::PinnedDirectory::open(&descriptor.root)?;
        root.lock_exclusive()?;
        // Read again after taking the lifetime lease, refusing a descriptor swap.
        let owner_capture = private_store::capture(&descriptor.root.join("owner"))?;
        if private_store::capture(path)? != descriptor_capture
            || owner_capture.2 != descriptor.run_id.as_bytes()
        {
            return Err(DENIED);
        }
        let mut directories = vec![root];
        for name in DIRECTORIES {
            // Tokens are optional; their absence never grants fallback to normal stores.
            if name == "tokens" && !descriptor.root.join(name).exists() {
                continue;
            }
            directories.push(private_store::PinnedDirectory::open(
                &descriptor.root.join(name),
            )?);
        }
        let database = database_identity(&descriptor.root.join("trainer.sqlite"))?;
        artifact(&descriptor)?;
        let admission = Self {
            descriptor,
            boot: uuid::Uuid::new_v4().to_string(),
            directories,
            database,
            descriptor_capture,
            owner_capture,
        };
        admission.verify_settings()?;
        Ok(admission)
    }
    pub fn settings(&self) -> PathBuf {
        // Newest presence is authority, even if invalid; never select legacy v1.
        let next = self.descriptor.root.join("config/settings-v3.json");
        if !matches!(fs::symlink_metadata(&next), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
        {
            next
        } else {
            self.descriptor.root.join("config/settings-v2.json")
        }
    }
    pub fn identifier(&self) -> String {
        format!(
            "com.codexa.garmin-trainer.ordinary.r{}",
            self.descriptor.run_id.replace('-', "")
        )
    }
    pub fn verify(&self) -> Result<(), &'static str> {
        for directory in &self.directories {
            directory.verify()?;
        }
        if database_identity(&self.descriptor.root.join("trainer.sqlite"))? != self.database
            || private_store::capture(&self.descriptor.root.join("launch.json"))?
                != self.descriptor_capture
            || private_store::capture(&self.descriptor.root.join("owner"))? != self.owner_capture
        {
            return Err(DENIED);
        }
        for sidecar in ["trainer.sqlite-wal", "trainer.sqlite-shm"] {
            let path = self.descriptor.root.join(sidecar);
            match fs::symlink_metadata(&path) {
                Ok(meta)
                    if meta.is_file()
                        && meta.nlink() == 1
                        && meta.uid() == unsafe { libc::getuid() }
                        && meta.mode() & 0o077 == 0
                        && fs::canonicalize(&path).ok().as_deref() == Some(path.as_path()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(DENIED),
            }
        }
        Ok(())
    }
    pub fn confine(&self, fields: &BTreeMap<String, String>) -> Result<(), &'static str> {
        self.verify()?;
        if fields.get("DATABASE_PATH").map(PathBuf::from)
            != Some(self.descriptor.root.join("trainer.sqlite"))
        {
            return Err(DENIED);
        }
        if let Some(tokens) = fields.get("GARMIN_MCP_TOKEN_DIR").filter(|s| !s.is_empty()) {
            if PathBuf::from(tokens) != self.descriptor.root.join("tokens") {
                return Err(DENIED);
            }
            let _ = private_store::PinnedDirectory::open(&self.descriptor.root.join("tokens"))?;
            // Inspect metadata only. Token contents remain owned by the ordinary integration.
            for name in ["garmin_tokens.json", "garmin_tokens.base64"] {
                let token = self.descriptor.root.join("tokens").join(name);
                if token.exists() {
                    settings::private_file(&token)?;
                }
            }
        }
        Ok(())
    }
    pub fn verify_settings(&self) -> Result<(), &'static str> {
        self.verify()?;
        let saved = settings::load(&self.settings())?;
        if ![2, 3].contains(&saved.version) {
            return Err(DENIED);
        }
        self.confine(&saved.fields)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn fixture() -> (PathBuf, PathBuf) {
        let id = uuid::Uuid::new_v4().to_string();
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("ordinary-{id}"));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        for name in DIRECTORIES {
            fs::create_dir(root.join(name)).unwrap();
            fs::set_permissions(root.join(name), fs::Permissions::from_mode(0o700)).unwrap();
        }
        let write = |path: PathBuf, bytes: Vec<u8>| {
            fs::write(&path, bytes).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        };
        write(root.join("owner"), id.as_bytes().to_vec());
        write(
            root.join("trainer.sqlite"),
            b"identity-only fixture; production DB validators still bind".to_vec(),
        );
        write(root.join("config/settings-v2.json"), serde_json::to_vec(&serde_json::json!({"version":2,"keys":{},"fields":{"DATABASE_PATH":root.join("trainer.sqlite")}})).unwrap());
        let path = root.join("launch.json");
        write(path.clone(), serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"runId":id,"root":root,"sourceFingerprint":"a".repeat(64),"artifactInventoryHash":"b".repeat(64),"controlPort":23567,"capability":"c".repeat(64)})).unwrap());
        (root, path)
    }
    #[test]
    fn argument_intent_is_exact_and_never_falls_back() {
        let args = |values: &[&str]| {
            values
                .iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>()
        };
        assert!(intent(&[]).unwrap().is_none());
        for values in [
            vec!["--isolated-smoke-run"],
            vec!["--isolated-smoke-run=x"],
            vec!["--isolated-smoke-run", "/x", "extra"],
        ] {
            assert!(intent(&args(&values)).is_err());
        }
        assert_eq!(
            intent(&args(&["--isolated-smoke-run", "/x"])).unwrap(),
            Some(PathBuf::from("/x"))
        );
    }
    #[test]
    fn lifetime_lease_restart_generation_and_confinement() {
        let (root, path) = fixture();
        let first = Admission::admit(&path, |_| Ok(())).unwrap();
        assert!(Admission::admit(&path, |_| Ok(())).is_err());
        assert!(first
            .confine(&BTreeMap::from([(
                "DATABASE_PATH".into(),
                "/normal/trainer.sqlite".into()
            )]))
            .is_err());
        let boot = first.boot.clone();
        drop(first);
        let second = Admission::admit(&path, |_| Ok(())).unwrap();
        assert_ne!(boot, second.boot);
        drop(second);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn newest_file_backed_authority_stays_confined_without_invalid_or_legacy_fallback() {
        let (root, path) = fixture();
        let prior = fs::read(root.join("config/settings-v2.json")).unwrap();
        let admission = Admission::admit(&path, |_| Ok(())).unwrap();
        let next = root.join("config/settings-v3.json");
        let mut value = serde_json::json!({"version":3,"keys":{},"fields":{"DATABASE_PATH":root.join("trainer.sqlite")},"chatCatalog":crate::chat_catalog::Catalog::default()});
        fs::write(&next, serde_json::to_vec(&value).unwrap()).unwrap();
        fs::set_permissions(&next, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(admission.settings(), next);
        assert!(admission.verify_settings().is_ok());
        assert_eq!(
            fs::read(root.join("config/settings-v2.json")).unwrap(),
            prior
        );
        value["fields"]["DATABASE_PATH"] = serde_json::json!("/normal/trainer.sqlite");
        fs::write(&next, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(admission.verify_settings().is_err());
        fs::write(&next, b"corrupt newest authority").unwrap();
        assert_eq!(admission.settings(), next);
        assert!(admission.verify_settings().is_err());
        drop(admission);
        assert!(Admission::admit(&path, |_| Ok(())).is_err());
        assert_eq!(
            fs::read(root.join("config/settings-v2.json")).unwrap(),
            prior
        );
        fs::remove_file(next).unwrap();
        fs::remove_file(root.join("config/settings-v2.json")).unwrap();
        let legacy = root.join("config/settings-v1.json");
        fs::write(&legacy, serde_json::to_vec(&serde_json::json!({"version":1,"keys":{},"fields":{"DATABASE_PATH":root.join("trainer.sqlite")}})).unwrap()).unwrap();
        fs::set_permissions(&legacy, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(Admission::admit(&path, |_| Ok(())).is_err());
        assert!(legacy.exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn malformed_version_unknown_fields_aliases_and_linked_database_refuse() {
        let (root, path) = fixture();
        let original = fs::read(&path).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&original).unwrap();
        for (key, data) in [
            ("schemaVersion", serde_json::json!(99)),
            ("unknown", serde_json::json!(true)),
            ("controlPort", serde_json::json!(80)),
            ("sourceFingerprint", serde_json::json!("bad")),
        ] {
            let mut changed = value.clone();
            changed[key] = data;
            fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
            assert!(Admission::admit(&path, |_| Ok(())).is_err());
        }
        fs::write(&path, &original).unwrap();
        fs::hard_link(root.join("trainer.sqlite"), root.join("linked.sqlite")).unwrap();
        assert!(Admission::admit(&path, |_| Ok(())).is_err());
        fs::remove_file(root.join("linked.sqlite")).unwrap();
        let alias = root.join("alias.json");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(Admission::admit(&alias, |_| Ok(())).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn aliases_swaps_insecure_objects_and_artifact_claims_refuse() {
        let (root, path) = fixture();
        assert!(Admission::admit(&path, |_| Err("artifact mismatch")).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(Admission::admit(&path, |_| Ok(())).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let admission = Admission::admit(&path, |_| Ok(())).unwrap();
        fs::rename(root.join("config"), root.join("old-config")).unwrap();
        fs::create_dir(root.join("config")).unwrap();
        assert!(admission.verify().is_err());
        drop(admission);
        fs::remove_dir_all(root).unwrap();
    }
}
