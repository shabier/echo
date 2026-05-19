import { useCallback, useEffect, useRef, useState } from "react";
import type { KokoroTTS } from "kokoro-js";
import { TTS_MODEL } from "../config";
import { chunkProse } from "./segment";
import { stripMarkdownInline } from "./prompts";

export type NarratorPhase = "idle" | "loading" | "ready" | "narrating" | "error";

export interface NarrationVoices {
  narrator: string;
  dialogue: string;
}

interface QueueItem {
  idx: number;
  // Tag identifying which logical block this item belongs to (a beat id, or
  // a synthetic marker for the chosen-choice transition). Lets the reader
  // filter the highlight to "current beat only".
  groupId: string;
  // Sentence index within the source block this chunk came from. Multiple
  // chunks may share a sentenceIdx (sub-sentence voice split).
  sentenceIdx: number;
  text: string;
  voice: string;
  isDialogue: boolean;
  // Per-chunk speed modulation. Short clipped sentences faster, ellipses
  // slower, otherwise neutral. Cheap heuristic, no LLM tagging needed.
  speed: number;
  url: string | null;
  duration: number;
  generated: boolean;
  generating: boolean;
  // Set to true when kokoro couldn't synthesize this chunk. advance() skips
  // failed items rather than stalling forever waiting for them.
  failed: boolean;
}

export type VoiceRole = "narrator" | "dialogue" | "idle";

interface State {
  phase: NarratorPhase;
  device: "webgpu" | "wasm" | null;
  // Queue index of the chunk currently playing.
  currentIdx: number;
  // groupId + sentenceIdx of the currently-playing chunk. Drives the
  // sentence-level highlight in the reader.
  currentGroupId: string | null;
  currentSentenceIdx: number;
  // Whether the active chunk is dialogue or narration. Lets the reader show
  // an Eleven-Labs-style voice presence indicator that swaps with each line.
  currentVoiceRole: VoiceRole;
  // Total chunks in the active narration.
  total: number;
  isPlaying: boolean;
  ended: boolean;
  error: string;
  lastDurationMs: number;
  lastElapsedMs: number;
}

const initialState: State = {
  phase: "idle",
  device: null,
  currentIdx: -1,
  currentGroupId: null,
  currentSentenceIdx: -1,
  currentVoiceRole: "idle",
  total: 0,
  isPlaying: false,
  ended: false,
  error: "",
  lastDurationMs: 0,
  lastElapsedMs: 0,
};

