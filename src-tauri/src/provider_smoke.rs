//! Explicit finite live-test credential handoff; never a renderer/export/settings-copy API.
use crate::settings;
use serde::Deserialize;
use std::path::{Path, PathBuf};

const DENIED: &str = "Finite OpenAI test credential handoff refused; production state preserved.";

#[derive(Clone, Copy, Deserialize)]
pub enum Mode {
    #[serde(rename = "t0269-openai-luna-025")]
    OpenaiLuna025,
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

pub fn activation(run_path: &Path, production: &Path) -> Result<(Vec<u8>, Capture), &'static str> {
    let mut run = settings::load(run_path).map_err(|_| DENIED)?;
    let expected = serde_json::json!({"version":1,"entries":[{"id":"entry_t0269_luna","provider":"openai","modelId":"gpt-6-luna"}],"defaultEntryId":null});
    if run.version != 3
        || !run.keys.is_empty()
        || run.selection_compatibility.is_some()
        || run.fields.len() != 5
        || run.fields.get("AI_PROVIDER").map(String::as_str) != Some("openai")
        || run.fields.get("AI_MODEL").map(String::as_str) != Some("gpt-6-luna")
        || run.fields.get("MEMORY_ENABLED").map(String::as_str) != Some("false")
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
        let (mut frame, capture) = activation(&path, &production).unwrap();
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
            assert!(activation(&path, &production).is_err(), "{mutation}");
            assert_eq!(fs::read(&source).unwrap(), before);
        }
        fs::write(&path, &run_before).unwrap();
        fs::write(tokens.join("unexpected"), b"synthetic-not-a-token").unwrap();
        assert!(activation(&path, &production).is_err());
        assert_eq!(fs::read(&source).unwrap(), before);
        assert!(serde_json::from_value::<Mode>(serde_json::json!("arbitrary-export")).is_err());
        assert!(serde_json::from_value::<Mode>(serde_json::json!("t0269-openai-luna-025")).is_ok());
        // No arbitrary input/catalog/secret map can opt into this native-only handoff.
        let other = directory();
        let invalid = publish(
            &other,
            "settings-v2.json",
            &serde_json::json!({"version":2,"fields":{},"keys":{}}),
        );
        assert!(activation(&invalid, &production).is_err());
        fs::write(&source, b"unsupported changed source").unwrap();
        assert!(!capture.unchanged());
    }
}
