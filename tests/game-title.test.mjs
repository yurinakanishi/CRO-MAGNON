import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('the public game title matches the repository name', async () => {
  const [html, main, review] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8'),
    readFile(new URL('public/model-review.html', root), 'utf8'),
  ]);

  assert.match(html, /<title>CRO-MAGNON<\/title>/);
  assert.match(html, /name="application-name" content="CRO-MAGNON"/);
  assert.match(html, /property="og:title" content="CRO-MAGNON"/);
  assert.match(main, /const GAME_TITLE = 'CRO-MAGNON';/);
  assert.match(main, /<h1>\$\{GAME_TITLE\}<\/h1>/);
  assert.match(review, /<title>CRO-MAGNON \| ASSET REVIEW<\/title>/);
});
