/**
 * Qwen3-ASR Web Worker
 * Ported from io/src/tools/audio/transcribe-worker.js.
 * Runs WASM inference off the main thread, posts progress updates back.
 * Chunks long audio into 30s segments for memory-safe transcription.
 */

let Module = null;
let modelLoaded = false;

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 30;
const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE;
const EXPECTED_MODEL_SIZE = 767_867_648;

self.onmessage = async function (e) {
  const { type, data } = e.data;
  switch (type) {
    case "init":
      await handleInit(data);
      break;
    case "transcribe":
      handleTranscribe(data);
      break;
  }
};

async function handleInit({ wasmBaseUrl, modelUrl }) {
  try {
    self.postMessage({ type: "status", message: "Loading WASM module..." });

    const glueUrl = wasmBaseUrl + "qwen3-asr-wasm.js";
    const glueResp = await fetch(glueUrl);
    const glueBlob = new Blob([await glueResp.text()], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(glueBlob);
    importScripts(blobUrl);

    Module = await createQwen3ASR({
      locateFile: (path) => wasmBaseUrl + path,
      mainScriptUrlOrBlob: blobUrl,
      print: (text) => self.postMessage({ type: "log", message: text }),
      printErr: (text) => self.postMessage({ type: "log", message: text }),
    });

    const CACHE_NAME = "qwen3-asr-models";
    let response = null;

    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(modelUrl);
      if (cached) {
        self.postMessage({ type: "log", message: "Model found in local cache" });
        self.postMessage({ type: "cache-hit" });
        response = cached;
      }
    } catch (e) {
      self.postMessage({ type: "log", message: "Cache API check failed: " + e.message });
    }

    let shouldCache = false;
    if (!response) {
      self.postMessage({ type: "status", message: "Downloading model..." });
      response = await fetch(modelUrl);
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
      shouldCache = true;
    }

    const total = EXPECTED_MODEL_SIZE;
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      self.postMessage({ type: "download-progress", loaded, total });
    }

    const modelData = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      modelData.set(chunk, offset);
      offset += chunk.length;
    }

    if (shouldCache) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(modelUrl, new Response(modelData.buffer, {
          headers: { "content-type": "application/octet-stream" },
        }));
      } catch (e) {
        self.postMessage({ type: "log", message: "Cache write failed: " + e.message });
      }
    }

    self.postMessage({ type: "status", message: "Loading model..." });
    Module.FS.writeFile("/model.gguf", modelData);
    const ok = Module.loadModel("/model.gguf");
    Module.FS.unlink("/model.gguf");
    if (!ok) throw new Error("loadModel returned false");

    modelLoaded = true;
    self.postMessage({ type: "init-done" });
  } catch (err) {
    self.postMessage({ type: "error", message: "Init failed: " + err.message });
  }
}

function transcribeChunk(samples, maxTokens, nThreads) {
  const nSamples = samples.length;
  const ptr = Module.mallocFloatBuffer(nSamples);
  const heap = new Float32Array(Module.HEAPF32.buffer, ptr, nSamples);
  heap.set(samples);
  const threads = nThreads || (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4) || 4;
  const result = Module.transcribe(ptr, nSamples, maxTokens || 1024, threads);
  Module.freeFloatBuffer(ptr);
  return result;
}

function handleTranscribe({ samples, maxTokens, nThreads }) {
  if (!modelLoaded) {
    self.postMessage({ type: "error", message: "Model not loaded" });
    return;
  }

  const totalSamples = samples.length;
  const numChunks = Math.ceil(totalSamples / CHUNK_SAMPLES);
  self.postMessage({ type: "transcribe-start", nSamples: totalSamples, numChunks });

  let fullText = "";
  let totalTime = { mel: 0, encode: 0, decode: 0, total: 0 };
  let detectedLanguage = "";

  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SAMPLES;
    const end = Math.min(start + CHUNK_SAMPLES, totalSamples);
    const chunk = samples.slice(start, end);
    const chunkStart = start / SAMPLE_RATE;
    const chunkEnd = end / SAMPLE_RATE;

    self.postMessage({
      type: "transcribe-progress",
      phase: "chunk-start",
      chunk: i + 1,
      numChunks,
      chunkStart,
      chunkEnd,
      fullText,
    });

    const result = transcribeChunk(chunk, maxTokens, nThreads);
    if (!result.success) {
      self.postMessage({
        type: "error",
        message: `Chunk ${i + 1}/${numChunks} failed: ${result.error}`,
      });
      return;
    }

    if (result.text) fullText += (fullText ? " " : "") + result.text.trim();
    if (result.language && result.language !== "None") detectedLanguage = result.language;

    totalTime.mel += result.t_mel_ms;
    totalTime.encode += result.t_encode_ms;
    totalTime.decode += result.t_decode_ms;
    totalTime.total += result.t_total_ms;

    self.postMessage({
      type: "transcribe-progress",
      phase: "chunk-done",
      chunk: i + 1,
      numChunks,
      chunkStart,
      chunkEnd,
      chunkText: result.text,
      fullText,
    });
  }

  self.postMessage({
    type: "transcribe-done",
    result: {
      success: true,
      text: fullText,
      language: detectedLanguage,
      t_mel_ms: totalTime.mel,
      t_encode_ms: totalTime.encode,
      t_decode_ms: totalTime.decode,
      t_total_ms: totalTime.total,
    },
  });
}
