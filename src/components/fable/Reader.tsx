import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Check, Share2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { useLLM } from "~/lib/llm/useLLM";
import { getSeed, type Seed } from "~/lib/fable/seeds";
import { segmentSentences } from "~/lib/fable/segment";
import { stripMarkdownInline } from "~/lib/fable/prompts";
import {
  appendBeat,
  getStory,
  newId,
  setBeatChoices,
  setChoiceForBeat,
} from "~/lib/fable/store";
import type { Story } from "~/lib/fable/types";
import { useBeatGenerator } from "~/lib/fable/useBeatGenerator";
import { useNarrator } from "~/lib/fable/useNarrator";
import { useHashRoute, formatRoute } from "~/lib/fable/useHashRoute";
import { playChoiceSting } from "~/lib/fable/sting";
import type { LLMMetrics, TTSMetrics } from "../MetricsBar";
import styles from "./Reader.module.scss";

interface Props {
  storyId: string;
  onLLMMetrics: (m: LLMMetrics) => void;
  onTTSMetrics: (m: TTSMetrics) => void;
}

const MAX_BEATS = 10;

export function Reader({ storyId, onLLMMetrics, onTTSMetrics }: Props) {
  const { navigate } = useHashRoute();
  const llm = useLLM();
  const narrator = useNarrator();
  const beatGen = useBeatGenerator(llm);

  const [story, setStory] = useState<Story | null>(null);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [error, setError] = useState("");
  const [generatingChoices, setGeneratingChoices] = useState(false);
  const [generatingNextBeat, setGeneratingNextBeat] = useState(false);
  const [shared, setShared] = useState(false);

  // Set of beat ids we've already routed to the narrator (whether by direct
  // narrate/append or by streaming sentences from generation). The narrate
  // effect re-fires on every render because `narrator` is a fresh object;
  // this set is what makes it idempotent across both already-played beats
  // and beats whose generation we've already started streaming.
  const narratedBeatsRef = useRef<Set<string>>(new Set());
  const generatedNextForRef = useRef<string | null>(null);
  const generatedChoicesForRef = useRef<string | null>(null);
  const stingPlayedForRef = useRef<string | null>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  // Step-by-step action log. Every visual or logical transition emits a line
  // so the sequence can be audited from the console without instrumenting
  // each touch point separately.
  const flog = useCallback((step: string, detail?: object) => {
    if (detail) console.info(`[fable] ${step}`, detail);
    else console.info(`[fable] ${step}`);
  }, []);
  // Speculative pre-generation cache, keyed by `${beatId}:${choiceIdx}`.
  // Filled in the background while the narrator reads the current beat; if
  // the user picks a choice we already speculated, the next beat lands with
  // zero wait. The single move that turns "competent" into "got it" per the
  // research — silence is the enemy.
  const speculativeCacheRef = useRef<Map<string, { text: string; choices: string[] }>>(
    new Map(),
  );
  const speculativeBeatIdRef = useRef<string | null>(null);
  const speculativeRunningRef = useRef<boolean>(false);
  // Bumped whenever storyId changes. In-flight async work captures the
  // session token at start and bails on commit if the token has moved on,
  // preventing a stale gen from writing to a different story or scrolling
  // an unmounted view.
  const sessionRef = useRef(0);
  // Hold the latest abort/stop functions in refs so the storyId-change
  // cleanup can call them without listing the unstable hook returns
  // (`llm`, `narrator`) as effect deps.
  const llmAbortRef = useRef(llm.abort);
  const narratorStopRef = useRef(narrator.stop);
  llmAbortRef.current = llm.abort;
  narratorStopRef.current = narrator.stop;

  // Always render the latest persisted beat as the current page. Earlier we
  // tried to defer the page-turn until the narrator left the :choice group
  // so the chosen choice could be visibly highlighted while it was read,
  // but that coupling made the visual unrecoverable if audio playback ever
  // stalled (the new beat was hidden behind a never-advancing index). The
  // loop reliability matters more than the brief narrating-highlight moment.
  const renderedBeatIdx = story ? story.beats.length - 1 : 0;
  const currentBeat = story?.beats[renderedBeatIdx] ?? null;
  const choicesReady = !!currentBeat && currentBeat.choices.length > 0;
  const isAwaitingPick =
    !!currentBeat && choicesReady && currentBeat.pickedChoiceIdx == null;
  const hasReachedMax = !!story && story.beats.length >= MAX_BEATS;
  // Choices fade in during the final sentences of narration, not after.
  // The user reads while listening — by the time the narrator finishes the
  // last line they're already ready to pick. Per the IF/audiobook research,
  // this kills the dead-air silence that murders pacing in this genre.
  const narrationNearingEnd =
    narrator.ended ||
    (narrator.phase === "narrating" &&
      narrator.total > 0 &&
      narrator.currentIdx >= narrator.total - 1 &&
      narrator.currentGroupId === currentBeat?.id);
  // No choices on the final beat — picking one would dead-end on "Fin"
  // because the next-beat effect bails at MAX_BEATS.
  const choicesVisible = isAwaitingPick && narrationNearingEnd && !hasReachedMax;

  // Load story + seed. Also bump the session token, reset gen guards, and
  // tear down any in-flight narration/LLM work from a previous story.
  useEffect(() => {
    sessionRef.current++;
    generatedNextForRef.current = null;
    generatedChoicesForRef.current = null;
    narratedBeatsRef.current = new Set();
    stingPlayedForRef.current = null;
    speculativeBeatIdRef.current = null;
    speculativeCacheRef.current = new Map();
    speculativeRunningRef.current = false;
    setNextBeatPreview("");
    setCommittedIdx(null);
    setUnpickedHidden(false);
    setError("");
    let cancelled = false;
    void (async () => {
      const s = await getStory(storyId);
      if (cancelled) return;
      if (!s) {
        setError("Story not found");
        return;
      }
      setStory(s);
      setSeed(getSeed(s.seedId) ?? null);
    })();
    return () => {
      cancelled = true;
      llmAbortRef.current();
      narratorStopRef.current();
    };
  }, [storyId]);

  // Kick off model loads as soon as we have a story.
  useEffect(() => {
    if (!story) return;
    if (llm.phase === "idle") llm.load();
    if (narrator.phase === "idle") narrator.load();
  }, [story, llm, narrator]);

  // Narrate the current beat. Opener starts fresh; subsequent beats append to
  // the live queue so playback flows through the chosen line into the new beat
  // without a hard stop/restart.
  useEffect(() => {
    if (!story || !seed || !currentBeat) return;
    if (narrator.phase !== "ready" && narrator.phase !== "narrating") return;
    if (narratedBeatsRef.current.has(currentBeat.id)) return;
    narratedBeatsRef.current.add(currentBeat.id);
    if (narrator.phase === "ready") {
      flog("narrate:fresh", { beatId: currentBeat.id, textLen: currentBeat.text.length });
      void narrator.narrate(currentBeat.text, seed.voices, currentBeat.id);
    } else {
      flog("narrate:append", { beatId: currentBeat.id, textLen: currentBeat.text.length });
      narrator.appendNarration(currentBeat.text, seed.voices, currentBeat.id);
    }
  }, [story, seed, currentBeat, narrator, flog]);

  // Generate choices for the opener (or any beat that arrived without them).
  useEffect(() => {
    if (!story || !seed || !currentBeat) return;
    if (currentBeat.choices.length > 0) return;
    if (llm.phase !== "ready") return;
    if (generatingChoices) return;
    if (generatedChoicesForRef.current === currentBeat.id) return;
    generatedChoicesForRef.current = currentBeat.id;
    setGeneratingChoices(true);
    const session = sessionRef.current;
    void (async () => {
      try {
        const labels = await beatGen.generateChoicesForOpener(seed, story.beats);
        if (sessionRef.current !== session) return;
        const updated = await setBeatChoices(
          story.id,
          currentBeat.id,
          labels.map((label) => ({ label })),
        );
        if (sessionRef.current !== session) return;
        setStory(updated);
      } catch (e) {
        if (sessionRef.current !== session) return;
        setError(e instanceof Error ? e.message : "Choice generation failed");
      } finally {
        if (sessionRef.current === session) setGeneratingChoices(false);
      }
    })();
  }, [story, seed, currentBeat, llm.phase, beatGen, generatingChoices]);

  // Speculative pre-generation is disabled until useLLM gets a proper
  // per-generation token (currently onTokenRef/onDoneRef are single-slot,
  // so overlapping calls clobber each other's resolvers — spec's onDone
  // can fire with real's handlers, returning the wrong branch's prose).
  // Real gen runs on pick (existing behavior). Re-enable once the worker
  // and useLLM echo gids end-to-end.

  // After a choice is picked, generate the next beat. We pre-allocate its id
  // and stream sentences into the narrator as they arrive from the LLM, so
  // narration starts within ~2-3s instead of waiting for the full beat.
  useEffect(() => {
    if (!story || !seed || !currentBeat) return;
    if (currentBeat.pickedChoiceIdx == null) return;
    if (story.beats.length >= MAX_BEATS) return;
    if (generatingNextBeat) return;
    if (llm.phase !== "ready") return;
    if (generatedNextForRef.current === currentBeat.id) return;
    generatedNextForRef.current = currentBeat.id;
    setGeneratingNextBeat(true);
    const nextBeatId = newId();
    // Claim the future beat id up-front so the narrate effect doesn't
    // re-queue it when the persisted beat lands. Streaming sentences are
    // already being routed through narrator.appendNarration with this id.
    narratedBeatsRef.current.add(nextBeatId);
    const pickedBeatId = currentBeat.id;
    const pickedIdx = currentBeat.pickedChoiceIdx;
    const session = sessionRef.current;
    speculativeBeatIdRef.current = null;
    flog("next-beat:start", {
      fromBeatId: pickedBeatId,
      pickedIdx,
      preallocatedId: nextBeatId,
    });
    void (async () => {
      try {
        const cacheKey = `${pickedBeatId}:${pickedIdx}`;
        const cached = speculativeCacheRef.current.get(cacheKey);
        let result: { text: string; choices: string[] };
        if (cached) {
          flog("next-beat:cache-hit", { cacheKey });
          result = cached;
          for (const sentence of segmentSentences(cached.text)) {
            if (sessionRef.current !== session) return;
            narrator.appendNarration(sentence, seed.voices, nextBeatId);
          }
          setNextBeatPreview(cached.text);
        } else {
          flog("llm:generate-start", { beatId: nextBeatId });
          let sentencesEmitted = 0;
          result = await beatGen.generateBeat(seed, story.beats, {
            onSentence: (sentence) => {
              if (sessionRef.current !== session) return;
              sentencesEmitted++;
              flog("llm:sentence", { n: sentencesEmitted, preview: sentence.slice(0, 60) });
              narrator.appendNarration(sentence, seed.voices, nextBeatId);
            },
          });
          flog("llm:generate-done", {
            beatId: nextBeatId,
            textLen: result.text.length,
            choices: result.choices.length,
          });
        }
        if (sessionRef.current !== session) return;
        const fresh = await getStory(story.id);
        if (sessionRef.current !== session) return;
        if (fresh) {
          const pickedIdx = fresh.beats.findIndex((b) => b.id === pickedBeatId);
          const successorAlreadyAppended =
            pickedIdx >= 0 && pickedIdx < fresh.beats.length - 1;
          if (successorAlreadyAppended) {
            flog("next-beat:dup-detected", { fresh: fresh.beats.length });
            setStory(fresh);
            return;
          }
        }
        const updated = await appendBeat(story.id, {
          id: nextBeatId,
          text: result.text,
          choices: result.choices.map((label) => ({ label })),
        });
        if (sessionRef.current !== session) return;
        flog("persist:beat-appended", {
          beatId: nextBeatId,
          totalBeats: updated.beats.length,
        });
        setStory(updated);
        setNextBeatPreview("");
        flog("state:current-beat-advanced", { newCurrentIdx: updated.beats.length - 1 });
      } catch (e) {
        if (sessionRef.current !== session) return;
        flog("next-beat:error", { message: e instanceof Error ? e.message : String(e) });
        setError(e instanceof Error ? e.message : "Beat generation failed");
      } finally {
        if (sessionRef.current === session) setGeneratingNextBeat(false);
      }
    })();
  }, [story, seed, currentBeat, llm.phase, beatGen, generatingNextBeat, narrator, flog]);

  // Surface metrics whenever the LLM/narrator post fresh numbers.
  useEffect(() => {
    if (llm.lastElapsedMs > 0) {
      onLLMMetrics({ tokens: llm.lastTokenCount, elapsedMs: llm.lastElapsedMs });
    }
  }, [llm.lastElapsedMs, llm.lastTokenCount, onLLMMetrics]);

  useEffect(() => {
    onTTSMetrics({
      device: narrator.device,
      elapsedMs: narrator.lastElapsedMs,
      durationMs: narrator.lastDurationMs,
    });
  }, [narrator.device, narrator.lastElapsedMs, narrator.lastDurationMs, onTTSMetrics]);

  const onShare = useCallback(async () => {
    if (!story || !seed) return;
    const path = story.beats
      .filter((b) => b.pickedChoiceIdx != null)
      .map((b) => b.pickedChoiceIdx!) as number[];
    const route = formatRoute({
      name: "seed",
      seedId: seed.id,
      replayPath: path.length ? path : undefined,
    });
    const url = `${window.location.origin}${window.location.pathname}#${route}`;
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      // Clipboard blocked — fall back to a prompt the user can copy from.
      window.prompt("Copy this link", url);
    }
  }, [story, seed]);

  // Committed-choice index for the ink-set animation. While set, the chosen
  // row shows the locked-in state and siblings fade. After ~360ms the real
  // commit fires. The animation IS the undo affordance — releasing or
  // clicking elsewhere within the window would cancel (not wired today,
  // but the affordance is read by users as "this is settling").
  const [committedIdx, setCommittedIdx] = useState<number | null>(null);
  // After ink-set + a short fade, the unpicked rows unmount entirely. The
  // chosen one stays mounted so the narrator can read it and the user has a
  // visual anchor for "what is being said right now."
  const [unpickedHidden, setUnpickedHidden] = useState(false);
  // Text of the in-flight next beat — used for the streaming preview during
  // the hold period. Set immediately on speculative-cache hit, or driven
  // by beatGen.visibleText during real-time streaming.
  const [nextBeatPreview, setNextBeatPreview] = useState("");
  useEffect(() => {
    if (currentBeat?.pickedChoiceIdx == null) {
      setUnpickedHidden(false);
      return;
    }
    const t = window.setTimeout(() => {
      setUnpickedHidden(true);
      flog("commit:unpicked-hidden", { beatId: currentBeat.id });
    }, 520);
    return () => window.clearTimeout(t);
  }, [currentBeat?.pickedChoiceIdx, currentBeat?.id, flog]);

  const onPickChoice = useCallback(
    async (idx: number) => {
      if (!story || !seed || !currentBeat || !isAwaitingPick) {
        flog("pick:ignored", {
          idx,
          reason: !story
            ? "no story"
            : !seed
              ? "no seed"
              : !currentBeat
                ? "no currentBeat"
                : "!isAwaitingPick",
        });
        return;
      }
      if (committedIdx != null) {
        flog("pick:ignored", { idx, reason: "already committing", committedIdx });
        return;
      }
      flog("pick:clicked", {
        idx,
        beatId: currentBeat.id,
        label: currentBeat.choices[idx]?.label?.slice(0, 50),
      });
      setCommittedIdx(idx);
      flog("commit:ink-set", { idx, holdMs: 360 });
      // Hold the ink-set for 360ms before firing the real pick. The user
      // sees the choice "settle" rather than blink.
      await new Promise((r) => setTimeout(r, 360));
      flog("commit:persist-start", { idx, beatId: currentBeat.id });
      const updated = await setChoiceForBeat(story.id, currentBeat.id, idx);
      flog("commit:persist-done", { idx, beatId: currentBeat.id });
      setStory(updated);
      setCommittedIdx(null);
      flog("commit:state-updated", { idx, pickedChoiceIdx: idx });
      // Narrate the chosen line as a transition. The next-beat effect kicks
      // off LLM gen in parallel; when the beat lands the narrate effect
      // appends it onto the same queue, so playback flows continuously.
      const choice = currentBeat.choices[idx];
      if (choice) {
        narrator.appendNarration(
          choice.label,
          seed.voices,
          `${currentBeat.id}:choice`,
        );
        flog("narrate:queued-choice-line", {
          idx,
          groupId: `${currentBeat.id}:choice`,
          chunks: choice.label.length,
        });
      }
    },
    [story, seed, currentBeat, isAwaitingPick, narrator, committedIdx, flog],
  );

  // Keyboard shortcuts: 1/2/3 to pick when choices are up, space to toggle
  // play/pause anytime. Research: pointer primary, keyboard for power users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip when typing in inputs (none in this view today, but
      // future-proof).
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        if (narrator.phase === "narrating") {
          e.preventDefault();
          narrator.togglePlay();
        }
        return;
      }
      if (!choicesVisible || !currentBeat) return;
      const idx = "123".indexOf(e.key);
      if (idx >= 0 && idx < currentBeat.choices.length) {
        e.preventDefault();
        void onPickChoice(idx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choicesVisible, currentBeat, onPickChoice, narrator]);

  // Auto-scroll respects the user. If they've scrolled up to re-read prior
  // beats, freeze. Resume auto-scroll only after they've stopped touching
  // for 5s AND they're within one viewport of the bottom — otherwise we'd
  // yank them away from prose they're trying to read.
  const lastUserScrollRef = useRef<number>(0);
  useEffect(() => {
    const el = bookRef.current;
    if (!el) return;
    let userInitiated = false;
    const onScroll = () => {
      if (userInitiated) lastUserScrollRef.current = Date.now();
      userInitiated = true;
    };
    const onWheel = () => {
      lastUserScrollRef.current = Date.now();
    };
    const onTouch = () => {
      lastUserScrollRef.current = Date.now();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouch, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouch);
    };
  }, []);

  useEffect(() => {
    const el = bookRef.current;
    if (!el) return;
    const sinceUserScroll = Date.now() - lastUserScrollRef.current;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < el.clientHeight;
    // Only auto-scroll if the user hasn't recently scrolled, OR they're
    // already near the bottom (following the narrator).
    if (sinceUserScroll > 5000 || nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [story?.beats.length]);

  // Tab visibility: pause narration when the user leaves the tab, resume
  // when they return. The story shouldn't keep talking to an empty room.
  useEffect(() => {
    const onVisibility = () => {
      const audio = (window as { __fableAudio__?: HTMLAudioElement }).__fableAudio__;
      // Use narrator.togglePlay via the latest ref — avoids stale closure.
      if (document.visibilityState === "hidden") {
        if (narrator.isPlaying) narrator.togglePlay();
      }
      void audio;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [narrator]);

  // Play the "your turn" sting when choices first appear.
  useEffect(() => {
    if (!choicesVisible || !currentBeat) return;
    if (stingPlayedForRef.current === currentBeat.id) return;
    stingPlayedForRef.current = currentBeat.id;
    playChoiceSting();
  }, [choicesVisible, currentBeat]);

  const sentences = useMemo(() => {
    if (!currentBeat) return [];
    return segmentSentences(currentBeat.text)
      .map(cleanSentenceMarkdown)
      .filter((s) => s.length > 0);
  }, [currentBeat]);

  // Inline markdown render — drops the wrapping <p> so each sentence stays
  // inline within its own <span class="sentence">, and styles emphasis with
  // the per-sentence activation classes.
  const inlineMarkdown: Components = useMemo(
    () => ({
      p: ({ children }) => <>{children}</>,
      em: ({ children }) => <em className={styles.em}>{children}</em>,
      strong: ({ children }) => <strong className={styles.strong}>{children}</strong>,
      blockquote: ({ children }) => (
        <span className={styles.blockquote}>{children}</span>
      ),
    }),
    [],
  );

  const status = useMemo(() => {
    if (error) return error;
    if (llm.phase === "loading") {
      return llm.fromCache ? "Drawing the book near" : "Lighting the lamp";
    }
    if (narrator.phase === "loading") return "Clearing his throat";
    if (generatingNextBeat) return "Turning the page";
    if (generatingChoices && !choicesReady) return "Considering";
    return null;
  }, [error, llm, narrator.phase, generatingNextBeat, generatingChoices, choicesReady]);

  // Reading progress = how far the narrator has advanced through the queue.
  // Drives the thin gold rule along the top edge.
  const progressPct = useMemo(() => {
    if (narrator.total === 0) return 0;
    if (narrator.ended) return 100;
    if (narrator.currentIdx < 0) return 0;
    return Math.min(100, ((narrator.currentIdx + 1) / narrator.total) * 100);
  }, [narrator.currentIdx, narrator.total, narrator.ended]);

  if (!story || !seed) {
    return (
      <section className={styles.card} aria-label="Fable reader">
        <div className={styles.book}>
          <span className={styles.railRight} aria-hidden />
          <div className={styles.prose}>
            <StatusLine label={error || "Opening the book"} />
          </div>
          <span className={styles.railRight} aria-hidden />
        </div>
      </section>
    );
  }

  const priorBeats = story.beats.slice(0, renderedBeatIdx);

  // Display the rendered beat's folio so the page counter doesn't tick
  // forward before the user actually sees the new beat.
  const folio = ROMAN[renderedBeatIdx] ?? String(renderedBeatIdx + 1);

  return (
    <section className={styles.card} aria-label={`Fable: ${seed.title}`}>
      <header className={styles.header}>
        <button
          className={styles.iconBtn}
          onClick={() => navigate({ name: "library" })}
          aria-label="Back to library"
          title="Library"
        >
          <ArrowLeft size={14} />
        </button>
        <div className={styles.titleWrap}>
          <span className={styles.title}>{seed.title}</span>
        </div>
        <button
          className={styles.iconBtn}
          onClick={onShare}
          data-shared={shared || undefined}
          aria-label={shared ? "Link copied" : "Share this fable"}
          title={shared ? "Link copied" : "Share"}
        >
          {shared ? <Check size={14} /> : <Share2 size={14} />}
        </button>
      </header>

      <div className={styles.book} ref={bookRef}>
        <aside className={styles.rail} aria-hidden>
          <span className={styles.folio}>{folio}.</span>
          <span className={styles.railTrack}>
            <span
              className={styles.railFill}
              style={{ ["--progress" as string]: `${progressPct}%` }}
            />
          </span>
        </aside>

        <div
          className={styles.prose}
          data-playing={narrator.isPlaying ? "true" : undefined}
        >
          {priorBeats.map((b) => (
            <div key={b.id} className={styles.priorBeat}>
              {b.text}
              {b.pickedChoiceIdx != null && b.choices[b.pickedChoiceIdx] && (
                <div className={styles.priorChoice}>                  {b.choices[b.pickedChoiceIdx].label}
                </div>
              )}
            </div>
          ))}

          {currentBeat && (
            <div
              className={styles.currentBeat}
              key={currentBeat.id}
              data-role={
                narrator.currentGroupId === currentBeat.id
                  ? narrator.currentVoiceRole
                  : undefined
              }
            >
              {(() => {
                const onThisBeat = narrator.currentGroupId === currentBeat.id;
                const localIdx = onThisBeat ? narrator.currentSentenceIdx : -1;
                return sentences.map((s, i) => {
                  const isActive = i === localIdx && narrator.isPlaying;
                  const isRead =
                    isActive
                      ? false
                      : narrator.phase !== "narrating" || narrator.ended || i < localIdx;
                  return (
                    <span
                      key={i}
                      className={clsx(
                        styles.sentence,
                        isActive && styles.sentenceActive,
                        isRead && styles.sentenceRead,
                      )}
                    >
                      <ReactMarkdown components={inlineMarkdown}>{s}</ReactMarkdown>
                      {i < sentences.length - 1 ? " " : ""}
                    </span>
                  );
                });
              })()}
            </div>
          )}

          {currentBeat && (choicesVisible || currentBeat.pickedChoiceIdx != null) && (
            <div className={styles.choicesWrap} aria-label="Choices">
              {currentBeat.pickedChoiceIdx == null && (
                <span className={styles.choicesLabel}>Or</span>
              )}
              {currentBeat.choices.map((c, i) => {
                const isLocked = currentBeat.pickedChoiceIdx === i;
                const isOtherLocked =
                  currentBeat.pickedChoiceIdx != null &&
                  currentBeat.pickedChoiceIdx !== i;
                const isCommitting = committedIdx === i;
                const isOtherCommitting =
                  committedIdx != null && committedIdx !== i;
                // Once the pick is committed, the other choices unmount after
                // their fade completes. The chosen one stays mounted so the
                // narrator can read it and the user can see what they chose.
                if (isOtherLocked && unpickedHidden) return null;
                // Narrator is currently speaking this chosen line — apply the
                // active reading state to the row itself.
                const isNarratingThis =
                  isLocked &&
                  narrator.currentGroupId === `${currentBeat.id}:choice` &&
                  narrator.isPlaying;
                return (
                  <button
                    key={i}
                    className={styles.choice}
                    data-committed={isCommitting || isLocked || undefined}
                    data-fading={
                      isOtherCommitting || isOtherLocked ? "true" : undefined
                    }
                    data-narrating={isNarratingThis || undefined}
                    onClick={() => onPickChoice(i)}
                    disabled={committedIdx != null || isLocked}
                  >
                    <span className={styles.choiceNumeral} aria-hidden>
                      {ROMAN[i] ?? i + 1}.
                    </span>
                    <span className={styles.choiceLabelWrap}>
                      <span className={styles.choiceLabelInner}>{c.label}</span>
                      <span className={styles.choiceUnderline} aria-hidden />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Streaming next-beat preview. We're showing the upcoming page
              while the narrator is still reading the choice line that
              bridges to it. Three sources, in priority: the actual next
              beat persisted to story.beats (cache hit / gen complete), the
              speculative cache text (also a hit), the live LLM stream
              buffer. When the narrator moves past the :choice group,
              `renderedBeatIdx` advances and this preview is replaced by
              the real currentBeat (with drop cap + sentence highlighting). */}
          {(() => {
            if (hasReachedMax) return null;
            const persistedNext =
              story && renderedBeatIdx + 1 < story.beats.length
                ? story.beats[renderedBeatIdx + 1].text
                : "";
            const rawPreview =
              persistedNext || nextBeatPreview || beatGen.visibleText;
            if (!rawPreview) return null;
            // Only show the preview while the chosen line is in play OR a
            // gen is still streaming. Once renderedBeatIdx advances (audio
            // moved past :choice) the persisted beat takes over.
            const showPreview =
              currentBeat?.pickedChoiceIdx != null || generatingNextBeat;
            if (!showPreview) return null;
            // Strip markdown for the plain-text preview — it's not rendered
            // via ReactMarkdown, so raw `*` / `> ` / `**` would show literal.
            const previewText = stripMarkdownInline(rawPreview).trim();
            if (!previewText) return null;
            return (
              <div className={styles.streamingBeat} aria-hidden>
                {previewText}
              </div>
            );
          })()}

          {hasReachedMax && narrator.ended && (
            <button
              className={styles.endNote}
              onClick={() => navigate({ name: "library" })}
              aria-label="End — tap to return to the library"
            >
              <span>End.</span>
              <span className={styles.endHint}>tap to begin another</span>
            </button>
          )}

          {status && <StatusLine label={status} />}
        </div>

        <aside className={styles.railRight} aria-hidden />
      </div>

      <footer className={styles.footer}>
        <button
          className={styles.barBtn}
          onClick={narrator.togglePlay}
          aria-label={narrator.isPlaying ? "Pause" : "Play"}
          disabled={narrator.phase !== "narrating"}
        >
          {narrator.isPlaying ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <span className={styles.barMeta}>
          {folio} <span aria-hidden>·</span> {ROMAN[MAX_BEATS - 1] ?? MAX_BEATS}
        </span>
        <span aria-hidden />
      </footer>
    </section>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// Defensive sentence cleanup. The 0.8B model frequently emits asymmetric or
// junk markdown — lone `*`, leading `> *` with no closing pair, repeated
// stuttered fragments. Without this, ReactMarkdown renders the raw marker
// characters in the prose. Strips unbalanced markers, removes leading
// blockquote prefixes that aren't useful on a per-sentence render, and
// filters out sentences that are just punctuation/markers.
function cleanSentenceMarkdown(s: string): string {
  let text = s.trim();
  // Remove leading "> " (blockquote markers — handled at the block level
  // anyway, but ReactMarkdown only sees one sentence at a time so > here
  // produces a per-sentence blockquote that looks broken).
  text = text.replace(/^\s*>\s*/, "");
  // Unbalanced `**` — pair count is odd. Strip them all.
  const boldCount = (text.match(/\*\*/g) || []).length;
  if (boldCount % 2 !== 0) text = text.replace(/\*\*/g, "");
  // Single asterisks that aren't part of a balanced italic pair. Count
  // remaining `*` (after pair-strip) — if odd, drop all `*`.
  const italicCount = (text.match(/\*/g) || []).length;
  if (italicCount % 2 !== 0) text = text.replace(/\*/g, "");
  text = text.trim();
  // Pure-marker sentences (`"*"`, `"**"`, `">"`) — junk.
  if (/^[*>_~`#-]+$/.test(text)) return "";
  return text;
}

// Hand-rolled glyphs so the footer doesn't carry lucide's default visual
// signature — the research called lucide-everywhere out as an AI tell.
function PlayGlyph() {
  return (
    <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden>
      <path d="M1 1 L1 11 L10 6 Z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden>
      <rect x="1" y="1" width="2.5" height="10" fill="currentColor" />
      <rect x="6.5" y="1" width="2.5" height="10" fill="currentColor" />
    </svg>
  );
}

function StatusLine({ label }: { label: string }) {
  return (
    <div className={styles.statusPill} role="status">
      <span>{label}</span>
      <span className={styles.statusDots} aria-hidden>
        <span className={styles.statusDot}>.</span>
        <span className={styles.statusDot}>.</span>
        <span className={styles.statusDot}>.</span>
      </span>
    </div>
  );
}
