"""Portable no-follow, ownership and lock primitives for build/release helpers.

Unix keeps the existing POSIX semantics (O_NOFOLLOW, st_uid, flock). Windows
uses reparse-point refusal, binary-mode descriptors, the object's owner SID
from its security descriptor, and an exclusive byte-range lock. Nothing here
changes permissions or follows links.
"""
import contextlib
import os
import stat
import sys

WINDOWS = sys.platform == 'win32'
NOFOLLOW = getattr(os, 'O_NOFOLLOW', 0)
# Windows CRT descriptors default to text mode; identity hashing needs bytes.
BINARY = getattr(os, 'O_BINARY', 0)
_REPARSE = getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)


def is_link(info):
    """A symbolic link, junction or other reparse point."""
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, 'st_file_attributes', 0) & _REPARSE)


def open_nofollow(path, flags, mode=0o600):
    """os.open that never follows a final link (Windows: refuses reparse points)."""
    if WINDOWS:
        try:
            if is_link(os.lstat(path)):
                raise OSError('Refusing link or reparse point')
        except FileNotFoundError:
            if not flags & os.O_CREAT:
                raise
    fd = os.open(path, flags | NOFOLLOW | BINARY, mode)
    if WINDOWS:
        try:
            current = os.lstat(path)
            opened = os.fstat(fd)
            if is_link(current) or (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
                raise OSError('Object replaced while opening')
        except BaseException:
            os.close(fd)
            raise
    return fd


def _windows_owner_is_current_user(fd):
    import ctypes
    from ctypes import wintypes
    import msvcrt
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    owner = ctypes.c_void_p()
    descriptor = ctypes.c_void_p()
    OWNER_SECURITY_INFORMATION, SE_FILE_OBJECT = 1, 1
    advapi32.GetSecurityInfo.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.DWORD,
                                         ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p,
                                         ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    if advapi32.GetSecurityInfo(msvcrt.get_osfhandle(fd), SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION,
                                ctypes.byref(owner), None, None, None, ctypes.byref(descriptor)) != 0:
        return False
    try:
        token = wintypes.HANDLE()
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
            return False
        try:
            matches = False
            for token_class in (1, 4):  # TokenUser, TokenOwner
                size = wintypes.DWORD()
                advapi32.GetTokenInformation(token, token_class, None, 0, ctypes.byref(size))
                buffer = ctypes.create_string_buffer(size.value)
                if not advapi32.GetTokenInformation(token, token_class, buffer, size, ctypes.byref(size)):
                    return False
                sid = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p))[0]
                advapi32.EqualSid.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
                matches = matches or bool(advapi32.EqualSid(owner, sid))
            return matches
        finally:
            kernel32.CloseHandle(token)
    finally:
        kernel32.LocalFree(descriptor)


def owned(fd):
    """The open object belongs to the current user."""
    if WINDOWS:
        return _windows_owner_is_current_user(fd)
    return os.fstat(fd).st_uid == os.getuid()


@contextlib.contextmanager
def exclusive(fd):
    """Blocking exclusive lock held for the context (no stealing, no timeout)."""
    if WINDOWS:
        import msvcrt
        os.lseek(fd, 0, os.SEEK_SET)
        while True:
            try:
                msvcrt.locking(fd, msvcrt.LK_LOCK, 1)  # Retries ~10 s, then raises.
                break
            except OSError:
                continue
        try:
            yield
        finally:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
