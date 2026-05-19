import { useCallback, useState } from "react";
import { useLLM } from "../llm/useLLM";
import { segmentSentences } from "./segment";
import type { Seed } from "./seeds";
import type { Beat } from "./types";
import {
  BEAT_SYSTEM_PROMPT,
  CHOICES_ONLY_SYSTEM_PROMPT,
  CHOICES_RETRY_SYSTEM_PROMPT,
  buildBeatUserMessage,
  dedupeChoices,
  normalizeForTTS,
  parseBeat,
} from "./prompts";

export type BeatGenPhase = "idle" | "generating" | "ready" | "error";

export interface BeatGenResult {
  text: string;
  choices: string[];
  rawText: string;
}

export interface BeatGenCallbacks {
  // Fires once per sentence as the LLM streams. Lets the caller pipeline
  // narration into the live audio queue before generation completes.
  onSentence?: (sentence: string) => void;
}

interface State {
  phase: BeatGenPhase;
  // Live prose for the UI — stops growing once we detect numbered choice lines.
  visibleText: string;
  error: string;
}

// Accept whatever distinct choices the model produced. The retry path
// (CHOICES_RETRY_SYSTEM_PROMPT) doubles end-to-end latency for what is often
// the same collapse, since a small model that produced duplicates once tends
// to do so again. Better to ship a slightly-thin choice rack than to stall
// the loop. If we get *zero* unique choices, the rack hides and the user
// taps the play/library — still preferable to a 30s freeze.
const MIN_DISTINCT_CHOICES = 1;
// 70-110 word prose + 3 short choices comfortably fits in 240 tokens.
const BEAT_MAX_TOKENS = 240;
const CHOICES_MAX_TOKENS = 120;

export function useBeatGenerator(llm: ReturnType<typeof useLLM>) {
  const [state, setState] = useState<State>({
    phase: "idle",
    visibleText: "",
    error: "",
  });

  // Wrap llm.generate in a promise so we can compose retries. Rejects on
  // worker error so awaiting callers don't hang forever.
  const callLLM = useCallback(
    (
      systemPrompt: string,
      userMsg: string,
      maxTokens: number,
      onToken?: (buffer: string) => void,
    ): Promise<string> => {
      return new Promise((resolve, reject) => {
        let buffer = "";
        llm.generate(
          systemPrompt,
          [{ role: "user", content: userMsg }],
          {
            onToken: (t) => {
              buffer += t;
              onToken?.(buffer);
            },
            onDone: (text) => resolve(text || buffer),
            onError: (err) => reject(new Error(err)),
          },
          maxTokens,
        );
      });
    },
    [llm],
  );

  const retryChoices = useCallback(
    async (proseSoFar: string): Promise<string[]> => {
      const userMsg = `${proseSoFar}\n\n(The previous attempt produced near-identical choices. Now write 3 clearly distinct ones.)`;
      const raw = await callLLM(CHOICES_RETRY_SYSTEM_PROMPT, userMsg, CHOICES_MAX_TOKENS);
      const parsed = parseBeat(raw);
      return dedupeChoices(parsed.choices).slice(0, 3);
    },
    [callLLM],
  );

  const generateBeat = useCallback(
    async (
      seed: Seed,
      beats: Beat[],
      callbacks?: BeatGenCallbacks,
    ): Promise<BeatGenResult> => {
      if (llm.phase !== "ready") {
        const err = "LLM not ready";
        setState({ phase: "error", visibleText: "", error: err });
        throw new Error(err);
      }
      setState({ phase: "generating", visibleText: "", error: "" });

      const userMsg = buildBeatUserMessage(seed, beats);
      let inChoices = false;
      let emittedSentenceCount = 0;
      let cachedProse = "";

      const tryEmitSentences = (proseBuffer: string, isFinal: boolean) => {
        if (!callbacks?.onSentence) return;
        const segments = segmentSentences(proseBuffer);
        // While streaming, hold back the trailing segment in case it's still
        // mid-sentence. On final flush, emit everything.
        const safeUntil = isFinal ? segments.length : segments.length - 1;
        for (let i = emittedSentenceCount; i < safeUntil; i++) {
          callbacks.onSentence?.(segments[i]);
        }
        emittedSentenceCount = Math.max(emittedSentenceCount, safeUntil);
      };

      try {
        const raw = await callLLM(BEAT_SYSTEM_PROMPT, userMsg, BEAT_MAX_TOKENS, (buffer) => {
          // Detect transition into numbered choices and freeze prose at that cut.
          if (!inChoices) {
            const cutIdx = buffer.search(/\n\s*1[.)]\s/);
            if (cutIdx >= 0) {
              inChoices = true;
              cachedProse = buffer.slice(0, cutIdx).trim();
              setState((s) => ({ ...s, visibleText: cachedProse }));
              tryEmitSentences(cachedProse, true);
              return;
            }
            cachedProse = buffer;
            setState((s) => ({ ...s, visibleText: cachedProse }));
            tryEmitSentences(cachedProse, false);
          }
        });

        const parsed = parseBeat(raw);
        const cleanText = normalizeForTTS(parsed.text);
        // If we never saw the choices marker mid-stream, emit any final pending
        // sentence now.
        if (!inChoices) tryEmitSentences(cleanText, true);

        let unique = dedupeChoices(parsed.choices).slice(0, 3);
        if (unique.length < MIN_DISTINCT_CHOICES && cleanText) {
          const retried = await retryChoices(cleanText);
          if (retried.length > unique.length) unique = retried;
        }

        setState({ phase: "ready", visibleText: cleanText, error: "" });
        return { text: cleanText, choices: unique, rawText: raw };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Beat generation failed";
        setState({ phase: "error", visibleText: cachedProse, error: message });
        throw e;
      }
    },
    [llm, callLLM, retryChoices],
  );

  const generateChoicesForOpener = useCallback(
    async (seed: Seed, beats: Beat[]): Promise<string[]> => {
      if (llm.phase !== "ready") throw new Error("LLM not ready");
      setState({ phase: "generating", visibleText: "", error: "" });
      const userMsg = buildBeatUserMessage(seed, beats);
      try {
        const raw = await callLLM(CHOICES_ONLY_SYSTEM_PROMPT, userMsg, CHOICES_MAX_TOKENS);
        const parsed = parseBeat(raw);
        let unique = dedupeChoices(parsed.choices).slice(0, 3);
        if (unique.length < MIN_DISTINCT_CHOICES) {
          const retried = await retryChoices(beats[0].text);
          if (retried.length > unique.length) unique = retried;
        }
        setState({ phase: "ready", visibleText: "", error: "" });
        return unique;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Choice generation failed";
        setState({ phase: "error", visibleText: "", error: message });
        throw e;
      }
    },
    [llm, callLLM, retryChoices],
  );

  const reset = useCallback(() => {
    setState({ phase: "idle", visibleText: "", error: "" });
  }, []);

  return { ...state, generateBeat, generateChoicesForOpener, reset };
}
