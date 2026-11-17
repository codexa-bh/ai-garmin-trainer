//! Owned descendant trees for bundled Node and helper processes.
//!
//! Unix: the child leads a new process group; group signals reach only it and
//! its descendants. Windows: the child starts suspended, is assigned to a new
//! kill-on-close Job Object before its first instruction runs, then resumes, so
//! no descendant can escape. Ownership is never inferred from names, ports or
//! parent PIDs, and foreign processes are never signalled.
use std::ffi::OsString;
use std::io;
use std::ops::{Deref, DerefMut};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

/// Bundled Node executable inside the packaged resources.
pub fn node(resources: &Path) -> PathBuf {
    resources.join(if cfg!(windows) { "node.exe" } else { "node" })
}

/// OS variables a cleared child environment needs to function (Windows: system
/// roots and temp; Unix: none, preserving the existing reviewed environment).
pub fn system_environment(command: &mut Command) {
    #[cfg(windows)]
    for key in ["SystemRoot", "SystemDrive", "windir", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    #[cfg(unix)]
    let _ = command;
}

/// The reviewed user-context variables passed to tool/runtime children.
pub fn user_environment(command: &mut Command) {
    #[cfg(unix)]
    let keys = ["HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "LANG"].as_slice();
    #[cfg(windows)]
    let keys = [
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "PATHEXT",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "LANG",
    ]
    .as_slice();
    for key in keys {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    system_environment(command);
}

/// Fixed non-user search path for tool children. `unix` keeps each caller's
/// existing reviewed literal; Windows uses only the system directories.
pub fn search_path(unix: &str) -> OsString {
    #[cfg(windows)]
    {
        let _ = unix;
        let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
        let mut path = OsString::from(Path::new(&root).join("System32"));
        path.push(";");
        path.push(&root);
        path
    }
    #[cfg(unix)]
    OsString::from(unix)
}

pub struct Tree {
    child: Child,
    #[cfg(windows)]
    job: std::sync::Arc<std::os::windows::io::OwnedHandle>,
}

/// A cloneable stop capability for the exact owned tree, safe to use from a
/// cancellation path while another thread owns the `Tree`.
#[derive(Clone)]
pub struct Killer {
    #[cfg(unix)]
    group: i32,
    #[cfg(windows)]
    job: std::sync::Arc<std::os::windows::io::OwnedHandle>,
}
impl Killer {
    /// Request termination: Unix SIGTERM to the group; Windows has no signal, so
    /// the job (child and descendants) is terminated.
    pub fn terminate(&self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-self.group, libc::SIGTERM);
        }
        #[cfg(windows)]
        windows::terminate(&self.job);
    }
    /// Immediately stop every owned process in the tree.
    pub fn kill(&self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-self.group, libc::SIGKILL);
        }
        #[cfg(windows)]
        windows::terminate(&self.job);
    }
}

impl Tree {
    pub fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let child = command.process_group(0).spawn()?;
            Ok(Self { child })
        }
        #[cfg(windows)]
        {
            let (child, job) = windows::spawn(command)?;
            Ok(Self {
                child,
                job: std::sync::Arc::new(job),
            })
        }
    }
    pub fn killer(&self) -> Killer {
        Killer {
            #[cfg(unix)]
            group: self.child.id() as i32,
            #[cfg(windows)]
            job: self.job.clone(),
        }
    }
    pub fn terminate(&self) {
        self.killer().terminate();
    }
    /// Stop the whole owned tree (never only the direct child).
    pub fn kill(&mut self) {
        self.killer().kill();
    }
    /// Let the child itself keep its tree alive after host loss, so it can settle
    /// owned state (for example DB leases) before its descendants are stopped.
    /// Unix process groups already outlive the host; Windows duplicates the
    /// kill-on-close job handle (non-inheritable) into the child.
    pub fn share_ownership_with_child(&self) -> io::Result<()> {
        #[cfg(windows)]
        return windows::share(&self.child, &self.job);
        #[cfg(unix)]
        Ok(())
    }
}
impl Deref for Tree {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}
impl DerefMut for Tree {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::os::windows::process::CommandExt;
    use std::process::{Child, Command};
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{
        CloseHandle, DuplicateHandle, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED,
        THREAD_SUSPEND_RESUME,
    };

