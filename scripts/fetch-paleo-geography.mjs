// Public NOAA inputs. This script never reads game state or sends workspace data.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = new URL('../assets/geography/source/', import.meta.url);
await mkdir(directory, { recursive: true });
const sources = [
  ['etopo1-6min.nc', 'https://oceanwatch.aoml.noaa.gov/erddap/griddap/etopo180.nc?altitude[0:6:10800][0:6:21600]'],
  ['etopo1-metadata.txt', 'https://oceanwatch.aoml.noaa.gov/erddap/griddap/etopo180.das'],
  ['spratt2016-noaa.txt', 'https://www.ncei.noaa.gov/pub/data/paleo/contributions_by_author/spratt2016/spratt2016-noaa.txt'],
];
const manifest = await Promise.all(sources.map(async ([file, url]) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(file, directory), bytes);
  const record = { file, url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString() };
  console.log(JSON.stringify(record)); return record;
}));
await writeFile(new URL('manifest.json', directory), JSON.stringify(manifest, null, 2) + '\n');
