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
        if ![2, 3].contains(&settings.version)
            || !(accepted_keys(&settings.keys) || self.synthetic_keys(&settings.keys))
            || !self.accepts_fields(&settings.fields)
            || settings
                .selection_compatibility
                .as_ref()
                .map(|prior| {
                    (prior.database.is_some()
                        && prior.database.as_ref() != settings.fields.get("DATABASE_PATH"))
                        || !self.accepts_catalog(&prior.catalog, &settings.fields)
                })
                .unwrap_or(false)
            || (settings.version == 3
                && !settings
                    .chat_catalog
                    .as_ref()
                    .map(|catalog| self.accepts_catalog(catalog, &settings.fields))
                    .unwrap_or(false))
        {
            return Err(
                "Smoke requires exact keyless or authored synthetic run-local settings; no auth/tool overrides".into(),
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
    fn accepts_fields(&self, fields: &std::collections::BTreeMap<String, String>) -> bool {
        let baseline = std::collections::BTreeMap::from([
            (
                "DATABASE_PATH".to_owned(),
                self.root
                    .join("trainer.sqlite")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ("AI_PROVIDER".into(), "ollama".into()),
            ("MEMORY_ENABLED".into(), "false".into()),
        ]);
        if !baseline
            .iter()
            .all(|(key, value)| fields.get(key) == Some(value))
        {
            return false;
        }
        let Ok(catalog) = serde_json::from_str::<Vec<serde_json::Value>>(include_str!(
            "../ui/settings-fields.json"
        )) else {
            return false;
        };
        fields.iter().all(|(key, value)| {
            #[cfg(debug_assertions)]
            if key == "OLLAMA_BASE_URL" && value == "http://127.0.0.1:11435/v1" {
                let marker = self.root.join("live-provider");
                return crate::settings::private_file(&marker).is_ok()
                    && fs::read_to_string(marker).ok().as_deref() == Some(self.run_id.as_str());
            }
            #[cfg(debug_assertions)]
            if key == "MEMORY_EMBEDDING_DIMS" && value == "2048" {
                return true;
            }
            if let Some(expected) = baseline.get(key) {
                return value == expected;
            }
            if key == "GARMIN_HISTORY_START_DATE" {
                return value.is_empty() || value == "2024-01-01";
            }
            catalog
                .iter()
                .find(|field| field["key"].as_str() == Some(key.as_str()))
                .map(|field| {
                    let expected = field.get("default").and_then(|v| v.as_str()).or_else(|| {
                        field
                            .get("options")
                            .and_then(|v| v.as_array())
                            .and_then(|v| v.first())
                            .and_then(|v| v.as_str())
                    });
                    expected
                        .map(|expected| value == expected)
                        .unwrap_or_else(|| value.is_empty())
                })
                .unwrap_or(false)
        })
    }
    fn accepts_catalog(
        &self,
        catalog: &crate::chat_catalog::Catalog,
        fields: &std::collections::BTreeMap<String, String>,
    ) -> bool {
        // Closed legacy/cleared, empty or authored grouped UI states only.
        // Added identities, model/name/order/providers are exact, not caller text.
        let legacy = crate::chat_catalog::legacy(fields, &Default::default());
        let cleared = crate::chat_catalog::Catalog {
            default_entry_id: None,
            ..legacy.clone()
        };
        if *catalog == legacy
            || *catalog == cleared
            || *catalog == crate::chat_catalog::Catalog::default()
        {
            return true;
        }
        #[cfg(debug_assertions)]
        {
            let mut synthetic = crate::chat_catalog::legacy(fields, &Default::default());
            for entry in &mut synthetic.entries {
                if entry.provider == "openai" {
                    entry.model_id = "Synthetic/Live:one".into();
                } else if entry.provider == "ollama" {
                    entry.model_id = "Synthetic/Local:two".into();
                }
            }
            synthetic.default_entry_id = None;
            if *catalog == synthetic {
                return true;
            }
            synthetic.entries.retain(|entry| entry.provider != "openai");
            synthetic.default_entry_id = None;
            if *catalog == synthetic || *catalog == crate::chat_catalog::Catalog::default() {
                return true;
            }
        }
        // Preserve delivered grouped-provider evidence and its exact UUID/content bounds.
        if catalog.validate().is_err()
            || catalog.entries.len() != 8
            || catalog.default_entry_id.is_some()
        {
            return false;
        }
        ["openai", "deepseek", "ollama", "openrouter"]
            .iter()
            .enumerate()
            .all(|(index, provider)| {
                let first = &catalog.entries[index];
                let second = &catalog.entries[index + 4];
                first.id == format!("entry_legacy_{provider}")
                    && first.provider == *provider
                    && first.model_id == format!("synthetic/{provider}:Case")
                    && first.display_name.as_deref() == Some("Synthetic model")
                    && second.provider == *provider
                    && second.model_id == format!("synthetic/{provider}:Second")
                    && second.display_name.is_none()
                    && second
                        .id
                        .strip_prefix("entry_")
                        .and_then(|id| uuid::Uuid::parse_str(id).ok())
                        .map(|id| id.get_version_num() == 4 && second.id == format!("entry_{id}"))
                        == Some(true)
            })
    }
    pub fn accepts_save(&self, input: &crate::settings::SaveInput) -> bool {
        self.accepts_fields(&input.fields)
            && self.accepts_catalog(&input.chat_catalog, &input.fields)
            && input
                .keys
                .keys()
                .all(|slot| crate::settings::SLOTS.contains(&slot.as_str()))
            && (input
                .keys
                .values()
                .all(|intent| matches!(intent, crate::settings::KeyUpdate::Unchanged))
                || self.synthetic_intents(&input.keys)
                || self.provider_field_intents(input))
    }
    fn synthetic_keys(&self, keys: &std::collections::BTreeMap<String, String>) -> bool {
        #[cfg(debug_assertions)]
        for suffix in ["one", "two"] {
            if keys.len() == 3
                && crate::settings::SLOTS.iter().all(|slot| {
                    keys.get(*slot) == Some(&format!("T0257-synthetic-{slot}-{suffix}"))
                })
            {
                return true;
            }
        }
        let _ = keys;
        false
    }
    fn synthetic_intents(
        &self,
        keys: &std::collections::BTreeMap<String, crate::settings::KeyUpdate>,
    ) -> bool {
        #[cfg(debug_assertions)]
        {
            if keys.len() == 3
                && crate::settings::SLOTS
                    .iter()
                    .all(|slot| matches!(keys.get(*slot), Some(crate::settings::KeyUpdate::Clear)))
            {
                return true;
            }
            for suffix in ["one", "two"] {
                if keys.len() == 3 && crate::settings::SLOTS.iter().all(|slot| matches!(keys.get(*slot), Some(crate::settings::KeyUpdate::Replace { value }) if value == &format!("T0257-synthetic-{slot}-{suffix}"))) { return true; }
            }
        }
        let _ = keys;
        false
    }
    fn provider_field_intents(&self, input: &crate::settings::SaveInput) -> bool {
        crate::settings::load(&self.settings())
            .map(|saved| saved.keys == initial_keys())
            .unwrap_or(false)
            && input.keys.len() == 3
            && matches!(input.keys.get("OPENAI_API_KEY"), Some(crate::settings::KeyUpdate::Replace { value }) if value == "synthetic-openai-replacement")
            && matches!(
                input.keys.get("DEEPSEEK_API_KEY"),
                Some(crate::settings::KeyUpdate::Clear)
            )
            && matches!(
                input.keys.get("OPENROUTER_API_KEY"),
                Some(crate::settings::KeyUpdate::Unchanged)
            )
    }
    pub fn settings(&self) -> PathBuf {
        let next = self.root.join("config/settings-v3.json");
        if !matches!(fs::symlink_metadata(&next), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
        {
            next
        } else {
            self.root.join("config/settings-v2.json")
        }
    }
    pub fn identifier(&self) -> String {
        format!(
            "com.codexa.garmin-trainer.smoke.r{}",
            self.run_id.replace('-', "")
        )
    }
}
fn initial_keys() -> std::collections::BTreeMap<String, String> {
    std::collections::BTreeMap::from([
        ("OPENAI_API_KEY".into(), "synthetic-openai-original".into()),
        (
            "DEEPSEEK_API_KEY".into(),
            "synthetic-deepseek-original".into(),
        ),
    ])
}
fn accepted_keys(keys: &std::collections::BTreeMap<String, String>) -> bool {
    keys.is_empty()
        || *keys == initial_keys()
        || *keys
            == std::collections::BTreeMap::from([(
                "OPENAI_API_KEY".into(),
                "synthetic-openai-replacement".into(),
            )])
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
    fn synthetic_keys_are_finite_and_never_accept_private_or_partial_states() {
        assert!(accepted_keys(&initial_keys()));
        assert!(accepted_keys(&Default::default()));
        assert!(accepted_keys(&std::collections::BTreeMap::from([(
            "OPENAI_API_KEY".into(),
            "synthetic-openai-replacement".into()
        )])));
        for (slot, value) in [
            ("OPENAI_API_KEY", "private"),
            ("OPENROUTER_API_KEY", "synthetic-openai-replacement"),
            ("OPENAI_API_KEY", "synthetic-openai-original"),
        ] {
            assert!(!accepted_keys(&std::collections::BTreeMap::from([(
                slot.into(),
                value.into()
            )])));
        }
    }
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
        let mut settings = serde_json::json!({"version":2,"keys":{},"fields":{"DATABASE_PATH":root.join("trainer.sqlite"),"AI_PROVIDER":"ollama","MEMORY_ENABLED":"false"}});
        write(&config.settings(), settings.to_string().as_bytes());
        assert!(config.validate().is_ok());
        settings["fields"]["AI_MODEL"] = serde_json::json!("gpt-6-luna");
        write(&config.settings(), settings.to_string().as_bytes());
        assert!(config.validate().is_ok());
        let snapshot = crate::settings::snapshot(&config.settings(), false).unwrap();
        let mut input: crate::settings::SaveInput = serde_json::from_value(serde_json::json!({"fields":settings["fields"],"keys":{"OPENAI_API_KEY":{"intent":"unchanged"}},"chatCatalog":snapshot.chat_catalog,"expectedRevision":snapshot.revision})).unwrap();
        assert!(config.accepts_save(&input));
        input.keys.insert(
            "OPENAI_API_KEY".into(),
            crate::settings::KeyUpdate::Replace {
                value: "synthetic-not-a-key".into(),
            },
        );
        assert!(!config.accepts_save(&input));
        let initial = settings.clone();
        settings["keys"] = serde_json::to_value(initial_keys()).unwrap();
        write(&config.settings(), settings.to_string().as_bytes());
        assert!(config.validate().is_ok());
        input.keys = serde_json::from_value(serde_json::json!({
            "OPENAI_API_KEY":{"intent":"replace","value":"synthetic-openai-replacement"},
            "DEEPSEEK_API_KEY":{"intent":"clear"},
            "OPENROUTER_API_KEY":{"intent":"unchanged"}
        }))
        .unwrap();
        assert!(config.accepts_save(&input));
        for (slot, update) in [
            (
                "OPENAI_API_KEY",
                crate::settings::KeyUpdate::Replace {
                    value: "private".into(),
                },
            ),
            ("OPENROUTER_API_KEY", crate::settings::KeyUpdate::Clear),
            ("DEEPSEEK_API_KEY", crate::settings::KeyUpdate::Unchanged),
            ("unknown", crate::settings::KeyUpdate::Unchanged),
        ] {
            let mut rejected = crate::settings::SaveInput {
                fields: input.fields.clone(),
                chat_catalog: input.chat_catalog.clone(),
                expected_revision: input.expected_revision.clone(),
                keys: serde_json::from_value(serde_json::json!({
                    "OPENAI_API_KEY":{"intent":"replace","value":"synthetic-openai-replacement"},
                    "DEEPSEEK_API_KEY":{"intent":"clear"},
                    "OPENROUTER_API_KEY":{"intent":"unchanged"}
                }))
                .unwrap(),
            };
            rejected.keys.insert(slot.into(), update);
            assert!(!config.accepts_save(&rejected));
        }
        settings = initial;
        write(&config.settings(), settings.to_string().as_bytes());
        assert!(!config.accepts_save(&input));
        input.keys.clear();
        input
            .fields
            .insert("GARMIN_MCP_TOKEN_DIR".into(), String::new());
        input
            .fields
            .insert("MEMORY_EMBEDDING_BASE_URL".into(), String::new());
        assert!(config.accepts_save(&input));
        for (key, value) in [
            ("GARMIN_MCP_TOKEN_DIR", "/not-a-run-token-store"),
            ("GARMIN_MCP_COMMAND", "/unsafe-override"),
            ("OLLAMA_BASE_URL", "http://external.invalid"),
            ("AI_MODEL", "other-model"),
            ("AI_MODEL", ""),
        ] {
            let mut changed = crate::settings::SaveInput {
                fields: input.fields.clone(),
                keys: Default::default(),
                chat_catalog: input.chat_catalog.clone(),
                expected_revision: input.expected_revision.clone(),
            };
            changed.fields.insert(key.into(), value.into());
            assert!(!config.accepts_save(&changed));
        }
        let mut changed_catalog = crate::settings::SaveInput {
            fields: input.fields.clone(),
            keys: Default::default(),
            chat_catalog: input.chat_catalog.clone(),
            expected_revision: input.expected_revision.clone(),
        };
        changed_catalog.chat_catalog.default_entry_id = None;
        assert!(config.accepts_save(&changed_catalog));
        changed_catalog.chat_catalog = input.chat_catalog.clone();
        changed_catalog.chat_catalog.entries[2].model_id = "nondefault-local-model".into();
        assert!(!config.accepts_save(&changed_catalog));
        #[cfg(debug_assertions)]
        {
            let mut live = crate::settings::SaveInput {
                fields: input.fields.clone(),
                keys: Default::default(),
                chat_catalog: input.chat_catalog.clone(),
                expected_revision: input.expected_revision.clone(),
            };
            live.chat_catalog
                .entries
                .iter_mut()
                .find(|entry| entry.provider == "openai")
                .unwrap()
                .model_id = "Synthetic/Live:one".into();
            live.chat_catalog
                .entries
                .iter_mut()
                .find(|entry| entry.provider == "ollama")
                .unwrap()
                .model_id = "Synthetic/Local:two".into();
            live.chat_catalog.default_entry_id = None;
            for slot in crate::settings::SLOTS {
                live.keys.insert(
                    slot.into(),
                    crate::settings::KeyUpdate::Replace {
                        value: format!("T0257-synthetic-{slot}-one"),
                    },
                );
            }
            assert!(config.accepts_save(&live));
            live.fields
                .insert("MEMORY_EMBEDDING_DIMS".into(), "2048".into());
            assert!(config.accepts_save(&live));
            live.fields
                .insert("MEMORY_EMBEDDING_DIMS".into(), "2049".into());
            assert!(!config.accepts_save(&live));
            live.fields
                .insert("MEMORY_EMBEDDING_DIMS".into(), "2048".into());
            live.keys.insert(
                "OPENAI_API_KEY".into(),
                crate::settings::KeyUpdate::Replace {
                    value: "real-or-arbitrary-private-input".into(),
                },
            );
            assert!(!config.accepts_save(&live));
            for slot in crate::settings::SLOTS {
                live.keys
                    .insert(slot.into(), crate::settings::KeyUpdate::Clear);
            }
            live.chat_catalog
                .entries
                .retain(|entry| entry.provider != "openai");
            live.chat_catalog.default_entry_id = None;
            assert!(config.accepts_save(&live));
            live.chat_catalog = Default::default();
            assert!(config.accepts_save(&live));
        }
        let mut synthetic = crate::chat_catalog::legacy(&input.fields, &Default::default());
        for entry in &mut synthetic.entries {
            entry.model_id = format!("synthetic/{}:Case", entry.provider);
            entry.display_name = Some("Synthetic model".into());
        }
        for provider in ["openai", "deepseek", "ollama", "openrouter"] {
            synthetic.entries.push(crate::chat_catalog::Entry {
                id: format!("entry_{}", uuid::Uuid::new_v4()),
                provider: provider.into(),
                model_id: format!("synthetic/{provider}:Second"),
                display_name: None,
            });
        }
        synthetic.default_entry_id = None;
        assert!(config.accepts_catalog(&synthetic, &input.fields));
        assert!(config.accepts_catalog(&crate::chat_catalog::Catalog::default(), &input.fields));
        for case in 0..7 {
            let mut rejected = synthetic.clone();
            match case {
                0 => rejected.entries[4].model_id = "private-text".into(),
                1 => rejected.entries[4].id = "entry_not_a_uuid".into(),
                2 => rejected.entries[0].display_name = Some("private-text".into()),
                3 => rejected.entries[4].provider = "deepseek".into(),
                4 => rejected.default_entry_id = Some("entry_legacy_ollama".into()),
                5 => rejected.entries.swap(0, 1),
                _ => rejected.entries[5].id = rejected.entries[4].id.clone(),
            }
            assert!(!config.accepts_catalog(&rejected, &input.fields));
        }
        #[cfg(debug_assertions)]
        {
            let mut provider_fields = input.fields.clone();
            provider_fields.insert("OLLAMA_BASE_URL".into(), "http://127.0.0.1:11435/v1".into());
            assert!(!config.accepts_fields(&provider_fields));
            write(&root.join("live-provider"), id.as_bytes());
            assert!(config.accepts_fields(&provider_fields));
            provider_fields.insert("OLLAMA_BASE_URL".into(), "http://127.0.0.1:11436/v1".into());
            assert!(!config.accepts_fields(&provider_fields));
            fs::remove_file(root.join("live-provider")).unwrap();
        }
        let next = root.join("config/settings-v3.json");
        let projected = crate::chat_catalog::legacy(&input.fields, &Default::default());
        let version3 = serde_json::json!({"version":3,"keys":{},"fields":input.fields,"chatCatalog":projected});
        write(&next, version3.to_string().as_bytes());
        assert_eq!(config.settings(), next);
        assert!(config.validate().is_ok());
        write(&next, b"corrupt newest authority");
        assert!(config.validate().is_err());
        fs::remove_file(&next).unwrap();
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
