//! Closed transport, installed only by explicit native debug or ordinary-run admission.
use crate::isolated_run::Admission;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;
#[path = "dev_capture.rs"]
mod capture;
#[cfg(debug_assertions)]
#[path = "dev_input.rs"]
mod input;
const LIMIT: usize = 16 * 1024;
#[derive(Clone)]
pub struct Config {
    pub run_id: String,
    pub token: String,
    pub root: std::path::PathBuf,
    pub source: String,
    pub port: u16,
    pub ordinary: Option<Arc<Admission>>,
}
impl Config {
    fn boot(&self) -> Option<&str> {
        self.ordinary.as_ref().map(|a| a.boot.as_str())
    }
    fn verify(&self) -> bool {
        self.ordinary
            .as_ref()
            .map(|a| a.verify().is_ok())
            .unwrap_or(true)
    }
    fn permits(&self, command: &Command) -> bool {
        match command {
            Command::Capture {} => self.ordinary.is_none(),
            #[cfg(debug_assertions)]
            Command::CaptureDebug {} | Command::DebugKey { .. } => self.ordinary.is_none(),
            Command::Click { target }
                if ["LLM debug traces", "First LLM trace"].contains(&target.as_str()) =>
            {
                self.ordinary.is_none()
            }
            Command::SetViewport { .. } | Command::CaptureView { .. } => self.ordinary.is_some(),
            Command::Input { value, .. } | Command::Assert { value, .. }
                if self.ordinary.is_some() =>
            {
                value == &format!("T0231-smoke-{}", self.run_id)
            }
            _ => true,
        }
    }
}
#[cfg(debug_assertions)]
impl From<crate::smoke_config::Config> for Config {
    fn from(value: crate::smoke_config::Config) -> Self {
        Self {
            run_id: value.run_id,
            token: value.token,
            root: value.root,
            source: value.source,
            port: value.port,
            ordinary: None,
        }
    }
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Observe {},
    Click {
        target: String,
    },
    Input {
        target: String,
        value: String,
    },
    Assert {
        target: String,
        value: String,
    },
    Capture {},
    SetViewport {
        preset: String,
    },
    CaptureView {
        view: String,
        preset: String,
    },
    #[cfg(debug_assertions)]
    CaptureDebug {},
    #[cfg(debug_assertions)]
    DebugKey {
        key: String,
    },
}
impl Command {
    fn is_capture(&self) -> bool {
        match self {
            Self::Capture {} | Self::CaptureView { .. } => true,
            #[cfg(debug_assertions)]
            Self::CaptureDebug {} => true,
            _ => false,
        }
    }
    fn boundary(&self, ordinary: bool) -> &'static str {
        #[cfg(debug_assertions)]
        if matches!(self, Self::CaptureDebug {}) {
            return "sanitized actual synthetic LLM disclosure subtree";
        }
        if ordinary {
            "geometry-preserving redacted own-WebView"
        } else {
            "sanitized actual Profile Goals subtree"
        }
    }
    fn valid(&self) -> bool {
        match self {
            Self::Observe {} | Self::Capture {} => true,
            Self::SetViewport { preset } => ["wide", "narrow"].contains(&preset.as_str()),
            Self::CaptureView { view, preset } => {
                ["trainer", "sync", "profile"].contains(&view.as_str())
                    && ["wide", "narrow"].contains(&preset.as_str())
            }
            #[cfg(debug_assertions)]
            Self::CaptureDebug {} => true,
            #[cfg(debug_assertions)]
            Self::DebugKey { key } => ["Enter", "Space"].contains(&key.as_str()),
            Self::Click { target } => {
                [
                    "Activities",
                    "Health",
                    "Training Plan",
                    "Sync",
                    "Profile & data",
                    "Back to chat",
                    "Close Profile & data",
                    "Save Profile",
                    "Reload saved Profile",
                ]
                .contains(&target.as_str())
                    || (cfg!(debug_assertions)
                        && ["LLM debug traces", "First LLM trace"].contains(&target.as_str()))
            }
            Self::Input { target, value } | Self::Assert { target, value } => {
                target == "Goals"
                    && value.starts_with("T0231-smoke-")
                    && value.len() <= 100
                    && value
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            }
        }
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    request_id: String,
    expected_run_id: String,
    #[serde(default)]
    expected_boot: Option<String>,
    command: Command,
}
type Pending = Option<(String, mpsc::SyncSender<Value>)>;
pub struct Bridge {
    pub config: Config,
    pub origin: Mutex<Option<String>>,
    pending: Mutex<Pending>,
    seen: Mutex<HashSet<String>>,
}
#[tauri::command]
pub fn smoke_result(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<Bridge>>,
    run_id: String,
    request_id: String,
    result: Value,
    boot: Option<String>,
) -> Result<(), String> {
    let origin = state.origin.lock().map_err(|_| "Identity unavailable")?;
    if window.label() != "trainer"
        || window
            .url()
            .ok()
            .map(|u| u.origin().ascii_serialization())
            .as_ref()
            != origin.as_ref()
        || run_id != state.config.run_id
        || boot.as_deref() != state.config.boot()
        || !state.config.verify()
        || serde_json::to_vec(&result)
            .map_err(|_| "Invalid result")?
            .len()
            > LIMIT
    {
        return Err("Wrong renderer/result identity or bound".into());
    }
    state.complete(&request_id, result)
}
impl Bridge {
    fn complete(&self, request_id: &str, result: Value) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "Pending unavailable")?;
        if pending.as_ref().map(|(id, _)| id.as_str()) != Some(request_id) {
            return Err("Unknown/late/duplicate result".into());
        }
        pending
            .take()
            .ok_or("No pending result")?
            .1
            .try_send(result)
            .map_err(|_| "Expired result".into())
    }
}
pub fn start(app: &tauri::AppHandle, config: Config) -> Result<(), String> {
    if !config.verify() {
        return Err("Run authority changed".into());
    }
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, config.port))
        .map_err(|_| "Smoke endpoint occupied; no fallback")?;
    let state = Arc::new(Bridge {
        config,
        origin: Mutex::new(None),
        pending: Mutex::new(None),
        seen: Mutex::new(HashSet::new()),
    });
    app.manage(state.clone());
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
            let (status, result) = match read_request(&mut stream, &state.config) {
                Ok((path, body)) => handle(&app, &state, &path, &body),
                Err(error) => (403, json!({"ok":false,"error":error})),
            };
            let body = serde_json::to_vec(&result).unwrap_or_default();
            let header=format!("HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len());
            let _ = stream
                .write_all(header.as_bytes())
                .and_then(|_| stream.write_all(&body));
        }
    });
    Ok(())
}
fn read_request(stream: &mut TcpStream, config: &Config) -> Result<(String, Vec<u8>), String> {
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut data = Vec::new();
    loop {
        stream
            .set_read_timeout(Some(
                deadline
                    .checked_duration_since(Instant::now())
                    .ok_or("Read deadline")?,
            ))
            .map_err(|_| "Deadline unavailable")?;
        if data.len() >= LIMIT {
            return Err("Input bound".into());
        }
        let mut byte = [0];
        if stream.read(&mut byte).map_err(|_| "Read deadline")? == 0 {
            return Err("Incomplete header".into());
        }
        data.push(byte[0]);
        if data.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let text = std::str::from_utf8(&data).map_err(|_| "Invalid headers")?;
    let mut lines = text.split("\r\n");
    let first = lines.next().ok_or("Missing method")?;
    let mut headers = HashMap::new();
    for line in lines.filter(|l| !l.is_empty()) {
        let (key, value) = line.split_once(':').ok_or("Malformed header")?;
        if headers
            .insert(key.to_ascii_lowercase(), value.trim())
            .is_some()
        {
            return Err("Duplicate header".into());
        }
    }
    authorize(&headers, config)?;
    let path = match first {
        "GET /identity HTTP/1.1" => "/identity",
        "POST /command HTTP/1.1" => "/command",
        _ => return Err("Unknown route".into()),
    };
    let length: usize = headers
        .get("content-length")
        .unwrap_or(&"0")
        .parse()
        .map_err(|_| "Invalid length")?;
    if length > LIMIT - data.len()
        || headers.contains_key("transfer-encoding")
        || (path == "/command" && headers.get("content-type") != Some(&"application/json"))
        || (path == "/identity" && length != 0)
    {
        return Err("Invalid framing/size/type".into());
    }
    let mut body = vec![0; length];
    let mut offset = 0;
    while offset < length {
        stream
            .set_read_timeout(Some(
                deadline
                    .checked_duration_since(Instant::now())
                    .ok_or("Body deadline")?,
            ))
            .map_err(|_| "Deadline")?;
        let n = stream
            .read(&mut body[offset..])
            .map_err(|_| "Body deadline")?;
        if n == 0 {
            return Err("Incomplete body".into());
        }
        offset += n
    }
    Ok((path.into(), body))
}
fn authorize(headers: &HashMap<String, &str>, config: &Config) -> Result<(), String> {
    if headers.get("host").copied() != Some(format!("127.0.0.1:{}", config.port).as_str())
        || headers.get("authorization").copied()
            != Some(format!("Bearer {}", config.token).as_str())
        || headers.get("x-smoke-run").copied() != Some(config.run_id.as_str())
        || headers.contains_key("origin")
        || headers.contains_key("sec-fetch-site")
    {
        return Err("Host/origin/capability/run refused".into());
    }
    Ok(())
}
fn diagnostic_result(bytes: &[u8]) -> Value {
    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Diagnostic {
        ready: String,
        bootstrap: bool,
        ipc: bool,
        dashboard: bool,
        ordinary_context: bool,
        width: u32,
        height: u32,
    }
    match serde_json::from_slice::<Diagnostic>(bytes) {
        Ok(value)
            if ["loading", "interactive", "complete"].contains(&value.ready.as_str())
                && value.width <= 8192
                && value.height <= 8192 =>
        {
            serde_json::to_value(value).unwrap_or(json!({"evaluationFailed":true}))
        }
        _ => json!({"evaluationFailed":true}),
    }
}
#[cfg(target_os = "macos")]
fn renderer_diagnostic(app: &tauri::AppHandle) -> Value {
    use objc2::{class, msg_send, runtime::AnyObject};
    let Some(window) = app.get_webview_window("trainer") else {
        return json!({"window":false});
    };
    let (tx, rx) = mpsc::sync_channel(1);
    let script = "JSON.stringify({ready:document.readyState,bootstrap:typeof window.__trainerSmoke==='function',ipc:!!window.__TAURI_INTERNALS__,dashboard:!!document.querySelector('[aria-label=\"AI trainer dashboard\"]'),ordinaryContext:!!window.__trainerOrdinaryIsolated,width:window.innerWidth,height:window.innerHeight})";
    let script = std::ffi::CString::new(script).expect("Fixed script without NUL");
    let queued = window.with_webview(move |webview| {
        let completion =
            block2::RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                // SAFETY: fixed native-owned script returns an NSString of bounded booleans;
                // WebKit invokes this callback with live objects on its main thread.
                let diagnostic = unsafe {
                    if !error.is_null() || result.is_null() {
                        json!({"evaluationFailed":true})
                    } else {
                        let bytes: *const std::ffi::c_char = msg_send![result, UTF8String];
                        if bytes.is_null() {
                            json!({"evaluationFailed":true})
                        } else {
                            let text = std::ffi::CStr::from_ptr(bytes).to_bytes();
                            if text.len() > 512 {
                                json!({"evaluationFailed":true})
                            } else {
                                diagnostic_result(text)
                            }
                        }
                    }
                };
                let _ = tx.try_send(diagnostic);
            });
        // SAFETY: this is Tauri's own WKWebView and a fixed internal diagnostic, never wire code.
        unsafe {
            let view = webview.inner().cast::<AnyObject>();
            let string: *mut AnyObject =
                msg_send![class!(NSString),stringWithUTF8String:script.as_ptr()];
            let _: () = msg_send![view,evaluateJavaScript:string,completionHandler:&*completion];
        }
    });
    if queued.is_err() {
        return json!({"window":false});
    }
    let mut diagnostic = rx
        .recv_timeout(Duration::from_secs(1))
        .unwrap_or(json!({"evaluationDeadline":true}));
    if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
        let logical = size.to_logical::<f64>(scale);
        if logical.width.is_finite()
            && logical.height.is_finite()
            && (0.0..=8192.0).contains(&logical.width)
            && (0.0..=8192.0).contains(&logical.height)
        {
            diagnostic["nativeWidth"] = json!(logical.width);
            diagnostic["nativeHeight"] = json!(logical.height);
        }
    }
    diagnostic
}
#[cfg(not(target_os = "macos"))]
fn renderer_diagnostic(_app: &tauri::AppHandle) -> Value {
    json!({"unsupported":true})
}
fn viewport_size(diagnostic: &Value, preset: &str) -> Option<tauri::LogicalSize<f64>> {
    let width = match preset {
        "wide" => 1280.0,
        "narrow" => 420.0,
        _ => return None,
    };
    let dx = diagnostic["nativeWidth"].as_f64()? - diagnostic["width"].as_f64()?;
    let dy = diagnostic["nativeHeight"].as_f64()? - diagnostic["height"].as_f64()?;
    // Account only for bounded native content insets. Never change requested WebView geometry.
    if !(0.0..=64.0).contains(&dx) || !(0.0..=64.0).contains(&dy) {
        return None;
    }
    Some(tauri::LogicalSize::new(width + dx, 850.0 + dy))
}
fn exact_keys(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .map(|o| o.len() == keys.len() && keys.iter().all(|key| o.contains_key(*key)))
        .unwrap_or(false)
}
fn safe_debug_observation(value: &Value) -> bool {
    if value["available"] == false {
        return exact_keys(value, &["available"]);
    }
    let booleans = [
        "available",
        "open",
        "summaryVisible",
        "nativeMarker",
        "focused",
        "focusVisible",
        "focusMatches",
        "documentFocused",
        "nativeKeyReceived",
        "warningVisible",
    ];
    let arrays = ["innerOpen", "previewsVisible", "bodiesVisible"];
    let mut keys = booleans.to_vec();
    keys.extend(arrays);
    exact_keys(value, &keys)
        && value["available"] == true
        && booleans.iter().all(|key| value[*key].is_boolean())
        && arrays.iter().all(|key| {
            value[*key]
                .as_array()
                .map(|items| items.len() <= 128 && items.iter().all(Value::is_boolean))
                .unwrap_or(false)
        })
        && arrays.iter().all(|key| {
            value[*key].as_array().map(Vec::len) == value["innerOpen"].as_array().map(Vec::len)
        })
}
fn safe_result(command: &Command, value: &Value, ordinary: bool) -> bool {
    if value["ok"] == false {
        return (exact_keys(value, &["ok", "error"])
            && value["error"] == "Rendered command refused or failed")
            || (matches!(command, Command::Assert { .. })
                && exact_keys(value, &["ok", "matches"])
                && value["matches"] == false);
    }
    if value["ok"] != true {
        return false;
    }
    match command {
        Command::Observe {} => {
            let strings = |key: &str, choices: &[&str], max: usize| {
                value[key]
                    .as_array()
                    .map(|a| {
                        a.len() <= max
                            && a.iter()
                                .all(|v| v.as_str().map(|s| choices.contains(&s)).unwrap_or(false))
                    })
                    .unwrap_or(false)
            };
            let mut keys = vec![
                "ok",
                "dashboard",
                "hydrated",
                "navigation",
                "headings",
                "profileReady",
                "profileSaved",
                "view",
            ];
            if let Some(debug) = value.get("llmDebug") {
                if ordinary || !safe_debug_observation(debug) {
                    return false;
                }
                keys.push("llmDebug");
            }
            exact_keys(value, &keys)
                && ["dashboard", "hydrated", "profileReady", "profileSaved"]
                    .iter()
                    .all(|k| value[*k].is_boolean())
                && strings(
                    "navigation",
                    &[
                        "Activities",
                        "Health",
                        "Training Plan",
                        "Sync",
                        "Profile & data",
                        "Back to chat",
                    ],
                    9,
                )
                && strings(
                    "headings",
                    &[
                        "Garmin AI Trainer",
                        "Activities",
                        "Daily health",
                        "Health",
                        "Training Plan",
                        "Sync",
                        "Profile & data",
                    ],
                    9,
                )
                && value["view"]
                    .as_str()
                    .map(|v| {
                        [
                            "Trainer",
                            "Activities",
                            "Health",
                            "Training Plan",
                            "Sync",
                            "Profile & data",
                        ]
                        .contains(&v)
                    })
                    .unwrap_or(false)
        }
        Command::Click { target } => {
            exact_keys(value, &["ok", "action", "trustedInput"])
                && value["action"].as_str() == Some(target)
                && value["trustedInput"] == false
        }
        Command::Input { .. } => {
            exact_keys(value, &["ok", "action", "trustedInput"])
                && value["action"] == "Goals input"
                && value["trustedInput"] == false
        }
        Command::Assert { .. } => exact_keys(value, &["ok", "matches"]) && value["matches"] == true,
        Command::Capture {} => {
            exact_keys(value, &["ok", "boundary"])
                && value["boundary"] == "sanitized actual Profile Goals subtree"
        }
        #[cfg(debug_assertions)]
        Command::CaptureDebug {} => {
            !ordinary
                && exact_keys(value, &["ok", "boundary"])
                && value["boundary"] == "sanitized actual synthetic LLM disclosure subtree"
        }
        #[cfg(debug_assertions)]
        Command::DebugKey { .. } => {
            !ordinary
                && exact_keys(value, &["ok", "readyForNativeKey"])
                && value["readyForNativeKey"] == true
        }
        Command::SetViewport { preset } => {
            exact_keys(value, &["ok", "preset"]) && value["preset"].as_str() == Some(preset)
        }
        Command::CaptureView { view, preset } => {
            exact_keys(value, &["ok", "view", "preset", "boundary"])
                && value["view"].as_str() == Some(view)
                && value["preset"].as_str() == Some(preset)
                && value["boundary"] == "geometry-preserving redacted own-WebView"
        }
    }
}
fn handle(app: &tauri::AppHandle, state: &Arc<Bridge>, path: &str, body: &[u8]) -> (u16, Value) {
    if !state.config.verify() {
        return (403, json!({"ok":false,"error":"Run authority changed"}));
    }
    if path == "/identity" {
        return (
            200,
            json!({"schemaVersion":1,"runId":state.config.run_id,"source":state.config.source,"appIdentity":app.config().identifier,"pid":std::process::id(),"origin":*state.origin.lock().unwrap(),"database":state.config.root.join("trainer.sqlite"),"buildMode":if cfg!(debug_assertions){"debug"}else{"release"},"artifactKind":if state.config.ordinary.is_some(){"ordinary"}else{"debug"},"launchMode":"isolated","controlContract":crate::isolated_run::CONTRACT,"boot":state.config.boot(),"artifactInventoryHash":state.config.ordinary.as_ref().map(|a| &a.descriptor.artifact_inventory_hash),"rendererDiagnostic":renderer_diagnostic(app)}),
        );
    }
    let request: Request = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return (400, json!({"ok":false,"error":"Malformed closed command"})),
    };
    if !request.command.valid()
        || !state.config.permits(&request.command)
        || request.expected_boot.as_deref() != state.config.boot()
        || request.expected_run_id != state.config.run_id
        || uuid::Uuid::parse_str(&request.request_id).is_err()
    {
        return (
            400,
            json!({"ok":false,"error":"Invalid command/run/request"}),
        );
    }
    let mut seen = state.seen.lock().unwrap();
    if seen.len() >= 4096 || !seen.insert(request.request_id.clone()) {
        return (
            409,
            json!({"ok":false,"error":"Duplicate/run request limit"}),
        );
    }
    drop(seen);
    let Some(window) = app.get_webview_window("trainer") else {
        return (503, json!({"ok":false,"error":"Renderer unavailable"}));
    };
    if let Command::SetViewport { preset } = &request.command {
        let diagnostic = renderer_diagnostic(app);
        let Some(size) = viewport_size(&diagnostic, preset) else {
            return (
                409,
                json!({"ok":false,"error":"Bounded native viewport insets unavailable"}),
            );
        };
        if window.set_size(size).is_err() {
            return (409, json!({"ok":false,"error":"Viewport unavailable"}));
        }
    }
    let (tx, rx) = mpsc::sync_channel(1);
    *state.pending.lock().unwrap() = Some((request.request_id.clone(), tx));
    // The only evaluated code is this fixed call and a serialized closed DTO.
    let script = format!(
        "window.__trainerSmoke && window.__trainerSmoke({})",
        serde_json::to_string(&request).unwrap()
    );
    let result = if window.eval(&script).is_err() {
        Err("Renderer unavailable")
    } else {
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Renderer deadline: effect unknown; inspect before further mutation")
    };
    state.pending.lock().unwrap().take();
    let capturing = request.command.is_capture();
    let result = result.and_then(|value| {
        if safe_result(&request.command, &value, state.config.ordinary.is_some()) {
            Ok(value)
        } else {
            Err("Closed renderer result schema refused")
        }
    });
    let response = match result {
        Err(error) => (
            504,
            json!({"requestId":request.request_id,"result":{"ok":false,"error":error}}),
        ),
        Ok(mut result) => {
            #[cfg(debug_assertions)]
            if let Command::DebugKey { key } = &request.command {
                result = if result["ok"] == true && result["readyForNativeKey"] == true {
                    match input::disclosure_key(&window, key) {
                        Ok(()) => json!({"ok":true,"nativeLocalEvent":true,"hardwareInput":false}),
                        Err(error) => json!({"ok":false,"error":error}),
                    }
                } else {
                    json!({"ok":false,"error":"Disclosure focus refused; no key dispatched"})
                };
            }
            if result["ok"] == true && capturing {
                let boundary = request.command.boundary(state.config.ordinary.is_some());
                result = match capture::png(&window).and_then(|bytes| {
                    capture::publish(
                        &state.config.root.join("screenshots"),
                        &request.request_id,
                        &bytes,
                    )
                }) {
                    Ok(path) => {
                        json!({"ok":true,"capture":path,"boundary":boundary})
                    }
                    Err(error) => json!({"ok":false,"error":error}),
                };
            }
            (
                if result["ok"] == true { 200 } else { 409 },
                json!({"requestId":request.request_id,"result":result}),
            )
        }
    };
    // Restore on dispatch, callback, schema, timeout and snapshot failure as well as success.
    if capturing {
        let _ = window.eval("window.__trainerSmokeRestore && window.__trainerSmokeRestore()");
    }
    response
}
#[cfg(test)]
mod tests {
    use super::*;
    fn safe_result(command: &Command, value: &Value) -> bool {
        super::safe_result(command, value, false)
    }
    #[test]
    fn closed_commands_reject_privileges_and_private_targets() {
        for value in [
            json!({"type":"eval","code":"1"}),
            json!({"type":"capture","path":"/tmp/x"}),
            json!({"type":"observe","selector":"body"}),
        ] {
            assert!(serde_json::from_value::<Command>(value).is_err())
        }
        for target in [
            "Password",
            "Email",
            "Garmin sign-in",
            "Delete Garmin",
            "Verify connector",
            "Force refresh detail",
            "Trainer model",
            "Data & settings",
            "Close settings",
        ] {
            assert!(!Command::Click {
                target: target.into()
            }
            .valid())
        }
        for target in [
            "Profile & data",
            "Close Profile & data",
            "LLM debug traces",
            "First LLM trace",
        ] {
            assert!(Command::Click {
                target: target.into()
            }
            .valid());
        }
        for key in ["Enter", "Space"] {
            assert!(Command::DebugKey { key: key.into() }.valid());
        }
        for key in ["Tab", "Escape", "a", "Meta+Q"] {
            assert!(!Command::DebugKey { key: key.into() }.valid());
        }
        for value in [
            json!({"type":"debugKey","key":"Enter","target":"Password"}),
            json!({"type":"captureDebug","selector":"body"}),
        ] {
            assert!(serde_json::from_value::<Command>(value).is_err());
        }
        assert!(!Command::Input {
            target: "Goals".into(),
            value: "private text".into()
        }
        .valid());
    }
    #[test]
    fn debug_observations_are_closed_bounded_and_unavailable_to_ordinary() {
        assert!(safe_debug_observation(&json!({"available":false})));
        assert!(!safe_debug_observation(
            &json!({"available":false,"private":"copied text"})
        ));
        let mut observation = json!({"ok":true,"dashboard":true,"hydrated":true,"navigation":[],"headings":[],"profileReady":false,"profileSaved":false,"view":"Trainer","llmDebug":{"available":false}});
        assert!(super::safe_result(
            &Command::Observe {},
            &observation,
            false
        ));
        assert!(!super::safe_result(
            &Command::Observe {},
            &observation,
            true
        ));
        observation["llmDebug"] = json!({"available":true,"open":false,"summaryVisible":true,"nativeMarker":true,"focused":false,"focusVisible":false,"focusMatches":false,"documentFocused":false,"nativeKeyReceived":false,"warningVisible":false,"innerOpen":[false,false],"previewsVisible":[false,false],"bodiesVisible":[false,false]});
        assert!(super::safe_result(
            &Command::Observe {},
            &observation,
            false
        ));
        observation["llmDebug"]["innerOpen"] = json!(["private text"]);
        assert!(!super::safe_result(
            &Command::Observe {},
            &observation,
            false
        ));
        assert!(!super::safe_result(
            &Command::DebugKey {
                key: "Enter".into()
            },
            &json!({"ok":true,"readyForNativeKey":true}),
            true
        ));
    }
    #[test]
    fn viewport_preserves_exact_client_size_and_bounds_native_insets() {
        let current = json!({"width":1280,"height":818,"nativeWidth":1280.0,"nativeHeight":850.0});
        let wide = viewport_size(&current, "wide").unwrap();
        assert_eq!((wide.width, wide.height), (1280.0, 882.0));
        let narrow = viewport_size(&current, "narrow").unwrap();
        assert_eq!((narrow.width, narrow.height), (420.0, 882.0));
        assert!(viewport_size(&current, "arbitrary").is_none());
        assert!(viewport_size(
            &json!({"width":1280,"height":100,"nativeWidth":1280.0,"nativeHeight":850.0}),
            "wide"
        )
        .is_none());
    }
    #[test]
    fn fixed_diagnostics_never_forward_arbitrary_renderer_json() {
        let value = json!({"ready":"complete","bootstrap":true,"ipc":true,"dashboard":true,"ordinaryContext":true,"width":1280,"height":850});
        assert_eq!(
            diagnostic_result(&serde_json::to_vec(&value).unwrap()),
            value
        );
        for changed in [
            json!({"private":"secret"}),
            json!({"ready":"copied text","bootstrap":true,"ipc":true,"dashboard":true,"ordinaryContext":true,"width":1280,"height":850}),
            json!({"ready":"complete","bootstrap":true,"ipc":true,"dashboard":true,"ordinaryContext":true,"width":99999,"height":850}),
        ] {
            assert_eq!(
                diagnostic_result(&serde_json::to_vec(&changed).unwrap()),
                json!({"evaluationFailed":true})
            );
        }
    }
    #[test]
    fn results_are_closed_and_command_bound_not_arbitrary_renderer_json() {
        let observe = Command::Observe {};
        let valid = json!({"ok":true,"dashboard":true,"hydrated":true,"navigation":["Sync"],"headings":["Sync"],"profileReady":false,"profileSaved":false,"view":"Sync"});
        assert!(safe_result(&observe, &valid));
        for changed in [
            json!({"ok":true,"private":"copied text"}),
            json!({"ok":false,"error":"private exception"}),
            json!({"ok":true,"action":"Garmin sign-in","trustedInput":false}),
        ] {
            assert!(!safe_result(&observe, &changed));
        }
        let mut copied_heading = valid.clone();
        copied_heading["headings"] = json!(["copied private heading"]);
        assert!(!safe_result(&observe, &copied_heading));
        let mut extra = valid;
        extra["private"] = json!("secret");
        assert!(!safe_result(&observe, &extra));
        assert!(safe_result(
            &Command::Assert {
                target: "Goals".into(),
                value: "T0231-smoke-unit".into()
            },
            &json!({"ok":false,"matches":false})
        ));
        assert!(!safe_result(
            &Command::Input {
                target: "Goals".into(),
                value: "T0231-smoke-unit".into()
            },
            &json!({"ok":true,"action":"Goals input","trustedInput":true})
        ));
    }
    #[test]
    fn fixed_capture_presets_are_mode_scoped_and_not_generic_geometry() {
        let config = config();
        for value in [
            json!({"type":"setViewport","width":400}),
            json!({"type":"captureView","view":"trainer","preset":"wide","selector":"body"}),
        ] {
            assert!(serde_json::from_value::<Command>(value).is_err());
        }
        for command in [
            Command::SetViewport {
                preset: "wide".into(),
            },
            Command::CaptureView {
                view: "profile".into(),
                preset: "narrow".into(),
            },
        ] {
            assert!(command.valid());
            assert!(!config.permits(&command));
        }
        assert!(!Command::CaptureView {
            view: "setup".into(),
            preset: "wide".into()
        }
        .valid());
        assert!(!Command::SetViewport {
            preset: "arbitrary".into()
        }
        .valid());
    }
    fn config() -> Config {
        Config {
            run_id: uuid::Uuid::new_v4().to_string(),
            token: "a".repeat(64),
            source: "b".repeat(64),
            root: "/unused".into(),
            port: 19321,
            ordinary: None,
        }
    }
    #[test]
    fn late_duplicate_and_unknown_results_cannot_satisfy_a_new_request() {
        let bridge = Bridge {
            config: config(),
            origin: Mutex::new(None),
            pending: Mutex::new(None),
            seen: Mutex::new(HashSet::new()),
        };
        let (tx, rx) = mpsc::sync_channel(1);
        *bridge.pending.lock().unwrap() = Some(("current".into(), tx));
        assert!(bridge.complete("expired", json!({"ok":true})).is_err());
        assert!(rx.try_recv().is_err());
        bridge.complete("current", json!({"ok":false})).unwrap();
        assert_eq!(rx.recv().unwrap()["ok"], false);
        assert!(bridge.complete("current", json!({"ok":true})).is_err());
        let (tx, rx) = mpsc::sync_channel(1);
        *bridge.pending.lock().unwrap() = Some(("next".into(), tx));
        drop(rx);
        assert!(bridge.complete("next", json!({"ok":true})).is_err());
    }
    #[test]
    fn parser_rejects_duplicate_chunked_oversized_and_browser_requests() {
        for suffix in [
            "Host: duplicate\r\n",
            "Transfer-Encoding: chunked\r\n",
            "Content-Length: 999999\r\n",
            "Origin: null\r\n",
            "Sec-Fetch-Site: same-origin\r\n",
        ] {
            let config = config();
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let request=format!("GET /identity HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nX-Smoke-Run: {}\r\n{suffix}\r\n",config.port,config.token,config.run_id);
            let client = std::thread::spawn(move || {
                let mut socket = TcpStream::connect(address).unwrap();
                socket.write_all(request.as_bytes()).unwrap();
            });
            let (mut socket, _) = listener.accept().unwrap();
            assert!(read_request(&mut socket, &config).is_err());
            client.join().unwrap();
        }
    }
    #[test]
    fn strict_auth_and_origin() {
        let config = Config {
            run_id: uuid::Uuid::new_v4().to_string(),
            token: "a".repeat(64),
            source: "b".repeat(64),
            root: "/unused".into(),
            port: 19321,
            ordinary: None,
        };
        let host = format!("127.0.0.1:{}", config.port);
        let token = format!("Bearer {}", config.token);
        let mut headers = HashMap::from([
            ("host".into(), host.as_str()),
            ("authorization".into(), token.as_str()),
            ("x-smoke-run".into(), config.run_id.as_str()),
        ]);
        assert!(authorize(&headers, &config).is_ok());
        headers.insert("origin".into(), "null");
        assert!(authorize(&headers, &config).is_err());
        headers.remove("origin");
        headers.insert("x-smoke-run".into(), "other");
        assert!(authorize(&headers, &config).is_err());
    }
}
