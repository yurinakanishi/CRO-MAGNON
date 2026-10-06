// Offline build only: originals must already exist. No network or game state.
import { spawnSync } from 'node:child_process';
const python =
  process.env.PYTHON ||
  'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
for (const script of ['prepare-nature-quality.py', 'prepare-nature-foley.py']) {
  const result = spawnSync(python, ['-X', 'utf8', `scripts/${script}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
