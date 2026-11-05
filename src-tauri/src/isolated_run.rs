//! Explicit ordinary-artifact admission. No ambient enabling environment or default-state lookup.
//! Only the named, separately authorized provider preset delegates opaque key use to its native owner.
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
pub const CONTRACT: &str = "trainer-ordinary-isolated/v2";
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

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HistorySetup {
    CreateNew,
    UseExisting,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Descriptor {
    schema_version: u8,
    pub run_id: String,
    pub root: PathBuf,
    pub source_fingerprint: String,
    pub build_source_fingerprint: String,
    pub build_context: String,
    pub artifact_inventory_hash: String,
    pub control_port: u16,
    pub capability: String,
    #[serde(default)]
    pub history_setup: Option<HistorySetup>,
    #[serde(default)]
    pub provider_smoke: Option<crate::provider_smoke::Mode>,
}

pub struct Admission {
    pub descriptor: Descriptor,
    pub boot: String,
    directories: Vec<private_store::PinnedDirectory>,
    database: std::sync::Mutex<Option<(u64, u64)>>,
    descriptor_capture: (u64, u64, Vec<u8>),
    owner_capture: (u64, u64, Vec<u8>),
    provider_source: std::sync::Mutex<Option<crate::provider_smoke::Capture>>,
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
        if (self.provider_smoke.is_some() && self.history_setup.is_some())
            || self.schema_version != 2
            || uuid::Uuid::parse_str(&self.run_id)
                .map(|id| id.to_string())
                .ok()
                .as_deref()
                != Some(self.run_id.as_str())
            || !hex(&self.capability)
            || !hex(&self.source_fingerprint)
            || !hex(&self.build_source_fingerprint)
            || !hex(&self.build_context)
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

pub fn wait_for_owner_loss(input: &mut impl Read) {
    let mut byte = [0u8; 1];
    loop {
        match input.read(&mut byte) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            _ => return, // EOF, unexpected data or failure: stop only our own instance.
        }
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

fn verify_build_identity(
    provenance: &serde_json::Value,
    descriptor: &Descriptor,
    compiled: [Option<&str>; 3],
) -> Result<(), &'static str> {
    if provenance["version"].as_u64() != Some(2) {
        return Err(DENIED);
    }
    for ((field, expected), compiled) in [
        ("sourceFingerprint", descriptor.source_fingerprint.as_str()),
        (
            "buildSourceFingerprint",
            descriptor.build_source_fingerprint.as_str(),
        ),
        ("buildContext", descriptor.build_context.as_str()),
    ]
    .into_iter()
    .zip(compiled)
    {
        if provenance[field].as_str() != Some(expected) || compiled != Some(expected) {
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
    verify_build_identity(
        &provenance,
        descriptor,
        [
            option_env!("TRAINER_ORDINARY_SOURCE"),
            option_env!("TRAINER_ORDINARY_BUILD_SOURCE"),
            option_env!("TRAINER_ORDINARY_BUILD_CONTEXT"),
        ],
    )?;
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
        let admission = Self::admit(path, verify_artifact)?;
        if admission.descriptor.history_setup.is_some()
            || admission.descriptor.provider_smoke.is_some()
        {
            // History/provider automation must retain a real ownership pipe, not a terminal,
            // file, environment marker or stored parent PID.
            let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
            if unsafe { libc::fstat(libc::STDIN_FILENO, metadata.as_mut_ptr()) } != 0
                || unsafe { metadata.assume_init() }.st_mode & libc::S_IFMT != libc::S_IFIFO
            {
                return Err(DENIED);
            }
        }
        Ok(admission)
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
        let missing_settings = Self::missing_settings_at(&descriptor.root);
        let database_path = descriptor.root.join("trainer.sqlite");
        let database = if matches!(descriptor.history_setup, Some(HistorySetup::CreateNew))
            && missing_settings
        {
            if !matches!(fs::symlink_metadata(&database_path), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
            {
                return Err(DENIED);
            }
            None
        } else {
            Some(database_identity(&database_path)?)
        };
        artifact(&descriptor)?;
        let admission = Self {
            descriptor,
            boot: uuid::Uuid::new_v4().to_string(),
            directories,
            database: std::sync::Mutex::new(database),
            descriptor_capture,
            owner_capture,
            provider_source: std::sync::Mutex::new(None),
        };
        admission.verify_settings()?;
        Ok(admission)
    }
    fn missing_settings_at(root: &Path) -> bool {
        ["settings-v1.json", "settings-v2.json", "settings-v3.json"].iter().all(|name| {
            matches!(fs::symlink_metadata(root.join("config").join(name)), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
        })
    }
    pub fn initialize_created_database<'a>(
        &self,
        initialize: impl FnOnce() -> Result<&'a crate::onboarding::OwnedDatabase, &'static str>,
    ) -> Result<(), &'static str> {
        if !matches!(self.descriptor.history_setup, Some(HistorySetup::CreateNew)) {
            return Err(DENIED);
        }
        // Identity reads must not observe the gap between exclusive publication
        // and binding its native OwnedDatabase proof. Never adopt an arbitrary
        // file or retry a failed admission check to hide that interval.
        let mut identity = self.database.lock().map_err(|_| DENIED)?;
        let owned = initialize()?;
        let path = self.descriptor.root.join("trainer.sqlite");
        owned.verify(&path)?;
        let current = database_identity(&path)?;
        if identity.map(|prior| prior != current).unwrap_or(false) {
            return Err(DENIED);
        }
        *identity = Some(current);
        Ok(())
    }
    pub fn accepts_history_settings(&self, input: &settings::SaveInput) -> bool {
        if self.descriptor.history_setup.is_none()
            || self.confine(&input.fields).is_err()
            || !input
                .keys
                .values()
                .all(|intent| matches!(intent, settings::KeyUpdate::Unchanged))
        {
            return false;
        }
        let saved = if Self::missing_settings_at(&self.descriptor.root) {
            settings::Settings::default()
        } else {
            match settings::load(&self.settings()) {
                Ok(saved) => saved,
                Err(_) => return false,
            }
        };
        if !saved.keys.is_empty() {
            return false;
        }
        let expected_catalog = if saved.version == 0 {
            crate::chat_catalog::Catalog::default()
        } else {
            saved
                .chat_catalog
                .clone()
                .unwrap_or_else(|| crate::chat_catalog::legacy(&saved.fields, &Default::default()))
        };
        if input.chat_catalog != expected_catalog {
            return false;
        }
        let Ok(catalog) = serde_json::from_str::<Vec<serde_json::Value>>(include_str!(
            "../ui/settings-fields.json"
        )) else {
            return false;
        };
        let cloud_summary = input.fields.get("SUMMARY_MODEL")
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            == Some(serde_json::json!({"version":1,"entryId":"entry_summary_cloud","provider":"openai","modelId":"gpt-6-luna"}))
            && expected_catalog.entries.iter().any(|entry| entry.id == "entry_summary_cloud" && entry.provider == "openai" && entry.model_id == "gpt-6-luna");
        let catalog_summary = input
            .fields
            .get("SUMMARY_MODEL")
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            == Some(
                serde_json::json!({"version":1,"entryId":"entry_summary_local","provider":"ollama","modelId":"synthetic-memory:small"}),
            )
            && expected_catalog.entries.iter().any(|entry| {
                entry.id == "entry_summary_local"
                    && entry.provider == "ollama"
                    && entry.model_id == "synthetic-memory:small"
            });
        let summary_preset = matches!(
            self.descriptor.history_setup,
            Some(HistorySetup::UseExisting)
        ) && saved.version == 3
            && matches!(
                input.fields.get("SUMMARY_ENABLED").map(String::as_str),
                Some("true" | "false")
            )
            && (catalog_summary || cloud_summary
                || input.fields.get("SUMMARY_MODEL").map(String::as_str) == Some("gpt-6-luna"))
            && input.fields.get("SUMMARY_CHAR_LIMIT").map(String::as_str) == Some("6000");
        input.fields.iter().all(|(key, value)| {
            if summary_preset
                && matches!(
                    key.as_str(),
                    "SUMMARY_ENABLED" | "SUMMARY_MODEL" | "SUMMARY_CHAR_LIMIT"
                )
            {
                return true;
            }
            if key == "DATABASE_PATH" {
                return PathBuf::from(value) == self.descriptor.root.join("trainer.sqlite");
            }
            if key == "GARMIN_HISTORY_START_DATE" {
                return value.is_empty() || value == "2024-01-01";
            }
            if key == "GARMIN_MCP_TOKEN_DIR" {
                return value == saved.fields.get(key).map(String::as_str).unwrap_or("");
            }
            if let Some(expected) = saved.fields.get(key) {
                return value == expected;
            }
            catalog
                .iter()
                .find(|field| field["key"].as_str() == Some(key.as_str()))
                .map(|field| {
                    let default = field
                        .get("default")
                        .and_then(|v| v.as_str())
                        .or_else(|| {
                            field
                                .get("options")
                                .and_then(|v| v.as_array())
                                .and_then(|v| v.first())
                                .and_then(|v| v.as_str())
                        })
                        .unwrap_or("");
                    value == default
                })
                .unwrap_or(false)
        })
    }
    pub fn accepts_finish(&self, input: &crate::onboarding::FinishInput) -> bool {
        if input
            .settings
            .fields
            .get("GARMIN_HISTORY_START_DATE")
            .map(|value| !value.is_empty())
            .unwrap_or(false)
        {
            return false;
        }
        matches!(
            (&self.descriptor.history_setup, &input.selection),
            (
                Some(HistorySetup::CreateNew),
                crate::onboarding::Selection::CreateNew
            ) | (
                Some(HistorySetup::UseExisting),
                crate::onboarding::Selection::UseExisting
            )
        ) && self.accepts_history_settings(&input.settings)
    }
    pub fn settings(&self) -> PathBuf {
        // Reuse the private-file owner: newest presence wins; genuine absence
        // selects the current v3 destination. verify_settings still refuses v1.
        settings::selected(&self.descriptor.root.join("config"))
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
        let identity = *self.database.lock().map_err(|_| DENIED)?;
        let database_ok = match identity {
            Some(expected) => {
                database_identity(&self.descriptor.root.join("trainer.sqlite"))? == expected
            }
            None => {
                matches!(self.descriptor.history_setup, Some(HistorySetup::CreateNew))
                    && matches!(fs::symlink_metadata(self.descriptor.root.join("trainer.sqlite")), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
            }
        };
        if !database_ok
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
    pub fn provider_activation(&self, path: &Path) -> Result<Vec<u8>, &'static str> {
        self.verify_settings()?;
        let Some(mode) = self.descriptor.provider_smoke else {
            return settings::activation(path);
        };
        let (frame, capture) = crate::provider_smoke::activation(
            path,
            &crate::provider_smoke::production_directory()?,
            mode,
        )?;
        *self.provider_source.lock().map_err(|_| DENIED)? = Some(capture);
        Ok(frame)
    }
    pub fn provider_source_unchanged(&self) -> bool {
        self.provider_source
            .lock()
            .ok()
            .and_then(|source| source.as_ref().map(|source| source.unchanged()))
            .unwrap_or(false)
    }
    pub fn verify_settings(&self) -> Result<(), &'static str> {
        self.verify()?;
        if self.descriptor.history_setup.is_some()
            && Self::missing_settings_at(&self.descriptor.root)
        {
            return Ok(());
        }
        let saved = settings::load(&self.settings())?;
        if ![2, 3].contains(&saved.version)
            || (self.descriptor.history_setup.is_some() && !saved.keys.is_empty())
        {
            return Err(DENIED);
        }
        self.confine(&saved.fields)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn finite_provider_scope_never_combines_with_history_setup() {
        let (_root, path) = fixture();
        let mut descriptor: Descriptor = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        for mode in [
            crate::provider_smoke::Mode::OpenaiLuna025,
            crate::provider_smoke::Mode::OpenaiLuna100,
            crate::provider_smoke::Mode::SummaryLuna100,
            crate::provider_smoke::Mode::IntegratedMemoryLuna200,
            crate::provider_smoke::Mode::CapacityLuna5000,
        ] {
            descriptor.history_setup = None;
            descriptor.provider_smoke = Some(mode);
            assert!(descriptor.validate(&path).is_ok());
            descriptor.history_setup = Some(HistorySetup::UseExisting);
            assert!(descriptor.validate(&path).is_err());
        }
    }
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
        write(path.clone(), serde_json::to_vec(&serde_json::json!({"schemaVersion":2,"runId":id,"root":root,"sourceFingerprint":"a".repeat(64),"buildSourceFingerprint":"d".repeat(64),"buildContext":"e".repeat(64),"artifactInventoryHash":"b".repeat(64),"controlPort":23567,"capability":"c".repeat(64)})).unwrap());
        (root, path)
    }
    #[test]
    fn separated_build_identity_requires_exact_versioned_compiled_resource_descriptor_agreement() {
        let (root, path) = fixture();
        let bytes = fs::read(&path).unwrap();
        let descriptor: Descriptor = serde_json::from_slice(&bytes).unwrap();
        let good = serde_json::json!({"version":2,"sourceFingerprint":"a".repeat(64),"buildSourceFingerprint":"d".repeat(64),"buildContext":"e".repeat(64)});
        let compiled = [
            Some(descriptor.source_fingerprint.as_str()),
            Some(descriptor.build_source_fingerprint.as_str()),
            Some(descriptor.build_context.as_str()),
        ];
        assert!(verify_build_identity(&good, &descriptor, compiled).is_ok());
        for field in [
            "version",
            "sourceFingerprint",
            "buildSourceFingerprint",
            "buildContext",
        ] {
            let mut bad = good.clone();
            bad[field] = serde_json::json!("unsupported-or-mismatch");
            assert!(verify_build_identity(&bad, &descriptor, compiled).is_err());
            bad.as_object_mut().unwrap().remove(field);
            assert!(verify_build_identity(&bad, &descriptor, compiled).is_err());
        }
        for index in 0..3 {
            let mut bad = compiled;
            bad[index] = None;
            assert!(verify_build_identity(&good, &descriptor, bad).is_err());
            bad[index] = Some("wrong compiled identity");
            assert!(verify_build_identity(&good, &descriptor, bad).is_err());
        }
        let mut legacy: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        legacy["schemaVersion"] = serde_json::json!(1);
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert!(Admission::admit(&path, |_| Ok(())).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn owner_loss_is_bounded_and_does_not_need_a_saved_pid() {
        use std::os::unix::net::UnixStream;
        let (mut reader, owner) = UnixStream::pair().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || {
            wait_for_owner_loss(&mut reader);
            tx.send(()).unwrap();
        });
        drop(owner);
        rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        thread.join().unwrap();
        let mut unexpected_data = std::io::Cursor::new(vec![1u8; 4096]);
        wait_for_owner_loss(&mut unexpected_data);
        assert_eq!(unexpected_data.position(), 1); // No command parsing/unbounded buffering.
    }
    #[test]
    fn missing_settings_and_fresh_database_need_exact_explicit_history_scope() {
        let (root, path) = fixture();
        fs::remove_file(root.join("config/settings-v2.json")).unwrap();
        assert!(Admission::admit(&path, |_| Ok(())).is_err());
        let mut descriptor: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        descriptor["historySetup"] = serde_json::json!("use-existing");
        fs::write(&path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let existing = Admission::admit(&path, |_| Ok(())).unwrap();
        assert!(existing.verify_settings().is_ok());
        let newest = root.join("config/settings-v3.json");
        assert_eq!(existing.settings(), newest);
        let saved = serde_json::json!({"version":3,"keys":{},"fields":{"DATABASE_PATH":root.join("trainer.sqlite")},"chatCatalog":crate::chat_catalog::Catalog::default()});
        fs::write(&newest, serde_json::to_vec(&saved).unwrap()).unwrap();
        fs::set_permissions(&newest, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(existing.verify_settings().is_ok());
        fs::remove_file(&newest).unwrap();
        let conflict = root.join("config/settings-v2.json");
        fs::write(&conflict, serde_json::to_vec(&saved).unwrap()).unwrap();
        fs::set_permissions(&conflict, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(existing.verify_settings().is_err()); // Filename/version guard remains binding.
        fs::remove_file(conflict).unwrap();
        drop(existing);
        descriptor["historySetup"] = serde_json::json!("create-new");
        fs::write(&path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        assert!(Admission::admit(&path, |_| Ok(())).is_err()); // Collision is not adoption.
        fs::remove_file(root.join("trainer.sqlite")).unwrap();
        let fresh = Admission::admit(&path, |_| Ok(())).unwrap();
        let fields = BTreeMap::from([(
            "DATABASE_PATH".into(),
            root.join("trainer.sqlite").to_string_lossy().into_owned(),
        )]);
        let input = settings::SaveInput {
            fields,
            keys: Default::default(),
            chat_catalog: Default::default(),
            expected_revision: "missing".into(),
        };
        assert!(fresh.accepts_history_settings(&input));
        let mut bad = input;
        bad.fields
            .insert("GARMIN_MCP_COMMAND".into(), "/external/command".into());
        assert!(!fresh.accepts_history_settings(&bad));
        bad.fields.remove("GARMIN_MCP_COMMAND");
        bad.keys
            .insert("OPENAI_API_KEY".into(), settings::KeyUpdate::Clear);
        assert!(!fresh.accepts_history_settings(&bad));
        fs::write(root.join("trainer.sqlite"), b"unbound external publication").unwrap();
        assert!(fresh.verify().is_err()); // Only native OwnedDatabase can bind a new identity.
        drop(fresh);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn summary_save_accepts_only_two_keyless_existing_presets_without_other_mutations() {
        let (root, path) = fixture();
        let mut descriptor: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        descriptor["historySetup"] = serde_json::json!("use-existing");
        fs::write(&path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let fields = BTreeMap::from([
            (
                "DATABASE_PATH".into(),
                root.join("trainer.sqlite").to_string_lossy().into_owned(),
            ),
            ("MEMORY_ENABLED".into(), "false".into()),
            ("SUMMARY_ENABLED".into(), "false".into()),
            ("SUMMARY_MODEL".into(), "unselected".into()),
            ("SUMMARY_CHAR_LIMIT".into(), "6000".into()),
        ]);
        let authored_catalog: crate::chat_catalog::Catalog = serde_json::from_value(serde_json::json!({"version":1,"entries":[{"id":"entry_summary_local","provider":"ollama","modelId":"synthetic-memory:small"},{"id":"entry_summary_cloud","provider":"openai","modelId":"gpt-6-luna"}],"defaultEntryId":null})).unwrap();
        let saved = serde_json::json!({"version":3,"fields":fields,"keys":{},"chatCatalog":authored_catalog.clone()});
        let v3 = root.join("config/settings-v3.json");
        fs::write(&v3, serde_json::to_vec(&saved).unwrap()).unwrap();
        fs::set_permissions(&v3, fs::Permissions::from_mode(0o600)).unwrap();
        let admission = Admission::admit(&path, |_| Ok(())).unwrap();
        let mut input = settings::SaveInput {
            fields,
            keys: Default::default(),
            chat_catalog: Default::default(),
            expected_revision: "synthetic".into(),
        };
        input.chat_catalog = authored_catalog;
        input
            .fields
            .insert("SUMMARY_MODEL".into(), "gpt-6-luna".into());
        for enabled in ["true", "false"] {
            input
                .fields
                .insert("SUMMARY_ENABLED".into(), enabled.into());
            assert!(admission.accepts_history_settings(&input));
        }
        input.fields.insert("SUMMARY_MODEL".into(), serde_json::json!({"version":1,"entryId":"entry_summary_local","provider":"ollama","modelId":"synthetic-memory:small"}).to_string());
        assert!(admission.accepts_history_settings(&input));
        let valid_choice = input.fields["SUMMARY_MODEL"].clone();
        for model in ["gpt-6-luna", "GPT-6-luna", "different"] {
            input.fields.insert("SUMMARY_MODEL".into(), serde_json::json!({"version":1,"entryId":"entry_summary_cloud","provider":"openai","modelId":model}).to_string());
            assert_eq!(admission.accepts_history_settings(&input), model == "gpt-6-luna");
        }
        input.fields.insert("SUMMARY_MODEL".into(), serde_json::json!({"version":1,"entryId":"entry_summary_local","provider":"ollama","modelId":"synthetic-memory:small","extra":true}).to_string());
        assert!(!admission.accepts_history_settings(&input));
        input.fields.insert("SUMMARY_MODEL".into(), valid_choice);
        for (key, value) in [
            ("SUMMARY_MODEL", "other-model"),
            ("SUMMARY_CHAR_LIMIT", "1000"),
            ("SUMMARY_ENABLED", "unexpected"),
            ("MEMORY_ENABLED", "true"),
            ("AI_MODEL", "other-model"),
        ] {
            let previous = input.fields.insert(key.into(), value.into());
            assert!(!admission.accepts_history_settings(&input), "{key}");
            match previous {
                Some(value) => {
                    input.fields.insert(key.into(), value);
                }
                None => {
                    input.fields.remove(key);
                }
            }
        }
        input
            .keys
            .insert("OPENAI_API_KEY".into(), settings::KeyUpdate::Clear);
        assert!(!admission.accepts_history_settings(&input));
        assert_eq!(fs::read(&v3).unwrap(), serde_json::to_vec(&saved).unwrap());
    }
    #[test]
    fn native_creation_and_identity_binding_are_one_observed_transition() {
        let (root, path) = fixture();
        fs::remove_file(root.join("config/settings-v2.json")).unwrap();
        fs::remove_file(root.join("trainer.sqlite")).unwrap();
        let mut descriptor: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        descriptor["historySetup"] = serde_json::json!("create-new");
        fs::write(&path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let fresh = Admission::admit(&path, |_| Ok(())).unwrap();
        let (published_tx, published_rx) = std::sync::mpsc::channel();
        let (continue_tx, continue_rx) = std::sync::mpsc::channel();
        let (verified_tx, verified_rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            let creator_admission = &fresh;
            let creator_root = &root;
            let creator = scope.spawn(move || {
                let mut owned = None;
                creator_admission.initialize_created_database(|| {
                    fs::write(
                        creator_root.join("trainer.sqlite"),
                        b"owned native publication fixture",
                    )
                    .unwrap();
                    fs::set_permissions(
                        creator_root.join("trainer.sqlite"),
                        fs::Permissions::from_mode(0o600),
                    )
                    .unwrap();
                    owned = Some(crate::onboarding::OwnedDatabase::capture_test_publication(
                        &creator_root.join("trainer.sqlite"),
                    ));
                    published_tx.send(()).unwrap();
                    continue_rx.recv().unwrap();
                    Ok(owned.as_ref().unwrap())
                })
            });
            published_rx.recv().unwrap();
            scope.spawn(|| {
                verified_tx.send(fresh.verify()).unwrap();
            });
            assert!(verified_rx
                .recv_timeout(std::time::Duration::from_millis(30))
                .is_err());
            continue_tx.send(()).unwrap();
            assert!(creator.join().unwrap().is_ok());
            assert!(verified_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap()
                .is_ok());
        });
        drop(fresh);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_or_out_of_scope_creation_never_binds_an_unowned_file() {
        let (root, path) = fixture();
        let existing = Admission::admit(&path, |_| Ok(())).unwrap();
        assert!(existing
            .initialize_created_database(|| panic!("Out-of-scope mutation"))
            .is_err());
        drop(existing);
        fs::remove_file(root.join("config/settings-v2.json")).unwrap();
        fs::remove_file(root.join("trainer.sqlite")).unwrap();
        let mut descriptor: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        descriptor["historySetup"] = serde_json::json!("create-new");
        fs::write(&path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let fresh = Admission::admit(&path, |_| Ok(())).unwrap();
        assert!(fresh
            .initialize_created_database(|| {
                fs::write(
                    root.join("trainer.sqlite"),
                    b"failed or foreign publication",
                )
                .unwrap();
                Err("Native creation failed")
            })
            .is_err());
        assert!(fresh.verify().is_err());
        drop(fresh);
        fs::remove_dir_all(root).unwrap();
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
