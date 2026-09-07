// Run the adjacent official CLI source because its checked-out dist is stale.
import { createProgram } from '../../meshmell.com/packages/cli/src/program.ts';
try { await createProgram().parseAsync(process.argv); }
catch (error) { if (error.exitCode === 0) process.exitCode = 0; else throw error; }
