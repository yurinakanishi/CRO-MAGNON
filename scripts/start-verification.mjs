// Explicit local verification never reuses the ordinary 3000 save directory.
process.env.CRO_ENVIRONMENT = 'local';
process.env.EXHIBITION_RULES = '0';
const { startServer } = await import('../dist/server.mjs');
await startServer();
