use serde::Deserialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

pub struct Service {
    child: Child,
    pub port: u16,
    pub tooling_available: bool,
    stopped: bool,
}
#[derive(Deserialize)]
struct Ready {
    #[serde(rename = "type")]
    kind: String,
    version: u8,
    port: Option<u16>,
    tooling: Option<Tooling>,
    code: Option<String>,
}
#[derive(Deserialize)]
struct Tooling {
    uv: bool,
    uvx: bool,
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
    ) -> Result<Self, &'static str> {
        let nonce = uuid::Uuid::new_v4().to_string();
        let mut command = Command::new(resources.join("node"));
        command
            .arg(resources.join("runtime/runtime.cjs"))
            .current_dir(resources.join("runtime"))
            .env_clear()
            .env("TRAINER_DESKTOP_NONCE", &nonce)
            .env("NODE_ENV", "production")
            .env("NEXT_TELEMETRY_DISABLED", "1")
            .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
            // Retain the write end as an ownership/liveness pipe. EOF lets the
            // backend fail closed even if the native host dies without callbacks.
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0);
        for key in ["HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "LANG"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        let mut child = command
            .spawn()
            .map_err(|_| "Bundled Node/resources missing or not executable.")?;
        // One bounded activation frame, then retain stdin for parent liveness.
        // Provider keys never enter argv, inherited environment or a disk file.
        let sent = child
            .stdin
            .as_mut()
            .ok_or("Backend activation unavailable.")?
            .write_all(snapshot);
        snapshot.fill(0);
        if sent.is_err() {
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
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
            tooling_available: false,
            stopped: false,
        };
        let result = (|| {
            let deadline = Instant::now() + Duration::from_secs(90);
            let message = loop {
                if quitting.load(Ordering::SeqCst) {
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
                    Some("resources") => "Packaged resources failed. Rebuild the ARM64 desktop resources and verify bundled Node/SQLite; do not install/sign to bypass this error.",
                    _ => "Local backend startup refused. Check source doctor/status and owned listener readiness; no unrelated service was loaded.",
                });
            }
            service.port = message
                .port
                .filter(|port| *port != 0)
                .ok_or("Backend returned no owned port.")?;
            service.tooling_available = message.tooling.map(|t| t.uv && t.uvx).unwrap_or(false);
            verify_identity(service.port, &nonce)
        })();
        if let Err(error) = result {
            service.stop();
            return Err(error);
        }
        Ok(service)
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
        let group = -(self.child.id() as i32);
        // The process group was created by this exact child. No name/port kills.
        unsafe {
            libc::kill(group, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if self.child.try_wait().ok().flatten().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        // Include any remaining connector/FIT descendants, even after Node exits.
        unsafe {
            libc::kill(group, libc::SIGKILL);
        }
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
    #[test]
    fn stops_only_its_owned_group_and_is_idempotent() {
        let child = Command::new("/bin/sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .unwrap();
        let mut unrelated = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let mut service = Service {
            child,
            port: 0,
            tooling_available: false,
            stopped: false,
        };
        service.stop();
        assert!(service.child.try_wait().unwrap().is_some());
        service.stop();
        assert!(unrelated.try_wait().unwrap().is_none());
        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
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
