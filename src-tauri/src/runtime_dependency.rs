//! Action-time uv diagnostic only. No package/script execution, network or downloads.
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const UV_UNAVAILABLE: &str = "dependency-uv-unavailable";
pub const PYTHON_UNAVAILABLE: &str = "dependency-python-unavailable";

#[derive(Debug, PartialEq)]
enum Python {
    Available,
    Missing,
    Unknown,
}

fn installed_python(bytes: &[u8]) -> Python {
    let Ok(serde_json::Value::Array(entries)) = serde_json::from_slice(bytes) else {
        return Python::Unknown;
    };
    if entries.is_empty() {
        return Python::Missing;
    }
    if entries.len() > 256 {
        return Python::Unknown;
    }
    // Reject malformed/unrecognized successful output, including path-only text.
    if entries.iter().all(|entry| {
        entry["version_parts"]["major"].as_u64() == Some(3)
            && entry["version_parts"]["minor"].as_u64() == Some(12)
            && entry["path"]
                .as_str()
                .is_some_and(|path| Path::new(path).is_absolute())
    }) {
        Python::Available
    } else {
        Python::Unknown
    }
}

pub fn check_auth_uv(executable: &Path) -> Result<(), &'static str> {
    let mut command = Command::new(executable);
    command
        .args([
            "python",
            "list",
            "3.12",
            "--only-installed",
            "--output-format",
            "json",
            "--offline",
            "--no-config",
            "--no-python-downloads",
        ])
        .env_clear()
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .env("UV_PYTHON_DOWNLOADS", "never")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    for key in ["HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "LANG"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
            ) =>
        {
            return Err(UV_UNAVAILABLE)
        }
        Err(_) => return Ok(()), // Inconclusive: preserve the original auth path.
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(32769).read_to_end(&mut bytes);
        let _ = tx.send((result.is_ok(), bytes));
    });
    let output = rx.recv_timeout(Duration::from_secs(3));
    if !matches!(&output, Ok((true, bytes)) if bytes.len() <= 32768) {
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
    }
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                // Reap only the diagnostic's exact owned group on timeout/error.
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                break child.wait();
            }
        }
    };
    match (output, status) {
        (Ok((true, bytes)), Ok(status))
            if status.success()
                && bytes.len() <= 32768
                && installed_python(&bytes) == Python::Missing =>
        {
            Err(PYTHON_UNAVAILABLE)
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_override_is_bounded_noninstalling_and_failures_stay_unknown() {
        use std::os::unix::fs::PermissionsExt;
        let root =
            std::env::temp_dir().join(format!("trainer-dependency-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let tool = root.join("selected uv");
        for (body, expected) in [
            ("printf '[]'", Err(PYTHON_UNAVAILABLE)),
            ("printf '[]'; exit 2", Ok(())),
            ("printf 'private-canary Python not found'", Ok(())),
            ("sleep 10", Ok(())),
        ] {
            let script = format!("#!/bin/sh\n[ \"$*\" = 'python list 3.12 --only-installed --output-format json --offline --no-config --no-python-downloads' ] || exit 99\n[ -z \"$GARMIN_PASSWORD\" ] || exit 99\n{body}\n");
            std::fs::write(&tool, script).unwrap();
            std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o700)).unwrap();
            assert_eq!(check_auth_uv(&tool), expected);
        }
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(check_auth_uv(&tool), Err(UV_UNAVAILABLE));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_valid_successful_empty_inventory_proves_missing_python() {
        assert_eq!(installed_python(b"[]"), Python::Missing);
        assert_eq!(
            installed_python(
                br#"[{"version_parts":{"major":3,"minor":12},"path":"/synthetic/python"}]"#
            ),
            Python::Available
        );
        for bytes in [
            b"private stderr Python not found".as_slice(),
            b"null",
            b"{}",
            b"[{}]",
            br#"[{"version_parts":{"major":3,"minor":10},"path":"/private/canary"}]"#,
        ] {
            assert_eq!(installed_python(bytes), Python::Unknown);
        }
        assert_eq!(
            check_auth_uv(Path::new("/nonexistent-trainer-uv")),
            Err(UV_UNAVAILABLE)
        );
    }
}
