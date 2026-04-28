import { useCallback, useEffect, useRef, useState } from "react";
import { LLM_MODEL, WASM_BASE } from "../config";

export type LLMPhase = "idle" | "loading" | "ready" | "generating" | "error";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface State {
  phase: LLMPhase;
  status: string;
  downloadPct: number;
  fromCache: boolean;
  streamingText: string;
  error: string;
  lastElapsedMs: number;
  lastTokenCount: number;
}

const initialState: State = {
  phase: "idle",
  status: "",
  downloadPct: 0,
  fromCache: false,
  streamingText: "",
  error: "",
  lastElapsedMs: 0,
  lastTokenCount: 0,
};

export function useLLM() {
  const [state, setState] = useState<State>(initialState);
  const workerRef = useRef<Worker | null>(null);
  const onTokenRef = useRef<((token: string) => void) | null>(null);
  const onDoneRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("./chat-worker.js", import.meta.url),
      { type: "classic" },
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const d = e.data;
      switch (d.type) {
        case "status":
          setState((s) => ({ ...s, status: d.message }));
          break;
        case "log":
          console.log("[llm]", d.message);
          break;
        case "cache-hit":
          setState((s) => ({ ...s, fromCache: true }));
          break;
        case "download-progress": {
          const pct = d.total > 0 ? (d.loaded / d.total) * 100 : 0;
          setState((s) => ({ ...s, downloadPct: pct }));
          break;
        }
        case "init-done":
          setState((s) => ({ ...s, phase: "ready", status: "" }));
          break;
        case "token":
          setState((s) => ({ ...s, streamingText: s.streamingText + d.token }));
          onTokenRef.current?.(d.token);
          break;
        case "generate-done":
          setState((s) => ({
            ...s,
            phase: "ready",
            lastElapsedMs: d.elapsed,
            lastTokenCount: d.tokenCount,
          }));
          onDoneRef.current?.(d.text);
          onTokenRef.current = null;
          onDoneRef.current = null;
          break;
        case "error":
          setState((s) => ({ ...s, phase: "error", error: d.message }));
          onTokenRef.current = null;
          onDoneRef.current = null;
          break;
      }
    };

    worker.onerror = (e) => {
      setState((s) => ({ ...s, phase: "error", error: e.message || "Worker error" }));
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const load = useCallback(() => {
    setState((s) => ({ ...s, phase: "loading", error: "", downloadPct: 0, fromCache: false }));
    workerRef.current?.postMessage({
      type: "init",
      data: {
        wasmBaseUrl: WASM_BASE,
        modelParts: LLM_MODEL.parts,
        cacheKey: LLM_MODEL.cacheKey,
        contextWindow: LLM_MODEL.contextWindow,
      },
    });
  }, []);

  const generate = useCallback(
    (
      systemPrompt: string,
      messages: ChatMessage[],
      handlers?: { onToken?: (t: string) => void; onDone?: (text: string) => void },
      maxTokens = 512,
    ) => {
      if (!workerRef.current) return;
      setState((s) => ({ ...s, phase: "generating", streamingText: "", error: "" }));
      onTokenRef.current = handlers?.onToken ?? null;
      onDoneRef.current = handlers?.onDone ?? null;
      workerRef.current.postMessage({
        type: "generate",
        data: { systemPrompt, messages, maxTokens },
      });
    },
    [],
  );

  const abort = useCallback(() => {
    workerRef.current?.postMessage({ type: "abort" });
  }, []);

  return { ...state, load, generate, abort };
}
