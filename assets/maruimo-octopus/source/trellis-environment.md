# Local runtime prerequisites

Generation attempt 02 restored the shape but the installed texture stage failed:
`tex_flow_1024.gguf` was missing. No candidate GLB was produced or adopted.

The installed runtime's official [README](https://github.com/pwilkin/trellis.cpp)
links to the [GGUF weight distribution](https://huggingface.co/ilintar/trellis2-gguf).
The Hugging Face file API returned these expected values on 2026-10-01:

- File: `tex_flow_1024.gguf`
- Bytes: `2586734336`
- SHA-256: `c0a51917c1e5a9dad4d8a49cdf47553e21fd47716d46e53c5f44fcc7bf7f3af1`

Only this missing model is being restored to the existing local model directory;
the CLI/runtime and the other nine model files are retained. Verify length and
SHA-256 before promoting the `.part` download to the expected model name.
The weight file is an execution dependency, not a game asset.

The download completed and both expected values matched. Dense attempt 03 uses
the restored texture model with the unchanged imagegen v2 alpha and seed 42.
