use crate::{
    chat_catalog::{self, Catalog},
    keychain::Secrets,
    private_store,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const SLOTS: [&str; 3] = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"];
/// Retired unofficial-connector fields. Saved values stay readable inert
/// compatibility metadata in preserved files; nothing validates, activates or
/// falls back to them. Their presence without an official key means reconnect.
pub const RETIRED_FIELDS: [&str; 6] = [
    "GARMIN_MCP_TOKEN_DIR",
    "GARMIN_MCP_COMMAND",
    "GARMIN_FIT_BASELINE_COMMAND",
    "GARMIN_FIT_SPEED_COMMAND",
    "GARMIN_FIT_DISTANCE_COMMAND",
    "GARMIN_FIT_ALTITUDE_COMMAND",
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectionCompatibility {
    pub database: Option<String>,
    pub catalog: Catalog,
}
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
    #[serde(
        rename = "selectionCompatibility",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub selection_compatibility: Option<SelectionCompatibility>,
    /// The user's official Garmin Personal API key. Deliberately not a chat
    /// provider slot: the live provider path never carries it, and builds that
    /// predate it refuse the file instead of silently dropping the connection.
    #[serde(
        rename = "garminApiKey",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub garmin_api_key: Option<String>,
}
#[derive(Deserialize, Default)]
#[serde(tag = "intent", rename_all = "lowercase", deny_unknown_fields)]
pub enum KeyUpdate {
    #[default]
    Unchanged,
    Replace {
        value: String,
    },
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
    /// Garmin key intent; absent means unchanged.
    #[serde(rename = "garminKey", default)]
    pub garmin_key: KeyUpdate,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub fields: BTreeMap<String, String>,
    pub keys: BTreeMap<String, &'static str>,
    /// Status only, never key material: configured, not configured or
    /// reconnect-required (saved unofficial connection, no official key).
    pub garmin: &'static str,
    pub saved: bool,
    pub running: bool,
    pub storage: &'static str,
    #[serde(rename = "chatCatalog")]
    pub chat_catalog: Catalog,
    pub revision: String,
    pub activation: String,
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
    let meta =
        crate::private_fs::path_meta(path).map_err(|_| "Private file missing or unreadable.")?;
    if !path.is_absolute()
        || !meta.private_file()
        || meta.len > 128 * 1024
        || !crate::private_fs::canonical(path)
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
/// A Personal API key is opaque printable ASCII without whitespace. Its expiry
/// and validity are never inferred from the text; only an explicit official
/// operation can show whether Garmin accepts it.
fn valid_garmin_key(value: &str) -> bool {
    (8..=4096).contains(&value.len())
        && value.bytes().all(|b| b.is_ascii_graphic())
        && valid_secret(value)
}
/// Saved unofficial connection metadata without an official key.
fn reconnect_required(settings: &Settings) -> bool {
    settings.garmin_api_key.is_none()
        && settings
            .fields
            .get("GARMIN_MCP_TOKEN_DIR")
            .map(|value| !value.is_empty())
            .unwrap_or(false)
}
pub fn garmin_status(settings: &Settings) -> &'static str {
    if settings.garmin_api_key.is_some() {
        "configured"
    } else if reconnect_required(settings) {
        "reconnect-required"
    } else {
        "not configured"
    }
}
fn apply_garmin(next: &mut Settings, update: KeyUpdate) -> Result<(), &'static str> {
    match update {
        KeyUpdate::Unchanged => Ok(()),
        KeyUpdate::Clear => {
            next.garmin_api_key = None;
            Ok(())
        }
        KeyUpdate::Replace { value } => {
            if !valid_garmin_key(&value) {
                return Err("Enter a valid Garmin Personal API key or choose unchanged/clear.");
            }
            next.garmin_api_key = Some(value);
            Ok(())
        }
    }
}
fn decode(bytes: &[u8]) -> Result<Settings, &'static str> {
    let settings: Settings = serde_json::from_slice(bytes)
        .map_err(|_| "Private settings invalid; preserve originals and use a compatible build.")?;
    let catalog: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../ui/settings-fields.json"))
            .map_err(|_| "Settings catalog unavailable.")?;
    if settings.fields.iter().any(|(key, value)| {
        (!catalog
            .iter()
            .any(|field| field["key"].as_str() == Some(key))
            && !RETIRED_FIELDS.contains(&key.as_str()))
            || value.len() > 2048
            || value.chars().any(char::is_control)
    }) {
        return Err("Saved settings contain unsupported fields; no values are returned.");
    }
    if let Some(prior) = &settings.selection_compatibility {
        if settings.version != 3
            || prior
                .database
                .as_ref()
                .map(|v| v.len() > 2048 || v.chars().any(char::is_control))
                .unwrap_or(false)
        {
            return Err("Unsupported selection compatibility; preserve settings.");
        }
        prior.catalog.validate()?;
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
    if settings
        .garmin_api_key
        .as_ref()
        .map(|key| settings.version != 3 || !valid_garmin_key(key))
        .unwrap_or(false)
    {
        return Err("Saved Garmin key unsupported; preserve settings and use a compatible build.");
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
    match crate::private_fs::path_meta(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("absent".into()),
        Err(_) => Err("Settings revision unavailable; reload before saving."),
        Ok(m) => {
            private_file(path)?;
            Ok(m.revision())
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
        activation:
            "Live state unknown; reload reconciles the owned backend without retrying Save.".into(),
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
        garmin: garmin_status(&settings),
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
        "Settings committed."
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub message: String,
    pub restart_required: bool,
}
// Internal commit facts, never serialized to the renderer. Durability uncertainty
// is not authority for a successful-restart notice.
pub struct SavedCommit {
    pub message: String,
    pub previous_fields: BTreeMap<String, String>,
    pub fields: BTreeMap<String, String>,
    pub durable: bool,
    /// The saved Garmin key differs from the one before this Save.
    pub garmin_changed: bool,
}
/// Comparison token for the Garmin key, never the key: lets the running host
/// tell whether a saved key still matches its startup capability.
pub fn garmin_fingerprint(key: Option<&str>) -> Option<String> {
    use sha2::{Digest, Sha256};
    key.map(|key| format!("{:x}", Sha256::digest(key.as_bytes())))
}
#[cfg(test)]
pub fn save(path: &Path, input: SaveInput) -> Result<String, &'static str> {
    save_confirmed(path, input).map(|saved| saved.message)
}
pub fn save_confirmed(path: &Path, input: SaveInput) -> Result<SavedCommit, &'static str> {
    save_inner(path, input, false)
}
pub fn save_new(path: &Path, input: SaveInput) -> Result<String, &'static str> {
    save_inner(path, input, true).map(|saved| saved.message)
}
fn save_inner(path: &Path, input: SaveInput, fresh: bool) -> Result<SavedCommit, &'static str> {
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
    if next.selection_compatibility.is_none() {
        // Capture before replacing catalog/DB inputs. Retain original v3 bytes
        // before any overwrite; v1/v2 migration already preserves its source.
        if exists && next.version == 3 {
            let archive = path.with_file_name("settings-v3-before-single-choice.json");
            let original = previous
                .as_deref()
                .ok_or("Original settings unavailable.")?;
            if archive.exists() {
                if private_store::read(&archive)? != original {
                    return Err("Original settings archive differs; preserve both and reconcile before saving.");
                }
            } else if !private_store::publish(&archive, original, None)? {
                return Err(
                    "Original settings preservation durability uncertain; reconcile before saving.",
                );
            }
        }
        next.selection_compatibility = Some(SelectionCompatibility {
            database: next.fields.get("DATABASE_PATH").cloned(),
            catalog: if exists {
                next.chat_catalog
                    .clone()
                    .unwrap_or_else(|| chat_catalog::legacy(&next.fields, &next.keys))
            } else {
                Catalog::default()
            },
        });
    }
    let previous_fields = next.fields.clone();
    let previous_garmin = garmin_fingerprint(next.garmin_api_key.as_deref());
    next.version = 3;
    if input
        .fields
        .keys()
        .any(|key| RETIRED_FIELDS.contains(&key.as_str()))
    {
        return Err("Retired Garmin connector settings cannot be edited.");
    }
    // Native carries saved retired metadata forward unchanged; it stays inert.
    let retained: Vec<(String, String)> = previous_fields
        .iter()
        .filter(|(key, _)| RETIRED_FIELDS.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    next.fields = input.fields;
    next.fields.extend(retained);
    let mut catalog = input.chat_catalog;
    catalog.default_entry_id = None;
    next.chat_catalog = Some(catalog);
    apply(&mut next, input.keys)?;
    apply_garmin(&mut next, input.garmin_key)?;
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
    Ok(SavedCommit {
        message: format!(
            "{}{}",
            message(durable, fresh),
            if migrating {
                " Catalog migration committed; original v2 retained unchanged."
            } else {
                ""
            }
        ),
        garmin_changed: previous_garmin != garmin_fingerprint(next.garmin_api_key.as_deref()),
        previous_fields,
        fields: next.fields,
        durable,
    })
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
        chat_catalog: Some(Catalog {
            default_entry_id: None,
            ..input.chat_catalog
        }),
        selection_compatibility: Some(SelectionCompatibility {
            database: old.fields.get("DATABASE_PATH").cloned(),
            catalog: chat_catalog::legacy(&old.fields, &old.keys),
        }),
        garmin_api_key: None,
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
    apply_garmin(&mut next, input.garmin_key)?;
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
    // Retired connector metadata stays in the saved file only; it never reaches
    // the backend, so no activation can select an unofficial path from it.
    let fields: BTreeMap<&String, &String> = settings
        .fields
        .iter()
        .filter(|(key, _)| !RETIRED_FIELDS.contains(&key.as_str()))
        .collect();
    let value = if let Some(catalog) = &settings.chat_catalog {
        catalog.validate()?;
        if let Some(prior) = &settings.selection_compatibility {
            let mut value = serde_json::json!({"version":3,"fields":fields,"secrets":settings.keys,"chatCatalog":catalog,"selectionCompatibility":prior});
            if let Some(key) = &settings.garmin_api_key {
                value["garminKey"] = serde_json::Value::String(key.clone());
            }
            value
        } else {
            serde_json::json!({"version":2,"fields":fields,"secrets":settings.keys,"chatCatalog":catalog})
        }
    } else {
        serde_json::json!({"version":1,"fields":fields,"secrets":settings.keys})
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
        selection_compatibility: None,
        garmin_api_key: None,
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

#[cfg(any(windows, test))]
fn validation_diagnostic(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let object = value.as_object()?;
    if object.len() != 3
        || value["ok"] != false
        || !object.contains_key("stage")
        || !object.contains_key("code")
    {
        return None;
    }
    let stage = match value["stage"].as_str()? {
        "fields" => "fields",
        "database" => "database",
        _ => return None,
    };
    let code = [
        "SQLITE_BUSY",
        "SQLITE_LOCKED",
        "SQLITE_CANTOPEN",
        "SQLITE_CORRUPT",
        "SQLITE_NOTADB",
        "SQLITE_READONLY",
        "SQLITE_ERROR",
        "SQLITE_IOERR",
        "MODULE_NOT_FOUND",
        "ERR_DLOPEN_FAILED",
        "canonical-path",
        "database-file",
        "database-schema",
        "database-integrity",
        "database-compatibility",
        "database-control",
        "unavailable",
    ]
    .into_iter()
    .find(|known| value["code"].as_str() == Some(*known))
    .unwrap_or("unavailable");
    Some((stage, code))
}

#[cfg(any(windows, test))]
fn validation_loader_diagnostic(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    let text = String::from_utf8_lossy(bytes); // Only closed ASCII tokens can leave this function.
    let code = [
        "MODULE_NOT_FOUND",
        "ERR_MODULE_NOT_FOUND",
        "ERR_DLOPEN_FAILED",
        "ERR_REQUIRE_ESM",
        "EINVAL",
        "EBADF",
        "EPIPE",
        "ENOENT",
        "ENOTDIR",
        "ENOTSOCK",
        "EPERM",
        "EACCES",
        "ERR_INVALID_HANDLE_TYPE",
        "ERR_INVALID_FD_TYPE",
        "ERR_INVALID_ARG_VALUE",
        "ERR_INVALID_ARG_TYPE",
        "ERR_UNSUPPORTED_ESM_URL_SCHEME",
        "ERR_UNKNOWN_FILE_EXTENSION",
    ]
    .into_iter()
    .find(|code| text.contains(*code))
    .or_else(|| {
        [
            ("SyntaxError:", "NODE_SYNTAX_ERROR"),
            ("TypeError:", "NODE_TYPE_ERROR"),
            ("RangeError:", "NODE_RANGE_ERROR"),
            ("Assertion failed", "NODE_ASSERTION"),
            ("bad option:", "NODE_BAD_OPTION"),
        ]
        .into_iter()
        .find(|(marker, _)| text.contains(marker))
        .map(|(_, code)| code)
    })?;
    let specifier = text
        .split_once("Cannot find module '")
        .and_then(|(_, tail)| tail.split('\'').next())
        .unwrap_or("");
    let module = [
        "next",
        "better-sqlite3",
        "@next/env",
        "@resvg/resvg-wasm",
        "react",
        "react-dom",
        "react-is",
        "styled-jsx",
        "bindings",
        "file-uri-to-path",
        "@swc/helpers",
        "postcss",
        "caniuse-lite",
        "baseline-browser-mapping",
        "@opentelemetry/api",
        "scheduler",
        "client-only",
        "server-only",
    ]
    .into_iter()
    .find(|module| specifier == *module || specifier.starts_with(&format!("{module}/")))
    .unwrap_or("unavailable");
    Some((code, module))
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
    let runtime = crate::process_tree::runtime_directory(resources);
    let mut command = Command::new(crate::process_tree::node(resources));
    command
        .arg(runtime.join("runtime.cjs"))
        .arg("--validate-settings")
        .current_dir(runtime)
        .env_clear()
        .env("NODE_ENV", "production")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::process_tree::system_environment(&mut command);
    let mut child = crate::process_tree::Tree::spawn(&mut command)
        .map_err(|_| "Settings validator resources unavailable. Rebuild the desktop app.")?;
    let stdout = child.stdout.take().ok_or("Settings result unavailable.")?;
    let stderr = child.stderr.take().ok_or("Settings result unavailable.")?;
    let error_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.take(64 * 1024 + 1).read_to_end(&mut bytes);
        bytes
    });
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
                    #[cfg(windows)]
                    if let Some(code) = exit.code() {
                        eprintln!("Desktop settings child exit: {code}");
                    }
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
        child.kill();
    }
    let _ = child.wait();
    let (read, bytes) = reader.join().map_err(|_| "Settings result interrupted.")?;
    let mut error_bytes = error_reader
        .join()
        .map_err(|_| "Settings result interrupted.")?;
    #[cfg(windows)]
    if result.is_err() {
        eprintln!(
            "Desktop settings transport bytes: {} {}",
            bytes.len(),
            error_bytes.len()
        );
        let value = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
        let kind = match value.as_ref() {
            Some(value) if value["ok"] == false => "validation-refusal",
            Some(value) if value["ok"] == true => "unexpected-success",
            Some(value) if value["type"] == "failed" => "backend-failure",
            Some(value) if value["type"] == "ready" => "unexpected-ready",
            Some(_) => "other-json",
            None => "non-json",
        };
        eprintln!("Desktop settings stdout kind: {kind}");
        if let Some((stage, code)) = validation_diagnostic(&bytes) {
            eprintln!("Desktop settings validation: {stage} {code}");
        }
        if error_bytes.len() <= 64 * 1024 {
            if let Some((code, module)) = validation_loader_diagnostic(&error_bytes) {
                eprintln!("Desktop settings loader: {code} {module}");
            }
        }
    }
    error_bytes.fill(0); // Raw loader errors/paths never become UI, logs or publication.
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
    #[test]
    fn validation_failure_metadata_never_forwards_unknown_text_paths_or_fields() {
        assert_eq!(
            validation_diagnostic(br#"{"ok":false,"stage":"database","code":"SQLITE_CANTOPEN"}"#),
            Some(("database", "SQLITE_CANTOPEN"))
        );
        assert_eq!(
            validation_diagnostic(br#"{"ok":false,"stage":"fields","code":"private-key-path"}"#),
            Some(("fields", "unavailable"))
        );
        assert!(validation_diagnostic(
            br#"{"ok":false,"stage":"private-key","code":"unavailable"}"#
        )
        .is_none());
        assert!(validation_diagnostic(
            br#"{"ok":false,"stage":"database","code":"unavailable","path":"private-key"}"#
        )
        .is_none());
        assert!(validation_diagnostic(br#"{"ok":true,"fields":{}}"#).is_none());
    }
    #[test]
    fn loader_diagnostics_discard_raw_paths_and_unknown_module_names() {
        assert_eq!(validation_loader_diagnostic(b"Error: Cannot find module 'styled-jsx/package.json'\ncode: 'MODULE_NOT_FOUND'\nprivate-path-key"), Some(("MODULE_NOT_FOUND", "styled-jsx")));
        assert_eq!(
            validation_loader_diagnostic(
                b"Error: Cannot find module '../private-key'\ncode: 'MODULE_NOT_FOUND'"
            ),
            Some(("MODULE_NOT_FOUND", "unavailable"))
        );
        assert_eq!(
            validation_loader_diagnostic(
                b"Error: invalid argument\ncode: 'EINVAL'\nprivate-path-key"
            ),
            Some(("EINVAL", "unavailable"))
        );
        assert_eq!(
            validation_loader_diagnostic(b"\xff\x1b[32mEINVAL\x1b[0m private-path-key"),
            Some(("EINVAL", "unavailable"))
        );
        assert_eq!(
            validation_loader_diagnostic(b"TypeError: private-path-key"),
            Some(("NODE_TYPE_ERROR", "unavailable"))
        );
        assert!(validation_loader_diagnostic(b"private-path-key").is_none());
    }
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
        crate::private_fs::testing::private_root("trainer-settings")
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
            garmin_key: Default::default(),
        }
    }
    fn garmin(path: &Path, update: KeyUpdate) -> SaveInput {
        SaveInput {
            garmin_key: update,
            ..input(path, BTreeMap::new(), BTreeMap::new())
        }
    }
    const GARMIN_KEY: &str = "synthetic-garmin-personal-key";
    #[test]
    fn garmin_key_unchanged_replace_clear_is_status_only_and_never_a_chat_slot() {
        let root = root();
        let path = selected(&root);
        save_new(&path, input(&path, BTreeMap::new(), BTreeMap::new())).unwrap();
        assert_eq!(snapshot(&path, false).unwrap().garmin, "not configured");
        let replaced = save_confirmed(
            &path,
            garmin(
                &path,
                KeyUpdate::Replace {
                    value: GARMIN_KEY.into(),
                },
            ),
        )
        .unwrap();
        assert!(replaced.garmin_changed);
        let read = serde_json::to_string(&snapshot(&path, true).unwrap()).unwrap();
        assert!(!read.contains(GARMIN_KEY));
        assert!(read.contains("\"garmin\":\"configured\""));
        assert!(!load(&path).unwrap().keys.contains_key("GARMIN_API_KEY"));
        // Activation carries it separately from the chat-provider secrets.
        let frame: serde_json::Value = serde_json::from_slice(&activation(&path).unwrap()).unwrap();
        assert_eq!(frame["garminKey"], GARMIN_KEY);
        assert_eq!(frame["secrets"], serde_json::json!({}));
        let unchanged = save_confirmed(&path, garmin(&path, KeyUpdate::Unchanged)).unwrap();
        assert!(!unchanged.garmin_changed);
        assert_eq!(
            load(&path).unwrap().garmin_api_key.as_deref(),
            Some(GARMIN_KEY)
        );
        // Blank/placeholder text is refused, never stored or treated as removal.
        for value in ["", "your-garmin-key", "two words", "short"] {
            let before = private_store::read(&path).unwrap();
            assert!(save(
                &path,
                garmin(
                    &path,
                    KeyUpdate::Replace {
                        value: value.into()
                    }
                )
            )
            .is_err());
            assert_eq!(private_store::read(&path).unwrap(), before);
        }
        let cleared = save_confirmed(&path, garmin(&path, KeyUpdate::Clear)).unwrap();
        assert!(cleared.garmin_changed);
        assert_eq!(snapshot(&path, false).unwrap().garmin, "not configured");
        let frame: serde_json::Value = serde_json::from_slice(&activation(&path).unwrap()).unwrap();
        assert!(frame.get("garminKey").is_none());
        // A stale form never publishes a Garmin change.
        let stale = garmin(
            &path,
            KeyUpdate::Replace {
                value: GARMIN_KEY.into(),
            },
        );
        save(&path, input(&path, BTreeMap::new(), BTreeMap::new())).unwrap();
        assert!(save(&path, stale).is_err());
        assert!(load(&path).unwrap().garmin_api_key.is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn saved_unofficial_connection_needs_reconnect_and_its_metadata_stays_inert_and_preserved() {
        let root = root();
        let path = root.join("settings-v3.json");
        let old = Settings {
            version: 3,
            fields: BTreeMap::from([
                (
                    "GARMIN_MCP_TOKEN_DIR".into(),
                    "/private/old-token-store".into(),
                ),
                ("GARMIN_MCP_COMMAND".into(), "uvx".into()),
                ("AI_PROVIDER".into(), "ollama".into()),
            ]),
            keys: BTreeMap::new(),
            chat_catalog: Some(Catalog::default()),
            selection_compatibility: Some(SelectionCompatibility {
                database: None,
                catalog: Catalog::default(),
            }),
            garmin_api_key: None,
        };
        assert!(private_store::publish(&path, &encode(&old).unwrap(), None).unwrap());
        let snapshot = snapshot(&path, false).unwrap();
        assert_eq!(snapshot.garmin, "reconnect-required");
        assert_eq!(snapshot.storage, "private-file");
        // Retired metadata never reaches the backend, so no fallback can use it.
        let frame: serde_json::Value = serde_json::from_slice(&activation(&path).unwrap()).unwrap();
        assert_eq!(
            frame["fields"],
            serde_json::json!({"AI_PROVIDER": "ollama"})
        );
        // Renderer forms cannot edit retired fields.
        let mut edit = input(&path, BTreeMap::new(), BTreeMap::new());
        edit.fields
            .insert("GARMIN_MCP_TOKEN_DIR".into(), String::new());
        assert!(save(&path, edit).is_err());
        // Ordinary Save and key entry carry the old metadata forward unchanged.
        save(
            &path,
            SaveInput {
                garmin_key: KeyUpdate::Replace {
                    value: GARMIN_KEY.into(),
                },
                ..input(
                    &path,
                    BTreeMap::from([("AI_PROVIDER".into(), "ollama".into())]),
                    BTreeMap::new(),
                )
            },
        )
        .unwrap();
        let saved = load(&path).unwrap();
        assert_eq!(
            saved.fields["GARMIN_MCP_TOKEN_DIR"],
            "/private/old-token-store"
        );
        assert_eq!(saved.fields["GARMIN_MCP_COMMAND"], "uvx");
        assert_eq!(garmin_status(&saved), "configured");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn older_formats_and_builds_cannot_carry_or_silently_drop_a_garmin_key() {
        let root = root();
        let path = root.join("settings-v2.json");
        // Only the current format may carry a key; older ones refuse it.
        for version in [1, 2] {
            let old = serde_json::json!({"version":version,"fields":{},"keys":{},"garminApiKey":GARMIN_KEY});
            assert!(decode(&serde_json::to_vec(&old).unwrap()).is_err());
        }
        // The current-format key field is outside every older deny_unknown_fields schema.
        let v3 = serde_json::json!({"version":3,"fields":{},"keys":{},"chatCatalog":Catalog::default(),"selectionCompatibility":{"database":null,"catalog":Catalog::default()},"garminApiKey":GARMIN_KEY});
        let decoded = decode(&serde_json::to_vec(&v3).unwrap()).unwrap();
        assert_eq!(decoded.garmin_api_key.as_deref(), Some(GARMIN_KEY));
        let _ = path;
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn confirmed_save_carries_private_delta_only_internally_and_refuses_stale_commit() {
        let root = root();
        let path = selected(&root);
        let before = BTreeMap::from([("MEMORY_EMBEDDING_DIMS".into(), "1536".into())]);
        save_new(&path, input(&path, before.clone(), replacement())).unwrap();
        let after = BTreeMap::from([("MEMORY_EMBEDDING_DIMS".into(), "2048".into())]);
        let stale = input(&path, before.clone(), BTreeMap::new());
        let committed =
            save_confirmed(&path, input(&path, after.clone(), BTreeMap::new())).unwrap();
        assert!(committed.durable);
        assert_eq!(committed.previous_fields, before);
        assert_eq!(committed.fields, after);
        let result = serde_json::to_value(SaveResult {
            message: committed.message,
            restart_required: true,
        })
        .unwrap();
        assert_eq!(result.as_object().unwrap().len(), 2);
        assert_eq!(result["restartRequired"], true);
        assert!(!result.to_string().contains("2048"));
        assert!(!result.to_string().contains("synthetic-provider-secret"));
        assert!(save_confirmed(&path, stale).is_err());
        assert_eq!(load(&path).unwrap().fields, after);
        fs::remove_dir_all(root).unwrap();
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
    fn provider_field_intents_preserve_untouched_slots_and_refuse_key_only_stale_forms() {
        let root = root();
        let path = selected(&root);
        let originals = BTreeMap::from([
            ("OPENAI_API_KEY".into(), "synthetic-openai-original".into()),
            (
                "DEEPSEEK_API_KEY".into(),
                "synthetic-deepseek-original".into(),
            ),
            (
                "OPENROUTER_API_KEY".into(),
                "synthetic-openrouter-original".into(),
            ),
        ]);
        let create = originals
            .iter()
            .map(|(slot, value): (&String, &String)| {
                (
                    slot.clone(),
                    KeyUpdate::Replace {
                        value: value.clone(),
                    },
                )
            })
            .collect();
        save_new(&path, input(&path, BTreeMap::new(), create)).unwrap();
        let stale = input(&path, BTreeMap::new(), replacement());
        let updates = BTreeMap::from([
            ("OPENAI_API_KEY".into(), KeyUpdate::Unchanged),
            (
                "DEEPSEEK_API_KEY".into(),
                KeyUpdate::Replace {
                    value: "synthetic-new-deepseek".into(),
                },
            ),
            ("OPENROUTER_API_KEY".into(), KeyUpdate::Clear),
        ]);
        save(&path, input(&path, BTreeMap::new(), updates)).unwrap();
        let committed = private_store::read(&path).unwrap();
        assert_eq!(
            load(&path).unwrap().keys,
            BTreeMap::from([
                ("OPENAI_API_KEY".into(), "synthetic-openai-original".into()),
                ("DEEPSEEK_API_KEY".into(), "synthetic-new-deepseek".into()),
            ])
        );
        assert!(save(&path, stale).is_err());
        assert_eq!(private_store::read(&path).unwrap(), committed);
        let snapshot = serde_json::to_string(&snapshot(&path, false).unwrap()).unwrap();
        for secret in originals
            .values()
            .chain(std::iter::once(&"synthetic-new-deepseek".to_string()))
        {
            assert!(!snapshot.contains(secret));
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn memory_off_on_retains_complete_custom_configuration_and_private_key() {
        let root = root();
        let path = selected(&root);
        let mut fields = BTreeMap::from([
            ("MEMORY_ENABLED".into(), "true".into()),
            ("MEMORY_EMBEDDING_PROVIDER".into(), "ollama".into()),
            ("MEMORY_EMBEDDING_MODEL".into(), "custom-embedding".into()),
            (
                "MEMORY_EMBEDDING_BASE_URL".into(),
                "http://127.0.0.1:11435".into(),
            ),
            ("MEMORY_EMBEDDING_DIMS".into(), "768".into()),
            ("MEMORY_TIMEOUT_MS".into(), "15432".into()),
            ("MEMORY_EXTRACTION_MODE".into(), "off".into()),
            ("MEMORY_EXTRACTION_TIMEOUT_MS".into(), "5432".into()),
        ]);
        save_new(&path, input(&path, fields.clone(), replacement())).unwrap();
        for enabled in ["false", "true"] {
            fields.insert("MEMORY_ENABLED".into(), enabled.into());
            save(
                &path,
                input(
                    &path,
                    fields.clone(),
                    BTreeMap::from([("OPENAI_API_KEY".into(), KeyUpdate::Unchanged)]),
                ),
            )
            .unwrap();
            assert_eq!(load(&path).unwrap().fields, fields);
            assert_eq!(snapshot(&path, true).unwrap().fields, fields);
            assert_eq!(
                load(&path).unwrap().keys["OPENAI_API_KEY"],
                "synthetic-provider-secret"
            );
        }
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
            selection_compatibility: None,
            keys: SLOTS
                .iter()
                .map(|s| (s.to_string(), format!("{s}/{}", uuid::Uuid::new_v4())))
                .collect(),
            garmin_api_key: None,
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
            selection_compatibility: None,
            keys: SLOTS
                .iter()
                .map(|s| (s.to_string(), format!("{s}/{}", uuid::Uuid::new_v4())))
                .collect(),
            garmin_api_key: None,
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
            selection_compatibility: None,
            keys: SLOTS
                .iter()
                .map(|s| (s.to_string(), format!("{s}/{}", uuid::Uuid::new_v4())))
                .collect(),
            garmin_api_key: None,
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
            selection_compatibility: None,
            garmin_api_key: None,
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
    fn choice_compatibility_survives_save_before_read_removal_restart_and_preserves_original_v3() {
        let root = root();
        let path = root.join("settings-v3.json");
        let fields = BTreeMap::from([
            ("DATABASE_PATH".into(), "/private/original.sqlite".into()),
            ("AI_PROVIDER".into(), "ollama".into()),
        ]);
        let catalog = chat_catalog::legacy(&fields, &BTreeMap::new());
        let original = encode(&Settings {
            version: 3,
            fields: fields.clone(),
            chat_catalog: Some(catalog.clone()),
            ..Default::default()
        })
        .unwrap();
        private_store::publish(&path, &original, None).unwrap();
        let mut edit = input(&path, fields.clone(), BTreeMap::new());
        edit.chat_catalog = Catalog::default(); // Includes removal of prior default.
        save(&path, edit).unwrap();
        assert_eq!(
            private_store::read(&root.join("settings-v3-before-single-choice.json")).unwrap(),
            original
        );
        let saved = load(&path).unwrap();
        let prior = saved.selection_compatibility.unwrap();
        assert_eq!(prior.database.as_deref(), Some("/private/original.sqlite"));
        assert_eq!(prior.catalog, catalog);
        assert!(saved.chat_catalog.unwrap().entries.is_empty());
        let frame: serde_json::Value = serde_json::from_slice(&activation(&path).unwrap()).unwrap();
        assert_eq!(frame["version"], 3);
        assert_eq!(
            frame["selectionCompatibility"]["catalog"]["defaultEntryId"],
            "entry_legacy_ollama"
        );
        let mut other = input(
            &path,
            BTreeMap::from([("DATABASE_PATH".into(), "/private/different.sqlite".into())]),
            BTreeMap::new(),
        );
        other.chat_catalog = Catalog::default();
        save(&path, other).unwrap();
        assert_eq!(
            load(&path)
                .unwrap()
                .selection_compatibility
                .unwrap()
                .database,
            prior.database
        );
        assert_eq!(
            private_store::read(&root.join("settings-v3-before-single-choice.json")).unwrap(),
            original
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_original_preservation_never_discards_compatibility_inputs() {
        let root = root();
        let path = root.join("settings-v3.json");
        let original = encode(&Settings {
            version: 3,
            chat_catalog: Some(Catalog::default()),
            ..Default::default()
        })
        .unwrap();
        private_store::publish(&path, &original, None).unwrap();
        private_store::publish(
            &root.join("settings-v3-before-single-choice.json"),
            b"different-original",
            None,
        )
        .unwrap();
        assert!(save(&path, input(&path, BTreeMap::new(), BTreeMap::new())).is_err());
        assert_eq!(private_store::read(&path).unwrap(), original);
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
            selection_compatibility: None,
            garmin_api_key: None,
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
