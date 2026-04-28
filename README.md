# echo

Echo showcases browser-side inference for two engines I ported to WebAssembly: [qwen3-asr.wasm](https://github.com/shabier/qwen3-asr.wasm) for speech recognition and [deltanet.wasm](https://github.com/shabier/deltanet.wasm) for language modeling. Each runs in its own use case, and the page also composes them as a voice round-trip: audio in, transcribed, chatted with, spoken back.

## Engines

- **[qwen3-asr.wasm](https://github.com/shabier/qwen3-asr.wasm)** for speech recognition. Runs Qwen3-ASR 0.6B (Q5_K_M, 768 MB).
- **[deltanet.wasm](https://github.com/shabier/deltanet.wasm)** for language modeling. Runs Qwen3.5 0.8B (Q4_0, 507 MB).
- [kokoro-js](https://github.com/hexgrad/kokoro) for TTS (Kokoro 82M ONNX). Not my work, npm import.

## Numbers

On a 10-core M-series Mac with WebGPU:

| | |
|---|---|
| ASR | rtf 0.84× |
| LLM | 27.6 tok/s |
| TTS | rtf 3.83× |
| End-to-end | ~1s from question sent to speech ready |

## Stack

- Vite + React 19 + TypeScript
- @huggingface/transformers
- kokoro-js
- qwen3-asr.wasm and deltanet.wasm loaded from CDN, models cached in IndexedDB
- Hand-rolled waveform rendering

## Recursive demo trick

The bundled samples (Talk, Voicemail, Note, Memo) aren't real recordings. They're generated at build time by kokoro-js reading short scripts. So kokoro generates the demo audio that demonstrates qwen3-asr.wasm transcribing it, before kokoro re-synthesizes the LLM's response. The TTS engine appears twice in the round-trip, once as content generator, once as output.

```bash
npm run samples
```

## Development

```bash
git clone https://github.com/shabier/echo.git
cd echo
npm install
npm run dev
```

WASM glue and model assets are hosted at `tap.bier.sh`. Models fetched on first load, cached in IndexedDB.

## Browser requirements

- WebGPU recommended (Chrome/Edge with WebGPU enabled, Safari Tech Preview). Falls back to WASM where unavailable.
- SharedArrayBuffer required for qwen3-asr.wasm. Needs COOP/COEP headers in production.
- ~1.5 GB of free RAM. Desktop only.

## License

MIT
