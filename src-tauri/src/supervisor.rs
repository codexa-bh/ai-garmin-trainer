use crate::process_tree::{self, Tree};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

pub struct Service {
    child: Tree,
    pub port: u16,
    stopped: bool,
    nonce: String,
    pub live: crate::live_settings::LiveSettings,
}
#[derive(Deserialize)]
struct Ready {
    #[serde(rename = "type")]
    kind: String,
    version: u8,
    port: Option<u16>,
    code: Option<String>,
}

fn verify_identity(port: u16, nonce: &str) -> Result<(), &'static str> {
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|_| "Invalid owned port.")?;
    let mut socket = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|_| "Owned backend unavailable.")?;
    socket
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "Readiness timeout setup failed.")?;
    socket
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "Readiness timeout setup failed.")?;
    write!(socket, "GET /__desktop/ready HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nx-trainer-identity: {nonce}\r\nConnection: close\r\n\r\n").map_err(|_| "Readiness request failed.")?;
    let mut response = String::new();
    socket
        .take(8192)
        .read_to_string(&mut response)
        .map_err(|_| "Readiness response failed.")?;
    if !response.starts_with("HTTP/1.1 200 ")
        || !response
            .lines()
            .any(|line| line.eq_ignore_ascii_case(&format!("x-trainer-identity: {nonce}")))
    {
        return Err("Backend identity did not match. No unrelated listener was loaded.");
    }
    Ok(())
}

