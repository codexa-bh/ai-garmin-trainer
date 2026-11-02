use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct LiveSettings {
    pub startup_fields: BTreeMap<String, String>,
    pub startup_revision: String,
    generation: u64,
    confirmed: u64,
    pub revision: String,
    pub uncertain: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ack {
    version: u8,
    boot: String,
    generation: u64,
    revision: String,
    state: String,
}
pub enum Failure {
    Unapplied,
    Unknown,
}

// One fixed identity-bound endpoint. No caller URL, secret readback, redirects,
// chunked encoding, unbounded body or retry. Deadline includes connect/read/write.
fn exchange(port: u16, boot: &str, body: Option<&[u8]>) -> Result<Ack, Failure> {
    let deadline = Instant::now() + Duration::from_secs(3);
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|_| Failure::Unapplied)?;
    let mut socket = TcpStream::connect_timeout(&address, Duration::from_secs(1))
        .map_err(|_| Failure::Unapplied)?;
    socket
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|_| Failure::Unapplied)?;
    let method = if body.is_some() { "POST" } else { "GET" };
    let bytes = body.unwrap_or_default();
    write!(socket, "{method} /__desktop/live-settings HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nx-trainer-identity: {boot}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()).map_err(|_| Failure::Unknown)?;
    socket.write_all(bytes).map_err(|_| Failure::Unknown)?;
    let mut response = Vec::new();
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(Failure::Unknown)?;
        socket
            .set_read_timeout(Some(remaining))
            .map_err(|_| Failure::Unknown)?;
        let mut buffer = [0u8; 512];
        let count = socket.read(&mut buffer).map_err(|_| Failure::Unknown)?;
        if count == 0 {
            break;
        }
        response.extend_from_slice(&buffer[..count]);
        if response.len() > 4096 {
            return Err(Failure::Unknown);
        }
    }
    let split = response
        .windows(4)
        .position(|part| part == b"\r\n\r\n")
        .ok_or(Failure::Unknown)?;
    let headers = std::str::from_utf8(&response[..split]).map_err(|_| Failure::Unknown)?;
    // A fixed explicit refusal is known not to have published a snapshot.
    if headers.starts_with("HTTP/1.1 409 ") || headers.starts_with("HTTP/1.1 403 ") {
        return Err(Failure::Unapplied);
    }
    let payload = &response[split + 4..];
    if !headers.starts_with("HTTP/1.1 200 ")
        || !headers
            .lines()
            .any(|line| line.eq_ignore_ascii_case(&format!("x-trainer-identity: {boot}")))
        || !headers
            .lines()
            .any(|line| line.eq_ignore_ascii_case(&format!("content-length: {}", payload.len())))
        || headers
            .lines()
            .any(|line| line.to_ascii_lowercase().starts_with("transfer-encoding:"))
    {
        return Err(Failure::Unknown);
    }
    let ack: Ack = serde_json::from_slice(payload).map_err(|_| Failure::Unknown)?;
    if ack.version != 1 || ack.boot != boot || ack.state != "applied" || ack.revision.len() > 256 {
        return Err(Failure::Unknown);
    }
    Ok(ack)
}
impl LiveSettings {
    pub fn new(startup_fields: BTreeMap<String, String>) -> Self {
        Self {
            startup_fields,
            ..Default::default()
        }
    }
    pub fn reconcile(&mut self, port: u16, boot: &str) -> bool {
        if let Ok(ack) = exchange(port, boot, None) {
            if ack.generation >= self.confirmed
                && ack.generation <= self.generation
                && ((ack.generation == 0 && ack.revision == "startup")
                    || (ack.generation > 0
                        && ack.revision.chars().all(|c| c.is_ascii_digit() || c == '-')))
            {
                self.confirmed = ack.generation;
                self.revision = if ack.generation == 0 {
                    self.startup_revision.clone()
                } else {
                    ack.revision
                };
                self.uncertain = false;
                return true;
            }
        }
        false
    }
    pub fn apply(
        &mut self,
        port: u16,
        boot: &str,
        settings: &Settings,
        revision: &str,
    ) -> Result<(), Failure> {
        self.generation = self
            .generation
            .checked_add(1)
            .filter(|g| *g <= 9_007_199_254_740_991)
            .ok_or(Failure::Unapplied)?;
        let mut body = serde_json::to_vec(&serde_json::json!({"version":1,"boot":boot,"generation":self.generation,"revision":revision,"chatCatalog":settings.chat_catalog,"secrets":settings.keys})).map_err(|_| Failure::Unapplied)?;
        if body.len() > 96 * 1024 {
            body.fill(0);
            return Err(Failure::Unapplied);
        }
        let result = exchange(port, boot, Some(&body));
        body.fill(0);
        match result {
            Ok(ack) if ack.generation == self.generation && ack.revision == revision => {
                self.confirmed = ack.generation;
                self.revision = ack.revision;
                self.uncertain = false;
                Ok(())
            }
            Err(Failure::Unapplied) => Err(Failure::Unapplied),
            _ => {
                self.uncertain = true;
                Err(Failure::Unknown)
            }
        }
    }
    pub fn pending_restart(&self, settings: &Settings) -> bool {
        self.pending_fields(&settings.fields)
    }
    pub fn pending_fields(&self, saved: &BTreeMap<String, String>) -> bool {
        // The real form expands omitted optional fields to the declared defaults
        // (notably uv) and explicit empty strings. Compare effective startup
        // inputs, not representation differences introduced by a live-only Save.
        let Ok(fields) = serde_json::from_str::<Vec<serde_json::Value>>(include_str!(
            "../ui/settings-fields.json"
        )) else {
            return true;
        };
        fields.iter().any(|field| {
            let Some(key) = field["key"].as_str() else {
                return true;
            };
            let default = field["default"]
                .as_str()
                .or_else(|| {
                    field["options"]
                        .as_array()
                        .and_then(|values| values.first())
                        .and_then(|value| value.as_str())
                })
                .unwrap_or("");
            let value = |map: &BTreeMap<String, String>| {
                map.get(key)
                    .map(String::as_str)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(default)
                    .to_owned()
            };
            value(&self.startup_fields) != value(saved)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn endpoint(
        revision: &'static str,
        generation: u64,
        boot: &'static str,
    ) -> (u16, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buffer = [0; 512];
                let count = socket.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    assert!(headers.contains("/__desktop/live-settings"));
                    assert!(headers.contains("x-trainer-identity: owned-boot"));
                    let length: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("Content-Length: "))
                        .unwrap()
                        .parse()
                        .unwrap();
                    if bytes.len() == end + 4 + length {
                        break;
                    }
                }
            }
            let body = serde_json::to_string(&Ack {
                version: 1,
                boot: boot.into(),
                generation,
                revision: revision.into(),
                state: "applied".into(),
            })
            .unwrap();
            write!(socket, "HTTP/1.1 200 OK\r\nx-trainer-identity: owned-boot\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        (port, server)
    }
    #[test]
    fn exact_ack_required_and_unknown_reconciles_without_save_replay() {
        let mut live = LiveSettings::default();
        let settings = Settings {
            version: 3,
            chat_catalog: Some(Default::default()),
            ..Default::default()
        };
        let (port, server) = endpoint("wrong-revision", 1, "owned-boot");
        assert!(matches!(
            live.apply(port, "owned-boot", &settings, "1-2-3"),
            Err(Failure::Unknown)
        ));
        server.join().unwrap();
        assert!(live.uncertain);
        assert_eq!(live.confirmed, 0);
        let (port, server) = endpoint("1-2-3", 1, "owned-boot");
        assert!(live.reconcile(port, "owned-boot"));
        server.join().unwrap();
        assert_eq!(live.generation, 1); // GET did not replay the committed Save.
        assert_eq!(live.revision, "1-2-3");
        assert!(!live.uncertain);
        let (port, server) = endpoint("2-2-3", 2, "foreign-boot");
        assert!(matches!(
            live.apply(port, "owned-boot", &settings, "2-2-3"),
            Err(Failure::Unknown)
        ));
        server.join().unwrap();
        assert_eq!(live.revision, "1-2-3");
    }
    #[test]
    fn unavailable_backend_and_restart_only_fields_are_independent() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let mut live =
            LiveSettings::new(BTreeMap::from([("MEMORY_ENABLED".into(), "false".into())]));
        let mut settings = Settings {
            version: 3,
            fields: live.startup_fields.clone(),
            chat_catalog: Some(Default::default()),
            ..Default::default()
        };
        assert!(!live.pending_restart(&settings));
        settings
            .fields
            .insert("GARMIN_FIT_BASELINE_COMMAND".into(), "uv".into());
        settings
            .fields
            .insert("GARMIN_MCP_TOKEN_DIR".into(), String::new());
        settings
            .fields
            .insert("MEMORY_EMBEDDING_BASE_URL".into(), String::new());
        assert!(!live.pending_restart(&settings));
        settings
            .fields
            .insert("MEMORY_ENABLED".into(), "true".into());
        assert!(live.pending_restart(&settings));
        assert!(matches!(
            live.apply(port, "owned-boot", &settings, "1-2-3"),
            Err(Failure::Unapplied)
        ));
        assert!(!live.uncertain);
    }
}
