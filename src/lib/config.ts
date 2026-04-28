// CDN endpoints for wasm glue and model assets, matching io's hosting.
export const WASM_BASE = "https://tap.bier.sh/io/wasm/";
export const MODEL_BASE = "https://tap.bier.sh/io/models/";

// Qwen3-ASR 0.6B Q5_K_M. 16kHz mono PCM in, transcript out.
export const ASR_MODEL = {
  url: "https://huggingface.co/OpenVoiceOS/qwen3-asr-0.6b-q5-k-m/resolve/main/qwen3-asr-0.6b-q5_k_m.gguf",
  expectedSize: 767_867_648,
  cacheName: "qwen3-asr-models",
} as const;

// Qwen3.5 0.8B Q4_0. Split into 2 parts on the CDN, runs on llama-wasm (deltanet build).
export const LLM_MODEL = {
  parts: [
    `${MODEL_BASE}Qwen3.5-0.8B-Q4_0.gguf.part-aa`,
    `${MODEL_BASE}Qwen3.5-0.8B-Q4_0.gguf.part-ab`,
  ],
  cacheKey: "qwen3.5-0.8b-q4_0",
  cacheName: "llama-models",
  expectedSize: 507_000_000,
  contextWindow: 4096,
} as const;

// Kokoro 82M ONNX. Main-thread inference via kokoro-js.
export const TTS_MODEL = {
  id: "onnx-community/Kokoro-82M-v1.0-ONNX",
  defaultVoice: "af_heart",
  voiceCacheName: "kokoro-voices",
} as const;

export const ASR_SAMPLE_RATE = 16_000;
