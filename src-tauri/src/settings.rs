use crate::{
    chat_catalog::{self, Catalog},
    keychain::Secrets,
    private_store,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const SLOTS: [&str; 3] = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"];
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub version: u8,
    pub fields: BTreeMap<String, String>,
    pub keys: BTreeMap<String, String>,
    #[serde(
        rename = "chatCatalog",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub chat_catalog: Option<Catalog>,
}
#[derive(Deserialize)]
#[serde(tag = "intent", rename_all = "lowercase", deny_unknown_fields)]
pub enum KeyUpdate {
    Unchanged,
    Replace { value: String },
    Clear,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveInput {
    pub fields: BTreeMap<String, String>,
    pub keys: BTreeMap<String, KeyUpdate>,
    #[serde(rename = "chatCatalog")]
    pub chat_catalog: Catalog,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: String,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub fields: BTreeMap<String, String>,
    pub keys: BTreeMap<String, &'static str>,
    pub saved: bool,
    pub running: bool,
    pub storage: &'static str,
    #[serde(rename = "chatCatalog")]
    pub chat_catalog: Catalog,
    pub revision: String,
}
const LEGACY: &str = "Legacy provider settings require explicit adoption or private re-entry in Desktop Settings. No automatic Keychain access.";
/// Presence, not successful parsing, selects the newest format. No fallback.
pub fn selected(directory: &Path) -> PathBuf {
    for name in ["settings-v3.json", "settings-v2.json", "settings-v1.json"] {
        let path = directory.join(name);
        if !matches!(fs::symlink_metadata(&path), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
        {
            return path;
        }
    }
    directory.join("settings-v3.json")
}
// Retained metadata contract for independent Garmin/smoke inputs. Provider
// documents and onboarding identity use descriptor-bound private_store IO.
pub fn private_file(path: &Path) -> Result<(), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|_| "Private file missing or unreadable.")?;
    if !path.is_absolute()
        || !meta.is_file()
        || meta.nlink() != 1
        || meta.uid() != unsafe { libc::getuid() }
        || meta.mode() & 0o077 != 0
        || meta.len() > 128 * 1024
        || fs::canonicalize(path).ok().as_deref() != Some(path)
    {
        return Err("Private file must be bounded, owner-private, regular and unaliased.");
    }
    Ok(())
}
fn valid_secret(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| c == '-' || c == '_' || c.is_whitespace())
        .collect();
    !lower.is_empty()
        && value.len() <= 16384
        && !value.chars().any(char::is_control)
        && lower != "..."
        && !(lower.starts_with('<') && lower.ends_with('>'))
        && !words
            .first()
            .map(|word| {
                [
                    "replace",
                    "your",
                    "example",
                    "placeholder",
                    "changeme",
                    "todo",
                ]
                .contains(word)
            })
            .unwrap_or(false)
        && !words
            .iter()
            .any(|word| ["replace", "placeholder", "changeme"].contains(word))
}
fn decode(bytes: &[u8]) -> Result<Settings, &'static str> {
    let settings: Settings = serde_json::from_slice(bytes)
        .map_err(|_| "Private settings invalid; preserve originals and use a compatible build.")?;
    let catalog: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../ui/settings-fields.json"))
            .map_err(|_| "Settings catalog unavailable.")?;
    if settings.fields.iter().any(|(key, value)| {
        !catalog
            .iter()
            .any(|field| field["key"].as_str() == Some(key))
            || value.len() > 2048
            || value.chars().any(char::is_control)
    }) {
        return Err("Saved settings contain unsupported fields; no values are returned.");
    }
    if settings.version == 3 {
        settings
            .chat_catalog
            .as_ref()
            .ok_or("Chat catalog missing; preserve settings and use a compatible build.")?
            .validate()?;
    } else if settings.chat_catalog.is_some() {
        return Err("Unexpected catalog on legacy settings; originals preserved.");
    }
    if ![1, 2, 3].contains(&settings.version)
        || settings.keys.iter().any(|(slot, value)| {
            !SLOTS.contains(&slot.as_str())
                || if settings.version == 1 {
                    !value
                        .strip_prefix(&format!("{slot}/"))
                        .map(|id| uuid::Uuid::parse_str(id).is_ok())
                        .unwrap_or(false)
                } else {
                    !valid_secret(value)
                }
        })
    {
        return Err("Settings version or provider slots unsupported; preserve originals.");
    }
    Ok(settings)
}
pub fn load(path: &Path) -> Result<Settings, &'static str> {
    let settings = decode(&private_store::read(path)?)?;
    if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
        if ["settings-v1.json", "settings-v2.json", "settings-v3.json"].contains(&name)
            && name != format!("settings-v{}.json", settings.version)
        {
            return Err("Settings filename/version conflict; preserve originals and use a compatible build.");
        }
    }
    Ok(settings)
}
// No bytes/secrets in this token. Parent/file descriptor privacy checks still
// bind every read/publication; this adds stale whole-form protection.
pub fn revision(path: &Path) -> Result<String, &'static str> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("absent".into()),
        Err(_) => Err("Settings revision unavailable; reload before saving."),
        Ok(m) => {
            private_file(path)?;
            Ok(format!(
                "{}-{}-{}-{}-{}-{}-{}",
                m.dev(),
                m.ino(),
                m.len(),
                m.mtime(),
                m.mtime_nsec(),
                m.ctime(),
                m.ctime_nsec()
            ))
        }
    }
}
fn check_revision(path: &Path, expected: &str) -> Result<(), &'static str> {
    if revision(path)? != expected {
        return Err("Settings changed since this form was loaded. Reload before saving; no changes published.");
    }
    Ok(())
}
pub fn snapshot(path: &Path, running: bool) -> Result<Snapshot, &'static str> {
    let saved =
        !matches!(fs::symlink_metadata(path), Err(e) if e.kind() == std::io::ErrorKind::NotFound);
    let before = revision(path)?;
    let settings = if saved {
        load(path)?
    } else {
        Settings::default()
    };
    let chat_catalog = if saved {
        settings
            .chat_catalog
            .clone()
            .unwrap_or_else(|| chat_catalog::legacy(&settings.fields, &settings.keys))
    } else {
        Catalog::default()
    };
    chat_catalog.validate()?;
    check_revision(path, &before)?;
    Ok(Snapshot {
        chat_catalog,
        revision: before,
        keys: SLOTS
            .iter()
            .map(|slot| {
                (
                    slot.to_string(),
                    if settings.keys.contains_key(*slot) {
                        if settings.version == 1 {
                            "legacy — adoption or re-entry required"
                        } else {
                            "configured"
                        }
                    } else {
                        "not configured"
                    },
                )
            })
            .collect(),
        fields: settings.fields,
        saved,
        running,
        storage: if !saved {
            "new-private-file"
        } else if settings.version == 1 {
            "legacy-required"
        } else if settings.version == 2 {
            "catalog-migration-required"
        } else {
            "private-file"
        },
    })
}
fn apply(next: &mut Settings, updates: BTreeMap<String, KeyUpdate>) -> Result<(), &'static str> {
    for (slot, update) in updates {
        if !SLOTS.contains(&slot.as_str()) {
            return Err("Unknown provider slot.");
        }
        match update {
            KeyUpdate::Unchanged => (),
            KeyUpdate::Clear => {
                next.keys.remove(&slot);
            }
            KeyUpdate::Replace { value } => {
                if !valid_secret(&value) {
                    return Err("Enter a valid replacement key or choose unchanged/clear.");
                }
                next.keys.insert(slot, value);
            }
        }
    }
    Ok(())
}
fn encode(settings: &Settings) -> Result<Vec<u8>, &'static str> {
    let bytes = serde_json::to_vec(settings).map_err(|_| "Cannot encode private settings.")?;
    decode(&bytes)?;
    Ok(bytes)
}
fn message(durable: bool, fresh: bool) -> String {
    let state = if fresh {
        "First-run settings committed."
    } else {
        "Settings committed. Quit and reopen to apply; the running backend is unchanged."
    };
    format!(
        "{state}{}",
        if durable {
            ""
        } else {
            " Verification/directory durability uncertain; reconcile saved state before any retry. Legacy originals retained."
        }
    )
}
pub fn save(path: &Path, input: SaveInput) -> Result<String, &'static str> {
    save_inner(path, input, false)
}
pub fn save_new(path: &Path, input: SaveInput) -> Result<String, &'static str> {
    save_inner(path, input, true)
}
fn save_inner(path: &Path, input: SaveInput, fresh: bool) -> Result<String, &'static str> {
    check_revision(path, &input.expected_revision)?;
    input.chat_catalog.validate()?;
    let exists =
        !matches!(fs::symlink_metadata(path), Err(e) if e.kind() == std::io::ErrorKind::NotFound);
    if fresh && exists {
        return Err("Existing settings preserved; this is not a blank installation.");
    }
    let previous = if exists {
        Some(private_store::read(path)?)
    } else {
        None
    };
    let mut next = if let Some(bytes) = &previous {
        decode(bytes)?
    } else {
        Settings {
            version: 2,
            ..Default::default()
        }
    };
    if next.version == 1 {
        return Err(LEGACY);
    }
    let migrating = exists && next.version == 2;
    next.version = 3;
    next.fields = input.fields;
    next.chat_catalog = Some(input.chat_catalog);
    apply(&mut next, input.keys)?;
    let bytes = encode(&next)?;
    check_revision(path, &input.expected_revision)?;
    let target = if migrating {
        path.with_file_name("settings-v3.json")
    } else {
        path.to_path_buf()
    };
    let durable = private_store::publish(
        &target,
        &bytes,
        if migrating { None } else { previous.as_deref() },
    )?;
    Ok(format!(
        "{}{}",
        message(durable, fresh),
        if migrating {
            " Catalog migration committed; original v2 retained unchanged."
        } else {
            ""
        }
    ))
}
/// Explicit user action only. Never retain a partially retrieved provider set.
/// Re-entry requires a decision for every legacy slot and makes zero legacy calls.
pub fn adoption(
    path: &Path,
    input: SaveInput,
    read_legacy: bool,
    secrets: &impl Secrets,
) -> Result<(Settings, Vec<u8>), &'static str> {
    check_revision(path, &input.expected_revision)?;
    input.chat_catalog.validate()?;
    let original = private_store::read(path)?;
    let old = decode(&original)?;
    if old.version != 1 {
        return Err("Already file-backed; reload settings. Adoption was not repeated.");
    }
    let mut next = Settings {
        version: 3,
        fields: input.fields,
        keys: BTreeMap::new(),
        chat_catalog: Some(input.chat_catalog),
    };
    for (slot, account) in old.keys {
        if matches!(input.keys.get(&slot), None | Some(KeyUpdate::Unchanged)) {
            if !read_legacy {
                return Err("Re-entry required: replace or explicitly clear every legacy configured slot; originals unchanged.");
            }
            let value = secrets.get(&account).map_err(|_| "Legacy access denied, locked or missing. Nothing published; privately re-enter all configured slots or explicitly retry adoption. Originals unchanged.")?;
            if !valid_secret(&value) {
                return Err(
                    "Legacy value invalid. Nothing published; privately re-enter configured slots.",
                );
            }
            next.keys.insert(slot, value);
        }
    }
    apply(&mut next, input.keys)?;
    encode(&next)?;
    Ok((next, original))
}
pub fn commit_adoption(
    path: &Path,
    next: &Settings,
    original: &[u8],
) -> Result<String, &'static str> {
    if next.version != 3 || private_store::read(path)? != original {
        return Err("Legacy settings changed; reload before adoption. Originals preserved.");
    }
    let target = path.with_file_name("settings-v3.json");
    let durable = private_store::publish(&target, &encode(next)?, None)?;
    Ok(format!("Private file adoption committed; legacy settings and Keychain items preserved. Quit and reopen explicitly.{}", if durable { "" } else { " Verification/directory durability uncertain; reconcile saved state before retry." }))
}
fn frame(settings: &Settings) -> Result<Vec<u8>, &'static str> {
    let value = if let Some(catalog) = &settings.chat_catalog {
        catalog.validate()?;
        serde_json::json!({"version":2,"fields":settings.fields,"secrets":settings.keys,"chatCatalog":catalog})
    } else {
        serde_json::json!({"version":1,"fields":settings.fields,"secrets":settings.keys})
    };
    let mut bytes = serde_json::to_vec(&value).map_err(|_| "Activation unavailable.")?;
    if bytes.len() >= 128 * 1024 {
        return Err("Activation too large.");
    }
    bytes.push(b'\n');
    Ok(bytes)
}
pub fn adoption_frame(settings: &Settings) -> Result<Vec<u8>, &'static str> {
    frame(settings)
}
pub fn preview(input: &SaveInput) -> Result<Vec<u8>, &'static str> {
    let mut next = Settings {
        version: 3,
        fields: input.fields.clone(),
        keys: BTreeMap::new(),
        chat_catalog: Some(input.chat_catalog.clone()),
    };
    for (slot, update) in &input.keys {
        if !SLOTS.contains(&slot.as_str()) {
            return Err("Unknown provider slot.");
        }
        if let KeyUpdate::Replace { value } = update {
            if !valid_secret(value) {
                return Err("Invalid replacement provider key.");
            }
            next.keys.insert(slot.clone(), value.clone());
        }
    }
    frame(&next)
}
pub fn activation(path: &Path) -> Result<Vec<u8>, &'static str> {
    let settings = load(path)?;
    if settings.version == 1 {
        return Err(LEGACY);
    }
    frame(&settings)
}

