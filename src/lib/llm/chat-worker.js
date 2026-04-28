/**
 * Chat Web Worker
 * Adapted from io/src/tools/text/summarize-worker.js for multi-turn chat.
 * Each generate() call rebuilds the full chat-template prompt and streams tokens.
 */

let Module = null;
let modelLoaded = false;
let abortFlag = false;

const EXPECTED_MODEL_SIZE = 507_000_000;

self.onmessage = async function (e) {
  const { type, data } = e.data;
  switch (type) {
    case "init":
      await handleInit(data);
      break;
    case "generate":
      handleGenerate(data);
      break;
    case "abort":
      abortFlag = true;
      break;
  }
};

async function handleInit({ wasmBaseUrl, modelParts, cacheKey, contextWindow }) {
  try {
    self.postMessage({ type: "status", message: "Loading WASM module..." });

    const glueUrl = wasmBaseUrl + "llama-wasm.js";
    const glueResp = await fetch(glueUrl);
    const glueBlob = new Blob([await glueResp.text()], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(glueBlob);
    importScripts(blobUrl);

    Module = await createLlama({
      locateFile: (path) => wasmBaseUrl + path,
      mainScriptUrlOrBlob: blobUrl,
      print: (text) => self.postMessage({ type: "log", message: text }),
      printErr: (text) => self.postMessage({ type: "log", message: text }),
    });

    const CACHE_NAME = "llama-models";
    let modelData = null;

    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      if (cached) {
        self.postMessage({ type: "cache-hit" });
        const buf = await cached.arrayBuffer();
        modelData = new Uint8Array(buf);
      }
    } catch (e) {
      self.postMessage({ type: "log", message: "Cache API check failed: " + e.message });
    }

    if (!modelData) {
      self.postMessage({ type: "status", message: "Downloading model..." });
      const total = EXPECTED_MODEL_SIZE;
      const allChunks = [];
      let loaded = 0;
      for (const partUrl of modelParts) {
        const response = await fetch(partUrl);
        if (!response.ok) throw new Error(`Fetch failed: ${response.status} for ${partUrl}`);
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          allChunks.push(value);
          loaded += value.length;
          self.postMessage({ type: "download-progress", loaded, total });
        }
      }

      modelData = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of allChunks) {
        modelData.set(chunk, offset);
        offset += chunk.length;
      }

      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(cacheKey, new Response(modelData.buffer, {
          headers: { "content-type": "application/octet-stream" },
        }));
      } catch (e) {
        self.postMessage({ type: "log", message: "Cache write failed: " + e.message });
      }
    }

    self.postMessage({ type: "status", message: "Loading model..." });
    Module.FS.writeFile("/model.gguf", modelData);
    Module.loadModel("/model.gguf", contextWindow || 4096);
    Module.FS.unlink("/model.gguf");

    modelLoaded = true;
    self.postMessage({ type: "init-done" });
  } catch (err) {
    self.postMessage({ type: "error", message: "Init failed: " + err.message });
  }
}

// Qwen3 non-thinking prefix. Same wrapper on every assistant turn. Drop it from
// past turns and the model loses prior context across the conversation.
const ASSISTANT_PREFIX = "<|im_start|>assistant\n<think>\n\n</think>\n\n";

function buildChatPrompt(systemPrompt, messages) {
  let prompt = "";
  if (systemPrompt) {
    prompt += `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;
  }
  for (const m of messages) {
    if (m.role === "user") {
      prompt += `<|im_start|>user\n${m.content}<|im_end|>\n`;
    } else if (m.role === "assistant") {
      prompt += `${ASSISTANT_PREFIX}${m.content}<|im_end|>\n`;
    }
  }
  prompt += ASSISTANT_PREFIX;
  return prompt;
}

function handleGenerate({ systemPrompt, messages, maxTokens }) {
  if (!modelLoaded) {
    self.postMessage({ type: "error", message: "Model not loaded" });
    return;
  }

  abortFlag = false;
  const prompt = buildChatPrompt(systemPrompt, messages);
  const tokens = Module.tokenize(prompt);
  if (tokens > 3500) {
    self.postMessage({
      type: "error",
      message: `Prompt too long (${tokens} tokens). Trim transcript or earlier turns.`,
    });
    return;
  }

  Module.resetContext();
  const ok = Module.decodePrompt(prompt);
  if (!ok) {
    self.postMessage({ type: "error", message: "Failed to decode prompt" });
    return;
  }

  const limit = maxTokens || 512;
  let result = "";
  let tokenCount = 0;
  const startTime = performance.now();

  for (let i = 0; i < limit; i++) {
    if (abortFlag) {
      self.postMessage({
        type: "generate-done",
        text: result,
        tokenCount,
        elapsed: performance.now() - startTime,
        aborted: true,
      });
      return;
    }
    const token = Module.generateToken();
    if (!token) break;
    result += token;
    tokenCount++;
    self.postMessage({ type: "token", token });
  }

  self.postMessage({
    type: "generate-done",
    text: result,
    tokenCount,
    elapsed: performance.now() - startTime,
    aborted: false,
  });
}
