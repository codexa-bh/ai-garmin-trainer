use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pointer {
    version: u8,
    env_file: PathBuf,
}

pub fn validate_file(path: &Path) -> Result<(), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|_| "Configuration missing or unreadable.")?;
    if !path.is_absolute()
        || !meta.is_file()
        || meta.uid() != unsafe { libc::getuid() }
        || meta.mode() & 0o077 != 0
        || meta.len() > 128 * 1024
        || fs::canonicalize(path).ok().as_deref() != Some(path)
    {
        return Err("Configuration must be an absolute owner-private regular file, not an alias.");
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<PathBuf, &'static str> {
    validate_file(path)?;
    let bytes = fs::read(path).map_err(|_| "Saved reference unreadable.")?;
    let pointer: Pointer =
        serde_json::from_slice(&bytes).map_err(|_| "Saved reference invalid.")?;
    if pointer.version != 1 {
        return Err("Saved reference version unsupported.");
    }
    validate_file(&pointer.env_file)?;
    Ok(pointer.env_file)
}

pub fn save(path: &Path, env_file: PathBuf) -> Result<(), &'static str> {
    validate_file(&env_file)?;
    if path.exists() {
        validate_file(path)?;
    }
    let parent = path.parent().ok_or("No private config directory.")?;
    fs::create_dir_all(parent).map_err(|_| "Cannot create private config directory.")?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Cannot protect config directory.")?;
    let tmp = parent.join(format!("pointer-{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(&Pointer {
        version: 1,
        env_file,
    })
    .map_err(|_| "Cannot encode reference.")?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|_| "Cannot save private reference.")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot persist private reference.")?;
    fs::rename(&tmp, path).map_err(|_| "Cannot replace private reference.")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_only_a_private_reference_without_changing_originals() {
        let root = std::env::temp_dir().join(format!("trainer-pointer-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let config = root.join("original.env");
        fs::write(&config, "DATABASE_PATH=./existing.sqlite\n").unwrap();
        fs::set_permissions(&config, fs::Permissions::from_mode(0o600)).unwrap();
        let pointer = root.join("desktop/configuration-v1.json");
        save(&pointer, config.clone()).unwrap();
        assert_eq!(load(&pointer).unwrap(), config);
        assert_eq!(fs::metadata(&pointer).unwrap().mode() & 0o777, 0o600);
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            "DATABASE_PATH=./existing.sqlite\n"
        );
        fs::write(&pointer, br#"{"version":2,"env_file":"/unsupported"}"#).unwrap();
        assert!(load(&pointer).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_relative_and_public_files() {
        assert!(validate_file(Path::new("relative.env")).is_err());
        let path = std::env::temp_dir().join(format!("trainer-{}.env", uuid::Uuid::new_v4()));
        fs::write(&path, "DATABASE_PATH=unused").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(validate_file(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}