    fn job() -> io::Result<OwnedHandle> {
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = unsafe { OwnedHandle::from_raw_handle(handle as _) };
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        // No breakaway flags: descendants cannot leave the job.
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }
    /// Resume the only thread of a process created suspended.
    fn resume(pid: u32) -> io::Result<()> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot as _) };
        let mut entry: THREADENTRY32 = unsafe { zeroed() };
        entry.dwSize = size_of::<THREADENTRY32>() as u32;
        let mut threads = Vec::new();
        let mut more =
            unsafe { Thread32First(snapshot.as_raw_handle() as HANDLE, &mut entry) } != 0;
        while more {
            if entry.th32OwnerProcessID == pid {
                threads.push(entry.th32ThreadID);
            }
            more = unsafe { Thread32Next(snapshot.as_raw_handle() as HANDLE, &mut entry) } != 0;
        }
        let [thread] = threads[..] else {
            return Err(io::Error::other("unexpected suspended thread set"));
        };
        let handle = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, thread) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let resumed = unsafe { ResumeThread(handle) };
        unsafe { CloseHandle(handle) };
        if resumed == u32::MAX {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    pub fn spawn(command: &mut Command) -> io::Result<(Child, OwnedHandle)> {
        let job = job()?;
        let mut child = command
            .creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW)
            .spawn()?;
        let assigned = unsafe {
            AssignProcessToJobObject(
                job.as_raw_handle() as HANDLE,
                child.as_raw_handle() as HANDLE,
            )
        } != 0;
        let started = if assigned {
            resume(child.id())
        } else {
            Err(io::Error::last_os_error())
        };
        if let Err(error) = started {
            // Never run an unowned child: stop the suspended process itself.
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok((child, job))
    }
    pub fn terminate(job: &OwnedHandle) {
        unsafe {
            TerminateJobObject(job.as_raw_handle() as HANDLE, 1);
        }
    }
    pub fn share(child: &Child, job: &OwnedHandle) -> io::Result<()> {
        let mut duplicate: HANDLE = null_mut();
        if unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                job.as_raw_handle() as HANDLE,
                child.as_raw_handle() as HANDLE,
                &mut duplicate,
                0,
                0,
                windows_sys::Win32::Foundation::DUPLICATE_SAME_ACCESS,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(()) // The handle now belongs to the child and closes when it exits.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn wait_until(mut done: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if done() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[cfg(unix)]
    fn alive(pid: u32) -> bool {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    fn alive(pid: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = unsafe { GetExitCodeProcess(handle, &mut code) } != 0;
        unsafe { CloseHandle(handle) };
        ok && code == STILL_ACTIVE as u32
    }

    /// A child that starts one long-lived grandchild, prints its PID, then runs
    /// for `seconds` (synthetic fixture; no product code or network).
    fn parent_of_grandchild(seconds: u32) -> Command {
        #[cfg(unix)]
        {
            let mut command = Command::new("/bin/sh");
            command.args([
                "-c",
                &format!("/bin/sleep 60 & echo $!; /bin/sleep {seconds}"),
            ]);
            command
        }
        #[cfg(windows)]
        {
            // The test host's Node (on PATH in CI): a child that spawns a
            // detached-console grandchild and prints its PID.
            let node = std::env::split_paths(&std::env::var_os("PATH").unwrap())
                .map(|dir| dir.join("node.exe"))
                .find(|path| path.is_file())
                .expect("Node on PATH for the synthetic process fixture");
            let mut command = Command::new(node);
            command.args([
                "-e",
                &format!(
                    "const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{{}},90000)'],{{stdio:'ignore'}});console.log(c.pid);setTimeout(()=>process.exit(0),{}*1000)",
                    seconds
                ),
            ]);
            command
        }
    }
    fn spawn_with_grandchild(seconds: u32) -> (Tree, u32) {
        use std::io::{BufRead, BufReader};
        let mut command = parent_of_grandchild(seconds);
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        system_environment(&mut command);
        let mut tree = Tree::spawn(&mut command).unwrap();
        let mut line = String::new();
        BufReader::new(tree.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let grandchild = line.trim().parse().unwrap();
        assert!(alive(grandchild));
        (tree, grandchild)
    }
    fn unrelated() -> Child {
        #[cfg(unix)]
        return Command::new("/bin/sleep").arg("60").spawn().unwrap();
        #[cfg(windows)]
        return Command::new("ping.exe")
            .args(["-n", "90", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
    }

    #[test]
    fn kill_stops_child_and_grandchild_but_never_foreign_processes() {
        let mut foreign = unrelated();
        let (mut tree, grandchild) = spawn_with_grandchild(60);
        tree.kill();
        tree.wait().unwrap();
        assert!(wait_until(|| !alive(grandchild)), "grandchild escaped");
        assert!(
            foreign.try_wait().unwrap().is_none(),
            "foreign process touched"
        );
        foreign.kill().unwrap();
        foreign.wait().unwrap();
    }

    #[test]
    fn cancellation_capability_reaches_the_tree_from_another_owner() {
        let (mut tree, grandchild) = spawn_with_grandchild(60);
        let killer = tree.killer();
        std::thread::spawn(move || killer.terminate())
            .join()
            .unwrap();
        tree.wait().unwrap();
        #[cfg(unix)]
        tree.kill(); // SIGTERM may leave a trapping descendant; the owner settles it.
        assert!(wait_until(|| !alive(grandchild)));
    }

    #[cfg(windows)]
    #[test]
    fn windows_host_loss_closes_the_job_unless_the_child_shares_ownership() {
        // Host loss is modelled by closing the host's only job handle without
        // terminating: kill-on-close must stop the whole tree.
        let (tree, grandchild) = spawn_with_grandchild(60);
        let pid = tree.id();
        drop(tree);
        assert!(wait_until(|| !alive(pid) && !alive(grandchild)));
        // With shared ownership the child outlives host loss and settles first;
        // its exit then closes the job and stops the remaining descendant.
        let (tree, grandchild) = spawn_with_grandchild(3);
        tree.share_ownership_with_child().unwrap();
        let pid = tree.id();
        drop(tree);
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            alive(grandchild),
            "shared job must survive host handle loss"
        );
        assert!(wait_until(|| !alive(pid) && !alive(grandchild)));
    }

    #[test]
    fn search_path_never_includes_user_directories() {
        let path = search_path("/usr/bin:/bin");
        if cfg!(unix) {
            assert_eq!(path, "/usr/bin:/bin");
        } else {
            let text = path.to_string_lossy().to_ascii_lowercase();
            assert!(text.ends_with("windows") || text.contains("system32"));
            assert!(!text.contains("users"));
        }
        assert!(node(Path::new("/r")).ends_with(if cfg!(windows) { "node.exe" } else { "node" }));
    }
}
