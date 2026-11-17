//! Bounded native private documents. All IO is relative to a pinned parent handle.
//! Values and IO errors must never be formatted into diagnostics.
use crate::private_fs::{self, FileId};
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const LIMIT: usize = 128 * 1024;
const UNSAFE: &str = "Private settings unsafe or inaccessible; preserve originals and check owner, permissions and canonical path.";
fn name(part: &OsStr) -> Result<OsString, &'static str> {
    private_fs::valid_name(part)
        .then(|| part.to_owned())
        .ok_or(UNSAFE)
}
fn private(meta: &private_fs::Meta) -> bool {
    meta.private_file() && meta.exact && meta.len <= LIMIT as u64
}
struct Parent {
    file: File,
    path: PathBuf,
    lock: Option<private_fs::Lock>,
}
impl Parent {
    fn open(path: &Path, create: bool) -> Result<Self, &'static str> {
        let file = private_fs::walk(path, create).map_err(|_| UNSAFE)?;
        let parent = Self {
            file,
            path: path.into(),
            lock: None,
        };
        parent.verify()?;
        Ok(parent)
    }
    fn verify(&self) -> Result<(), &'static str> {
        let meta = private_fs::meta(&self.file).map_err(|_| UNSAFE)?;
        if !meta.private_dir()
            || !meta.exact
            || !private_fs::canonical(&self.path)
            || !private_fs::same_object(&self.path, &self.file)
        {
            return Err(UNSAFE);
        }
        Ok(())
    }
    fn lock(&mut self) -> bool {
        self.lock = private_fs::try_lock(&self.file);
        self.lock.is_some()
    }
    fn open_file(&self, part: &OsStr) -> Result<Option<File>, &'static str> {
        let file = match private_fs::open_at(&self.file, part) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(UNSAFE),
        };
        if !private(&private_fs::meta(&file).map_err(|_| UNSAFE)?) {
            return Err(UNSAFE);
        }
        Ok(Some(file))
    }
    fn identity(&self, part: &OsStr, file: &File) -> bool {
        match (self.open_file(part), private_fs::id(file)) {
            (Ok(Some(current)), Ok(id)) => private_fs::id(&current).map(|c| c == id).unwrap_or(false),
            _ => false,
        }
    }
    fn read(&self, part: &OsStr) -> Result<Option<Vec<u8>>, &'static str> {
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
impl Drop for Parent {
    fn drop(&mut self) {
        if self.lock.take().is_some() {
            private_fs::unlock(&self.file);
        }
    }
}
/// A run keeps these handles alive, so path replacement cannot transfer authority.
/// Directory locks are additional run ownership, never a replacement DB writer lease.
pub struct PinnedDirectory(Parent);
impl PinnedDirectory {
    pub fn open(path: &Path) -> Result<Self, &'static str> {
        Parent::open(path, false).map(Self)
    }
    pub fn verify(&self) -> Result<(), &'static str> {
        self.0.verify()
    }
    pub fn lock_exclusive(&mut self) -> Result<(), &'static str> {
        self.verify()?;
        if !self.0.lock() {
            return Err("Isolated run already owned; no lease stealing or fallback.");
        }
        Ok(())
    }
}

/// Exact private object identity plus its bounded bytes.
pub type Capture = (FileId, Vec<u8>);

