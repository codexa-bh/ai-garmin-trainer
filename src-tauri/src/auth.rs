//! One owned, finite auth session. Only the trusted settings WebView can call
//! its facade. Final publication happens here under the same lock as cancel.
use crate::onboarding::Parent;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
pub struct Status {
    pub id: String,
    pub state: String,
    pub code: Option<String>,
    // Setup-only selection; present exclusively after this session publishes.
    pub destination: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Event {
    state: String,
    code: Option<String>,
}
struct Session {
    child: Child,
    events: Receiver<Event>,
    staging: PathBuf,
    staging_file: File,
    parent: Parent,
    destination: PathBuf,
    deadline: Instant,
}
#[derive(Default)]
pub struct Auth {
    session: Option<Session>,
    status: Option<Status>,
}
fn private_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| {
            meta.is_dir()
                && meta.uid() == unsafe { libc::getuid() }
                && meta.mode() & 0o077 == 0
                && fs::canonicalize(path).ok().as_deref() == Some(path)
        })
        .unwrap_or(false)
}
fn unused_destination(path: &Path) -> Result<(), &'static str> {
    if !path.is_absolute()
        || path.as_os_str().len() > 4096
        || path
            .to_string_lossy()
            .chars()
            .any(|c| c.is_control() || c == '~' || c == '$')
        || path.file_name().is_none()
        || path.symlink_metadata().is_ok()
        || !private_directory(path.parent().ok_or("Choose a private parent directory.")?)
    {
        return Err("New login requires a nonexistent destination inside a canonical owner-private directory. Existing tokens are never replaced.");
    }
    Ok(())
}
fn stop(session: &mut Session) {
    // Exact owned group includes uv/Python. No name/port process cleanup.
    unsafe {
        libc::kill(-(session.child.id() as i32), libc::SIGKILL);
    }
    let _ = session.child.wait();
    // Staging is exclusive task-owned output, never the user's destination.
    if session.parent.verify().is_ok() && same_staging(&session.staging, &session.staging_file) {
        let _ = fs::remove_dir_all(&session.staging);
    }
}
impl Auth {
    pub fn start_managed(
        &mut self,
        resources: &Path,
        executable: &Path,
        root: &Path,
        email: String,
        password: String,
    ) -> Result<Status, &'static str> {
        let parent = Parent::open(root, true)?;
        let destination = root.join(format!("garmin-{}", uuid::Uuid::new_v4()));
        self.start(resources, executable, destination, parent, email, password)
    }
    fn start(
        &mut self,
        resources: &Path,
        executable: &Path,
        destination: PathBuf,
        parent: Parent,
        email: String,
        password: String,
    ) -> Result<Status, &'static str> {
        self.tick();
        if self.session.is_some() {
            return Err("An authentication session is already active. Cancel it first.");
        }
        if email.trim().is_empty()
            || email.len() > 8192
            || password.is_empty()
            || password.len() > 8192
            || email.chars().any(char::is_control)
            || password.chars().any(char::is_control)
        {
            return Err("Enter email and password privately in the settings window.");
        }
        parent.verify()?;
        unused_destination(&destination)?;
        let id = uuid::Uuid::new_v4().to_string();
        let staging = destination
            .parent()
            .ok_or("Private destination unavailable.")?
            .join(format!(".trainer-auth-{id}"));
        let part = std::ffi::CString::new(format!(".trainer-auth-{id}")).unwrap();
        if unsafe { libc::mkdirat(parent.file.as_raw_fd(), part.as_ptr(), 0o700) } != 0 {
            return Err("Cannot exclusively create private authentication staging.");
        }
        let fd = unsafe {
            libc::openat(
                parent.file.as_raw_fd(),
                part.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err("Private authentication staging unavailable.");
        }
        let staging_file = unsafe { File::from_raw_fd(fd) };
        parent.verify()?;
        if !same_staging(&staging, &staging_file) {
            return Err("Private authentication staging changed.");
        }
        let mut command = Command::new(executable);
        command
            .args([
                "run",
                "--no-project",
                "--no-python-downloads",
                "--python",
                "3.12",
                "--locked",
                "--script",
            ])
            .arg(resources.join("runtime/scripts/garmin_auth.py"))
            .arg(&staging)
            .current_dir(resources.join("runtime"))
            .env_clear()
            .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("UV_PYTHON_DOWNLOADS", "never")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0);
        for key in ["HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "LANG"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        let child = match command.spawn() {
            Ok(child) => child,
            Err(_) => {
                if parent.verify().is_ok() && same_staging(&staging, &staging_file) {
                    let _ = fs::remove_dir(&staging);
                }
                return Err("Auth tooling unavailable. Install/manage uv and Python separately.");
            }
        };
        let (tx, events) = mpsc::channel();
        let mut session = Session {
            child,
            events,
            staging,
            staging_file,
            parent,
            destination,
            deadline: Instant::now() + Duration::from_secs(180),
        };
        let mut input = serde_json::to_vec(&serde_json::json!({"email":email,"password":password}))
            .map_err(|_| "Invalid authentication input.")?;
        input.push(b'\n');
        let sent = session
            .child
            .stdin
            .as_mut()
            .ok_or("Auth pipe unavailable.")?
            .write_all(&input);
        input.fill(0);
        if sent.is_err() {
            stop(&mut session);
            return Err("Auth startup interrupted.");
        }
        let stdout = session
            .child
            .stdout
            .take()
            .ok_or("Auth status unavailable.")?;
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            // Each event <=512 bytes; total <=16 events. Reject unexpected/raw
            // output without retaining or reflecting it into diagnostics.
            for _ in 0..16 {
                let mut bytes = Vec::new();
                if Read::by_ref(&mut reader)
                    .take(513)
                    .read_until(b'\n', &mut bytes)
                    .is_err()
                    || bytes.is_empty()
                {
                    break;
                }
                if bytes.len() > 512 || !bytes.ends_with(b"\n") {
                    break;
                }
                match serde_json::from_slice::<Event>(&bytes) {
                    Ok(event) => {
                        if tx.send(event).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = tx.send(Event {
                state: "failed".into(),
                code: Some("auth-unavailable".into()),
            });
        });
        let status = Status {
            id,
            state: "authenticating".into(),
            code: None,
            destination: None,
        };
        self.session = Some(session);
        self.status = Some(status.clone());
        Ok(status)
    }
    pub fn tick(&mut self) {
        let Some(mut session) = self.session.take() else {
            return;
        };
        let Some(status) = self.status.as_mut() else {
            stop(&mut session);
            return;
        };
        let mut finished = false;
        if Instant::now() >= session.deadline {
            status.state = "failed".into();
            status.code = Some("timeout".into());
            finished = true;
        }
        while !finished {
            let Ok(event) = session.events.try_recv() else {
                break;
            };
            match event.state.as_str() {
                "needs-mfa" if status.state == "authenticating" => {
                    status.state = event.state;
                }
                "verifying"
                    if ["authenticating", "submitting-mfa"].contains(&status.state.as_str()) =>
                {
                    status.state = event.state;
                }
                "verified" if status.state == "verifying" => {
                    match publish(
                        &session.parent,
                        &session.staging,
                        &session.staging_file,
                        &session.destination,
                    ) {
                        Ok(()) => {
                            status.state = "succeeded".into();
                            status.code = None;
                            status.destination =
                                Some(session.destination.to_string_lossy().into_owned());
                        }
                        Err(_) => {
                            status.state = "failed".into();
                            status.code = Some("publication-refused".into());
                        }
                    }
                    finished = true;
                }
                "failed" => {
                    status.state = "failed".into();
                    status.code = Some(match event.code.as_deref() {
                        Some(code)
                            if [
                                "credentials-rejected",
                                "mfa-rejected",
                                "unsupported-challenge",
                                "network-service",
                                "rate-limited",
                                "auth-unavailable",
                            ]
                            .contains(&code) =>
                        {
                            code.to_owned()
                        }
                        _ => "auth-unavailable".into(),
                    });
                    finished = true;
                }
                _ => {
                    status.state = "failed".into();
                    status.code = Some("protocol-refused".into());
                    finished = true;
                }
            }
        }
        if finished {
            stop(&mut session);
        } else {
            self.session = Some(session);
        }
    }
    pub fn status(&mut self) -> Option<Status> {
        self.tick();
        self.status.clone()
    }
    pub fn mfa(&mut self, id: &str, code: String) -> Result<Status, &'static str> {
        self.tick();
        let status = self.status.as_mut().ok_or("No active auth session.")?;
        if status.id != id
            || status.state != "needs-mfa"
            || code.is_empty()
            || code.len() > 128
            || code.chars().any(char::is_control)
        {
            return Err(
                "MFA session expired, duplicate or invalid. Start explicitly again if needed.",
            );
        }
        let session = self.session.as_mut().ok_or("Auth session ended.")?;
        let mut input = serde_json::to_vec(&serde_json::json!({"code":code}))
            .map_err(|_| "Invalid MFA input.")?;
        input.push(b'\n');
        let result = session
            .child
            .stdin
            .as_mut()
            .ok_or("Auth session ended.")?
            .write_all(&input);
        input.fill(0);
        if result.is_err() {
            return Err("MFA submission interrupted.");
        }
        status.state = "submitting-mfa".into();
        Ok(status.clone())
    }
    pub fn cancel(&mut self, id: &str) -> Result<Status, &'static str> {
        // Do not tick first: cancellation must not consume a queued verified
        // event and publish. This mutex is the commit/cancel linearization point.
        let status = self.status.as_mut().ok_or("No auth session.")?;
        if status.id != id {
            return Err("Stale auth session.");
        }
        if let Some(mut session) = self.session.take() {
            stop(&mut session);
            status.state = "cancelled".into();
            status.code = None;
        }
        Ok(status.clone())
    }
    pub fn stop(&mut self) {
        if let Some(mut session) = self.session.take() {
            stop(&mut session);
            if let Some(status) = self.status.as_mut() {
                status.state = "cancelled".into();
                status.code = None;
            }
        }
    }
}
impl Drop for Auth {
    fn drop(&mut self) {
        self.stop();
    }
}

