import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test(
  'Windows fleet failover preserves an unchanged host and rejects unsafe role changes',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve(import.meta.dirname, '../scripts/test-exhibition-fleet.ps1'),
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).success, true);
  },
);
