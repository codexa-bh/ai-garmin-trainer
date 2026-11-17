//! Owner-private filesystem mechanisms shared by the native private-state owners.
//!
//! Policy (which checks apply, size limits, user-facing messages) stays with the
//! callers. This module only provides no-follow, handle-relative primitives with
//! real OS identities:
//! - Unix: descriptor-relative POSIX calls, uid and mode bits, `flock`.
//! - Windows: NT handle-relative opens that never traverse reparse points,
//!   protected current-user DACLs from creation, volume/file-ID identity, renames
//!   of an already-open handle relative to the pinned parent, and a per-directory
//!   current-user lock object released on handle close or process death.
//!
//! Same-user and privileged processes (root; SYSTEM/Administrators) and backups
//! can still read private objects. Nothing here encrypts or repairs permissions.
use std::ffi::OsStr;
use std::fs::File;
use std::io;
use std::path::{Component, Path};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FileId {
    pub volume: u64,
    pub file: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    File,
    Directory,
    /// Links, reparse points, devices, pipes and other non-regular objects.
    Other,
}

#[derive(Clone, Debug)]
pub struct Meta {
    pub id: FileId,
    pub kind: Kind,
    pub links: u64,
    pub len: u64,
    /// Owned by the current user (Windows also accepts the token's default owner).
    pub owned: bool,
    /// No access for ordinary foreign principals. Unix: `mode & 0o077 == 0`.
    /// Windows: protected or inherited DACL whose applicable allow entries name
    /// only the current user, SYSTEM or Administrators.
    pub restricted: bool,
    /// Unix exact `0600` file / `0700` directory. Windows: equal to `restricted`.
    pub exact: bool,
    /// May be traversed as an ancestor: trusted owner and no foreign principal can
    /// replace its children (Unix: no group/other write unless root sticky).
    pub ancestor_safe: bool,
    /// Modification and change stamps for opaque revision tokens.
    stamp: [i64; 4],
}

impl Meta {
    pub fn private_file(&self) -> bool {
        self.kind == Kind::File && self.links == 1 && self.owned && self.restricted
    }
    pub fn private_dir(&self) -> bool {
        self.kind == Kind::Directory && self.owned && self.restricted
    }
    /// Opaque, content-free revision token (Unix format is unchanged).
    pub fn revision(&self) -> String {
        format!(
            "{}-{}-{}-{}-{}-{}-{}",
            self.id.volume,
            self.id.file,
            self.len,
            self.stamp[0],
            self.stamp[1],
            self.stamp[2],
            self.stamp[3]
        )
    }
}

/// Failure classes of a pinned traversal; callers own the wording.
#[derive(Debug, PartialEq, Eq)]
pub enum Walk {
    /// Not an absolute local canonical-form path, or it contains `..`, `.`,
    /// unsupported names, prefixes or drive types.
    Alias,
    /// A missing component could not be created exclusively.
    Create,
    /// A component is missing, a link/reparse point or otherwise not openable.
    Missing,
    /// A component has unsafe ownership or foreign replacement rights.
    Unsafe,
}

pub use os::{
    create_at, create_dir_at, exists_at, id, meta, open_at, open_dir_at, path_meta, remove_at,
    rename_at, sync_dir, try_lock, unlock, Lock,
};

/// Pin an absolute directory, optionally creating missing components as private.
/// No component may be a link/reparse point; every component must be a safe ancestor.
pub fn walk(path: &Path, create: bool) -> Result<File, Walk> {
    if !path.is_absolute() || path.as_os_str().len() > 4096 || !os::local_form(path) {
        return Err(Walk::Alias);
    }
    let mut current: Option<File> = None;
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                if current.is_none() {
                    current = Some(os::root(path).map_err(|_| Walk::Missing)?);
                }
            }
            Component::Normal(part) => {
                if !valid_name(part) {
                    return Err(Walk::Alias);
                }
                let parent = current.as_ref().ok_or(Walk::Alias)?;
                let mut next = open_dir_at(parent, part);
                if create && matches!(&next, Err(error) if error.kind() == io::ErrorKind::NotFound)
                {
                    create_dir_at(parent, part).map_err(|_| Walk::Create)?;
                    next = open_dir_at(parent, part);
                }
                let next = next.map_err(|_| Walk::Missing)?;
                if !meta(&next).map(|m| m.ancestor_safe).unwrap_or(false) {
                    return Err(Walk::Unsafe);
                }
                current = Some(next);
            }
            Component::CurDir | Component::ParentDir => return Err(Walk::Alias),
        }
    }
    current.ok_or(Walk::Alias)
}

/// True only when `path` is already the absolute, local, canonical spelling of an
/// existing object (Windows: exact final-path case, no 8.3/junction/subst alias).
pub fn canonical(path: &Path) -> bool {
    os::local_form(path) && os::canonical(path)
}

/// The held object is still the one `path` names, without following links.
pub fn same_object(path: &Path, held: &File) -> bool {
    match (path_meta(path), id(held)) {
        (Ok(current), Ok(held)) => current.id == held,
        _ => false,
    }
}