fn same_staging(path: &Path, file: &File) -> bool {
    match (file.metadata(), fs::symlink_metadata(path)) {
        (Ok(held), Ok(current)) => {
            private_directory(path) && held.dev() == current.dev() && held.ino() == current.ino()
        }
        _ => false,
    }
}
fn publish(
    parent: &Parent,
    staging: &Path,
    staging_file: &File,
    destination: &Path,
) -> Result<(), &'static str> {
    parent.verify()?;
    unused_destination(destination)?;
    if !same_staging(staging, staging_file) {
        return Err("Unsafe staging.");
    }
    let names = ["garmin_tokens.json", "garmin_tokens.base64"];
    for name in names {
        let path = staging.join(name);
        crate::settings::private_file(&path)?;
        let length = fs::metadata(path)
            .map_err(|_| "Token verification output missing.")?
            .len();
        if length == 0 {
            return Err("Empty token output.");
        }
    }
    // macOS atomic exclusive rename: unlike std::fs::rename this cannot replace
    // an existing empty destination directory created since the preflight.
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(staging.file_name().ok_or("Invalid staging.")?.as_bytes())
        .map_err(|_| "Invalid staging.")?;
    let target = CString::new(
        destination
            .file_name()
            .ok_or("Invalid destination.")?
            .as_bytes(),
    )
    .map_err(|_| "Invalid destination.")?;
    parent.verify()?;
    let result = unsafe {
        libc::renameatx_np(
            parent.file.as_raw_fd(),
            source.as_ptr(),
            parent.file.as_raw_fd(),
            target.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result != 0 {
        return Err("Token publication refused; existing destination preserved.");
    }
    // Never offer a path that no longer identifies this session's publication.
    // A postrename refusal is not rollback: independently committed tokens remain.
    parent.verify()?;
    if !same_staging(destination, staging_file) {
        return Err(
            "Published identity changed; committed tokens may remain. Reconcile before retry.",
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn simulated(state: &str, event: &str, expired: bool) -> (Auth, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("trainer-auth-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let staging = root.join("stage");
        fs::create_dir(&staging).unwrap();
        fs::set_permissions(&staging, fs::Permissions::from_mode(0o700)).unwrap();
        let child = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let (tx, events) = mpsc::channel();
        tx.send(Event {
            state: event.into(),
            code: Some("raw-secret-not-allowlisted".into()),
        })
        .unwrap();
        let session = Session {
            child,
            events,
            staging_file: File::open(&staging).unwrap(),
            parent: Parent::open(&root, false).unwrap(),
            staging,
            destination: root.join("unused"),
            deadline: if expired {
                Instant::now() - Duration::from_secs(1)
            } else {
                Instant::now() + Duration::from_secs(180)
            },
        };
        (
            Auth {
                session: Some(session),
                status: Some(Status {
                    id: "exact-session".into(),
                    state: state.into(),
                    code: None,
                    destination: None,
                }),
            },
            root,
        )
    }
    #[test]
    fn cancel_prevents_queued_verified_publication_and_stale_events() {
        let (mut auth, root) = simulated("verifying", "verified", false);
        assert!(auth.cancel("wrong-session").is_err());
        assert!(auth.session.is_some());
        assert_eq!(auth.cancel("exact-session").unwrap().state, "cancelled");
        auth.tick();
        assert!(!root.join("unused").exists());
        assert!(!root.join("stage").exists());
        assert!(auth.mfa("exact-session", "code".into()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn timeout_and_unexpected_or_adverse_events_fail_closed() {
        for (state, event, expired, expected) in [
            ("verifying", "verified", true, "timeout"),
            ("authenticating", "verified", false, "protocol-refused"),
            ("authenticating", "failed", false, "auth-unavailable"),
        ] {
            let (mut auth, root) = simulated(state, event, expired);
            auth.tick();
            let status = auth.status().unwrap();
            assert_eq!(status.state, "failed");
            assert_eq!(status.code.as_deref(), Some(expected));
            assert!(!root.join("unused").exists());
            assert!(auth.session.is_none());
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn managed_root_creation_refuses_aliases_and_insecure_existing_objects() {
        let root = std::env::temp_dir().join(format!("trainer-managed-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let managed = root.join("app/private");
        let mut auth = Auth::default();
        // No real library/network: a nonexistent executable exercises allocation/preflight.
        assert!(auth
            .start_managed(
                &root,
                Path::new("/nonexistent-uv"),
                &managed,
                "synthetic@example.invalid".into(),
                "synthetic".into()
            )
            .is_err());
        assert!(private_directory(&managed));
        assert_eq!(fs::read_dir(&managed).unwrap().count(), 0);
        fs::write(managed.join("preserved-original"), "original").unwrap();
        assert!(auth
            .start_managed(
                &root,
                Path::new("/nonexistent-uv"),
                &managed,
                "synthetic@example.invalid".into(),
                "synthetic".into()
            )
            .is_err());
        assert_eq!(
            fs::read_to_string(managed.join("preserved-original")).unwrap(),
            "original"
        );
        let alias = root.join("alias");
        std::os::unix::fs::symlink(&managed, &alias).unwrap();
        assert!(Parent::open(&alias, true).is_err());
        fs::set_permissions(&managed, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(auth
            .start_managed(
                &root,
                Path::new("/nonexistent-uv"),
                &managed,
                "synthetic@example.invalid".into(),
                "synthetic".into()
            )
            .is_err());
        assert_eq!(fs::metadata(&managed).unwrap().mode() & 0o777, 0o755);
        fs::remove_dir_all(root).unwrap();
    }
    fn token_output(stage: &Path) {
        for name in ["garmin_tokens.json", "garmin_tokens.base64"] {
            let path = stage.join(name);
            fs::write(&path, "synthetic-token-only").unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }
    #[test]
    fn verified_selection_is_bound_to_session_and_preserves_previous_store() {
        let (mut auth, root) = simulated("verifying", "verified", false);
        token_output(&root.join("stage"));
        fs::create_dir(root.join("previous")).unwrap();
        fs::write(root.join("previous/original"), "preserved").unwrap();
        let result = auth.status().unwrap();
        assert_eq!(result.id, "exact-session");
        assert_eq!(result.state, "succeeded");
        assert_eq!(result.destination.as_deref(), root.join("unused").to_str());
        assert!(auth.session.is_none());
        assert_eq!(auth.cancel("exact-session").unwrap().state, "succeeded");
        assert!(root.join("unused/garmin_tokens.json").exists());
        assert_eq!(
            fs::read_to_string(root.join("previous/original")).unwrap(),
            "preserved"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn substituted_parent_or_staging_and_hardlinked_tokens_refuse_publication() {
        for surface in ["parent", "staging", "hardlink"] {
            let (mut auth, root) = simulated("verifying", "verified", false);
            token_output(&root.join("stage"));
            let moved = root.with_extension("retained");
            match surface {
                "parent" => {
                    fs::rename(&root, &moved).unwrap();
                    fs::create_dir(&root).unwrap();
                    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
                }
                "staging" => {
                    fs::rename(root.join("stage"), root.join("original-stage")).unwrap();
                    fs::create_dir(root.join("stage")).unwrap();
                    fs::set_permissions(root.join("stage"), fs::Permissions::from_mode(0o700))
                        .unwrap();
                    token_output(&root.join("stage"));
                }
                _ => fs::hard_link(
                    root.join("stage/garmin_tokens.json"),
                    root.join("retained-link"),
                )
                .unwrap(),
            }
            let result = auth.status().unwrap();
            assert_eq!(result.state, "failed");
            assert_eq!(result.code.as_deref(), Some("publication-refused"));
            assert!(result.destination.is_none());
            assert!(!root.join("unused").exists());
            if surface == "parent" {
                assert!(moved.join("stage").exists());
                fs::remove_dir_all(moved).unwrap();
            }
            if surface == "staging" {
                assert!(root.join("stage").exists());
                assert!(root.join("original-stage").exists());
            }
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn one_mfa_submission_only_and_no_selection_before_publication() {
        let (mut auth, root) = simulated("authenticating", "needs-mfa", false);
        assert!(auth.status().unwrap().destination.is_none());
        assert!(auth.mfa("stale-session", "synthetic".into()).is_err());
        assert_eq!(
            auth.mfa("exact-session", "synthetic".into()).unwrap().state,
            "submitting-mfa"
        );
        assert!(auth.mfa("exact-session", "second".into()).is_err());
        auth.cancel("exact-session").unwrap();
        assert!(auth.status().unwrap().destination.is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn publication_is_private_verified_and_exclusive() {
        let root = std::env::temp_dir().join(format!("trainer-auth-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let stage = root.join("stage");
        fs::create_dir(&stage).unwrap();
        fs::set_permissions(&stage, fs::Permissions::from_mode(0o700)).unwrap();
        let destination = root.join("new-store");
        let parent = Parent::open(&root, false).unwrap();
        let held = File::open(&stage).unwrap();
        assert!(publish(&parent, &stage, &held, &destination).is_err());
        for name in ["garmin_tokens.json", "garmin_tokens.base64"] {
            let path = stage.join(name);
            fs::write(&path, "test-token-only").unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        fs::create_dir(&destination).unwrap();
        assert!(publish(&parent, &stage, &held, &destination).is_err());
        assert!(stage.exists());
        fs::remove_dir(&destination).unwrap();
        publish(&parent, &stage, &held, &destination).unwrap();
        assert!(!stage.exists());
        assert_eq!(
            fs::read_to_string(destination.join("garmin_tokens.json")).unwrap(),
            "test-token-only"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
