// Stable entry point for existing local launchers and operational scripts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './dist/server.mjs';
export { createGameServer } from './dist/server.mjs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
