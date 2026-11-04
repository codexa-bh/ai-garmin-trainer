//! Explicit finite live-test credential handoff; never a renderer/export/settings-copy API.
use crate::settings;
use serde::Deserialize;
use std::path::{Path, PathBuf};

const DENIED: &str = "Finite OpenAI test credential handoff refused; production state preserved.";

#[derive(Clone, Copy, Deserialize)]
pub enum Mode {
    #[serde(rename = "t0269-openai-luna-025")]
    OpenaiLuna025,
    #[serde(rename = "t0269-openai-luna-100")]
    OpenaiLuna100,
    #[serde(rename = "t0270-summary-luna-100")]
    SummaryLuna100,
    #[serde(rename = "t0272-integrated-memory-luna-200")]
    IntegratedMemoryLuna200,
}

pub struct Capture {
    path: PathBuf,
    revision: String,
}
impl Capture {
    pub fn unchanged(&self) -> bool {
        settings::revision(&self.path).ok().as_ref() == Some(&self.revision)
    }
}

// The platform's existing product config child, not a scan, supplied path or env-file lookup.
pub fn production_directory() -> Result<PathBuf, &'static str> {
    let home = std::env::var_os("HOME").ok_or(DENIED)?;
    let path =
        PathBuf::from(home).join("Library/Application Support/com.codexa.garmin-trainer.desktop");
    if !path.is_absolute() {
        return Err(DENIED);
    }
    Ok(path)
}