pub fn validate(
    resources: &Path,
    fields: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, &'static str> {
    let mut input = serde_json::to_vec(fields).map_err(|_| "Invalid settings.")?;
    if input.len() > 96 * 1024 {
        return Err("Settings too large.");
    }
    input.push(b'\n');
    let mut child = Command::new(resources.join("node"))
        .arg(resources.join("runtime/runtime.cjs"))
        .arg("--validate-settings")
        .current_dir(resources.join("runtime"))
        .env_clear()
        .env("NODE_ENV", "production")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Settings validator resources unavailable. Rebuild the desktop app.")?;
    let stdout = child.stdout.take().ok_or("Settings result unavailable.")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(128 * 1024 + 1).read_to_end(&mut bytes);
        (result, bytes)
    });
    let result = (|| {
        child
            .stdin
            .take()
            .ok_or("Settings validation pipe unavailable.")?
            .write_all(&input)
            .map_err(|_| "Settings validation interrupted.")?;
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(exit) = child
                .try_wait()
                .map_err(|_| "Settings validation interrupted.")?
            {
                if !exit.success() {
                    return Err("Settings invalid. Check existing current-schema database, absolute private paths, date, endpoints and advanced values.");
                }
                break;
            }
            if Instant::now() >= deadline {
                return Err("Settings validation timed out; settings unchanged.");
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    let (read, bytes) = reader.join().map_err(|_| "Settings result interrupted.")?;
    result?;
    read.map_err(|_| "Settings result unavailable.")?;
    if bytes.len() > 128 * 1024 {
        return Err("Settings result too large.");
    }
    #[derive(Deserialize)]
    struct Validated {
        ok: bool,
        fields: BTreeMap<String, String>,
    }
    let result: Validated =
        serde_json::from_slice(&bytes).map_err(|_| "Settings validation failed.")?;
    if !result.ok {
        return Err("Settings invalid.");
    }
    Ok(result.fields)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::os::unix::fs::PermissionsExt;
    struct Fake {
        calls: Cell<usize>,
        deny: bool,
        deny_after: usize,
    }
    impl Secrets for Fake {
        fn get(&self, _: &str) -> Result<String, &'static str> {
            self.calls.set(self.calls.get() + 1);
            if self.deny && self.calls.get() >= self.deny_after {
                Err("denied")
            } else {
                Ok("synthetic-provider-secret".into())
            }
        }
    }
    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!("trainer-settings-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        fs::canonicalize(path).unwrap()
    }
    fn replacement() -> BTreeMap<String, KeyUpdate> {
        BTreeMap::from([(
            "OPENAI_API_KEY".into(),
            KeyUpdate::Replace {
                value: "synthetic-provider-secret".into(),
            },
        )])
    }
    fn input(
        path: &Path,
        fields: BTreeMap<String, String>,
        keys: BTreeMap<String, KeyUpdate>,
    ) -> SaveInput {
        SaveInput {
            fields,
            keys,
            chat_catalog: snapshot(path, false).unwrap().chat_catalog,
            expected_revision: revision(path).unwrap(),
        }
    }
    #[test]
    fn first_save_is_exclusive_and_does_not_return_next_launch_instructions() {
        let root = root();
        let path = selected(&root);
        let message = save_new(&path, input(&path, BTreeMap::new(), replacement())).unwrap();
        assert!(message.contains("committed"));
        assert!(!message.contains("Quit"));
        let original = private_store::read(&path).unwrap();
        assert!(save_new(&path, input(&path, BTreeMap::new(), BTreeMap::new())).is_err());
        assert_eq!(private_store::read(&path).unwrap(), original);
        assert_eq!(load(&path).unwrap().version, 3);
        let read = serde_json::to_string(&snapshot(&path, false).unwrap()).unwrap();
        assert!(!read.contains("synthetic-provider-secret"));
        assert!(read.contains("configured"));
        assert!(String::from_utf8(activation(&path).unwrap())
            .unwrap()
            .contains("synthetic-provider-secret"));
        save(
            &path,
            input(
                &path,
                BTreeMap::new(),
                BTreeMap::from([("OPENAI_API_KEY".into(), KeyUpdate::Unchanged)]),
            ),
        )
        .unwrap();
        assert_eq!(private_store::read(&path).unwrap(), original);
        save(
            &path,
            input(
                &path,
                BTreeMap::new(),
                BTreeMap::from([("OPENAI_API_KEY".into(), KeyUpdate::Clear)]),
            ),
        )
        .unwrap();
        assert!(load(&path).unwrap().keys.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn adoption_is_explicit_complete_preserves_original_and_never_repeats_reads() {
        let root = root();
        let path = root.join("settings-v1.json");
        let legacy = Settings {
            version: 1,
            fields: BTreeMap::from([("AI_MODEL".into(), "custom-model".into())]),
            chat_catalog: None,
            keys: SLOTS
                .iter()
                .map(|s| (s.to_string(), format!("{s}/{}", uuid::Uuid::new_v4())))
                .collect(),
        };
        private_store::publish(&path, &encode(&legacy).unwrap(), None).unwrap();
        let original = private_store::read(&path).unwrap();
        let fake = Fake {
            calls: Cell::new(0),
            deny: false,
            deny_after: 1,
        };
        for _ in 0..3 {
            snapshot(&path, false).unwrap();
            assert!(activation(&path).is_err());
        }
        assert!(save(&path, input(&path, legacy.fields.clone(), replacement())).is_err());
        assert_eq!(fake.calls.get(), 0);
        assert!(adoption(
            &path,
            input(&path, legacy.fields.clone(), replacement()),
            false,
            &fake
        )
        .is_err());
        assert_eq!(fake.calls.get(), 0);
        let (next, prior) = adoption(
            &path,
            input(&path, legacy.fields.clone(), BTreeMap::new()),
            true,
            &fake,
        )
        .unwrap();
        assert_eq!(fake.calls.get(), 3);
        assert_eq!(next.keys.len(), 3);
        assert_eq!(next.fields, legacy.fields);
        commit_adoption(&path, &next, &prior).unwrap();
        assert_eq!(private_store::read(&path).unwrap(), original);
        let active = selected(&root);
        assert_eq!(active.file_name().unwrap(), "settings-v3.json");
        for _ in 0..3 {
            snapshot(&active, false).unwrap();
            activation(&active).unwrap();
        }
        assert!(adoption(
            &active,
            input(&active, BTreeMap::new(), BTreeMap::new()),
            true,
            &fake
        )
        .is_err());
        assert!(commit_adoption(&path, &next, &prior).is_err());
        assert_eq!(fake.calls.get(), 3);
        fs::write(&active, b"corrupt").unwrap();
        assert_eq!(selected(&root), active);
        assert!(activation(&active).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn denied_adoption_publishes_nothing_and_reentry_never_reads_legacy() {
        let root = root();
        let path = root.join("settings-v1.json");
        let legacy = Settings {
            version: 1,
            fields: BTreeMap::new(),
            chat_catalog: None,
            keys: SLOTS
                .iter()
                .map(|s| (s.to_string(), format!("{s}/{}", uuid::Uuid::new_v4())))
                .collect(),
        };
        private_store::publish(&path, &encode(&legacy).unwrap(), None).unwrap();
        let fake = Fake {
            calls: Cell::new(0),
            deny: true,
            deny_after: 2,
        };
        assert!(adoption(
            &path,
            input(&path, BTreeMap::new(), BTreeMap::new()),
            true,
            &fake
        )
        .is_err());
        assert!(!root.join("settings-v3.json").exists());
        assert_eq!(fake.calls.get(), 2);
        let keys = SLOTS
            .iter()
            .map(|s| {
                (
                    s.to_string(),
                    KeyUpdate::Replace {
                        value: "private-reentry-value".into(),
                    },
                )
            })
            .collect();
        let (next, prior) =
            adoption(&path, input(&path, BTreeMap::new(), keys), false, &fake).unwrap();
        commit_adoption(&path, &next, &prior).unwrap();
        assert_eq!(fake.calls.get(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn packaged_validation_and_onboarding_identity_accept_complete_private_adoption() {
        use std::sync::atomic::AtomicBool;
        let root = root();
        let database = root.join("populated-compatible.sqlite");
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let cancel = AtomicBool::new(false);
        let quitting = AtomicBool::new(false);
        crate::onboarding::initialize(&resources, &database, &root, &mut None, &cancel, &quitting)
            .unwrap();
        let fields = BTreeMap::from([
            (
                "DATABASE_PATH".into(),
                database.to_string_lossy().into_owned(),
            ),
            ("AI_PROVIDER".into(), "openai".into()),
            ("AI_MODEL".into(), "custom-retained-model".into()),
            ("GARMIN_HISTORY_START_DATE".into(), "2024-01-01".into()),
            ("MEMORY_ENABLED".into(), "false".into()),
        ]);
        let fields = validate(&resources, &fields).unwrap();
        let path = root.join("settings-v1.json");
        let legacy = Settings {
            version: 1,
            fields: fields.clone(),
            chat_catalog: None,
            keys: SLOTS
                .iter()
                .map(|s| (s.to_string(), format!("{s}/{}", uuid::Uuid::new_v4())))
                .collect(),
        };
        private_store::publish(&path, &encode(&legacy).unwrap(), None).unwrap();
        let fake = Fake {
            calls: Cell::new(0),
            deny: false,
            deny_after: 1,
        };
        let (next, prior) = adoption(
            &path,
            input(&path, fields.clone(), BTreeMap::new()),
            true,
            &fake,
        )
        .unwrap();
        let mut frame = adoption_frame(&next).unwrap();
        crate::onboarding::bundled(
            &resources,
            "--validate-existing-activation",
            &mut frame,
            128 * 1024,
            &cancel,
            &quitting,
        )
        .unwrap();
        frame.fill(0);
        commit_adoption(&path, &next, &prior).unwrap();
        let active = selected(&root);
        let identity = crate::onboarding::OwnedSettings::capture(&active).unwrap();
        identity.verify(&active).unwrap();
        assert_eq!(load(&active).unwrap().fields, fields);
        assert_eq!(private_store::read(&path).unwrap(), prior);
        let mut frame = activation(&active).unwrap();
        crate::onboarding::bundled(
            &resources,
            "--validate-existing-activation",
            &mut frame,
            128 * 1024,
            &cancel,
            &quitting,
        )
        .unwrap();
        frame.fill(0);
        let no_keys = Settings {
            version: 2,
            fields,
            keys: BTreeMap::new(),
            chat_catalog: None,
        };
        let mut invalid = adoption_frame(&no_keys).unwrap();
        assert!(crate::onboarding::bundled(
            &resources,
            "--validate-existing-activation",
            &mut invalid,
            128 * 1024,
            &cancel,
            &quitting
        )
        .is_err());
        assert_eq!(fake.calls.get(), 3);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn catalog_migration_preserves_original_and_stale_or_invalid_forms_never_publish() {
        let root = root();
        let old_path = root.join("settings-v2.json");
        let old = Settings {
            version: 2,
            fields: BTreeMap::from([
                ("AI_PROVIDER".into(), "openai".into()),
                ("AI_MODEL".into(), "Custom/Exact:Tag".into()),
            ]),
            keys: BTreeMap::from([("OPENAI_API_KEY".into(), "synthetic-original-key".into())]),
            chat_catalog: None,
        };
        let original = encode(&old).unwrap();
        private_store::publish(&old_path, &original, None).unwrap();
        let mut first = input(&old_path, old.fields.clone(), BTreeMap::new());
        let stale = input(&old_path, old.fields.clone(), BTreeMap::new());
        first.chat_catalog.entries[0].display_name = Some("Friendly".into());
        save(&old_path, first).unwrap();
        let active = selected(&root);
        assert_eq!(active.file_name().unwrap(), "settings-v3.json");
        assert_eq!(private_store::read(&old_path).unwrap(), original);
        let committed = private_store::read(&active).unwrap();
        // Another old form cannot overwrite the newly published authority.
        assert!(save(&old_path, stale).is_err());
        let stale = input(&active, old.fields.clone(), BTreeMap::new());
        let mut edit = input(&active, old.fields.clone(), BTreeMap::new());
        edit.chat_catalog.entries[0].model_id = "Second/Exact:Tag".into();
        save(&active, edit).unwrap();
        let after_edit = private_store::read(&active).unwrap();
        assert_ne!(committed, after_edit);
        assert!(save(&active, stale).is_err());
        let mut invalid = input(&active, old.fields.clone(), replacement());
        invalid.chat_catalog.default_entry_id = Some("entry_deleted".into());
        assert!(save(&active, invalid).is_err());
        assert_eq!(private_store::read(&active).unwrap(), after_edit);
        let saved = load(&active).unwrap();
        assert_eq!(saved.fields, old.fields); // extraction/title inputs unchanged
        assert_eq!(saved.keys, old.keys); // unchanged shared slot, never partial
        assert_eq!(
            saved.chat_catalog.unwrap().entries[0].model_id,
            "Second/Exact:Tag"
        );
        fs::write(&active, b"corrupt-newest").unwrap();
        assert_eq!(selected(&root), active);
        assert!(snapshot(&active, false).is_err());
        assert!(activation(&active).is_err());
        assert_eq!(private_store::read(&old_path).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn malformed_unknown_and_placeholder_values_are_rejected_without_readback() {
        for input in [
            r#"{"version":3,"fields":{},"keys":{}}"#,
            r#"{"version":2,"fields":{},"keys":{"OTHER":"synthetic"}}"#,
            r#"{"version":2,"fields":{},"keys":{"OPENAI_API_KEY":"your-api-key"}}"#,
            r#"{"version":2,"fields":{},"keys":{"OPENAI_API_KEY":"bad\nkey"}}"#,
            r#"{"version":1,"fields":{},"keys":{"OPENAI_API_KEY":"raw-not-reference"}}"#,
        ] {
            assert!(decode(input.as_bytes()).is_err());
        }
    }
}
