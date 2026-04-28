import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Copy, MessageCircle, Pause, Sparkles, Volume2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useLLM, type ChatMessage } from "~/lib/llm/useLLM";
import { useTTS } from "~/lib/tts/useTTS";
import { stripMarkdown, tightenSuggestions } from "~/lib/text";
import {
  CHAT_SYSTEM_PROMPT,
  FALLBACK_SUGGESTIONS,
  LABELS,
  SUGGESTIONS_SYSTEM_PROMPT,
} from "~/labels";
import type { LLMMetrics, TTSMetrics } from "../MetricsBar";
import { BrailleLabel } from "../BrailleLabel";
import styles from "./ChatCard.module.scss";

interface Props {
  transcript: string;
  hasAudio: boolean;
  onLLMMetrics: (m: LLMMetrics) => void;
  onTTSMetrics: (m: TTSMetrics) => void;
}

export function ChatCard({ transcript, hasAudio, onLLMMetrics, onTTSMetrics }: Props) {
  const llm = useLLM();
  const tts = useTTS();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [audioByMessage, setAudioByMessage] = useState<Record<number, string>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const suggestionsForRef = useRef<string>("");
  const playingIdxRef = useRef<number | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Shared <audio>; ref tells the event handlers which message it belongs to.
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onPlay = () => setPlayingIdx(playingIdxRef.current);
    const onPause = () => setPlayingIdx(null);
    const onEnded = () => {
      setPlayingIdx(null);
      playingIdxRef.current = null;
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, []);

  // Pull the chat model alongside ASR. Sequential otherwise, and that's another
  // half-gig on top of transcribe.
  useEffect(() => {
    if (hasAudio && llm.phase === "idle") llm.load();
  }, [hasAudio, llm.phase, llm.load]);

  // New transcript = new context, drop everything.
  useEffect(() => {
    setMessages([]);
    setInput("");
    setAudioByMessage({});
    setSuggestions([]);
    setSuggestionsLoading(false);
    setPlayingIdx(null);
    setCopiedIdx(null);
    suggestionsForRef.current = "";
    playingIdxRef.current = null;
    audioRef.current?.pause();
  }, [transcript]);

  useEffect(() => {
    if (!transcript) return;
    if (suggestionsForRef.current === transcript) return;
    if (llm.phase !== "ready") return;
    if (messages.length > 0) return;

    suggestionsForRef.current = transcript;
    setSuggestionsLoading(true);

    const userMsg = `Transcript:\n${transcript}\n\nWrite 3 questions:`;
    let buffer = "";
    llm.generate(SUGGESTIONS_SYSTEM_PROMPT, [{ role: "user", content: userMsg }], {
      onToken: (t) => { buffer += t; },
      onDone: (text) => {
        setSuggestionsLoading(false);
        const lines = (text || buffer)
          .split("\n")
          .map((l) =>
            l.trim()
              .replace(/^[-•*]\s*/, "")
              .replace(/^\d+[.)]\s*/, "")
              .replace(/^["']|["']$/g, ""),
          )
          .filter((l) => l.length > 5 && l.length < 80 && l.endsWith("?"));
        const unique = Array.from(new Set(lines)).slice(0, 3);
        setSuggestions(unique.length >= 2 ? unique : FALLBACK_SUGGESTIONS);
      },
    }, 80);
  }, [transcript, llm.phase, llm, messages.length]);

  useEffect(() => {
    if (llm.lastElapsedMs > 0) {
      onLLMMetrics({ tokens: llm.lastTokenCount, elapsedMs: llm.lastElapsedMs });
    }
  }, [llm.lastElapsedMs, llm.lastTokenCount, onLLMMetrics]);

  useEffect(() => {
    onTTSMetrics({
      device: tts.device,
      elapsedMs: tts.lastElapsedMs,
      durationMs: tts.lastDurationMs,
    });
  }, [tts.device, tts.lastElapsedMs, tts.lastDurationMs, onTTSMetrics]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, llm.streamingText]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !transcript || llm.phase !== "ready") return;
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    const sys = CHAT_SYSTEM_PROMPT + transcript;
    let buffer = "";
    llm.generate(sys, next, {
      onToken: (t) => { buffer += t; },
      onDone: (text) => {
        setMessages((prev) => [...prev, { role: "assistant", content: text || buffer }]);
      },
    });
  }, [transcript, messages, llm]);

  const speakMessage = useCallback(async (idx: number, text: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Same message, just toggle.
    if (playingIdxRef.current === idx) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return;
    }

    // Switching messages (or first speak), stop the current one.
    audio.pause();

    let url = audioByMessage[idx];
    if (!url) {
      if (tts.phase === "idle") await tts.load();
      const spoken = stripMarkdown(text);
      if (!spoken) return;
      const out = await tts.speak(spoken);
      if (!out) return;
      url = out.url;
      setAudioByMessage((m) => ({ ...m, [idx]: url! }));
    }

    playingIdxRef.current = idx;
    audio.src = url;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, [tts, audioByMessage]);

  const copyMessage = useCallback(async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => {
        setCopiedIdx((prev) => (prev === idx ? null : prev));
      }, 1500);
    } catch {}
  }, []);

  const reset = useCallback(() => {
    audioRef.current?.pause();
    playingIdxRef.current = null;
    setMessages([]);
    setInput("");
    setAudioByMessage({});
    setPlayingIdx(null);
    setCopiedIdx(null);
  }, []);

  const suggestionLabels = useMemo(() => tightenSuggestions(suggestions), [suggestions]);

  const inputState = useMemo(() => {
    if (!transcript) return { disabled: true, loading: false, placeholder: LABELS.chat.placeholderEmpty };
    if (suggestionsLoading) return { disabled: true, loading: true, placeholder: LABELS.chat.placeholderReading };
    if (llm.phase === "loading") {
      return {
        disabled: true,
        loading: true,
        placeholder: llm.fromCache
          ? LABELS.audio.loadingFromCache
          : LABELS.audio.downloading(llm.downloadPct),
      };
    }
    if (llm.phase === "generating") return { disabled: true, loading: true, placeholder: LABELS.chat.placeholderThinking };
    if (llm.phase === "error") return { disabled: true, loading: false, placeholder: llm.error };
    return { disabled: false, loading: false, placeholder: LABELS.chat.placeholderReady };
  }, [transcript, llm, suggestionsLoading]);

  if (!transcript) {
    return (
      <section className={styles.card} aria-label="Chat">
        <div className={styles.empty}>
          <MessageCircle size={20} className={styles.emptyIcon} aria-hidden />
          <h2 className={styles.emptyTitle}>{LABELS.chat.emptyTitle}</h2>
          <p className={styles.emptyHint}>{LABELS.chat.emptyHint}</p>
        </div>
      </section>
    );
  }

  const hasMessages = messages.length > 0;
  const showStreaming = llm.phase === "generating" && !!llm.streamingText && !suggestionsLoading;
  const showSuggestions =
    !hasMessages && !showStreaming && !suggestionsLoading && suggestions.length > 0;

  return (
    <section className={styles.card} aria-label="Chat">
      <header className={styles.header}>
        <span className={styles.persona} aria-hidden>
          <Sparkles size={14} />
        </span>
        <h2 className={styles.title}>Chat</h2>
        <span className={styles.spacer} />
        {llm.lastTokenCount > 0 && (
          <span
            className={styles.tokenCount}
            aria-label={`${llm.lastTokenCount} tokens generated`}
          >
            {llm.lastTokenCount} tok
          </span>
        )}
        {hasMessages && (
          <button
            className={styles.closeBtn}
            onClick={reset}
            aria-label={LABELS.chat.clearChat}
            title={LABELS.chat.clearChat}
          >
            <X size={14} />
          </button>
        )}
      </header>

      <div
        className={styles.messages}
        ref={messagesRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {!hasMessages && !showStreaming && (
          <div className={styles.placeholder}>{LABELS.chat.promptHint}</div>
        )}
        {messages.map((m, i) => {
          const isPlaying = playingIdx === i;
          const isCopied = copiedIdx === i;
          const ttsBusy = tts.phase === "loading" || tts.phase === "generating";
          return (
            <div key={i} className={styles.message} data-role={m.role}>
              <div className={styles.bubble}>
                {m.role === "assistant" ? (
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                ) : (
                  m.content
                )}
              </div>
              {m.role === "assistant" && (
                <div className={styles.actions}>
                  <button
                    className={styles.actionBtn}
                    onClick={() => speakMessage(i, m.content)}
                    aria-label={isPlaying ? LABELS.chat.pausePlayback : LABELS.chat.speakReply}
                    title={isPlaying ? LABELS.audio.pause : "Speak"}
                    disabled={ttsBusy && !isPlaying}
                    data-active={isPlaying || undefined}
                  >
                    {isPlaying ? <Pause size={12} fill="currentColor" /> : <Volume2 size={12} />}
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={() => copyMessage(i, m.content)}
                    aria-label={isCopied ? LABELS.chat.copied : LABELS.chat.copyReply}
                    title={isCopied ? LABELS.chat.copied : "Copy"}
                    data-active={isCopied || undefined}
                  >
                    {isCopied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {showStreaming && (
          <div className={styles.message} data-role="assistant" data-streaming="">
            <div className={styles.bubble}>
              <ReactMarkdown>{llm.streamingText}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {showSuggestions && (
        <div className={styles.suggestions} aria-label="Suggested questions">
          {suggestions.map((s, i) => (
            <button key={s} className={styles.suggestionChip} onClick={() => send(s)}>
              {suggestionLabels[i] ?? s}
            </button>
          ))}
        </div>
      )}

      <form
        className={styles.composer}
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        aria-label="Send a message"
      >
        {inputState.loading ? (
          <div
            className={styles.loadingPill}
            role="status"
            aria-live="polite"
            aria-label={inputState.placeholder}
          >
            <BrailleLabel label={inputState.placeholder} />
          </div>
        ) : (
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={inputState.placeholder}
            aria-label="Ask about the transcript"
            disabled={inputState.disabled}
          />
        )}
        <button
          type="submit"
          className={styles.sendBtn}
          disabled={inputState.disabled || !input.trim()}
          aria-label={LABELS.chat.send}
          title={LABELS.chat.send}
        >
          <ArrowUp size={14} />
        </button>
      </form>

      {tts.error && <div className={styles.error} role="alert">{tts.error}</div>}
    </section>
  );
}
