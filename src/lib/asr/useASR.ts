import { useCallback, useEffect, useRef, useState } from "react";
import { ASR_MODEL, ASR_SAMPLE_RATE, WASM_BASE } from "../config";

export type ASRPhase = "idle" | "loading" | "ready" | "transcribing" | "done" | "error";

export interface ASRSegment {
  start: number;
  end: number;
  text: string;
}

export interface ASRResult {
  text: string;
  language: string;
  segments: ASRSegment[];
  totalMs: number;
}

interface State {
  phase: ASRPhase;
  status: string;
  downloadPct: number;
  fromCache: boolean;
  error: string;
  result: ASRResult | null;
  chunkProgress: { chunk: number; total: number } | null;
}

const initialState: State = {
  phase: "idle",
  status: "",
  downloadPct: 0,
  fromCache: false,
  error: "",
  result: null,
  chunkProgress: null,
};

export function useASR() {
  const [state, setState] = useState<State>(initialState);
  const workerRef = useRef<Worker | null>(null);
  const segmentsRef = useRef<ASRSegment[]>([]);

  useEffect(() => {
    const worker = new Worker(
      new URL("./transcribe-worker.js", import.meta.url),
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
          console.log("[asr]", d.message);
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
        case "transcribe-start":
          segmentsRef.current = [];
          setState((s) => ({ ...s, result: null }));
          break;
        case "transcribe-progress":
          if (d.phase === "chunk-done" && d.chunkText) {
            const seg: ASRSegment = {
              start: d.chunkStart,
              end: d.chunkEnd,
              text: d.chunkText.trim(),
            };
            segmentsRef.current = [...segmentsRef.current, seg];
            setState((s) => ({
              ...s,
              chunkProgress: { chunk: d.chunk, total: d.numChunks },
            }));
          }
          break;
        case "transcribe-done": {
          const r = d.result;
          setState((s) => ({
            ...s,
            phase: "done",
            chunkProgress: null,
            result: {
              text: r.text,
              language: r.language || "",
              segments: segmentsRef.current,
              totalMs: r.t_total_ms,
            },
          }));
          break;
        }
        case "error":
          setState((s) => ({ ...s, phase: "error", error: d.message }));
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
      data: { wasmBaseUrl: WASM_BASE, modelUrl: ASR_MODEL.url },
    });
  }, []);

  const transcribe = useCallback((samples: Float32Array) => {
    if (!workerRef.current) return;
    setState((s) => ({ ...s, phase: "transcribing", error: "", result: null }));
    const copy = new Float32Array(samples);
    workerRef.current.postMessage(
      { type: "transcribe", data: { samples: copy, maxTokens: 1024, nThreads: 4 } },
      [copy.buffer],
    );
  }, []);

  return { ...state, load, transcribe, sampleRate: ASR_SAMPLE_RATE };
}

/** Decode a File into Float32 PCM at the ASR sample rate (16 kHz mono). */
export async function decodeFileToPCM(file: File): Promise<{ samples: Float32Array; duration: number }> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: ASR_SAMPLE_RATE });
  try {
    const ab = await ctx.decodeAudioData(buf);
    return { samples: ab.getChannelData(0), duration: ab.duration };
  } finally {
    await ctx.close();
  }
}
