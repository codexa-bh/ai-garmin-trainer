use crate::keychain::Secrets;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const SLOTS: [&str; 3] = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"];
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub version: u8,
    pub fields: BTreeMap<String, String>,
    pub keys: BTreeMap<String, String>,
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
}
#[derive(Serialize)]
pub struct Snapshot {
    pub fields: BTreeMap<String, String>,
    pub keys: BTreeMap<String, &'static str>,
    pub saved: bool,
    pub running: bool,
}

pub fn private_file(path: &Path) -> Result<(), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|_| "Private settings missing or unreadable.")?;
    if !path.is_absolute()
        || !meta.is_file()
        || meta.nlink() != 1
        || meta.uid() != unsafe { libc::getuid() }
        || meta.mode() & 0o077 != 0
        || meta.len() > 128 * 1024
        || fs::canonicalize(path).ok().as_deref() != Some(path)
    {
        return Err("Settings must be a bounded owner-private regular file, not an alias.");
    }
    Ok(())
}
fn private_directory(path: &Path) -> Result<(), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|_| "Private settings directory unavailable.")?;
    if !meta.is_dir()
        || meta.uid() != unsafe { libc::getuid() }
        || meta.mode() & 0o077 != 0
        || fs::canonicalize(path).ok().as_deref() != Some(path)
    {
        return Err("Settings directory must be owner-private and unaliased.");
    }
    Ok(())
}
pub fn load(path: &Path) -> Result<Settings, &'static str> {
    private_file(path)?;
    private_directory(path.parent().ok_or("Settings directory unavailable.")?)?;
    let settings: Settings = serde_json::from_slice(
        &fs::read(path).map_err(|_| "Settings unreadable.")?,
    )
    .map_err(|_| "Settings invalid. Re-enter settings; original env files are not imported.")?;
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
        return Err("Saved settings contain unsupported fields. No secret values are returned.");
    }
    if settings.version != 1
        || settings.keys.iter().any(|(slot, account)| {
            !SLOTS.contains(&slot.as_str())
                || !account
                    .strip_prefix(&format!("{slot}/"))
                    .map(|id| uuid::Uuid::parse_str(id).is_ok())
                    .unwrap_or(false)
        })
    {
        return Err("Settings version or Keychain references unsupported.");
    }
    Ok(settings)
}
pub fn snapshot(
    path: &Path,
    secrets: &impl Secrets,
    running: bool,
) -> Result<Snapshot, &'static str> {
    let saved = path.try_exists().map_err(|_| "Settings inaccessible.")?;
    let settings = if saved {
        load(path)?
    } else {
        Settings::default()
    };
    Ok(Snapshot {
        keys: SLOTS
            .iter()
            .map(|slot| {
                (
                    slot.to_string(),
                    match settings.keys.get(*slot) {
                        None => "not configured",
                        Some(account) if secrets.present(account) => "configured",
                        Some(_) => "unavailable",
                    },
                )
            })
            .collect(),
        fields: settings.fields,
        saved,
        running,
    })
}
fn persist(path: &Path, settings: &Settings) -> Result<bool, &'static str> {
    let parent = path.parent().ok_or("Settings directory unavailable.")?;
    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|_| "Cannot create settings directory.")?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect settings directory.")?;
    }
    private_directory(parent)?;
    if path.symlink_metadata().is_ok() {
        private_file(path)?;
    }
    let bytes = serde_json::to_vec(settings).map_err(|_| "Cannot encode settings.")?;
    if bytes.len() > 128 * 1024 {
        return Err("Settings too large.");
    }
    let tmp = parent.join(format!("settings-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|_| "Cannot save settings.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot persist settings.")?;
        fs::rename(&tmp, path).map_err(|_| "Cannot replace settings.")?;
        // Once renamed, failure is a committed save with uncertain durability,
        // not permission to compensate referenced keys or delete old accounts.
        Ok(fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .is_ok())
    })();
    // Only this exact exclusive temporary file is owned by the failed write.
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}