impl Service {
    pub fn start(
        resources: &Path,
        snapshot: &mut [u8],
        quitting: &AtomicBool,
        cancelled: &AtomicBool,
    ) -> Result<Self, &'static str> {
        let frame: serde_json::Value =
            serde_json::from_slice(snapshot).map_err(|_| "Startup frame invalid.")?;
        let fields = serde_json::from_value(if frame["version"] == 4 {
            frame["activation"]["fields"].clone()
        } else {
            frame["fields"].clone()
        })
        .map_err(|_| "Startup fields invalid.")?;
        let startup_fields = crate::settings::validate(resources, &fields)?;
        let activation = if frame["version"] == 4 {
            &frame["activation"]
        } else {
            &frame
        };
        let startup_garmin = crate::settings::garmin_fingerprint(activation["garminKey"].as_str());
        let nonce = uuid::Uuid::new_v4().to_string();
        let runtime = process_tree::runtime_directory(resources);
        let mut command = Command::new(process_tree::node(resources));
        command
            .arg(runtime.join("runtime.cjs"))
            .current_dir(runtime)
            .env_clear()
            .env("TRAINER_DESKTOP_NONCE", &nonce)
            .env("NODE_ENV", "production")
            .env("NEXT_TELEMETRY_DISABLED", "1")
            .env(
                "PATH",
                process_tree::search_path("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"),
            )
            // Retain the write end as an ownership/liveness pipe. EOF lets the
            // backend fail closed even if the native host dies without callbacks.
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        process_tree::user_environment(&mut command);
        let mut child = Tree::spawn(&mut command)
            .map_err(|_| "Bundled Node/resources missing or not executable.")?;
        // Host loss: the backend settles its exact DB leases on stdin EOF, then
        // its own exit ends the owned tree (no orphaned descendants).
        if child.share_ownership_with_child().is_err() {
            child.kill();
            let _ = child.wait();
            return Err("Backend ownership could not be established.");
        }
        // One bounded activation frame, then retain stdin for parent liveness.
        // Provider keys never enter argv, inherited environment or an activation file.
        // The native owner-private settings document is their sole disk authority.
        let sent = child
            .stdin
            .as_mut()
            .ok_or("Backend activation unavailable.")?
            .write_all(snapshot);
        snapshot.fill(0);
        if sent.is_err() {
            child.kill();
            let _ = child.wait();
            return Err("Backend activation interrupted.");
        }
        let stdout = child.stdout.take().ok_or("Backend protocol unavailable.")?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            // Bound protocol input, not arbitrary framework logs.
            let mut reader = BufReader::new(stdout);
            for line in Read::by_ref(&mut reader)
                .take(64 * 1024)
                .lines()
                .take(32)
                .flatten()
            {
                if let Ok(message) = serde_json::from_str::<Ready>(&line) {
                    let _ = tx.send(message);
                    break;
                }
            }
            // Keep the pipe drained without retaining/exposing private logs.
            // Closing it after readiness could turn incidental writes into EPIPE.
            let _ = std::io::copy(&mut reader, &mut std::io::sink());
        });
        let mut service = Self {
            child,
            port: 0,
            stopped: false,
            nonce: nonce.clone(),
            live: crate::live_settings::LiveSettings::new(startup_fields, startup_garmin),
        };
        let result = (|| {
            let deadline = Instant::now() + Duration::from_secs(90);
            let message = loop {
                if quitting.load(Ordering::SeqCst) || cancelled.load(Ordering::SeqCst) {
                    return Err("Startup cancelled by quit.");
                }
                if Instant::now() >= deadline {
                    return Err("Backend startup exceeded 90 seconds. Check config, DB schema/ownership and resources.");
                }
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(message) => break message,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(_) => return Err("Backend exited before readiness. Check config, schema, ownership and resources."),
                }
            };
            if message.kind != "ready" || message.version != 1 {
                return Err(match message.code.as_deref() {
                    Some("configuration") => "Settings or Keychain activation refused. Check required provider keys, existing database and private absolute paths; no env file is loaded.",
                    Some("database") => "Database preflight refused. Check existing target, integrity and supported schema with source db:status; never auto-upgrade the primary.",
                    Some("database-ownership") => "Database writer admission refused. Quit the other backend and inspect the exact lease/open-file owner; never steal a live lease.",
                    Some("resources") => "Packaged resources failed. Rebuild the desktop resources and verify bundled Node/SQLite; do not install/sign to bypass this error.",
                    _ => "Local backend startup refused. Check source doctor/status and owned listener readiness; no unrelated service was loaded.",
                });
            }
            service.port = message
                .port
                .filter(|port| *port != 0)
                .ok_or("Backend returned no owned port.")?;
            verify_identity(service.port, &nonce)
        })();
        if let Err(error) = result {
            service.stop();
            return Err(error);
        }
        Ok(service)
    }
    pub fn update_chatgpt(&mut self, connections: &serde_json::Value) -> Result<(), &'static str> {
        if self.stopped || self.exited() {
            return Err("Owned backend not running.");
        }
        let body = serde_json::to_vec(connections).map_err(|_| "Connection metadata invalid.")?;
        if body.len() > 128 * 1024 {
            return Err("Connection metadata exceeded bound.");
        }
        let address: SocketAddr = format!("127.0.0.1:{}", self.port)
            .parse()
            .map_err(|_| "Invalid owned port.")?;
        let mut socket = TcpStream::connect_timeout(&address, Duration::from_secs(1))
            .map_err(|_| "Owned backend unavailable.")?;
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .map_err(|_| "Connection timeout unavailable.")?;
        socket
            .set_write_timeout(Some(Duration::from_secs(1)))
            .map_err(|_| "Connection timeout unavailable.")?;
        write!(socket,"POST /__desktop/chatgpt-connections HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nx-trainer-identity: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",self.port,self.nonce,body.len()).and_then(|_| socket.write_all(&body)).map_err(|_| "Connection activation unknown.")?;
        let mut response = String::new();
        socket
            .take(4096)
            .read_to_string(&mut response)
            .map_err(|_| "Connection activation unknown.")?;
        if !response.starts_with("HTTP/1.1 200 ")
            || !response.lines().any(|line| {
                line.eq_ignore_ascii_case(&format!("x-trainer-identity: {}", self.nonce))
            })
        {
            return Err("Connection activation unknown.");
        }
        Ok(())
    }
    pub fn memory_status(&mut self) -> Result<crate::memory_status::Status, &'static str> {
        if self.stopped || self.exited() {
            return Err("Owned backend not running.");
        }
        let address: SocketAddr = format!("127.0.0.1:{}", self.port)
            .parse()
            .map_err(|_| "Invalid owned port.")?;
        let mut socket = TcpStream::connect_timeout(&address, Duration::from_secs(1))
            .map_err(|_| "Owned backend unavailable.")?;
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .map_err(|_| "Status timeout unavailable.")?;
        socket
            .set_write_timeout(Some(Duration::from_secs(1)))
            .map_err(|_| "Status timeout unavailable.")?;
        write!(socket, "GET /__desktop/memory-status HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nx-trainer-identity: {}\r\nConnection: close\r\n\r\n", self.port, self.nonce).map_err(|_| "Status request unavailable.")?;
        let mut response = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or("Status deadline exceeded.")?;
            socket
                .set_read_timeout(Some(remaining))
                .map_err(|_| "Status timeout unavailable.")?;
            let mut buffer = [0u8; 512];
            let count = socket
                .read(&mut buffer)
                .map_err(|_| "Status response unavailable.")?;
            if count == 0 {
                break;
            }
            response.extend_from_slice(&buffer[..count]);
            if response.len() > 4096 {
                return Err("Status response exceeded bound.");
            }
        }
        crate::memory_status::decode(&response, &self.nonce)
    }
    pub fn pid(&self) -> u32 {
        self.child.id()
    }
    pub fn reconcile_live(&mut self) -> bool {
        !self.stopped && !self.exited() && self.live.reconcile(self.port, &self.nonce)
    }
    pub fn apply_live(
        &mut self,
        settings: &crate::settings::Settings,
        revision: &str,
    ) -> Result<(), crate::live_settings::Failure> {
        if self.stopped || self.exited() {
            return Err(crate::live_settings::Failure::Unapplied);
        }
        self.live.apply(self.port, &self.nonce, settings, revision)
    }
    pub fn exited(&mut self) -> bool {
        self.child
            .try_wait()
            .map(|status| status.is_some())
            .unwrap_or(true)
    }
    pub fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        // Only this exact owned tree. No name/port kills.
        #[cfg(unix)]
        self.child.terminate();
        // Windows has no SIGTERM: closing the liveness pipe is the graceful
        // request (the backend drains, settles leases and exits).
        #[cfg(windows)]
        drop(self.child.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if self.child.try_wait().ok().flatten().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        // Include any remaining connector/FIT descendants, even after Node exits.
        self.child.kill();
        let _ = self.child.wait();
        eprintln!("desktop: owned backend group stopped");
    }
}
impl Drop for Service {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sleeper() -> Command {
        #[cfg(unix)]
        {
            let mut command = Command::new("/bin/sleep");
            command.arg("30");
            command
        }
        #[cfg(windows)]
        {
            let mut command = Command::new("ping.exe");
            command
                .args(["-n", "30", "127.0.0.1"])
                .stdout(Stdio::null())
                .stdin(Stdio::piped());
            command
        }
    }
    #[test]
    fn stops_only_its_owned_group_and_is_idempotent() {
        let child = Tree::spawn(&mut sleeper()).unwrap();
        let mut unrelated = sleeper().spawn().unwrap();
        let mut service = Service {
            child,
            port: 0,
            stopped: false,
            nonce: String::new(),
            live: Default::default(),
        };
        service.stop();
        assert!(service.child.try_wait().unwrap().is_some());
        service.stop();
        assert!(unrelated.try_wait().unwrap().is_none());
        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
    }
    #[test]
    fn status_uses_only_the_owned_fixed_authenticated_resource() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut connection, _) = listener.accept().unwrap();
            connection
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut input = Vec::new();
            while !input.ends_with(b"\r\n\r\n") {
                assert!(input.len() < 1024 && Instant::now() < deadline);
                let mut byte = [0u8; 1];
                assert_eq!(connection.read(&mut byte).unwrap(), 1);
                input.push(byte[0]);
            }
            let request = std::str::from_utf8(&input).unwrap();
            assert!(request.starts_with("GET /__desktop/memory-status HTTP/1.1\r\n"));
            assert!(request.contains("x-trainer-identity: owned-test\r\n"));
            let body = r#"{"version":1,"configuredEnabled":false,"enabled":false,"model":"unselected","cap":6000,"state":"disabled","revision":0,"frontier":0,"pending":0}"#;
            write!(connection, "HTTP/1.1 200 OK\r\nx-trainer-identity: owned-test\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        });
        let child = Tree::spawn(&mut sleeper()).unwrap();
        let mut service = Service {
            child,
            port,
            stopped: false,
            nonce: "owned-test".into(),
            live: Default::default(),
        };
        assert!(service.memory_status().is_ok());
        server.join().unwrap();
        service.stop();
        assert!(service.memory_status().is_err());
    }
    #[test]
    fn refuses_foreign_readiness() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut connection, _) = listener.accept().unwrap();
            let mut input = [0u8; 1024];
            let _ = connection.read(&mut input);
            connection
                .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nforeign")
                .unwrap();
        });
        assert!(verify_identity(port, "expected").is_err());
        server.join().unwrap();
    }
}
