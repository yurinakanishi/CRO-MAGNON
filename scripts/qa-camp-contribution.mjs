// Verify removal of camp delivery in real Chrome, through isolated solo saves.
// Reuses the title / touch / no-network checks of the resource QA.
process.argv.push('--camp-only');
await import('./qa-resource-visibility.mjs');
