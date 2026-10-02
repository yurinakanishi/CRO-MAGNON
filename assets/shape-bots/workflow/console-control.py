"""Inspect, or explicitly signal, one verified isolated Windows server console.

Never broadcasts to a console containing any process other than the requested
server and this short-lived helper. Signal mode is used only after save backup
and a zero-player check by the caller.
"""
import argparse
import ctypes
import json
import os
import sys
from ctypes import wintypes

p = argparse.ArgumentParser()
p.add_argument('pid', type=int)
p.add_argument('--signal', action='store_true')
a = p.parse_args()
k = ctypes.WinDLL('kernel32', use_last_error=True)
k.FreeConsole()
k.AttachConsole.argtypes = [wintypes.DWORD]
k.AttachConsole.restype = wintypes.BOOL
k.GetConsoleProcessList.argtypes = [ctypes.POINTER(wintypes.DWORD), wintypes.DWORD]
k.GetConsoleProcessList.restype = wintypes.DWORD
if not k.AttachConsole(a.pid):
    print(json.dumps(dict(attached=False, pid=a.pid, error=ctypes.get_last_error())))
    sys.exit(2)
try:
    # The helper must survive its own CTRL_C broadcast; the server keeps its handler.
    assert k.SetConsoleCtrlHandler(None, True)
    values = (wintypes.DWORD * 128)()
    count = k.GetConsoleProcessList(values, len(values))
    assert 0 < count <= len(values), 'Unbounded console; do not signal'
    processes = list(values[:count])
    isolated = set(processes) == {a.pid, os.getpid()}
    report = dict(attached=True, pid=a.pid, helperPid=os.getpid(),
                  processes=processes, isolated=isolated, signalled=False)
    if a.signal:
        assert isolated, 'Shared console: no signal sent'
        k.GenerateConsoleCtrlEvent.argtypes = [wintypes.DWORD, wintypes.DWORD]
        k.GenerateConsoleCtrlEvent.restype = wintypes.BOOL
        assert k.GenerateConsoleCtrlEvent(0, 0), ctypes.get_last_error()
        report['signalled'] = True
    print(json.dumps(report), flush=True)
finally:
    k.FreeConsole()