pub fn activation(
    run_path: &Path,
    production: &Path,
    mode: Mode,
) -> Result<(Vec<u8>, Capture), &'static str> {
    let mut run = settings::load(run_path).map_err(|_| DENIED)?;
    let integrated = matches!(mode, Mode::IntegratedMemoryLuna200);
    let summary = integrated || matches!(mode, Mode::SummaryLuna100);
    let entry = if integrated {
        "entry_t0272_chat_luna"
    } else if summary {
        "entry_t0270_chat_luna"
    } else {
        "entry_t0269_luna"
    };
    let expected = serde_json::json!({"version":1,"entries":[{"id":entry,"provider":"openai","modelId":"gpt-6-luna"}],"defaultEntryId":null});
    if run.version != 3
        || !run.keys.is_empty()
        || run.selection_compatibility.is_some()
        || run.fields.len()
            != if integrated {
                13
            } else if summary {
                8
            } else {
                5
            }
        || (integrated
            && [
                ("SUMMARY_CONTRACT_VERSION", "2"),
                ("MEMORY_EMBEDDING_PROVIDER", "ollama"),
                ("MEMORY_EMBEDDING_MODEL", "nomic-embed-text"),
                ("MEMORY_EMBEDDING_BASE_URL", "http://127.0.0.1:1"),
                ("MEMORY_EMBEDDING_DIMS", "768"),
            ]
            .iter()
            .any(|(key, value)| run.fields.get(*key).map(String::as_str) != Some(*value)))
        || (summary
            && ((!matches!(
                run.fields.get("SUMMARY_ENABLED").map(String::as_str),
                Some("true")
            ) && !(integrated
                && run.fields.get("SUMMARY_ENABLED").map(String::as_str) == Some("false")))
                || run.fields.get("SUMMARY_MODEL").map(String::as_str) != Some("gpt-6-luna")
                || run.fields.get("SUMMARY_CHAR_LIMIT").map(String::as_str) != Some("6000")))
        || run.fields.get("AI_PROVIDER").map(String::as_str) != Some("openai")
        || run.fields.get("AI_MODEL").map(String::as_str) != Some("gpt-6-luna")
        || run.fields.get("MEMORY_ENABLED").map(String::as_str)
            != Some(if integrated { "true" } else { "false" })
        || run.fields.get("DATABASE_PATH").map(PathBuf::from)
            != run_path
                .parent()
                .and_then(Path::parent)
                .map(|root| root.join("trainer.sqlite"))
        || run.fields.get("GARMIN_MCP_TOKEN_DIR").map(PathBuf::from)
            != run_path
                .parent()
                .and_then(Path::parent)
                .map(|root| root.join("tokens"))
        || serde_json::to_value(&run.chat_catalog).map_err(|_| DENIED)? != expected
    {
        return Err(DENIED);
    }
    let tokens = run_path
        .parent()
        .and_then(Path::parent)
        .ok_or(DENIED)?
        .join("tokens");
    let token_scope = crate::private_store::PinnedDirectory::open(&tokens).map_err(|_| DENIED)?;
    if std::fs::read_dir(&tokens)
        .map_err(|_| DENIED)?
        .next()
        .is_some()
    {
        return Err(DENIED); // This provider-only scope never admits copied Garmin credentials.
    }
    token_scope.verify().map_err(|_| DENIED)?;
    // Existing native owner enforces pinned no-follow private-file reads. Nothing is copied to disk.
    let source = settings::selected(production);
    let revision = settings::revision(&source).map_err(|_| DENIED)?;
    let mut original = settings::load(&source).map_err(|_| DENIED)?;
    if ![2, 3].contains(&original.version) {
        return Err(DENIED); // Never adopt/read legacy Keychain references.
    }
    let key = original.keys.remove("OPENAI_API_KEY").ok_or(DENIED)?;
    run.keys.insert("OPENAI_API_KEY".into(), key);
    let mut frame = settings::adoption_frame(&run).map_err(|_| DENIED)?;
    let capture = Capture {
        path: source,
        revision,
    };
    if !capture.unchanged() {
        frame.fill(0);
        return Err(DENIED);
    }
    Ok((frame, capture))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt};
    fn directory() -> PathBuf {
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("provider-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }
    fn publish(root: &Path, name: &str, value: &serde_json::Value) -> PathBuf {
        let path = root.join(name);
        crate::private_store::publish(&path, &serde_json::to_vec(value).unwrap(), None).unwrap();
        path
    }
    #[test]
    fn integrated_preset_is_separate_exact_and_preserves_inactive_legacy_settings() {
        let production = directory();
        let run = directory();
        let config = run.join("config");
        for path in [&config, &run.join("tokens")] {
            fs::create_dir(path).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let source = publish(
            &production,
            "settings-v3.json",
            &serde_json::json!({"version":3,"fields":{},"keys":{"OPENAI_API_KEY":"synthetic-openai-only","DEEPSEEK_API_KEY":"unrelated"},"chatCatalog":{"version":1,"entries":[],"defaultEntryId":null}}),
        );
        let base = serde_json::json!({"version":3,"fields":{
            "DATABASE_PATH":run.join("trainer.sqlite"),"GARMIN_MCP_TOKEN_DIR":run.join("tokens"),
            "AI_PROVIDER":"openai","AI_MODEL":"gpt-6-luna","MEMORY_ENABLED":"true",
            "SUMMARY_ENABLED":"true","SUMMARY_MODEL":"gpt-6-luna","SUMMARY_CHAR_LIMIT":"6000","SUMMARY_CONTRACT_VERSION":"2",
            "MEMORY_EMBEDDING_PROVIDER":"ollama","MEMORY_EMBEDDING_MODEL":"nomic-embed-text",
            "MEMORY_EMBEDDING_BASE_URL":"http://127.0.0.1:1","MEMORY_EMBEDDING_DIMS":"768"
        },"keys":{},"chatCatalog":{"version":1,"entries":[{"id":"entry_t0272_chat_luna","provider":"openai","modelId":"gpt-6-luna"}],"defaultEntryId":null}});
        let path = publish(&config, "settings-v3.json", &base);
        let before = fs::read(&source).unwrap();
        for enabled in ["true", "false"] {
            let mut document = base.clone();
            document["fields"]["SUMMARY_ENABLED"] = serde_json::json!(enabled);
            fs::write(&path, serde_json::to_vec(&document).unwrap()).unwrap();
            let (mut frame, capture) =
                activation(&path, &production, Mode::IntegratedMemoryLuna200).unwrap();
            let parsed: serde_json::Value = serde_json::from_slice(&frame).unwrap();
            assert_eq!(
                parsed["secrets"],
                serde_json::json!({"OPENAI_API_KEY":"synthetic-openai-only"})
            );
            assert_eq!(parsed["fields"], document["fields"]);
            assert!(capture.unchanged());
            assert_eq!(
                fs::read(&path).unwrap(),
                serde_json::to_vec(&document).unwrap()
            );
            frame.fill(0);
            for historical in [
                Mode::SummaryLuna100,
                Mode::OpenaiLuna100,
                Mode::OpenaiLuna025,
            ] {
                assert!(activation(&path, &production, historical).is_err());
            }
        }
        for field in base["fields"].as_object().unwrap().keys() {
            let mut invalid = base.clone();
            invalid["fields"][field] = serde_json::json!("unreviewed");
            fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert!(
                activation(&path, &production, Mode::IntegratedMemoryLuna200).is_err(),
                "{field}"
            );
        }
        for mutation in ["keys", "extra", "catalog", "compatibility"] {
            let mut invalid = base.clone();
            match mutation {
                "keys" => invalid["keys"] = serde_json::json!({"OPENAI_API_KEY":"in-file"}),
                "extra" => {
                    invalid["fields"]["OPENAI_BASE_URL"] =
                        serde_json::json!("https://example.invalid")
                }
                "catalog" => {
                    invalid["chatCatalog"]["entries"][0]["id"] =
                        serde_json::json!("entry_t0270_chat_luna")
                }
                _ => {
                    invalid["selectionCompatibility"] = serde_json::json!({"database":null,"catalog":{"version":1,"entries":[],"defaultEntryId":null}})
                }
            }
            fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert!(
                activation(&path, &production, Mode::IntegratedMemoryLuna200).is_err(),
                "{mutation}"
            );
        }
        fs::write(&path, serde_json::to_vec(&base).unwrap()).unwrap();
        fs::write(run.join("tokens/unexpected"), b"synthetic").unwrap();
        assert!(activation(&path, &production, Mode::IntegratedMemoryLuna200).is_err());
        assert_eq!(fs::read(&source).unwrap(), before);
        assert!(serde_json::from_value::<Mode>(serde_json::json!(
            "t0272-integrated-memory-luna-200"
        ))
        .is_ok());
        assert!(serde_json::from_value::<Mode>(serde_json::json!("t0272-unbounded")).is_err());
    }
    #[test]
    fn summary_preset_is_exact_independent_keyless_and_never_grants_other_scopes() {
        let production = directory();
        let run = directory();
        let config = run.join("config");
        for path in [&config, &run.join("tokens")] {
            fs::create_dir(path).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let source = publish(
            &production,
            "settings-v2.json",
            &serde_json::json!({"version":2,"fields":{},"keys":{"OPENAI_API_KEY":"synthetic-openai-only","DEEPSEEK_API_KEY":"synthetic-unrelated"}}),
        );
        let base = serde_json::json!({"version":3,"fields":{"DATABASE_PATH":run.join("trainer.sqlite"),"AI_PROVIDER":"openai","AI_MODEL":"gpt-6-luna","MEMORY_ENABLED":"false","GARMIN_MCP_TOKEN_DIR":run.join("tokens"),"SUMMARY_ENABLED":"true","SUMMARY_MODEL":"gpt-6-luna","SUMMARY_CHAR_LIMIT":"6000"},"keys":{},"chatCatalog":{"version":1,"entries":[{"id":"entry_t0270_chat_luna","provider":"openai","modelId":"gpt-6-luna"}],"defaultEntryId":null}});
        let path = publish(&config, "settings-v3.json", &base);
        let before = fs::read(&source).unwrap();
        let (mut frame, capture) = activation(&path, &production, Mode::SummaryLuna100).unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&frame).unwrap();
        assert_eq!(parsed["fields"]["SUMMARY_MODEL"], "gpt-6-luna");
        assert_eq!(
            parsed["secrets"],
            serde_json::json!({"OPENAI_API_KEY":"synthetic-openai-only"})
        );
        assert_eq!(fs::read(&path).unwrap(), serde_json::to_vec(&base).unwrap());
        assert!(capture.unchanged());
        frame.fill(0);
        assert!(activation(&path, &production, Mode::OpenaiLuna100).is_err());
        for (field, value) in [
            ("SUMMARY_ENABLED", "false"),
            ("SUMMARY_MODEL", "unselected"),
            ("SUMMARY_CHAR_LIMIT", "20000"),
            ("MEMORY_ENABLED", "true"),
            ("AI_MODEL", "other"),
        ] {
            let mut invalid = base.clone();
            invalid["fields"][field] = serde_json::json!(value);
            fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert!(activation(&path, &production, Mode::SummaryLuna100).is_err());
            assert_eq!(fs::read(&source).unwrap(), before);
        }
        fs::write(&path, serde_json::to_vec(&base).unwrap()).unwrap();
        fs::write(run.join("tokens/unexpected"), b"synthetic-not-a-token").unwrap();
        assert!(activation(&path, &production, Mode::SummaryLuna100).is_err());
        assert_eq!(fs::read(&source).unwrap(), before);
        assert!(
            serde_json::from_value::<Mode>(serde_json::json!("t0270-summary-luna-100")).is_ok()
        );
        assert!(serde_json::from_value::<Mode>(serde_json::json!("t0270-arbitrary")).is_err());
    }
    #[test]
    fn opaque_single_slot_frame_preserves_original_and_keyless_run_bytes() {
        let production = directory();
        let run = directory();
        let config = run.join("config");
        let tokens = run.join("tokens");
        fs::create_dir(&tokens).unwrap();
        fs::set_permissions(&tokens, fs::Permissions::from_mode(0o700)).unwrap();
        fs::create_dir(&config).unwrap();
        fs::set_permissions(&config, fs::Permissions::from_mode(0o700)).unwrap();
        let source = publish(
            &production,
            "settings-v2.json",
            &serde_json::json!({"version":2,"fields":{},"keys":{"OPENAI_API_KEY":"synthetic-openai-only","DEEPSEEK_API_KEY":"synthetic-unrelated"}}),
        );
        let path = publish(
            &config,
            "settings-v3.json",
            &serde_json::json!({"version":3,"fields":{"DATABASE_PATH":run.join("trainer.sqlite"),"AI_PROVIDER":"openai","AI_MODEL":"gpt-6-luna","MEMORY_ENABLED":"false","GARMIN_MCP_TOKEN_DIR":run.join("tokens")},"keys":{},"chatCatalog":{"version":1,"entries":[{"id":"entry_t0269_luna","provider":"openai","modelId":"gpt-6-luna"}],"defaultEntryId":null}}),
        );
        let before = fs::read(&source).unwrap();
        let run_before = fs::read(&path).unwrap();
        let (mut frame, capture) = activation(&path, &production, Mode::OpenaiLuna025).unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&frame).unwrap();
        assert_eq!(
            parsed["secrets"],
            serde_json::json!({"OPENAI_API_KEY":"synthetic-openai-only"})
        );
        assert_eq!(
            parsed["fields"]["DATABASE_PATH"],
            run.join("trainer.sqlite").to_str().unwrap()
        );
        assert!(capture.unchanged());
        assert_eq!(fs::read(&source).unwrap(), before);
        assert_eq!(fs::read(&path).unwrap(), run_before);
        frame.fill(0);
        let base: serde_json::Value = serde_json::from_slice(&run_before).unwrap();
        for mutation in [
            "model", "memory", "keys", "catalog", "tokens", "database", "extra",
        ] {
            let mut invalid = base.clone();
            match mutation {
                "model" => invalid["fields"]["AI_MODEL"] = serde_json::json!("unreviewed"),
                "memory" => invalid["fields"]["MEMORY_ENABLED"] = serde_json::json!("true"),
                "keys" => {
                    invalid["keys"] = serde_json::json!({"OPENAI_API_KEY":"synthetic-in-file"})
                }
                "catalog" => {
                    invalid["chatCatalog"]["entries"][0]["provider"] = serde_json::json!("deepseek")
                }
                "database" => {
                    invalid["fields"]["DATABASE_PATH"] =
                        serde_json::json!(production.join("trainer.sqlite"))
                }
                "tokens" => {
                    invalid["fields"]["GARMIN_MCP_TOKEN_DIR"] =
                        serde_json::json!(production.join("tokens"))
                }
                _ => {
                    invalid["fields"]["OPENAI_BASE_URL"] =
                        serde_json::json!("https://example.invalid")
                }
            }
            fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert!(
                activation(&path, &production, Mode::OpenaiLuna025).is_err(),
                "{mutation}"
            );
            assert_eq!(fs::read(&source).unwrap(), before);
        }
        fs::write(&path, &run_before).unwrap();
        fs::write(tokens.join("unexpected"), b"synthetic-not-a-token").unwrap();
        assert!(activation(&path, &production, Mode::OpenaiLuna025).is_err());
        assert_eq!(fs::read(&source).unwrap(), before);
        assert!(serde_json::from_value::<Mode>(serde_json::json!("arbitrary-export")).is_err());
        assert!(serde_json::from_value::<Mode>(serde_json::json!("t0269-openai-luna-025")).is_ok());
        assert!(serde_json::from_value::<Mode>(serde_json::json!("t0269-openai-luna-100")).is_ok());
        // No arbitrary input/catalog/secret map can opt into this native-only handoff.
        let other = directory();
        let invalid = publish(
            &other,
            "settings-v2.json",
            &serde_json::json!({"version":2,"fields":{},"keys":{}}),
        );
        assert!(activation(&invalid, &production, Mode::OpenaiLuna025).is_err());
        fs::write(&source, b"unsupported changed source").unwrap();
        assert!(!capture.unchanged());
    }
}
