//! Explicit isolated debug transport; never compiled in an ordinary release.
use crate::smoke_config::Config;
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
pub(crate) mod capture;
#[path = "dev_input.rs"]
mod input;
const LIMIT: usize = 16 * 1024;
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Observe {},
    Click { target: String },
    Input { target: String, value: String },
    Assert { target: String, value: String },
    Capture {},
    Settings { action: crate::setup_smoke::Action },
    CaptureDebug {},
    DebugKey { key: String },
}
impl Command {
    fn valid(&self) -> bool {
        match self {
            Self::Observe {} | Self::Capture {} | Self::CaptureDebug {} | Self::Settings { .. } => {
                true
            }
            Self::DebugKey { key } => ["Enter", "Space"].contains(&key.as_str()),
            Self::Click { target } => [
                "Activities",
                "Health",
                "Training Plan",
                "Sync",
                "Profile & data",
                "Back to chat",
                "Close Profile & data",
                "Save Profile",
                "Reload saved Profile",
                "LLM debug traces",
                "First LLM trace",
            ]
            .contains(&target.as_str()),
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
        || serde_json::to_vec(&result)
            .map_err(|_| "Invalid result")?
            .len()
            > 2 * 1024 * 1024
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
#[cfg(target_os = "macos")]
fn renderer_diagnostic(app: &tauri::AppHandle) -> Value {
    use objc2::{class, msg_send, runtime::AnyObject};
    let Some(window) = app.get_webview_window("trainer") else {
        return json!({"window":false});
    };
    let (tx, rx) = mpsc::sync_channel(1);
    let script = "JSON.stringify({ready:document.readyState,bootstrap:typeof window.__trainerSmoke==='function',ipc:!!window.__TAURI_INTERNALS__,dashboard:!!document.querySelector('[aria-label=\"AI trainer dashboard\"]')})";
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
                                serde_json::from_slice(text)
                                    .unwrap_or(json!({"evaluationFailed":true}))
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
    rx.recv_timeout(Duration::from_secs(1))
        .unwrap_or(json!({"evaluationDeadline":true}))
}
#[cfg(not(target_os = "macos"))]
fn renderer_diagnostic(_app: &tauri::AppHandle) -> Value {
    json!({"unsupported":true})
}
fn handle(app: &tauri::AppHandle, state: &Arc<Bridge>, path: &str, body: &[u8]) -> (u16, Value) {
    if path == "/identity" {
        return (
            200,
            json!({"schemaVersion":1,"runId":state.config.run_id,"source":state.config.source,"appIdentity":app.config().identifier,"pid":std::process::id(),"origin":*state.origin.lock().unwrap(),"database":state.config.root.join("trainer.sqlite"),"buildMode":"debug","rendererDiagnostic":renderer_diagnostic(app)}),
        );
    }
    let request: Request = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return (400, json!({"ok":false,"error":"Malformed closed command"})),
    };
    if !request.command.valid()
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
    if let Command::Settings { action } = request.command {
        let result = crate::setup_smoke::execute(app, &state.config, action);
        let (status, result) = match result {
            Ok(value) => (if value["ok"] == true { 200 } else { 409 }, value),
            Err(error) => (409, json!({"ok":false,"error":error})),
        };
        return (
            status,
            json!({"requestId":request.request_id,"result":result}),
        );
    }
    let Some(window) = app.get_webview_window("trainer") else {
        return (503, json!({"ok":false,"error":"Renderer unavailable"}));
    };
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
    match result {
        Err(error) => (
            504,
            json!({"requestId":request.request_id,"result":{"ok":false,"error":error}}),
        ),
        Ok(mut result) => {
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
            if result["ok"] == true
                && matches!(
                    request.command,
                    Command::Capture {} | Command::CaptureDebug {}
                )
            {
                let boundary = if matches!(request.command, Command::CaptureDebug {}) {
                    "sanitized actual synthetic LLM disclosure subtree"
                } else {
                    "sanitized actual Profile Goals subtree"
                };
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
                let _ =
                    window.eval("window.__trainerSmokeRestore && window.__trainerSmokeRestore()");
            }
            (
                if result["ok"] == true { 200 } else { 409 },
                json!({"requestId":request.request_id,"result":result}),
            )
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closed_commands_reject_privileges_and_private_targets() {
        for value in [
            json!({"type":"eval","code":"1"}),
            json!({"type":"capture","path":"/tmp/x"}),
            json!({"type":"observe","selector":"body"}),
            json!({"type":"settings","action":"auth"}),
            json!({"type":"settings","action":"connect","value":"secret"}),
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
    fn config() -> Config {
        Config {
            run_id: uuid::Uuid::new_v4().to_string(),
            token: "a".repeat(64),
            source: "b".repeat(64),
            root: "/unused".into(),
            port: 19321,
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
