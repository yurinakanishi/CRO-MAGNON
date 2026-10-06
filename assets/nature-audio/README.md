# Nature audio sources

The runtime uses only `public/audio/nature/` (14 MP3 files, 6,435,928 bytes).
See its `manifest.json` for original file SHA-256 hashes, source pages, authors, CC0
licenses, extraction intervals, processing, output hashes and exact sizes.

`source/` preserves the original first-version sources and the unused Fantozzi archive.
`quality-source/` adds the explicitly licensed CC0 field recordings and VSCO 2 CE
instrument samples (pinned Git commit, download URLs, author and SHA in sources.json).
`quality-masters/` contains the lossless PCM masters, never shipped to the game.

`node scripts/prepare-nature-audio.mjs` delegates to `prepare-nature-quality.py`.
It requires Python/numpy and FFmpeg (set PYTHON / FFMPEG as needed), only reads
local sources, and never fetches files or touches game state. The separate
`fetch-nature-quality.mjs` explicitly downloads the listed public CC0 originals.

Mastering preserves 44.1 kHz stereo for wind, river, shore, rain and music; localized
fire/torch, birds and drops are mono. Continuous recordings use 2–4 second
equal-power crossfades. Static loudness gains preserve dynamics, with headroom
protection; no per-frame automatic normalization. MP3 VBR q2 has matching decoded
durations and bounded loop seams in real Chrome. Decoded buffers use approximately
108.4 MiB at the requested 44.1 kHz; the 48 kHz bound is 118 MiB.

`source/kenney-impact.zip` is an unused research candidate and is never packaged.
The three original 48-second compositions use recorded VSCO flute and harp
multisamples, with small tuning correction, near-pitch sample selection, natural
attacks, releases, breath gaps and dark reverb. No prerecorded third-party song or
music generation service is used. Rain and water drops now use licensed source
audio instead of simple synthetic noise/tones. Only the acoustic reverb impulse
is synthesized at runtime, in `src/nature-audio-design.ts`.

The user removed all footsteps, action cues, stingers and UI sounds on 2026-10-06.
Their previous synthesis source and six footstep WAVs are retained only for audition
in `removed-20261006/`, outside every distribution. The review page and all 30
playable historical examples are in `output/nature-audio-review-20261006/index.html`.
`before-quality-20261006/` separately preserves the version before quality work.
The latest 13 before/after pairs, extra drop and two real-game mix recordings are
in `output/nature-audio-quality-20261006/index.html` (29 players).
Comparison copies target -28 LUFS with a -3 dBTP ceiling; game recordings retain
their actual default ambience 70% / music 30% levels. No automatic playback.
