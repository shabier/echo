import { useCallback, useRef, useState } from "react";
import type { KokoroTTS } from "kokoro-js";
import { TTS_MODEL } from "../config";

export type TTSPhase = "idle" | "loading" | "ready" | "generating" | "error";

interface State {
  phase: TTSPhase;
  status: string;
  voices: string[];
  error: string;
  device: "webgpu" | "wasm" | null;
  lastElapsedMs: number;
  lastDurationMs: number;
}

const initialState: State = {
  phase: "idle",
  status: "",
  voices: [],
  error: "",
  device: null,
  lastElapsedMs: 0,
  lastDurationMs: 0,
};

export function useTTS() {
  const [state, setState] = useState<State>(initialState);
  const ttsRef = useRef<KokoroTTS | null>(null);

  const load = useCallback(async () => {
    if (state.phase === "loading" || state.phase === "ready") return;
    setState((s) => ({ ...s, phase: "loading", status: "Loading model...", error: "" }));
    try {
      const { KokoroTTS } = await import("kokoro-js");
      const transformers = await import("@huggingface/transformers");
      transformers.env.allowLocalModels = false;
      if (transformers.env.backends.onnx.wasm) {
        transformers.env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;
      }

      let tts: KokoroTTS | null = null;
      let device: "webgpu" | "wasm" = "wasm";
      const hasWebGPU = "gpu" in navigator;
      if (hasWebGPU) {
        try {
          tts = await KokoroTTS.from_pretrained(TTS_MODEL.id, { dtype: "fp32", device: "webgpu" });
          device = "webgpu";
        } catch (e) {
          console.warn("[tts] WebGPU failed:", e);
          tts = null;
        }
      }
      if (!tts) {
        tts = await KokoroTTS.from_pretrained(TTS_MODEL.id, { dtype: "q8", device: "wasm" });
        device = "wasm";
      }
      ttsRef.current = tts;
      setState((s) => ({ ...s, phase: "ready", voices: Object.keys(tts!.voices), status: "", device }));
    } catch (e) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: e instanceof Error ? e.message : "TTS load failed",
      }));
    }
  }, [state.phase]);

  const speak = useCallback(
    async (
      text: string,
      voice: string = TTS_MODEL.defaultVoice,
    ): Promise<{ url: string; duration: number; elapsedMs: number } | null> => {
      const tts = ttsRef.current;
      if (!tts || !text.trim()) return null;
      setState((s) => ({ ...s, phase: "generating", error: "" }));
      type GenerateOpts = NonNullable<Parameters<KokoroTTS["generate"]>[1]>;
      type VoiceId = NonNullable<GenerateOpts["voice"]>;
      try {
        const t0 = performance.now();
        const audio = await tts.generate(text, { voice: voice as VoiceId });
        const elapsed = performance.now() - t0;
        const wav = audio.toWav();
        const blob = wav instanceof Blob ? wav : new Blob([wav], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const duration = audio.audio.length / audio.sampling_rate;
        setState((s) => ({
          ...s,
          phase: "ready",
          lastElapsedMs: elapsed,
          lastDurationMs: duration * 1000,
        }));
        return { url, duration, elapsedMs: elapsed };
      } catch (e) {
        setState((s) => ({
          ...s,
          phase: "error",
          error: e instanceof Error ? e.message : "TTS generation failed",
        }));
        return null;
      }
    },
    [],
  );

  return { ...state, load, speak };
}