// Copy-on-write accounts make the settings rename the commit point. Existing
// keys are never changed before it. Failed compensation is reported, never
// silently represented as a successful save or deletion of the old key.
pub fn save(
    path: &Path,
    fields: BTreeMap<String, String>,
    updates: BTreeMap<String, KeyUpdate>,
    secrets: &impl Secrets,
) -> Result<String, &'static str> {
    if updates.keys().any(|key| !SLOTS.contains(&key.as_str())) {
        return Err("Unknown Keychain slot.");
    }
    for update in updates.values() {
        if let KeyUpdate::Replace { value } = update {
            if value.trim().is_empty() || value.len() > 16384 || value.chars().any(char::is_control)
            {
                return Err("Enter a valid replacement key or choose unchanged/clear.");
            }
        }
    }
    let old = if path.try_exists().map_err(|_| "Settings inaccessible.")? {
        load(path)?
    } else {
        Settings::default()
    };
    let mut next = Settings {
        version: 1,
        fields,
        keys: old.keys.clone(),
    };
    let mut added = Vec::new();
    let result = (|| {
        for (slot, update) in updates {
            match update {
                KeyUpdate::Unchanged => {}
                KeyUpdate::Clear => {
                    next.keys.remove(&slot);
                }
                KeyUpdate::Replace { value } => {
                    let account = format!("{slot}/{}", uuid::Uuid::new_v4());
                    secrets.add(&account, &value)?;
                    added.push(account.clone());
                    next.keys.insert(slot, account);
                }
            }
        }
        persist(path, &next)
    })();
    if let Err(error) = result {
        let mut cleanup_failed = false;
        for account in added {
            cleanup_failed |= secrets.delete(&account).is_err();
        }
        return Err(if cleanup_failed {
            "Save failed; prior settings unchanged. Unreferenced new Keychain item cleanup failed; inspect the provider.v1 service in Keychain Access."
        } else {
            error
        });
    }
    if result == Ok(false) {
        return Ok("Settings saved for next launch; directory durability confirmation unavailable. Prior Keychain accounts retained for recovery; live backend unchanged.".into());
    }
    let mut cleanup_failed = false;
    for (slot, account) in old.keys {
        if next.keys.get(&slot) != Some(&account) {
            cleanup_failed |= secrets.delete(&account).is_err();
        }
    }
    Ok(if cleanup_failed {
        "Settings saved for next launch; live backend unchanged. Superseded Keychain item cleanup unavailable; inspect the provider.v1 service in Keychain Access."
    } else { "Settings saved. Quit and reopen to apply; the running backend is unchanged." }.into())
}
pub fn activation(path: &Path, secrets: &impl Secrets) -> Result<Vec<u8>, &'static str> {
    let settings = load(path)?;
    let mut values = BTreeMap::new();
    for (slot, account) in settings.keys {
        values.insert(slot, secrets.get(&account)?);
    }
    let mut bytes = serde_json::to_vec(
        &serde_json::json!({"version":1,"fields":settings.fields,"secrets":values}),
    )
    .map_err(|_| "Activation unavailable.")?;
    if bytes.len() > 128 * 1024 - 1 {
        return Err("Activation too large.");
    }
    bytes.push(b'\n');
    Ok(bytes)
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
    {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    #[derive(Default)]
    struct Fake {
        values: RefCell<BTreeMap<String, String>>,
        fail: bool,
    }
    impl Secrets for Fake {
        fn get(&self, account: &str) -> Result<String, &'static str> {
            self.values.borrow().get(account).cloned().ok_or("missing")
        }
        fn present(&self, account: &str) -> bool {
            self.values.borrow().contains_key(account)
        }
        fn add(&self, account: &str, value: &str) -> Result<(), &'static str> {
            if self.fail {
                return Err("denied");
            }
            self.values
                .borrow_mut()
                .insert(account.into(), value.into());
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<(), &'static str> {
            self.values.borrow_mut().remove(account);
            Ok(())
        }
    }
    #[test]
    fn masked_copy_on_write_save_clear_and_failed_persistence() {
        let root = std::env::temp_dir().join(format!("trainer-settings-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let path = root.join("settings-v1.json");
        let fake = Fake::default();
        let updates = BTreeMap::from([(
            "OPENAI_API_KEY".into(),
            KeyUpdate::Replace {
                value: "sentinel-secret".into(),
            },
        )]);
        save(&path, BTreeMap::new(), updates, &fake).unwrap();
        let original = fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&original).contains("sentinel-secret"));
        let read = serde_json::to_string(&snapshot(&path, &fake, false).unwrap()).unwrap();
        assert!(read.contains("configured"));
        assert!(!read.contains("sentinel-secret"));
        save(
            &path,
            BTreeMap::new(),
            BTreeMap::from([("OPENAI_API_KEY".into(), KeyUpdate::Unchanged)]),
            &fake,
        )
        .unwrap();
        assert_eq!(original, fs::read(&path).unwrap());
        let denied = Fake {
            fail: true,
            ..Default::default()
        };
        assert!(save(
            &path,
            BTreeMap::new(),
            BTreeMap::from([(
                "OPENAI_API_KEY".into(),
                KeyUpdate::Replace {
                    value: "new-secret".into()
                }
            )]),
            &denied
        )
        .is_err());
        assert_eq!(original, fs::read(&path).unwrap());
        let bad = root.join("not-private");
        fs::create_dir(&bad).unwrap();
        fs::set_permissions(&bad, fs::Permissions::from_mode(0o755)).unwrap();
        let before = fake.values.borrow().len();
        assert!(save(
            &bad.join("settings.json"),
            BTreeMap::new(),
            BTreeMap::from([(
                "OPENAI_API_KEY".into(),
                KeyUpdate::Replace {
                    value: "new-secret".into()
                }
            )]),
            &fake
        )
        .is_err());
        assert_eq!(before, fake.values.borrow().len());
        save(
            &path,
            BTreeMap::new(),
            BTreeMap::from([("OPENAI_API_KEY".into(), KeyUpdate::Clear)]),
            &fake,
        )
        .unwrap();
        assert!(fake.values.borrow().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