// Audiobook convention: narrator reads more deliberately than dialogue, which
// is where the pace lifts. Per the kokoro model card, 0.95–1.05 is the
// "natural" band; reserve excursions for explicit emotional beats.
function speedFor(text: string, isDialogue: boolean): number {
  const base = isDialogue ? 1.04 : 1.0;
  const t = text.trim();
  // Heavy emotion / dread / finality — slow it down.
  if (/…|\.{3,}/.test(t)) return base * 0.9;
  // Action beats — short clipped sentences with a punchy terminator.
  if (/[!?]["']?\s*$/.test(t) && t.length < 80) return base * 1.1;
  // Short throwaway lines — slight lift.
  if (t.length < 50) return base * 1.05;
  // Long, weighty clauses — slight settle.
  if (t.length > 180) return base * 0.94;
  return base;
}

// Deterministic ±~2% playbackRate jitter so two adjacent sentences never sit
// at the same exact pitch+pace. Breaks the "robotic flat narrator" feel for
// nearly free. Hash the text so re-renders are stable (the same sentence
// always gets the same nudge).
function jitterFor(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  // Map hash to [-1, 1) then to ±0.02.
  const norm = ((h >>> 0) / 0xffffffff) * 2 - 1;
  return 1 + norm * 0.02;
}

// Kokoro reads quote marks as audible micro-pauses that lean into the
// narrator's prosody. Strip them on dialogue chunks so the pure line plays.
function stripDialogueQuotes(text: string): string {
  return text.trim().replace(/^["']+|["']+$/g, "").trim();
}

export function useNarrator() {
  const [state, setState] = useState<State>(initialState);
  const ttsRef = useRef<KokoroTTS | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const playIdxRef = useRef<number>(-1);
  const cancelRef = useRef<boolean>(false);
  // Explicit "advance is waiting for queue[i] to finish generating" signal.
  // Kicked by primeQueue() when item i lands. Replaces the old reliance on
  // audio.paused/ended state — those flags also fire during the 180ms
  // voice-change setTimeout and cause spurious advance() calls (skip-ahead
  // and replay artifacts).
  const waitingForRef = useRef<number | null>(null);
  // True when advance ran out of queue and is parked at end-of-queue.
  // appendNarration() uses this to decide whether to kick playback.
  const queueEndedRef = useRef<boolean>(false);

  // Master-bus warmth chain. Once routed, every chunk plays through:
  //   HPF 100Hz → high-shelf -2dB @ 8kHz → peaking +1dB @ 3kHz → 2:1 comp.
  // Cheap, set-once, replaces the "dry, sterile, AI-out-of-the-tin" feel
  // with something closer to a properly produced audiobook track.
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;

    let ctx: AudioContext | null = null;
    try {
      ctx = new Ctx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaElementSource(audio);
      const hpf = ctx.createBiquadFilter();
      hpf.type = "highpass";
      hpf.frequency.value = 100;
      const shelf = ctx.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 8000;
      shelf.gain.value = -2;
      const presence = ctx.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.value = 3000;
      presence.Q.value = 1;
      presence.gain.value = 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 2;
      comp.attack.value = 0.005;
      comp.release.value = 0.12;
      comp.knee.value = 6;

      source.connect(hpf);
      hpf.connect(shelf);
      shelf.connect(presence);
      presence.connect(comp);
      comp.connect(ctx.destination);
    } catch (e) {
      console.warn("[narrator] master bus setup failed:", e);
    }

    return () => {
      audio.pause();
      // Revoke any pending blob URLs — accumulates ~50KB-300KB per chunk
      // otherwise. stop() handles this for in-session resets, but unmount
      // (navigate to library, refresh) needs its own sweep.
      queueRef.current.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
      audioRef.current = null;
      void ctx?.close();
      audioCtxRef.current = null;
    };
  }, []);

  const load = useCallback(async () => {
    if (state.phase === "loading" || state.phase === "ready") return;
    setState((s) => ({ ...s, phase: "loading", error: "" }));
    try {
      const { KokoroTTS } = await import("kokoro-js");
      const transformers = await import("@huggingface/transformers");
      transformers.env.allowLocalModels = false;
      if (transformers.env.backends.onnx.wasm) {
        transformers.env.backends.onnx.wasm.numThreads =
          navigator.hardwareConcurrency || 4;
      }

      let tts: KokoroTTS | null = null;
      let device: "webgpu" | "wasm" = "wasm";
      const hasWebGPU = "gpu" in navigator;
      if (hasWebGPU) {
        try {
          tts = await KokoroTTS.from_pretrained(TTS_MODEL.id, {
            dtype: "fp32",
            device: "webgpu",
          });
          device = "webgpu";
        } catch (e) {
          console.warn("[narrator] WebGPU failed:", e);
        }
      }
      if (!tts) {
        tts = await KokoroTTS.from_pretrained(TTS_MODEL.id, {
          dtype: "q8",
          device: "wasm",
        });
        device = "wasm";
      }
      ttsRef.current = tts;
      setState((s) => ({ ...s, phase: "ready", device }));
    } catch (e) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: e instanceof Error ? e.message : "Narrator load failed",
      }));
    }
  }, [state.phase]);

  const stop = useCallback(() => {
    cancelRef.current = true;
    audioRef.current?.pause();
    queueRef.current.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
    });
    queueRef.current = [];
    playIdxRef.current = -1;
    waitingForRef.current = null;
    queueEndedRef.current = false;
    setState((s) => ({
      ...s,
      isPlaying: false,
      currentIdx: -1,
      currentGroupId: null,
      currentSentenceIdx: -1,
      currentVoiceRole: "idle",
      ended: false,
    }));
  }, []);

  // Prime the next item in the queue (skips already-generated/in-flight).
  // Async, fires-and-forgets, posts results back into queueRef and triggers a
  // playback advance if the player was waiting on it.
  const primeQueue = useCallback(() => {
    const tts = ttsRef.current;
    if (!tts) return;
    const queue = queueRef.current;
    type GenerateOpts = NonNullable<Parameters<KokoroTTS["generate"]>[1]>;
    type VoiceId = NonNullable<GenerateOpts["voice"]>;

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.generated || item.generating) continue;
      // Only prime one ahead of the current playhead — keeps memory bounded
      // and gets the first sentence playing as fast as possible.
      const ahead = i - Math.max(playIdxRef.current, 0);
      if (ahead > 2) break;

      item.generating = true;
      void (async () => {
        try {
          const t0 = performance.now();
          const audio = await tts.generate(item.text, {
            voice: item.voice as VoiceId,
            speed: item.speed,
          });
          if (cancelRef.current) return;
          const wav = audio.toWav();
          const blob = wav instanceof Blob ? wav : new Blob([wav], { type: "audio/wav" });
          item.url = URL.createObjectURL(blob);
          item.duration = audio.audio.length / audio.sampling_rate;
          item.generated = true;
          item.generating = false;
          const elapsed = performance.now() - t0;
          setState((s) => ({
            ...s,
            lastElapsedMs: elapsed,
            lastDurationMs: item.duration * 1000,
          }));
          // Only kick playback if advance() was explicitly waiting for this
          // exact index. Avoids triggering on stale state during the 180ms
          // voice-change setTimeout window (which would skip ahead) or
          // re-triggering a still-playing chunk (which would replay).
          if (waitingForRef.current === i) {
            waitingForRef.current = null;
            advance();
          }
          // Continue priming subsequent items.
          primeQueue();
        } catch (e) {
          item.generating = false;
          item.failed = true;
          console.warn("[narrator] generate failed:", e);
          // If advance() was waiting on this exact index, kick it forward —
          // it will skip past the failed chunk rather than hang.
          if (waitingForRef.current === i) {
            waitingForRef.current = null;
            advance();
          }
          primeQueue();
        }
      })();
      // Limit to one in-flight at a time to avoid CPU/GPU thrash.
      break;
    }
  }, []);

  const advance = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const queue = queueRef.current;
    // Skip past any failed chunks. Advances the playhead silently rather
    // than parking on a chunk kokoro couldn't synthesize.
    let next = playIdxRef.current + 1;
    while (next < queue.length && queue[next].failed) {
      next++;
    }
    if (next >= queue.length) {
      // Reached the end of the queue. Leave playIdxRef at the last played
      // index so a future appendNarration() resumes from the right spot.
      queueEndedRef.current = true;
      waitingForRef.current = null;
      setState((s) => ({ ...s, isPlaying: false, ended: true, currentIdx: queue.length - 1 }));
      return;
    }
    const item = queue[next];
    if (!item.generated || !item.url) {
      // Wait for primer to finish; primeQueue will call advance when ready.
      playIdxRef.current = next - 1;
      waitingForRef.current = next;
      setState((s) => ({ ...s, isPlaying: false, currentIdx: next }));
      primeQueue();
      return;
    }
    waitingForRef.current = null;
    queueEndedRef.current = false;
    playIdxRef.current = next;
    setState((s) => ({
      ...s,
      currentIdx: next,
      currentGroupId: item.groupId,
      currentSentenceIdx: item.sentenceIdx,
      currentVoiceRole: item.isDialogue ? "dialogue" : "narrator",
      isPlaying: true,
      ended: false,
    }));
    audio.src = item.url;
    audio.currentTime = 0;
    // Subtle per-sentence pitch+pace nudge so adjacent lines never sit at
    // the same exact frequency. Couples pitch and rate (it's playbackRate,
    // not a phase vocoder) but the variation is small enough to read as
    // organic, not chipmunked.
    audio.playbackRate = jitterFor(item.text);
    // Audiobook convention: ~180ms of room tone on speaker change so the splice
    // doesn't read as a jump cut. No crossfade — pros never crossfade.
    const prev = next > 0 ? queue[next - 1] : null;
    const voiceChanged = !!prev && prev.voice !== item.voice;
    const startDelay = voiceChanged ? 180 : 0;
    // Browsers gate AudioContext until first user gesture; resume is a no-op
    // otherwise. Keeps the master bus alive for subsequent chunks.
    void audioCtxRef.current?.resume?.();
    if (startDelay > 0) {
      window.setTimeout(() => audio.play().catch(() => {}), startDelay);
    } else {
      audio.play().catch(() => {});
    }
    primeQueue();
  }, [primeQueue]);

  // Wire audio events once.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => advance();
    const onPlay = () => setState((s) => ({ ...s, isPlaying: true }));
    const onPause = () => setState((s) => ({ ...s, isPlaying: false }));
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [advance]);

  const buildQueueItem = (
    chunk: { text: string; isDialogue: boolean; sentenceIdx: number },
    idx: number,
    voices: NarrationVoices,
    groupId: string,
  ): QueueItem => {
    const cleaned = chunk.isDialogue
      ? stripDialogueQuotes(chunk.text)
      : chunk.text;
    return {
      idx,
      groupId,
      sentenceIdx: chunk.sentenceIdx,
      // Kokoro reads asterisks and other markdown literally; strip them so the
      // reader's <em>/<strong> styling carries the emphasis instead.
      text: stripMarkdownInline(cleaned),
      voice: chunk.isDialogue ? voices.dialogue : voices.narrator,
      isDialogue: chunk.isDialogue,
      speed: speedFor(cleaned, chunk.isDialogue),
      url: null,
      duration: 0,
      generated: false,
      generating: false,
      failed: false,
    };
  };

  const narrate = useCallback(
    async (text: string, voices: NarrationVoices, groupId: string) => {
      stop();
      cancelRef.current = false;
      if (!ttsRef.current) await load();
      if (!ttsRef.current) return;

      const chunks = chunkProse(text);
      const queue: QueueItem[] = chunks.map((c, idx) =>
        buildQueueItem(c, idx, voices, groupId),
      );
      queueRef.current = queue;
      playIdxRef.current = -1;
      setState((s) => ({
        ...s,
        phase: "narrating",
        currentIdx: -1,
        currentGroupId: null,
        currentSentenceIdx: -1,
        total: queue.length,
        isPlaying: false,
        ended: false,
        error: "",
      }));
      primeQueue();
      // Kick playback as soon as the first item is ready (advance handles
      // waiting if it isn't).
      advance();
    },
    [advance, load, primeQueue, stop],
  );

  // Extend the live queue with more text in the same narration session. Used
  // when the user picks a choice and we want narration to continue seamlessly
  // through the chosen line into the next beat — no stop, no restart.
  const appendNarration = useCallback(
    (text: string, voices: NarrationVoices, groupId: string) => {
      const queue = queueRef.current;
      const startIdx = queue.length;
      const chunks = chunkProse(text);
      for (let i = 0; i < chunks.length; i++) {
        queue.push(buildQueueItem(chunks[i], startIdx + i, voices, groupId));
      }
      setState((s) => ({
        ...s,
        phase: "narrating",
        total: queue.length,
        ended: false,
      }));
      primeQueue();
      // Only kick advance when we'd genuinely parked at end-of-queue. Don't
      // fire mid-stream — playback is already in flight or about to start
      // (e.g. waiting on prime, or in the 180ms voice-change setTimeout).
      if (queueEndedRef.current) {
        queueEndedRef.current = false;
        advance();
      }
    },
    [advance, primeQueue],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  // Synchronous getter so callers can record the queue index for a chunk they
  // are about to append, without racing the setState batch.
  const getQueueLength = useCallback(() => queueRef.current.length, []);

  return {
    ...state,
    load,
    narrate,
    appendNarration,
    stop,
    togglePlay,
    getQueueLength,
  };
}