/// A single leaf name usable relative to a pinned directory on every platform.
pub fn valid_name(name: &OsStr) -> bool {
    let Some(text) = name.to_str() else {
        return cfg!(unix) && !name.is_empty() && !name.as_encoded_bytes().contains(&0);
    };
    if text.is_empty() || text == "." || text == ".." || text.contains(['/', '\0']) {
        return false;
    }
    if cfg!(windows) {
        if text.len() > 255
            || text.ends_with(['.', ' '])
            || text
                .chars()
                .any(|c| (c as u32) < 32 || "<>:\"\\|?*".contains(c))
        {
            return false;
        }
        let stem = text
            .split('.')
            .next()
            .unwrap_or_default()
            .trim_end()
            .to_ascii_uppercase();
        let device = matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.chars().count() == 4
            && stem
                .chars()
                .nth(3)
                .is_some_and(|c| c.is_ascii_digit() || "¹²³".contains(c)));
        if device {
            return false;
        }
    }
    true
}

/// Create a new private file at an absolute path whose parent is a safe pinned
/// directory. Exclusive: an existing object is never replaced.
pub fn create_private_file(path: &Path) -> io::Result<File> {
    let refused = || io::Error::new(io::ErrorKind::PermissionDenied, "unsafe parent");
    let parent = walk(path.parent().ok_or_else(refused)?, false).map_err(|_| refused())?;
    let name = path
        .file_name()
        .filter(|n| valid_name(n))
        .ok_or_else(refused)?;
    create_at(&parent, name)
}

#[cfg(unix)]
mod os {
    use super::{FileId, Kind, Meta};
    use std::ffi::{CString, OsStr};
    use std::fs::{self, File};
    use std::io;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;

