// Offline build only: originals must already exist (fetch-nature-remake.py and
// fetch-nature-remake-vsco.py download them). No network or game state.
// Revision 4 (2026-10-11) replaces the revision 2/3 pipelines (prepare-nature-quality.py,
// prepare-nature-foley.py), which are kept only as a record of the earlier sounds.
import { spawnSync } from 'node:child_process';
const python =
  process.env.PYTHON ||
  'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const result = spawnSync(python, ['-X', 'utf8', 'scripts/prepare-nature-remake.py'], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
