/** Mascots may share a person's name with a hidden playable character. Audit
 * playable model identities and runtime URLs, not the person's display name. */
export function assertPublicCharacterData(name, bytes, excludedKeys, excludedSpecies) {
  if (name.startsWith('models/') && excludedKeys.has(name.split('/')[1]))
    throw new Error(`Excluded character file: ${name}`);
  if (/\.json$/.test(name)) {
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (
        excludedKeys.has(value.modelKey) ||
        excludedKeys.has(value.key) ||
        excludedSpecies.has(value.species)
      )
        throw new Error(`Excluded playable character in ${name}`);
      if (typeof value.url === 'string' && excludedKeys.has(value.url.split('/')[2]))
        throw new Error(`Excluded character runtime URL in ${name}`);
      for (const child of Object.values(value)) visit(child);
    }
    visit(JSON.parse(bytes.toString('utf8')));
  } else if (/\.(?:m?js|css|html|txt)$/.test(name)) {
    const code = bytes.toString('utf8');
    for (const key of excludedKeys)
      if (code.includes(key)) throw new Error(`Excluded character model in ${name}`);
    for (const species of excludedSpecies) {
      const escaped = species.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:["']?species["']?\\s*:)\\s*["']${escaped}["']`).test(code))
        throw new Error(`Excluded playable character in ${name}`);
    }
  }
}
