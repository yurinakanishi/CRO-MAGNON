# Audio revision 4 (2026-10-11): sources and reproduction

Every game sound and the three place themes were rebuilt from CC0 recordings and
calibrated to real-world sound levels. Design, measurements and verification:
[docs/nature-audio-remake-2026-10-11.md](../../../docs/nature-audio-remake-2026-10-11.md).

## Files

- `sources.json` (tracked): every Freesound recording used — page, author, licence (CC0,
  checked on each page on 2026-10-11), original format, role, preview URL, bytes, SHA-256.
- `music-tuning.json` (tracked): the measured tuning of every VSCO 2 CE sample zone.
- `source/` (gitignored, re-fetchable): `freesound/<id>.ogg` HQ previews and `vsco/` (pinned
  VSCO 2 CE commit `440300901dfe9275fd84e0b7763af1f8443ae62e`, list with SHA in
  `vsco/vsco-files.json`).
- `masters/` (gitignored, reproducible): 24-bit PCM masters of every shipped file.

The shipped MP3s and `public/audio/nature/manifest.json` record each file's source
interval/events, filters, score, measured loudness, true peak, bytes and SHA-256.

## Reproduce

```
python scripts/fetch-nature-remake.py          # explicit network step (Freesound CDN)
python scripts/fetch-nature-remake-vsco.py     # explicit network step (GitHub raw)
node scripts/prepare-nature-audio.mjs          # offline: prepare-nature-remake.py + compose-nature-music.py
```

Requires numpy and FFmpeg with libmp3lame and soxr. A second full run on 2026-10-11
reproduced all 79 files byte for byte. `scripts/prepare-nature-remake-review.py` writes the
local listening page `output/nature-audio-remake-20261011/index.html`;
`scripts/qa-nature-audio-remake.mjs` is the real-Chrome game check.

The previous shipped audio and code are kept in `../before-remake-20261011/`.