pub fn capture(path: &Path) -> Result<Capture, &'static str> {
    let parent = Parent::open(path.parent().ok_or(UNSAFE)?, false)?;
    let part = name(path.file_name().ok_or(UNSAFE)?)?;
    let mut file = parent
        .open_file(&part)?
        .ok_or("Private settings missing; no fallback. Preserve recovery inputs.")?;
    let id = private_fs::id(&file).map_err(|_| UNSAFE)?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNSAFE)?;
    if bytes.len() > LIMIT || !parent.identity(&part, &file) {
        return Err(UNSAFE);
    }
    parent.verify()?;
    Ok((id, bytes))
}
pub fn read(path: &Path) -> Result<Vec<u8>, &'static str> {
    capture(path).map(|(_, bytes)| bytes)
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
    let mut parent = Parent::open(path.parent().ok_or(UNSAFE)?, true)?;
    if !parent.lock() {
        return Err("Another settings transaction is active; do not retry until it settles.");
    }
    let target = name(path.file_name().ok_or(UNSAFE)?)?;
    let prior = parent.open_file(&target)?;
    if parent.read(&target)?.as_deref() != expected {
        return Err("Settings changed; reload and reconcile before saving.");
    }
    let tmp = OsString::from(format!(".provider-{}.tmp", uuid::Uuid::new_v4()));
    let Ok(mut file) = private_fs::create_at(&parent.file, &tmp) else {
        return Err("Cannot stage private settings; prior state unchanged.");
    };
    let result = (|| {
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot persist private settings; prior state unchanged.")?;
        // Verify the staged bytes through the same handle before selecting
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
        // Windows refuses replacing a file another handle has open without
        // delete sharing; release our verification handle first.
        drop(prior);
        if private_fs::rename_at(&parent.file, &tmp, &file, &target, expected.is_some()).is_err() {
            return Err("Private settings publication refused; prior state preserved.");
        }
        Ok(!deny_sync
            && private_fs::sync_dir(&parent.file)
            && parent.verify().is_ok()
            && parent.identity(&target, &file)
            && parent.read(&target).ok().flatten().as_deref() == Some(bytes))
    })();
    if result.is_err() && parent.identity(&tmp, &file) {
        let _ = private_fs::remove_at(&parent.file, &tmp, &file);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_fs::testing::{make_private, make_shared, private_dir, private_root, symlink};
    use std::fs;
    fn root() -> PathBuf {
        private_root("trainer-private")
    }
    #[test]
    fn publication_is_private_exclusive_and_compare_before_replace() {
        let root = root();
        let path = root.join("settings.json");
        assert!(publish(&path, b"first", None).unwrap());
        let meta = private_fs::path_meta(&path).unwrap();
        assert!(meta.private_file() && meta.exact);
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
                crate::private_fs::testing::write_private(&path, b"original");
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
        private_dir(&parent);
        let path = parent.join("settings.json");
        publish(&path, b"original", None).unwrap();
        let retained = root.join("retained");
        assert!(publish_with(
            &path,
            b"next",
            Some(b"original"),
            |_| {
                if crate::private_fs::testing::try_swap_dir(&parent, &retained) {
                    private_dir(&parent);
                    Ok(())
                } else {
                    Err("Windows refused swapping the pinned parent")
                }
            },
            false
        )
        .is_err());
        if retained.exists() {
            assert!(!path.exists());
            assert_eq!(read(&retained.join("settings.json")).unwrap(), b"original");
            assert_eq!(fs::read_dir(&retained).unwrap().count(), 1);
        } else {
            // Windows: the swap itself was refused; the original stays authoritative.
            assert_eq!(read(&path).unwrap(), b"original");
            assert_eq!(fs::read_dir(&parent).unwrap().count(), 1);
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn transaction_unlocks_even_with_a_duplicated_descriptor() {
        let root = root();
        let mut parent = Parent::open(&root, false).unwrap();
        assert!(parent.lock());
        assert!(publish(&root.join("settings.json"), b"held", None).is_err());
        let duplicate = parent.file.try_clone().unwrap();
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
        make_shared(&path);
        assert!(read(&path).is_err());
        make_private(&path);
        fs::write(&path, vec![b'x'; LIMIT + 1]).unwrap();
        assert!(read(&path).is_err());
        assert!(read(&root).is_err());
        let alias = root.join("parent-alias");
        symlink(&root, &alias).unwrap();
        assert!(read(&alias.join("settings.json")).is_err());
        crate::private_fs::testing::remove_link(&alias);
        make_shared(&root);
        assert!(read(&path).is_err());
        make_private(&root);
        fs::remove_dir_all(root).unwrap();
    }
}
