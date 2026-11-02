#!/usr/bin/env python3
"""Finite authored stdio connector for isolated history evidence; no service access.

Only the explicit history runner selects this script in its stopped keyless copy.
It is not bundled, enabled by default, a real Garmin adapter or an auth mechanism.
"""
import json
import os
from pathlib import Path
import stat
import sys

SENTINEL = b'{"syntheticHistoryOnly":true}'
TOOLS = frozenset(('get_stats', 'get_sleep_summary', 'get_body_battery',
                   'get_weekly_steps', 'get_activities_by_date', 'get_user_profile',
                   'get_cycling_ftp', 'get_body_composition', 'get_weigh_ins',
                   'get_activity_fit_data', 'get_activity', 'get_activity_hr_in_timezones'))


def admitted(root):
    root = Path(root)
    if not root.is_absolute() or root.resolve() != root:
        return False
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
        return False
    directory = root / 'tokens'
    if directory.resolve() != directory:
        return False
    parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(parent)
        if info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o700:
            return False
        fd = os.open('garmin_tokens.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            return (stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
                    info.st_mode & 0o777 == 0o600 and info.st_nlink == 1 and
                    info.st_size == len(SENTINEL) and source.read(len(SENTINEL) + 1) == SENTINEL)
    finally:
        os.close(parent)


def reply(message):
    if message.get('method') == 'initialize':
        return {'protocolVersion': '2024-11-05', 'capabilities': {}, 'serverInfo': {'name': 'authored-history-only', 'version': '1'}}
    params = message.get('params') or {}
    if message.get('method') != 'tools/call' or set(params) != {'name', 'arguments'} or params['name'] not in TOOLS or not isinstance(params['arguments'], dict):
        raise ValueError('Finite synthetic operation refused')
    name, args = params['name'], params['arguments']
    fields = {'get_stats': {'date'}, 'get_sleep_summary': {'date'}, 'get_body_battery': {'start_date', 'end_date'},
              'get_weekly_steps': {'end_date', 'weeks'}, 'get_activities_by_date': {'start_date', 'end_date', 'page', 'page_size'},
              'get_activity': {'activity_id'}, 'get_activity_fit_data': {'activity_id', 'include_records'},
              'get_activity_hr_in_timezones': {'activity_id'}, 'get_body_composition': {'start_date', 'end_date'},
              'get_weigh_ins': {'start_date', 'end_date'}, 'get_user_profile': set(), 'get_cycling_ftp': set()}
    if set(args) != fields[name]:
        raise ValueError('Synthetic argument shape refused')
    if name == 'get_stats':
        value = {'date': args['date'], 'total_steps': 0}
    elif name == 'get_sleep_summary':
        value = {'sleep_seconds': 3600}
    elif name == 'get_body_battery':
        value = []
    elif name == 'get_activities_by_date':
        value = {'activities': [], 'has_more': False}
    elif name == 'get_activity':
        value = []
    elif name == 'get_activity_fit_data':
        # Prevent every real FIT fallback, including the baseline helper.
        value = {'zones_target': {}, 'records': []}
    elif name == 'get_weekly_steps':
        value = {'end_date': args['end_date'], 'weeks_requested': args['weeks'], 'weeks_returned': 0, 'weekly_data': []}
    else:
        value = {}
    return {'content': [{'type': 'text', 'text': json.dumps(value)}]}


def main():
    if len(sys.argv) != 2 or not admitted(sys.argv[1]):
        raise SystemExit('Explicit private synthetic run required')
    attempts = 0
    while True:
        line = sys.stdin.buffer.readline(16385)
        if not line:
            return
        if len(line) > 16384 or not line.endswith(b'\n'):
            raise SystemExit('Synthetic frame bound')
        message = json.loads(line)
        if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
            raise SystemExit('Synthetic protocol refused')
        if 'id' not in message:
            if message.get('method') != 'notifications/initialized':
                raise SystemExit('Synthetic notification refused')
            continue
        if message.get('method') == 'tools/call':
            attempts += 1
            if attempts > 480:
                raise SystemExit('Synthetic attempt bound')
        try:
            result = {'jsonrpc': '2.0', 'id': message['id'], 'result': reply(message)}
        except (ValueError, KeyError, TypeError):
            result = {'jsonrpc': '2.0', 'id': message['id'], 'error': {'code': -32602, 'message': 'Finite synthetic operation refused'}}
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
