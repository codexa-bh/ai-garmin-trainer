use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub provider: String,
    pub model_id: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "display_name"
    )]
    pub display_name: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Catalog {
    pub version: u8,
    pub entries: Vec<Entry>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub default_entry_id: Option<String>,
}
fn display_name<'de, D: serde::Deserializer<'de>>(value: D) -> Result<Option<String>, D::Error> {
    String::deserialize(value).map(Some)
}
impl Default for Catalog {
    fn default() -> Self {
        Self {
            version: 1,
            entries: Vec::new(),
            default_entry_id: None,
        }
    }
}
fn text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty()
        && value.encode_utf16().count() <= limit
        && !value.chars().any(char::is_control)
}
fn id(value: &str) -> bool {
    value.starts_with("entry_")
        && (7..=80).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
impl Catalog {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != 1 || self.entries.len() > 32 {
            return Err("Invalid chat catalog version or size (maximum 32 entries).");
        }
        let mut ids = HashSet::new();
        let mut tuples = HashSet::new();
        for entry in &self.entries {
            if !id(&entry.id)
                || !["openai", "deepseek", "ollama", "openrouter"]
                    .contains(&entry.provider.as_str())
                || !text(&entry.model_id, 256)
                || entry
                    .display_name
                    .as_ref()
                    .map(|v| !text(v, 80))
                    .unwrap_or(false)
            {
                return Err("Invalid catalog entry: check identity, provider and nonblank bounded model/name without controls.");
            }
            if !ids.insert(&entry.id) {
                return Err("Duplicate chat entry identity.");
            }
            if !tuples.insert((&entry.provider, &entry.model_id)) {
                return Err("This provider and exact model ID already exist.");
            }
        }
        if self
            .default_entry_id
            .as_ref()
            .map(|default| !ids.contains(default))
            .unwrap_or(false)
        {
            return Err("Choose an existing default entry or explicitly clear the default.");
        }
        Ok(())
    }
}
// Pure projection, never writes settings or reads Keychain. Legacy fields are
// retained separately as extraction/title compatibility inputs after migration.
pub fn legacy(fields: &BTreeMap<String, String>, keys: &BTreeMap<String, String>) -> Catalog {
    let models = [
        ("openai", "AI_MODEL", "gpt-6-luna"),
        ("deepseek", "DEEPSEEK_MODEL", "deepseek-flash"),
        ("ollama", "OLLAMA_MODEL", "qwen3.5:4b"),
        (
            "openrouter",
            "OPENROUTER_MODEL",
            "nvidia/nemotron-3.5-lightning:free",
        ),
    ];
    let entries: Vec<Entry> = models
        .iter()
        .map(|(provider, key, default)| Entry {
            id: format!("entry_legacy_{provider}"),
            provider: provider.to_string(),
            model_id: {
                let value = fields.get(*key).map(String::as_str).unwrap_or(default);
                // Only the legacy OpenRouter env schema normalized whitespace.
                if *provider == "openrouter" {
                    value.trim()
                } else {
                    value
                }
                .to_string()
            },
            display_name: None,
        })
        .collect();
    let requested = fields
        .get("AI_PROVIDER")
        .map(String::as_str)
        .unwrap_or("auto");
    let provider = if requested == "auto" {
        if keys.contains_key("DEEPSEEK_API_KEY") {
            "deepseek"
        } else if keys.contains_key("OPENAI_API_KEY") {
            "openai"
        } else {
            ""
        }
    } else {
        requested
    };
    let default_entry_id = entries
        .iter()
        .find(|entry| entry.provider == provider)
        .map(|entry| entry.id.clone());
    Catalog {
        version: 1,
        entries,
        default_entry_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_literals_duplicates_defaults_and_bounds() {
        let mut catalog = Catalog {
            version: 1,
            entries: vec![Entry {
                id: "entry_a".into(),
                provider: "openrouter".into(),
                model_id: "Vendor/Model:Tag".into(),
                display_name: Some("Shared label".into()),
            }],
            default_entry_id: Some("entry_a".into()),
        };
        assert!(catalog.validate().is_ok());
        assert_eq!(catalog.entries[0].model_id, "Vendor/Model:Tag");
        let mut duplicate = catalog.entries[0].clone();
        duplicate.id = "entry_b".into();
        catalog.entries.push(duplicate);
        assert!(catalog.validate().is_err());
        catalog.entries[1].model_id = "Vendor/Other".into();
        assert!(catalog.validate().is_ok());
        catalog.entries[1].id = "entry_a".into();
        assert!(catalog.validate().is_err());
        catalog.entries.pop();
        catalog.entries[0].model_id = "bad\u{007f}id".into();
        assert!(catalog.validate().is_err());
        catalog.entries.clear();
        assert!(catalog.validate().is_err());
        catalog.default_entry_id = None;
        assert!(catalog.validate().is_ok());
        assert!(serde_json::from_str::<Catalog>(
            r#"{"version":1,"entries":[],"defaultEntryId":null,"secret":"no"}"#
        )
        .is_err());
    }
    #[test]
    fn legacy_keeps_custom_and_ineligible_intent_without_auto_inference_from_other_keys() {
        let mut fields = BTreeMap::from([("AI_MODEL".into(), "Custom/Case:Tag".into())]);
        let mut keys = BTreeMap::from([("OPENROUTER_API_KEY".into(), "synthetic".into())]);
        assert_eq!(legacy(&fields, &keys).default_entry_id, None);
        fields.insert("AI_PROVIDER".into(), "openai".into());
        let explicit = legacy(&fields, &keys);
        assert_eq!(
            explicit.default_entry_id.as_deref(),
            Some("entry_legacy_openai")
        );
        assert_eq!(explicit.entries[0].model_id, "Custom/Case:Tag");
        fields.insert("OPENROUTER_MODEL".into(), " Vendor/Legacy:Tag ".into());
        assert_eq!(
            legacy(&fields, &keys).entries[3].model_id,
            "Vendor/Legacy:Tag"
        );
        fields.insert("AI_PROVIDER".into(), "auto".into());
        keys.insert("OPENAI_API_KEY".into(), "synthetic".into());
        assert_eq!(
            legacy(&fields, &keys).default_entry_id.as_deref(),
            Some("entry_legacy_openai")
        );
        keys.insert("DEEPSEEK_API_KEY".into(), "synthetic".into());
        assert_eq!(
            legacy(&fields, &keys).default_entry_id.as_deref(),
            Some("entry_legacy_deepseek")
        );
    }
}
