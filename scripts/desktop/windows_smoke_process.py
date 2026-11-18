"""Finite Windows installer execution with the native owner's Job Object semantics.

Create suspended, bind to a fresh unnamed kill-on-close job, then resume. Wait
for the entire owned tree, including NSIS's temporary uninstaller child, not
merely its forwarding parent. No shell, elevation, PID/name adoption or escape.
"""
import ctypes
from ctypes import wintypes
import os
import subprocess
import time


class BasicLimits(ctypes.Structure):
    _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong), ('flags', wintypes.DWORD),
                ('min_working', ctypes.c_size_t), ('max_working', ctypes.c_size_t), ('active_limit', wintypes.DWORD),
                ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ['read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes']]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [('basic', BasicLimits), ('io', IoCounters), ('process_memory', ctypes.c_size_t),
                ('job_memory', ctypes.c_size_t), ('peak_process_memory', ctypes.c_size_t), ('peak_job_memory', ctypes.c_size_t)]


class Accounting(ctypes.Structure):
    _fields_ = [('times', ctypes.c_longlong * 4), ('faults', wintypes.DWORD), ('total', wintypes.DWORD),
                ('active', wintypes.DWORD), ('terminated', wintypes.DWORD)]


class Startup(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('reserved', wintypes.LPWSTR), ('desktop', wintypes.LPWSTR), ('title', wintypes.LPWSTR),
                ('x', wintypes.DWORD), ('y', wintypes.DWORD), ('width', wintypes.DWORD), ('height', wintypes.DWORD),
                ('chars_x', wintypes.DWORD), ('chars_y', wintypes.DWORD), ('fill', wintypes.DWORD), ('flags', wintypes.DWORD),
                ('show', wintypes.WORD), ('reserved_size', wintypes.WORD), ('reserved_bytes', ctypes.c_void_p),
                ('stdin', wintypes.HANDLE), ('stdout', wintypes.HANDLE), ('stderr', wintypes.HANDLE)]


class Process(ctypes.Structure):
    _fields_ = [('process', wintypes.HANDLE), ('thread', wintypes.HANDLE), ('pid', wintypes.DWORD), ('tid', wintypes.DWORD)]


def command_line(executable, arguments):
    """NSIS treats /D= as an unquoted final command-line tail, even with spaces.
    ApplicationName is passed independently to CreateProcessW, never inferred."""
    values = [str(executable), *arguments]
    if any(not isinstance(value, str) or any(char in value for char in '\0\r\n') for value in values):
        raise ValueError('Invalid executable argument')
    directories = [index for index, value in enumerate(arguments) if value.startswith('/D=')]
    if directories:
        if directories != [len(arguments) - 1] or '"' in arguments[-1] or len(arguments[-1]) <= 3:
            raise ValueError('NSIS /D= must be an unquoted final destination')
        return subprocess.list2cmdline(values[:-1]) + ' ' + arguments[-1]
    return subprocess.list2cmdline(values)


def api():
    if os.name != 'nt':
        raise ValueError('Windows Job Object host required')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    signatures = {
        'CreateJobObjectW': ([ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
        'SetInformationJobObject': ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
        'QueryInformationJobObject': ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p], wintypes.BOOL),
        'AssignProcessToJobObject': ([wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
        'CreateProcessW': ([wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, wintypes.BOOL, wintypes.DWORD,
                            ctypes.c_void_p, wintypes.LPCWSTR, ctypes.POINTER(Startup), ctypes.POINTER(Process)], wintypes.BOOL),
        'ResumeThread': ([wintypes.HANDLE], wintypes.DWORD),
        'GetExitCodeProcess': ([wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
        'TerminateProcess': ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
        'TerminateJobObject': ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
        'WaitForSingleObject': ([wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
        'CloseHandle': ([wintypes.HANDLE], wintypes.BOOL),
    }
    for name, (arguments, result) in signatures.items():
        getattr(kernel, name).argtypes = arguments
        getattr(kernel, name).restype = result
    return kernel


def execute(executable, arguments, *, cwd, timeout):
    if timeout <= 0:
        raise ValueError('Positive execution deadline required')
    text = command_line(executable, arguments)
    kernel = api()
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    process, assigned = Process(), False
    def active():
        observed = Accounting()
        if not kernel.QueryInformationJobObject(job, 1, ctypes.byref(observed), ctypes.sizeof(observed), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return observed.active
    try:
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
        if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        startup = Startup()
        startup.size = ctypes.sizeof(startup)
        if not kernel.CreateProcessW(str(executable), ctypes.create_unicode_buffer(text), None, None, False,
                                     0x4, None, str(cwd), ctypes.byref(startup), ctypes.byref(process)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel.AssignProcessToJobObject(job, process.process):
            raise ctypes.WinError(ctypes.get_last_error())
        assigned = True
        if kernel.ResumeThread(process.thread) == 0xffffffff:
            raise ctypes.WinError(ctypes.get_last_error())
        deadline = time.monotonic() + timeout
        while active():
            if time.monotonic() >= deadline:
                # This fresh job contains only our suspended-at-admission process
                # and its descendants. Never look up or stop a stored PID/name.
                kernel.TerminateJobObject(job, 1)
                settlement = time.monotonic() + 5
                while active() and time.monotonic() < settlement:
                    time.sleep(.05)
                error = subprocess.TimeoutExpired(str(executable), timeout)
                error.owned_tree_settled = active() == 0
                raise error
            time.sleep(.05)
        code = wintypes.DWORD()
        if not kernel.GetExitCodeProcess(process.process, ctypes.byref(code)):
            raise ctypes.WinError(ctypes.get_last_error())
        return code.value
    finally:
        if process.process and not assigned:
            kernel.TerminateProcess(process.process, 1)  # Our still-suspended fresh child only.
            kernel.WaitForSingleObject(process.process, 5000)
        # Close kills any remaining invocation-owned descendants on every error.
        kernel.CloseHandle(job)
        for handle in (process.thread, process.process):
            if handle:
                kernel.CloseHandle(handle)
