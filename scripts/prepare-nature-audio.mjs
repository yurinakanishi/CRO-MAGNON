// Offline build only: originals must already exist. No network or game state.
import { spawnSync } from 'node:child_process';
const python =
  process.env.PYTHON ||
  'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const result = spawnSync(python, ['scripts/prepare-nature-quality.py'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
