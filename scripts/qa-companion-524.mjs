// Current one-mascot-per-player QA; superseded camp/group ownership cases are mapped
// to current assertions in docs/mascot-tests-2026-10-12.md. Preserved model/rig tests
// remain in tests/ and qa-mae-contact / qa-rimo-happy-lifecycle.
import { runMascotRegressions } from './qa-mascot-regressions.mjs';
await runMascotRegressions({
  profile: 'active',
  keys: ['524'],
  out: process.argv[2] || 'output/playwright/companion-524-' + Date.now(),
});
