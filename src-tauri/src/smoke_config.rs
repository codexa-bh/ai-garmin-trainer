//! Launch-only isolation shared by debug smoke and the explicit release denial probe.
//! The ordinary release build does not compile this module.
use serde::Deserialize;
use std::{
    fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub run_id: String,
    pub token: String,
    pub root: PathBuf,
    pub source: String,
    pub port: u16,
}
impl Config {
    pub fn load() -> Result<Option<Self>, String> {
        let Some(path) = std::env::var_os("TRAINER_SMOKE_CONFIG") else {
            return Ok(None);
        };
        let path = PathBuf::from(path);
        crate::settings::private_file(&path)?;
        let config: Self =
            serde_json::from_slice(&fs::read(&path).map_err(|_| "Smoke config read")?)
                .map_err(|_| "Smoke config format")?;
        config.validate()?;
        if path != config.root.join("config.json")
            || std::env::var_os("HOME").map(PathBuf::from) != Some(config.root.join("home"))
            || std::env::var_os("TMPDIR").map(PathBuf::from) != Some(config.root.join("tmp"))
        {
            return Err(
                "Smoke must use its exact private config/HOME/temp; no normal fallback".into(),
            );
        }
        Ok(Some(config))
    }
    pub fn validate(&self) -> Result<(), String> {
        if uuid::Uuid::parse_str(&self.run_id).is_err()
            || self.token.len() != 64
            || !self.token.bytes().all(|c| c.is_ascii_hexdigit())
            || self.source.len() != 64
            || !self.source.bytes().all(|c| c.is_ascii_hexdigit())
            || self.port < 1024
        {
            return Err("Invalid smoke run/source/capability/port".into());
        }
        private_dir(&self.root)?;
        if self.root.file_name().and_then(|n| n.to_str())
            != Some(format!("native-{}", self.run_id).as_str())
        {
            return Err("Fresh UUID run directory required".into());
        }
        for name in ["home", "tmp", "profile", "config", "screenshots"] {
            private_dir(&self.root.join(name))?;
        }
        let marker = self.root.join("owner");
        crate::settings::private_file(&marker)?;
        if fs::read_to_string(marker).ok().as_deref() != Some(&self.run_id) {
            return Err("Run owner mismatch".into());
        }
        let settings = crate::settings::load(&self.settings())?;
        let expected = std::collections::BTreeMap::from([
            (
                "DATABASE_PATH".into(),
                self.root
                    .join("trainer.sqlite")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ("AI_PROVIDER".into(), "ollama".into()),
            ("MEMORY_ENABLED".into(), "false".into()),
            ("GARMIN_HISTORY_START_DATE".into(), "2024-01-01".into()),
        ]);
        if !settings.keys.is_empty() || settings.fields != expected {
            return Err(
                "Smoke requires exact keyless run-local settings; no auth/tool overrides".into(),
            );
        }
        let db = self.root.join("trainer.sqlite");
        let meta = fs::symlink_metadata(&db).map_err(|_| "Populated copy required")?;
        if !meta.is_file()
            || meta.nlink() != 1
            || meta.uid() != unsafe { libc::getuid() }
            || meta.mode() & 0o077 != 0
            || db.canonicalize().ok().as_ref() != Some(&db)
        {
            return Err("Unsafe copy DB".into());
        }
        Ok(())
    }
    pub fn settings(&self) -> PathBuf {
        self.root.join("config/settings-v1.json")
    }
    pub fn identifier(&self) -> String {
        format!(
            "com.codexa.garmin-trainer.smoke.r{}",
            self.run_id.replace('-', "")
        )
    }
}
pub fn private_dir(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "Missing smoke directory")?;
    if !path.is_absolute()
        || !meta.is_dir()
        || meta.uid() != unsafe { libc::getuid() }
        || meta.mode() & 0o077 != 0
        || path.canonicalize().ok().as_deref() != Some(path)
    {
        return Err("Smoke directory must be canonical owner-private, not an alias".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn admission_requires_exact_copy_settings_no_keys_and_private_paths() {
        let id = uuid::Uuid::new_v4().to_string();
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("native-{id}"));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let names = ["home", "tmp", "profile", "config", "screenshots"];
        for name in names {
            let path = root.join(name);
            fs::create_dir(&path).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let config = Config {
            run_id: id.clone(),
            token: "a".repeat(64),
            root: root.clone(),
            source: "b".repeat(64),
            port: 19321,
        };
        let write = |path: &Path, bytes: &[u8]| {
            fs::write(path, bytes).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        };
        write(&root.join("owner"), id.as_bytes());
        write(
            &root.join("trainer.sqlite"),
            b"DB preflight remains the real backend owner",
        );
        let mut settings = serde_json::json!({"version":1,"keys":{},"fields":{"DATABASE_PATH":root.join("trainer.sqlite"),"AI_PROVIDER":"ollama","MEMORY_ENABLED":"false","GARMIN_HISTORY_START_DATE":"2024-01-01"}});
        write(&config.settings(), settings.to_string().as_bytes());
        assert!(config.validate().is_ok());
        settings["keys"]["OPENAI_API_KEY"] =
            serde_json::json!(format!("OPENAI_API_KEY/{}", uuid::Uuid::new_v4()));
        write(&config.settings(), settings.to_string().as_bytes());
        assert!(config.validate().is_err());
        settings["keys"] = serde_json::json!({});
        settings["fields"]["DATABASE_PATH"] = serde_json::json!("/not-the-copy.sqlite");
        write(&config.settings(), settings.to_string().as_bytes());
        assert!(config.validate().is_err());
        settings["fields"]["DATABASE_PATH"] = serde_json::json!(root.join("trainer.sqlite"));
        write(&config.settings(), settings.to_string().as_bytes());
        fs::set_permissions(
            root.join("trainer.sqlite"),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        assert!(config.validate().is_err());
        for file in [
            root.join("owner"),
            root.join("trainer.sqlite"),
            config.settings(),
        ] {
            fs::remove_file(file).unwrap();
        }
        for name in names {
            fs::remove_dir(root.join(name)).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn refuses_invalid_identity_and_aliased_directory() {
        let id = uuid::Uuid::new_v4().to_string();
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("config-test-{id}"));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(private_dir(&path).is_ok());
        let alias = path.with_extension("alias");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(private_dir(&alias).is_err());
        let config = Config {
            run_id: id,
            token: "bad".into(),
            root: path.clone(),
            source: "a".repeat(64),
            port: 12345,
        };
        assert!(config.validate().is_err());
        fs::remove_file(alias).unwrap();
        fs::remove_dir(path).unwrap();
    }
}
