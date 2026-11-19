"""Windows invocation-owned private roots and the native run namespace lease.

Only freshly exclusive directories receive ACLs, at creation; never chmod/adopt
existing inputs. Native Admission independently validates every private DACL,
canonical spelling, file ID and settings/DB boundary before framework startup.
"""

import contextlib
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import re
import subprocess

import platform_files


def canonical(path):
    path = Path(path)
    if not path.is_absolute() or str(path.resolve(strict=True)) != str(path):
        raise ValueError('Canonical local path required')
    for part in [path, *path.parents]:
        if platform_files.is_link(part.lstat()):
            raise ValueError('Reparse/alias path refused')
    return path


def api():
    if not platform_files.WINDOWS:
        raise ValueError('Windows x64 host required')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    security = ctypes.WinDLL('advapi32', use_last_error=True)
    security.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.DWORD),
    ]
    security.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    kernel.CreateDirectoryW.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p]
    kernel.CreateDirectoryW.restype = wintypes.BOOL
    kernel.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.GetFileInformationByHandleEx.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel.GetFileInformationByHandleEx.restype = wintypes.BOOL
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    return kernel, security


def user_sid():
    executable = Path(os.environ['SystemRoot']) / 'System32/whoami.exe'
    output = subprocess.run(
        [str(executable), '/user', '/fo', 'csv', '/nh'], capture_output=True, check=True, timeout=10
    ).stdout.decode('utf8')
    values = re.findall(r'S-1-5-(?:[0-9]+-)*[0-9]+', output)
    if len(values) != 1:
        raise ValueError('Current-user SID unavailable')
    return values[0]


class Attributes(ctypes.Structure):
    _fields_ = [
        ('length', wintypes.DWORD),
        ('descriptor', ctypes.c_void_p),
        ('inherit', wintypes.BOOL),
    ]


@contextlib.contextmanager
def attributes(sddl):
    kernel, security = api()
    descriptor = ctypes.c_void_p()
    if not security.ConvertStringSecurityDescriptorToSecurityDescriptorW(
        sddl, 1, ctypes.byref(descriptor), None
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield Attributes(ctypes.sizeof(Attributes), descriptor, False)
    finally:
        kernel.LocalFree(descriptor)


def mkdir(path):
    canonical(path.parent)
    kernel, _ = api()
    sid = user_sid()
    with attributes(f'O:{sid}D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)') as security:
        if not kernel.CreateDirectoryW(str(path), ctypes.byref(security)):
            raise ctypes.WinError(ctypes.get_last_error())  # Existing is always refusal.
    return canonical(path)


class PinnedRoot:
    def __init__(self, path):
        self.path = canonical(path)
        self.kernel, _ = api()
        # Read attributes, sharing read/write but not delete: this invocation's
        # handle pins the directory while used. Open the reparse point itself.
        self.handle = self.kernel.CreateFileW(str(path), 0x80, 3, None, 3, 0x02200000, None)
        if self.handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        self.identity = self.file_id()

    def file_id(self):
        class FileId(ctypes.Structure):
            _fields_ = [('volume', ctypes.c_ulonglong), ('file', ctypes.c_ubyte * 16)]

        value = FileId()
        if not self.kernel.GetFileInformationByHandleEx(
            self.handle, 18, ctypes.byref(value), ctypes.sizeof(value)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        return value.volume, int.from_bytes(bytes(value.file), 'little')

    def verify(self):
        canonical(self.path)
        if self.file_id() != self.identity:
            raise ValueError('Pinned directory changed')

    @contextlib.contextmanager
    def lease(self):
        self.verify()
        volume, file = self.identity
        name = f'Local\\garmin-trainer-private-{volume:016x}-{file:032x}'
        with attributes(f'D:P(A;;GA;;;{user_sid()})') as security:
            ctypes.set_last_error(0)
            handle = self.kernel.CreateMutexW(ctypes.byref(security), False, name)
            existed = ctypes.get_last_error() == 183
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if existed:
                raise ValueError('Native run namespace is already owned; no stealing')
            yield
        finally:
            self.kernel.CloseHandle(handle)

    def close(self):
        if self.handle is not None:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class PinnedProcess:
    """Read-only live process handle, bound to the admitted installed node image.
    No terminate right, stale-PID signaling or process-name cleanup."""

    def __init__(self, pid, expected_image):
        self.kernel, _ = api()
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.QueryFullProcessImageNameW.argtypes = [
            wintypes.HANDLE,
            wintypes.DWORD,
            wintypes.LPWSTR,
            ctypes.POINTER(wintypes.DWORD),
        ]
        self.kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.kernel.WaitForSingleObject.restype = wintypes.DWORD
        self.handle = self.kernel.OpenProcess(
            0x00101000, False, pid
        )  # SYNCHRONIZE | QUERY_LIMITED_INFORMATION
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            size = wintypes.DWORD(32768)
            image = ctypes.create_unicode_buffer(size.value)
            if not self.kernel.QueryFullProcessImageNameW(
                self.handle, 0, image, ctypes.byref(size)
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            if str(Path(image.value).resolve(strict=True)) != str(expected_image):
                raise ValueError('Authenticated backend PID does not name installed node image')
            if self.settled():
                raise ValueError('Backend exited before its live handle was bound')
        except BaseException:
            self.close()
            raise

    def settled(self):
        status = self.kernel.WaitForSingleObject(self.handle, 0)
        if status not in (0, 258):
            raise ValueError('Owned backend handle settlement unavailable')
        return status == 0

    def close(self):
        if self.handle is not None:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def read_file(path, limit):
    canonical(path)
    fd = platform_files.open_nofollow(path, os.O_RDONLY)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if (
            before.st_nlink != 1
            or not platform_files.owned(stream.fileno())
            or not 0 <= before.st_size <= limit
        ):
            raise ValueError('Owned bounded single-link file required')
        content = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        current = path.stat()
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns')
        if len(content) != before.st_size or any(
            getattr(before, key) != getattr(after, key)
            or getattr(current, key) != getattr(after, key)
            for key in fields
        ):
            raise ValueError('File changed while reading')
        return content


def write_file(path, content):
    canonical(path.parent)
    fd = platform_files.open_nofollow(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