    fn c(name: &OsStr) -> io::Result<CString> {
        CString::new(name.as_bytes()).map_err(|_| io::ErrorKind::InvalidInput.into())
    }
    fn opened(fd: i32) -> io::Result<File> {
        if fd < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(unsafe { File::from_raw_fd(fd) })
        }
    }
    fn me() -> u32 {
        unsafe { libc::getuid() }
    }
    fn from_std(m: &fs::Metadata) -> Meta {
        let kind = if m.file_type().is_file() {
            Kind::File
        } else if m.file_type().is_dir() {
            Kind::Directory
        } else {
            Kind::Other
        };
        let sticky = m.uid() == 0 && m.mode() & u32::from(libc::S_ISVTX) != 0;
        Meta {
            id: FileId {
                volume: m.dev(),
                file: u128::from(m.ino()),
            },
            kind,
            links: m.nlink(),
            len: m.len(),
            owned: m.uid() == me(),
            restricted: m.mode() & 0o077 == 0,
            exact: m.mode() & 0o777
                == if kind == Kind::Directory {
                    0o700
                } else {
                    0o600
                },
            ancestor_safe: (m.uid() == 0 || m.uid() == me()) && (m.mode() & 0o022 == 0 || sticky),
            stamp: [m.mtime(), m.mtime_nsec(), m.ctime(), m.ctime_nsec()],
        }
    }
    pub fn meta(file: &File) -> io::Result<Meta> {
        file.metadata().map(|m| from_std(&m))
    }
    pub fn id(file: &File) -> io::Result<FileId> {
        meta(file).map(|m| m.id)
    }
    pub fn path_meta(path: &Path) -> io::Result<Meta> {
        fs::symlink_metadata(path).map(|m| from_std(&m))
    }
    pub(super) fn local_form(_path: &Path) -> bool {
        true
    }
    pub(super) fn canonical(path: &Path) -> bool {
        fs::canonicalize(path).ok().as_deref() == Some(path)
    }
    pub(super) fn root(_path: &Path) -> io::Result<File> {
        File::open("/")
    }
    pub fn open_dir_at(dir: &File, name: &OsStr) -> io::Result<File> {
        let name = c(name)?;
        opened(unsafe {
            libc::openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        })
    }
    pub fn create_dir_at(dir: &File, name: &OsStr) -> io::Result<()> {
        let name = c(name)?;
        if unsafe { libc::mkdirat(dir.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    pub fn open_at(dir: &File, name: &OsStr) -> io::Result<File> {
        let name = c(name)?;
        opened(unsafe {
            libc::openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        })
    }
    pub fn create_at(dir: &File, name: &OsStr) -> io::Result<File> {
        let name = c(name)?;
        opened(unsafe {
            libc::openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        })
    }
    pub fn exists_at(dir: &File, name: &OsStr) -> io::Result<bool> {
        let name = c(name)?;
        let mut meta = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe {
            libc::fstatat(
                dir.as_raw_fd(),
                name.as_ptr(),
                meta.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } == 0
        {
            return Ok(true);
        }
        match io::Error::last_os_error() {
            error if error.kind() == io::ErrorKind::NotFound => Ok(false),
            error => Err(error),
        }
    }
    /// Rename `from` (whose open handle is `_source`) to `to` within `dir`.
    pub fn rename_at(
        dir: &File,
        from: &OsStr,
        _source: &File,
        to: &OsStr,
        replace: bool,
    ) -> io::Result<()> {
        let (from, to) = (c(from)?, c(to)?);
        if unsafe {
            libc::renameatx_np(
                dir.as_raw_fd(),
                from.as_ptr(),
                dir.as_raw_fd(),
                to.as_ptr(),
                if replace { 0 } else { libc::RENAME_EXCL },
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    /// Remove `name` only while it still identifies `expected`.
    pub fn remove_at(dir: &File, name: &OsStr, expected: &File) -> io::Result<()> {
        if id(&open_at(dir, name)?)? != id(expected)? {
            return Err(io::ErrorKind::Other.into());
        }
        let name = c(name)?;
        if unsafe { libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    pub fn sync_dir(dir: &File) -> bool {
        dir.sync_all().is_ok()
    }
    /// The lock lives with the descriptor; `unlock` releases it explicitly.
    pub struct Lock(());
    pub fn try_lock(dir: &File) -> Option<Lock> {
        (unsafe { libc::flock(dir.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0)
            .then_some(Lock(()))
    }
    // Explicit unlock matters when another thread forks while a transaction owns
    // the fd: CLOEXEC closes inherited fds only after exec, not at parent close.
    pub fn unlock(dir: &File) {
        unsafe {
            libc::flock(dir.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

#[cfg(windows)]
mod os {
    use super::{FileId, Kind, Meta};
    use std::ffi::{c_void, OsStr};
    use std::fs::File;
    use std::io;
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::{Component, Path, Prefix};
    use std::ptr::{null, null_mut};
    use std::sync::OnceLock;
    use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows_sys::Wdk::Storage::FileSystem::{
        FileDispositionInformationEx, FileRenameInformationEx, NtCreateFile, NtSetInformationFile,
        FILE_CREATE, FILE_DIRECTORY_FILE, FILE_DISPOSITION_DELETE, FILE_DISPOSITION_INFORMATION_EX,
        FILE_DISPOSITION_POSIX_SEMANTICS, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
        FILE_OPEN_REPARSE_POINT, FILE_RENAME_INFORMATION, FILE_SYNCHRONOUS_IO_NONALERT,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, RtlNtStatusToDosError, ERROR_ALREADY_EXISTS,
        GENERIC_ALL, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
        OBJ_CASE_INSENSITIVE, UNICODE_STRING,
    };
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        ConvertStringSidToSidW, GetSecurityInfo, SDDL_REVISION_1, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        AclSizeInformation, CreateWellKnownSid, EqualSid, GetAce, GetAclInformation, GetLengthSid,
        GetTokenInformation, TokenOwner, TokenUser, WinBuiltinAdministratorsSid, WinLocalSystemSid,
        ACCESS_ALLOWED_ACE, ACL, ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION, INHERIT_ONLY_ACE,
        OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES, TOKEN_OWNER,
        TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FileBasicInfo, FileIdInfo, FlushFileBuffers, GetDriveTypeW,
        GetFileInformationByHandle, GetFileInformationByHandleEx, GetFileType,
        BY_HANDLE_FILE_INFORMATION, DELETE, FILE_ADD_FILE, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FILE_DELETE_CHILD,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO,
        FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, FILE_TRAVERSE, FILE_TYPE_DISK, OPEN_EXISTING, READ_CONTROL, SYNCHRONIZE,
        WRITE_DAC, WRITE_OWNER,
    };
    use windows_sys::Win32::System::SystemServices::{
        ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE,
    };
    use windows_sys::Win32::System::Threading::{
        CreateMutexW, GetCurrentProcess, OpenProcessToken,
    };
    use windows_sys::Win32::System::WindowsProgramming::{
        DRIVE_FIXED, DRIVE_RAMDISK, DRIVE_REMOVABLE, FILE_RENAME_FLAG_POSIX_SEMANTICS,
        FILE_RENAME_FLAG_REPLACE_IF_EXISTS,
    };
    use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

    const SHARE_ALL: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
    const DIR_ACCESS: u32 =
        FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE;
    // Rights that let a foreign principal replace, delete or re-permission children.
    const REPLACE_RIGHTS: u32 = DELETE
        | FILE_DELETE_CHILD
        | WRITE_DAC
        | WRITE_OWNER
        | GENERIC_ALL
        | GENERIC_WRITE
        | 0x0200_0000; // MAXIMUM_ALLOWED
    const TRUSTED_INSTALLER: &str =
        "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";

    fn wide(text: &OsStr) -> Vec<u16> {
        text.encode_wide().chain(Some(0)).collect()
    }
    fn os_error(status: i32) -> io::Error {
        io::Error::from_raw_os_error(unsafe { RtlNtStatusToDosError(status) } as i32)
    }
    fn handle(file: &File) -> HANDLE {
        file.as_raw_handle() as HANDLE
    }

    struct Sids {
        user: Vec<u8>,
        owner: Vec<u8>,
        system: Vec<u8>,
        admins: Vec<u8>,
        installer: Vec<u8>,
        user_sddl: String,
    }
    fn copy_sid(sid: PSID) -> Vec<u8> {
        let length = unsafe { GetLengthSid(sid) } as usize;
        unsafe { std::slice::from_raw_parts(sid as *const u8, length) }.to_vec()
    }
    fn token_sid(class: i32) -> Option<Vec<u8>> {
        unsafe {
            let mut token: HANDLE = null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return None;
            }
            let token = OwnedHandle::from_raw_handle(token as _);
            let mut length = 0u32;
            GetTokenInformation(
                token.as_raw_handle() as HANDLE,
                class,
                null_mut(),
                0,
                &mut length,
            );
            let mut buffer = vec![0u64; (length as usize).div_ceil(8) + 1];
            if GetTokenInformation(
                token.as_raw_handle() as HANDLE,
                class,
                buffer.as_mut_ptr() as *mut c_void,
                (buffer.len() * 8) as u32,
                &mut length,
            ) == 0
            {
                return None;
            }
            let sid = if class == TokenUser {
                (*(buffer.as_ptr() as *const TOKEN_USER)).User.Sid
            } else {
                (*(buffer.as_ptr() as *const TOKEN_OWNER)).Owner
            };
            Some(copy_sid(sid))
        }
    }
    fn well_known(kind: i32) -> Option<Vec<u8>> {
        let mut buffer = vec![0u8; 68];
        let mut length = buffer.len() as u32;
        (unsafe { CreateWellKnownSid(kind, null_mut(), buffer.as_mut_ptr() as PSID, &mut length) }
            != 0)
            .then(|| {
                buffer.truncate(length as usize);
                buffer
            })
    }
    fn string_sid(text: &str) -> Option<Vec<u8>> {
        let mut sid: PSID = null_mut();
        if unsafe { ConvertStringSidToSidW(wide(OsStr::new(text)).as_ptr(), &mut sid) } == 0 {
            return None;
        }
        let copied = copy_sid(sid);
        unsafe { LocalFree(sid as _) };
        Some(copied)
    }
    fn sid_text(sid: &[u8]) -> Option<String> {
        let mut text: *mut u16 = null_mut();
        if unsafe { ConvertSidToStringSidW(sid.as_ptr() as PSID, &mut text) } == 0 {
            return None;
        }
        let length = (0..).take_while(|&i| unsafe { *text.add(i) } != 0).count();
        let value = String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) }).ok();
        unsafe { LocalFree(text as _) };
        value
    }
    fn sids() -> Option<&'static Sids> {
        static SIDS: OnceLock<Option<Sids>> = OnceLock::new();
        SIDS.get_or_init(|| {
            let user = token_sid(TokenUser)?;
            Some(Sids {
                user_sddl: sid_text(&user)?,
                owner: token_sid(TokenOwner)?,
                system: well_known(WinLocalSystemSid)?,
                admins: well_known(WinBuiltinAdministratorsSid)?,
                installer: string_sid(TRUSTED_INSTALLER)?,
                user,
            })
        })
        .as_ref()
    }
    fn equal(sid: PSID, expected: &[u8]) -> bool {
        unsafe { EqualSid(sid, expected.as_ptr() as PSID) != 0 }
    }

    /// (owned, restricted, ancestor_safe) from the object's own owner and DACL.
    fn security(object: HANDLE) -> (bool, bool, bool) {
        let Some(sids) = sids() else {
            return (false, false, false);
        };
        let (mut owner, mut dacl, mut descriptor): (PSID, *mut ACL, PSECURITY_DESCRIPTOR) =
            (null_mut(), null_mut(), null_mut());
        if unsafe {
            GetSecurityInfo(
                object,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                &mut dacl,
                null_mut(),
                &mut descriptor,
            )
        } != 0
        {
            return (false, false, false);
        }
        let result = (|| {
            let owned = equal(owner, &sids.user) || equal(owner, &sids.owner);
            let trusted_owner = owned
                || equal(owner, &sids.system)
                || equal(owner, &sids.admins)
                || equal(owner, &sids.installer);
            if dacl.is_null() {
                return (owned, false, false); // A NULL DACL grants everyone everything.
            }
            let mut size: ACL_SIZE_INFORMATION = unsafe { zeroed() };
            if unsafe {
                GetAclInformation(
                    dacl,
                    &mut size as *mut _ as *mut c_void,
                    size_of::<ACL_SIZE_INFORMATION>() as u32,
                    AclSizeInformation,
                )
            } == 0
            {
                return (owned, false, false);
            }
            let (mut restricted, mut ancestor) = (true, trusted_owner);
            for index in 0..size.AceCount {
                let mut ace: *mut c_void = null_mut();
                if unsafe { GetAce(dacl, index, &mut ace) } == 0 {
                    return (owned, false, false);
                }
                let ace = unsafe { &*(ace as *const ACCESS_ALLOWED_ACE) };
                if u32::from(ace.Header.AceFlags) & INHERIT_ONLY_ACE != 0 {
                    continue; // Applies only to future children, not this object.
                }
                match u32::from(ace.Header.AceType) {
                    ACCESS_DENIED_ACE_TYPE => {}
                    ACCESS_ALLOWED_ACE_TYPE => {
                        let sid = &ace.SidStart as *const u32 as PSID;
                        let private = equal(sid, &sids.user)
                            || equal(sid, &sids.owner)
                            || equal(sid, &sids.system)
                            || equal(sid, &sids.admins);
                        restricted &= private;
                        if !private
                            && !equal(sid, &sids.installer)
                            && ace.Mask & REPLACE_RIGHTS != 0
                        {
                            ancestor = false;
                        }
                    }
                    _ => {
                        // Object/callback/conditional entries are not interpreted: fail closed.
                        restricted = false;
                        ancestor = false;
                    }
                }
            }
            (owned, restricted, ancestor)
        })();
        unsafe { LocalFree(descriptor as _) };
        result
    }

    pub fn id(file: &File) -> io::Result<FileId> {
        let mut info: FILE_ID_INFO = unsafe { zeroed() };
        if unsafe {
            GetFileInformationByHandleEx(
                handle(file),
                FileIdInfo,
                &mut info as *mut _ as *mut c_void,
                size_of::<FILE_ID_INFO>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(FileId {
            volume: info.VolumeSerialNumber,
            file: u128::from_le_bytes(info.FileId.Identifier),
        })
    }
    pub fn meta(file: &File) -> io::Result<Meta> {
        let object = handle(file);
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
        let mut basic: FILE_BASIC_INFO = unsafe { zeroed() };
        if unsafe { GetFileInformationByHandle(object, &mut info) } == 0
            || unsafe {
                GetFileInformationByHandleEx(
                    object,
                    FileBasicInfo,
                    &mut basic as *mut _ as *mut c_void,
                    size_of::<FILE_BASIC_INFO>() as u32,
                )
            } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let kind = if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            Kind::Other
        } else if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
            Kind::Directory
        } else if unsafe { GetFileType(object) } == FILE_TYPE_DISK {
            Kind::File
        } else {
            Kind::Other
        };
        let (owned, restricted, ancestor_safe) = security(object);
        Ok(Meta {
            id: id(file)?,
            kind,
            links: u64::from(info.nNumberOfLinks),
            len: (u64::from(info.nFileSizeHigh) << 32) | u64::from(info.nFileSizeLow),
            owned,
            restricted,
            exact: restricted,
            ancestor_safe: ancestor_safe && kind != Kind::Other,
            stamp: [basic.LastWriteTime, 0, basic.ChangeTime, 0],
        })
    }
    fn verbatim(path: &Path) -> Vec<u16> {
        let mut text = std::ffi::OsString::from(r"\\?\");
        text.push(path.as_os_str());
        wide(&text)
    }
    pub fn path_meta(path: &Path) -> io::Result<Meta> {
        if !local_form(path) {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let object = unsafe {
            CreateFileW(
                verbatim(path).as_ptr(),
                FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE,
                SHARE_ALL,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            )
        };
        if object == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        meta(&unsafe { File::from_raw_handle(object as _) })
    }
    /// Drive-letter absolute paths on fixed/removable/RAM volumes only: no UNC,
    /// device, verbatim or relative-drive forms, no `/` spellings or bad names.
    pub(super) fn local_form(path: &Path) -> bool {
        let Some(text) = path.to_str() else {
            return false;
        };
        let mut components = path.components();
        let drive = match components.next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::Disk(letter) => letter,
                _ => return false,
            },
            _ => return false,
        };
        if text.contains('/')
            || components.next() != Some(Component::RootDir)
            || !components.all(|c| matches!(c, Component::Normal(name) if super::valid_name(name)))
        {
            return false;
        }
        let root = format!("{}:\\", char::from(drive));
        matches!(
            unsafe { GetDriveTypeW(wide(OsStr::new(&root)).as_ptr()) },
            DRIVE_FIXED | DRIVE_REMOVABLE | DRIVE_RAMDISK
        )
    }
    pub(super) fn canonical(path: &Path) -> bool {
        // Final-path normalization resolves case, 8.3 names, junctions and subst.
        std::fs::canonicalize(path)
            .ok()
            .and_then(|full| full.to_str().map(str::to_owned))
            .is_some_and(|full| full.strip_prefix(r"\\?\") == path.to_str())
    }
    pub(super) fn root(path: &Path) -> io::Result<File> {
        let Some(Component::Prefix(prefix)) = path.components().next() else {
            return Err(io::ErrorKind::InvalidInput.into());
        };
        let Prefix::Disk(letter) = prefix.kind() else {
            return Err(io::ErrorKind::InvalidInput.into());
        };
        let root = format!(r"\\?\{}:\", char::from(letter));
        let object = unsafe {
            CreateFileW(
                wide(OsStr::new(&root)).as_ptr(),
                DIR_ACCESS,
                SHARE_ALL,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                null_mut(),
            )
        };
        if object == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { File::from_raw_handle(object as _) })
    }

    struct Descriptor(PSECURITY_DESCRIPTOR);
    impl Drop for Descriptor {
        fn drop(&mut self) {
            unsafe { LocalFree(self.0 as _) };
        }
    }
    /// Protected DACL: only the current user and SYSTEM, explicit user owner.
    /// Directory entries are inheritable so files written later by owned Node/
    /// Python descendants are private from creation (umask has no Windows meaning).
    fn private_descriptor(directory: bool) -> io::Result<Descriptor> {
        let user = &sids().ok_or(io::ErrorKind::PermissionDenied)?.user_sddl;
        let inherit = if directory { "OICI" } else { "" };
        let text = format!("O:{user}D:P(A;{inherit};FA;;;{user})(A;{inherit};FA;;;SY)");
        let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide(OsStr::new(&text)).as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Descriptor(descriptor))
    }

    #[allow(clippy::too_many_arguments)]
    fn nt_open(
        root: &File,
        name: &OsStr,
        access: u32,
        disposition: u32,
        options: u32,
        descriptor: Option<&Descriptor>,
    ) -> io::Result<File> {
        if !name.is_empty() && !super::valid_name(name) {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let mut units: Vec<u16> = name.encode_wide().collect();
        let bytes = u16::try_from(units.len() * 2).map_err(|_| io::ErrorKind::InvalidInput)?;
        let object_name = UNICODE_STRING {
            Length: bytes,
            MaximumLength: bytes,
            Buffer: units.as_mut_ptr(),
        };
        let attributes = OBJECT_ATTRIBUTES {
            Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: handle(root),
            ObjectName: &object_name,
            Attributes: OBJ_CASE_INSENSITIVE,
            SecurityDescriptor: descriptor.map(|d| d.0 as *const _).unwrap_or(null()),
            SecurityQualityOfService: null(),
        };
        let mut object: HANDLE = null_mut();
        let mut status: IO_STATUS_BLOCK = unsafe { zeroed() };
        let result = unsafe {
            NtCreateFile(
                &mut object,
                access,
                &attributes,
                &mut status,
                null(),
                FILE_ATTRIBUTE_NORMAL,
                SHARE_ALL,
                disposition,
                options | FILE_SYNCHRONOUS_IO_NONALERT,
                null(),
                0,
            )
        };
        if result < 0 {
            return Err(os_error(result));
        }
        Ok(unsafe { File::from_raw_handle(object as _) })
    }
    fn not_link(file: File, directory: bool) -> io::Result<File> {
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
        if unsafe { GetFileInformationByHandle(handle(&file), &mut info) } == 0 {
            return Err(io::Error::last_os_error());
        }
        if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
        {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "link or wrong object type",
            ));
        }
        Ok(file)
    }
    pub fn open_dir_at(dir: &File, name: &OsStr) -> io::Result<File> {
        not_link(
            nt_open(
                dir,
                name,
                DIR_ACCESS | DELETE,
                FILE_OPEN,
                FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT,
                None,
            )
            .or_else(|_| {
                // Ancestors we do not own (C:\Users) never grant DELETE.
                nt_open(
                    dir,
                    name,
                    DIR_ACCESS,
                    FILE_OPEN,
                    FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT,
                    None,
                )
            })?,
            true,
        )
    }
    pub fn create_dir_at(dir: &File, name: &OsStr) -> io::Result<()> {
        nt_open(
            dir,
            name,
            FILE_LIST_DIRECTORY | SYNCHRONIZE,
            FILE_CREATE,
            FILE_DIRECTORY_FILE,
            Some(&private_descriptor(true)?),
        )
        .map(drop)
    }
    pub fn open_at(dir: &File, name: &OsStr) -> io::Result<File> {
        nt_open(
            dir,
            name,
            GENERIC_READ | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE,
            FILE_OPEN,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT,
            None,
        )
    }
    pub fn create_at(dir: &File, name: &OsStr) -> io::Result<File> {
        nt_open(
            dir,
            name,
            GENERIC_READ | GENERIC_WRITE | DELETE | READ_CONTROL | SYNCHRONIZE,
            FILE_CREATE,
            FILE_NON_DIRECTORY_FILE,
            Some(&private_descriptor(false)?),
        )
    }
    pub fn exists_at(dir: &File, name: &OsStr) -> io::Result<bool> {
        match nt_open(
            dir,
            name,
            FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            FILE_OPEN,
            FILE_OPEN_REPARSE_POINT,
            None,
        ) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }
    /// Rename the already-open `source` (opened with DELETE access) to `to`,
    /// resolved relative to the pinned `dir` handle, never by path.
    pub fn rename_at(
        dir: &File,
        _from: &OsStr,
        source: &File,
        to: &OsStr,
        replace: bool,
    ) -> io::Result<()> {
        if !super::valid_name(to) {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let units: Vec<u16> = to.encode_wide().collect();
        let offset = std::mem::offset_of!(FILE_RENAME_INFORMATION, FileName);
        let length = offset + units.len() * 2;
        let mut buffer = vec![0u64; length.div_ceil(8) + 1];
        unsafe {
            let info = buffer.as_mut_ptr() as *mut FILE_RENAME_INFORMATION;
            (*info).Anonymous.Flags = FILE_RENAME_FLAG_POSIX_SEMANTICS
                | if replace {
                    FILE_RENAME_FLAG_REPLACE_IF_EXISTS
                } else {
                    0
                };
            (*info).RootDirectory = handle(dir);
            (*info).FileNameLength = (units.len() * 2) as u32;
            std::ptr::copy_nonoverlapping(
                units.as_ptr(),
                (buffer.as_mut_ptr() as *mut u8).add(offset) as *mut u16,
                units.len(),
            );
        }
        let mut status: IO_STATUS_BLOCK = unsafe { zeroed() };
        let result = unsafe {
            NtSetInformationFile(
                handle(source),
                &mut status,
                buffer.as_ptr() as *const c_void,
                length as u32,
                FileRenameInformationEx,
            )
        };
        if result < 0 {
            return Err(os_error(result));
        }
        Ok(())
    }
    /// Delete `name` through a handle proven to be `expected`: no name race.
    pub fn remove_at(dir: &File, name: &OsStr, expected: &File) -> io::Result<()> {
        let target = nt_open(
            dir,
            name,
            DELETE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            FILE_OPEN,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT,
            None,
        )?;
        if id(&target)? != id(expected)? {
            return Err(io::ErrorKind::Other.into());
        }
        let info = FILE_DISPOSITION_INFORMATION_EX {
            Flags: FILE_DISPOSITION_DELETE | FILE_DISPOSITION_POSIX_SEMANTICS,
        };
        let mut status: IO_STATUS_BLOCK = unsafe { zeroed() };
        let result = unsafe {
            NtSetInformationFile(
                handle(&target),
                &mut status,
                &info as *const _ as *const c_void,
                size_of::<FILE_DISPOSITION_INFORMATION_EX>() as u32,
                FileDispositionInformationEx,
            )
        };
        if result < 0 {
            return Err(os_error(result));
        }
        Ok(())
    }
    pub fn sync_dir(dir: &File) -> bool {
        // An empty name reopens the pinned directory itself with write access.
        nt_open(
            dir,
            OsStr::new(""),
            FILE_ADD_FILE | SYNCHRONIZE,
            FILE_OPEN,
            FILE_DIRECTORY_FILE,
            None,
        )
        .map(|writable| unsafe { FlushFileBuffers(handle(&writable)) } != 0)
        .unwrap_or(false)
    }
    /// Exclusive per-directory lock: a current-user named object keyed by the
    /// directory's volume/file identity. Released when the handle closes,
    /// including on process death; contention fails closed (no stealing).
    pub struct Lock(#[allow(dead_code)] OwnedHandle);
    pub fn try_lock(dir: &File) -> Option<Lock> {
        let identity = id(dir).ok()?;
        let user = &sids()?.user_sddl;
        let name = format!(
            "Local\\garmin-trainer-private-{:016x}-{:032x}",
            identity.volume, identity.file
        );
        let descriptor = {
            let text = format!("D:P(A;;GA;;;{user})");
            let mut value: PSECURITY_DESCRIPTOR = null_mut();
            if unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    wide(OsStr::new(&text)).as_ptr(),
                    SDDL_REVISION_1,
                    &mut value,
                    null_mut(),
                )
            } == 0
            {
                return None;
            }
            Descriptor(value)
        };
        let attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        let object = unsafe { CreateMutexW(&attributes, 0, wide(OsStr::new(&name)).as_ptr()) };
        let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if object.is_null() {
            return None;
        }
        if existed {
            unsafe { CloseHandle(object) };
            return None;
        }
        Some(Lock(unsafe { OwnedHandle::from_raw_handle(object as _) }))
    }
    pub fn unlock(_dir: &File) {}

    #[cfg(test)]
    pub(super) fn set_dacl(path: &Path, sddl: &str) {
        use windows_sys::Win32::Security::Authorization::SetNamedSecurityInfoW;
        use windows_sys::Win32::Security::{
            GetSecurityDescriptorDacl, PROTECTED_DACL_SECURITY_INFORMATION,
        };
        let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
        let text = sddl.replace("{user}", &sids().unwrap().user_sddl);
        assert_ne!(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    wide(OsStr::new(&text)).as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    null_mut(),
                )
            },
            0
        );
        let descriptor = Descriptor(descriptor);
        let (mut present, mut defaulted, mut dacl) = (0, 0, null_mut());
        assert_ne!(
            unsafe {
                GetSecurityDescriptorDacl(descriptor.0, &mut present, &mut dacl, &mut defaulted)
            },
            0
        );
        assert_eq!(
            unsafe {
                SetNamedSecurityInfoW(
                    wide(path.as_os_str()).as_ptr(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    null_mut(),
                    null_mut(),
                    dacl,
                    null(),
                )
            },
            0
        );
    }
}

/// Test fixtures for owner-private roots and files on the host platform.
#[cfg(test)]
pub mod testing {
    use std::fs;
    use std::path::{Path, PathBuf};

    /// The host temp root in its canonical local spelling (no `\\?\` prefix).
    pub fn temp_root() -> PathBuf {
        let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
        #[cfg(windows)]
        let temp = PathBuf::from(temp.to_str().unwrap().strip_prefix(r"\\?\").unwrap());
        temp
    }
    /// A fresh canonical owner-private directory under the host temp root.
    pub fn private_root(prefix: &str) -> PathBuf {
        let name = format!("{prefix}-{}", uuid::Uuid::new_v4());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = std::env::temp_dir().join(name);
            fs::create_dir(&path).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
            fs::canonicalize(path).unwrap()
        }
        #[cfg(windows)]
        {
            let temp = temp_root();
            let parent = super::walk(&temp, false).unwrap();
            super::create_dir_at(&parent, name.as_ref()).unwrap();
            temp.join(name)
        }
    }
    /// A private subdirectory (exclusive).
    pub fn private_dir(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::create_dir(path).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        #[cfg(windows)]
        {
            let parent = super::walk(path.parent().unwrap(), false).unwrap();
            super::create_dir_at(&parent, path.file_name().unwrap()).unwrap();
        }
    }
    /// Write bytes to a private file, creating it private when absent.
    pub fn write_private(path: &Path, bytes: &[u8]) {
        if !path.exists() {
            drop(super::create_private_file(path).unwrap());
        }
        fs::write(path, bytes).unwrap();
        make_private(path);
    }
    /// Restore owner-only access (Unix 0600/0700; Windows protected user+SYSTEM DACL).
    pub fn make_private(path: impl AsRef<Path>) {
        let path = path.as_ref();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = if path.is_dir() { 0o700 } else { 0o600 };
            fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
        }
        #[cfg(windows)]
        super::os::set_dacl(path, "D:P(A;;FA;;;{user})(A;;FA;;;SY)");
    }
    /// Grant ordinary other users read access (Unix 0644/0755; Windows Everyone read).
    pub fn make_shared(path: impl AsRef<Path>) {
        let path = path.as_ref();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = if path.is_dir() { 0o755 } else { 0o644 };
            fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
        }
        #[cfg(windows)]
        super::os::set_dacl(path, "D:P(A;;FA;;;{user})(A;;FA;;;SY)(A;;FR;;;WD)");
    }
    /// A symbolic link (Windows test hosts need symlink privilege, as on CI;
    /// a missing Windows target is linked as a file).
    pub fn symlink(target: impl AsRef<Path>, link: impl AsRef<Path>) -> std::io::Result<()> {
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, link);
        #[cfg(windows)]
        return if target.as_ref().is_dir() {
            std::os::windows::fs::symlink_dir(target, link)
        } else {
            std::os::windows::fs::symlink_file(target, link)
        };
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;
    use std::fs;
    #[cfg(windows)]
    use std::path::PathBuf;

    #[test]
    fn private_creation_identity_rename_and_owned_removal() {
        let root = private_root("trainer-fs");
        let dir = walk(&root, false).unwrap();
        assert!(meta(&dir).unwrap().private_dir());
        let staged = create_at(&dir, "stage".as_ref()).unwrap();
        assert!(meta(&staged).unwrap().private_file());
        assert!(
            create_at(&dir, "stage".as_ref()).is_err(),
            "creation is exclusive"
        );
        rename_at(&dir, "stage".as_ref(), &staged, "final".as_ref(), false).unwrap();
        assert!(!exists_at(&dir, "stage".as_ref()).unwrap());
        assert_eq!(
            id(&open_at(&dir, "final".as_ref()).unwrap()).unwrap(),
            id(&staged).unwrap()
        );
        let other = create_at(&dir, "other".as_ref()).unwrap();
        assert!(
            rename_at(&dir, "other".as_ref(), &other, "final".as_ref(), false).is_err(),
            "no-replace rename refuses an existing target"
        );
        rename_at(&dir, "other".as_ref(), &other, "final".as_ref(), true).unwrap();
        assert!(
            remove_at(&dir, "final".as_ref(), &staged).is_err(),
            "identity bound"
        );
        remove_at(&dir, "final".as_ref(), &other).unwrap();
        assert!(!exists_at(&dir, "final".as_ref()).unwrap());
        assert!(sync_dir(&dir));
        drop((staged, other, dir));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn traversal_creates_private_components_and_refuses_aliases() {
        let root = private_root("trainer-walk");
        let nested = root.join("a").join("b");
        assert_eq!(walk(&nested, false).unwrap_err(), Walk::Missing);
        let pinned = walk(&nested, true).unwrap();
        assert!(meta(&pinned).unwrap().private_dir());
        assert!(canonical(&nested));
        assert_eq!(
            walk(&root.join("a").join("..").join("a"), false).unwrap_err(),
            Walk::Alias
        );
        assert_eq!(walk(Path::new("relative"), false).unwrap_err(), Walk::Alias);
        drop(pinned);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn shared_objects_are_not_private_and_locks_are_exclusive() {
        let root = private_root("trainer-acl");
        let file = root.join("settings.json");
        write_private(&file, b"x");
        assert!(path_meta(&file).unwrap().private_file());
        make_shared(&file);
        assert!(!path_meta(&file).unwrap().private_file());
        make_private(&file);
        assert!(path_meta(&file).unwrap().private_file());
        let first = walk(&root, false).unwrap();
        let second = walk(&root, false).unwrap();
        let lock = try_lock(&first).unwrap();
        assert!(
            try_lock(&second).is_none(),
            "second owner refused, never stolen"
        );
        drop(lock);
        unlock(&first);
        assert!(try_lock(&second).is_some());
        drop((first, second));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn names_refuse_streams_devices_and_separators() {
        for bad in ["", ".", "..", "a/b", "a\0b"] {
            assert!(!valid_name(bad.as_ref()), "{bad:?}");
        }
        if cfg!(windows) {
            for bad in [
                "a:stream", "CON", "nul.txt", "COM1", "lpt9.log", "trail.", "trail ", "a\\b", "q?",
            ] {
                assert!(!valid_name(bad.as_ref()), "{bad:?}");
            }
        }
        assert!(valid_name("settings-v3.json".as_ref()));
        assert!(valid_name("Résumé plan.json".as_ref()));
    }
    #[cfg(windows)]
    #[test]
    fn windows_paths_require_local_drive_canonical_spelling() {
        let root = private_root("trainer-case");
        assert!(canonical(&root));
        let upper = PathBuf::from(root.to_str().unwrap().to_uppercase());
        assert!(
            !canonical(&upper),
            "case alias is not the canonical spelling"
        );
        for bad in [
            r"\\server\share\x",
            r"\\?\C:\Windows",
            r"\\.\C:\Windows",
            r"C:relative",
            r"C:/Windows",
            r"C:\Windows\file.txt:stream",
            r"C:\Windows\NUL",
        ] {
            assert!(!canonical(Path::new(bad)), "{bad}");
            assert_eq!(
                walk(Path::new(bad), false).unwrap_err(),
                Walk::Alias,
                "{bad}"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn windows_junctions_and_hardlinks_are_never_private_objects() {
        let root = private_root("trainer-reparse");
        let target = root.join("target");
        private_dir(&target);
        let junction = root.join("junction");
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&junction)
            .arg(&target)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(path_meta(&junction).unwrap().kind, Kind::Other);
        assert_eq!(walk(&junction, false).unwrap_err(), Walk::Missing);
        let file = target.join("settings.json");
        write_private(&file, b"x");
        fs::hard_link(&file, root.join("hard")).unwrap();
        assert!(
            !path_meta(&file).unwrap().private_file(),
            "hard link count refused"
        );
        fs::remove_file(root.join("hard")).unwrap();
        assert!(path_meta(&file).unwrap().private_file());
        fs::remove_dir(&junction).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
