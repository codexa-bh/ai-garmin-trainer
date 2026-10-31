//! Bounded native private documents. All IO is relative to a pinned parent fd.
//! Values and IO errors must never be formatted into diagnostics.
use std::ffi::CString;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

const LIMIT: usize = 128 * 1024;
const UNSAFE: &str = "Private settings unsafe or inaccessible; preserve originals and check owner, permissions and canonical path.";
fn name(part: &std::ffi::OsStr) -> Result<CString, &'static str> {
    CString::new(part.as_bytes()).map_err(|_| UNSAFE)
}
fn same(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    a.dev() == b.dev() && a.ino() == b.ino()
}
fn private(meta: &fs::Metadata) -> bool {
    meta.is_file()
        && meta.nlink() == 1
        && meta.uid() == unsafe { libc::getuid() }
        && meta.mode() & 0o777 == 0o600
        && meta.len() <= LIMIT as u64
}
struct Parent {
    file: File,
    path: PathBuf,
}
impl Parent {
    fn open(path: &Path, create: bool) -> Result<Self, &'static str> {
        if !path.is_absolute() || path.as_os_str().len() > 4096 {
            return Err(UNSAFE);
        }
        let mut file = File::open("/").map_err(|_| UNSAFE)?;
        for component in path.components() {
            let Component::Normal(part) = component else {
                if matches!(component, Component::RootDir) {
                    continue;
                }
                return Err(UNSAFE);
            };
            let part = name(part)?;
            let open = |fd| unsafe {
                libc::openat(
                    fd,
                    part.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            let mut fd = open(file.as_raw_fd());
            if fd < 0
                && create
                && std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound
            {
                if unsafe { libc::mkdirat(file.as_raw_fd(), part.as_ptr(), 0o700) } != 0 {
                    return Err(UNSAFE);
                }
                fd = open(file.as_raw_fd());
            }
            if fd < 0 {
                return Err(UNSAFE);
            }
            let next = unsafe { File::from_raw_fd(fd) };
            let meta = next.metadata().map_err(|_| UNSAFE)?;
            let sticky = meta.uid() == 0 && meta.mode() & u32::from(libc::S_ISVTX) != 0;
            if (meta.uid() != 0 && meta.uid() != unsafe { libc::getuid() })
                || (meta.mode() & 0o022 != 0 && !sticky)
            {
                return Err(UNSAFE);
            }
            file = next;
        }
        let parent = Self {
            file,
            path: path.into(),
        };
        parent.verify()?;
        Ok(parent)
    }
    fn verify(&self) -> Result<(), &'static str> {
        let meta = self.file.metadata().map_err(|_| UNSAFE)?;
        if meta.uid() != unsafe { libc::getuid() }
            || meta.mode() & 0o777 != 0o700
            || fs::canonicalize(&self.path).ok().as_deref() != Some(self.path.as_path())
            || !fs::symlink_metadata(&self.path)
                .map(|m| same(&meta, &m))
                .unwrap_or(false)
        {
            return Err(UNSAFE);
        }
        Ok(())
    }
    fn open_file(&self, part: &CString) -> Result<Option<File>, &'static str> {
        let fd = unsafe {
            libc::openat(
                self.file.as_raw_fd(),
                part.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(UNSAFE)
            };
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if !private(&file.metadata().map_err(|_| UNSAFE)?) {
            return Err(UNSAFE);
        }
        Ok(Some(file))
    }
    fn identity(&self, part: &CString, file: &File) -> bool {
        match (self.open_file(part), file.metadata()) {
            (Ok(Some(current)), Ok(meta)) => {
                current.metadata().map(|m| same(&m, &meta)).unwrap_or(false)
            }
            _ => false,
        }
    }
    fn read(&self, part: &CString) -> Result<Option<Vec<u8>>, &'static str> {
        let Some(mut file) = self.open_file(part)? else {
            return Ok(None);
        };
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| UNSAFE)?;
        if bytes.len() > LIMIT || !self.identity(part, &file) {
            return Err(UNSAFE);
        }
        self.verify()?;
        Ok(Some(bytes))
    }
}
// Explicit unlock matters when another thread forks while a transaction owns
// the fd: CLOEXEC closes inherited fds only after exec, not at parent close.
impl Drop for Parent {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}
pub fn capture(path: &Path) -> Result<(u64, u64, Vec<u8>), &'static str> {
    let parent = Parent::open(path.parent().ok_or(UNSAFE)?, false)?;
    let part = name(path.file_name().ok_or(UNSAFE)?)?;
    let mut file = parent
        .open_file(&part)?
        .ok_or("Private settings missing; no fallback. Preserve recovery inputs.")?;
    let meta = file.metadata().map_err(|_| UNSAFE)?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNSAFE)?;
    if bytes.len() > LIMIT || !parent.identity(&part, &file) {
        return Err(UNSAFE);
    }
    parent.verify()?;
    Ok((meta.dev(), meta.ino(), bytes))
}
pub fn read(path: &Path) -> Result<Vec<u8>, &'static str> {
    capture(path).map(|(_, _, bytes)| bytes)
}

/// Rename is the commit point. false means committed, but verification/durability
/// uncertain. Never compensate or repeat a committed transaction automatically.
pub fn publish(path: &Path, bytes: &[u8], expected: Option<&[u8]>) -> Result<bool, &'static str> {
    publish_with(path, bytes, expected, |_| Ok(()), false)
}
fn publish_with(
    path: &Path,
    bytes: &[u8],
    expected: Option<&[u8]>,
    before: impl FnOnce(&Path) -> Result<(), &'static str>,
    deny_sync: bool,
) -> Result<bool, &'static str> {
    if bytes.len() > LIMIT {
        return Err("Private settings too large.");
    }
    let parent = Parent::open(path.parent().ok_or(UNSAFE)?, true)?;
    if unsafe { libc::flock(parent.file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("Another settings transaction is active; do not retry until it settles.");
    }
    let target = name(path.file_name().ok_or(UNSAFE)?)?;
    let prior = parent.open_file(&target)?;
    if parent.read(&target)?.as_deref() != expected {
        return Err("Settings changed; reload and reconcile before saving.");
    }
    let tmp =
        CString::new(format!(".provider-{}.tmp", uuid::Uuid::new_v4())).map_err(|_| UNSAFE)?;
    let fd = unsafe {
        libc::openat(
            parent.file.as_raw_fd(),
            tmp.as_ptr(),
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err("Cannot stage private settings; prior state unchanged.");
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let result = (|| {
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot persist private settings; prior state unchanged.")?;
        // Verify the staged bytes through the same descriptor before selecting
        // this document as authority. A postrename failure is never rollback.
        file.seek(SeekFrom::Start(0))
            .map_err(|_| "Cannot verify staged settings; prior state unchanged.")?;
        let mut verified = Vec::new();
        Read::by_ref(&mut file)
            .take(LIMIT as u64 + 1)
            .read_to_end(&mut verified)
            .map_err(|_| "Cannot verify staged settings; prior state unchanged.")?;
        let matches = verified == bytes;
        verified.fill(0);
        if !matches {
            return Err("Staged settings verification refused; prior state unchanged.");
        }
        before(&parent.path)?;
        parent.verify()?;
        if !parent.identity(&tmp, &file)
            || prior
                .as_ref()
                .map(|old| !parent.identity(&target, old))
                .unwrap_or(false)
            || parent.read(&target)?.as_deref() != expected
        {
            return Err("Settings identity changed; publication refused.");
        }
        let result = unsafe {
            libc::renameatx_np(
                parent.file.as_raw_fd(),
                tmp.as_ptr(),
                parent.file.as_raw_fd(),
                target.as_ptr(),
                if expected.is_none() {
                    libc::RENAME_EXCL
                } else {
                    0
                },
            )
        };
        if result != 0 {
            return Err("Private settings publication refused; prior state preserved.");
        }
        Ok(!deny_sync
            && parent.file.sync_all().is_ok()
            && parent.verify().is_ok()
            && parent.identity(&target, &file)
            && parent.read(&target).ok().flatten().as_deref() == Some(bytes))
    })();
    if result.is_err() && parent.identity(&tmp, &file) {
        unsafe {
            libc::unlinkat(parent.file.as_raw_fd(), tmp.as_ptr(), 0);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!("trainer-private-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        fs::canonicalize(path).unwrap()
    }
    #[test]
    fn publication_is_private_exclusive_and_compare_before_replace() {
        let root = root();
        let path = root.join("settings.json");
        assert!(publish(&path, b"first", None).unwrap());
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert!(publish(&path, b"collision", None).is_err());
        assert!(publish(&path, b"stale", Some(b"other")).is_err());
        assert!(publish(&path, b"second", Some(b"first")).unwrap());
        assert_eq!(read(&path).unwrap(), b"second");
        assert!(!publish_with(&path, b"committed", Some(b"second"), |_| Ok(()), true).unwrap());
        assert_eq!(read(&path).unwrap(), b"committed");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failures_and_target_races_preserve_originals_and_clean_only_owned_stage() {
        let root = root();
        let path = root.join("settings.json");
        publish(&path, b"original", None).unwrap();
        assert!(publish_with(
            &path,
            b"next",
            Some(b"original"),
            |_| Err("injected sync failure"),
            false
        )
        .is_err());
        assert_eq!(read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let reached = std::cell::Cell::new(false);
        let result = publish_with(
            &path,
            b"next",
            Some(b"original"),
            |_| {
                reached.set(true);
                fs::rename(&path, root.join("preserved")).unwrap();
                assert!(publish(&path, b"raced", None).is_err()); // lock prevents second writer
                symlink(root.join("preserved"), &path).unwrap();
                Ok(())
            },
            false,
        );
        assert!(reached.get(), "race hook not reached: {result:?}");
        assert!(result.is_err());
        assert_eq!(fs::read(root.join("preserved")).unwrap(), b"original");
        assert!(read(&path).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn same_content_target_replacement_is_not_the_pinned_target() {
        let root = root();
        let path = root.join("settings.json");
        publish(&path, b"original", None).unwrap();
        assert!(publish_with(
            &path,
            b"next",
            Some(b"original"),
            |_| {
                fs::rename(&path, root.join("preserved")).unwrap();
                fs::write(&path, b"original").unwrap();
                fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
                Ok(())
            },
            false
        )
        .is_err());
        assert_eq!(read(&path).unwrap(), b"original");
        assert_eq!(read(&root.join("preserved")).unwrap(), b"original");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn parent_swap_refuses_publication_and_preserves_both_paths() {
        let root = root();
        let parent = root.join("private");
        fs::create_dir(&parent).unwrap();
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
        let path = parent.join("settings.json");
        publish(&path, b"original", None).unwrap();
        let retained = root.join("retained");
        assert!(publish_with(
            &path,
            b"next",
            Some(b"original"),
            |_| {
                fs::rename(&parent, &retained).unwrap();
                fs::create_dir(&parent).unwrap();
                fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
                Ok(())
            },
            false
        )
        .is_err());
        assert!(!path.exists());
        assert_eq!(read(&retained.join("settings.json")).unwrap(), b"original");
        assert_eq!(fs::read_dir(&retained).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn transaction_unlocks_even_with_a_duplicated_descriptor() {
        let root = root();
        let parent = Parent::open(&root, false).unwrap();
        assert_eq!(
            unsafe { libc::flock(parent.file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
            0
        );
        let duplicate = unsafe { libc::dup(parent.file.as_raw_fd()) };
        assert!(duplicate >= 0);
        let duplicate = unsafe { File::from_raw_fd(duplicate) };
        drop(parent);
        assert!(publish(&root.join("settings.json"), b"new", None).unwrap());
        drop(duplicate);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_aliases_links_modes_large_and_nonregular_objects() {
        let root = root();
        let path = root.join("settings.json");
        publish(&path, b"original", None).unwrap();
        let link = root.join("alias");
        symlink(&path, &link).unwrap();
        assert!(read(&link).is_err());
        let hard = root.join("hard");
        fs::hard_link(&path, &hard).unwrap();
        assert!(read(&path).is_err());
        fs::remove_file(hard).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read(&path).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&path, vec![b'x'; LIMIT + 1]).unwrap();
        assert!(read(&path).is_err());
        assert!(read(&root).is_err());
        let alias = root.join("parent-alias");
        symlink(&root, &alias).unwrap();
        assert!(read(&alias.join("settings.json")).is_err());
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(read(&path).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
