import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Pause, Play, Upload, X } from "lucide-react";
import { decodeFileToPCM, useASR, type ASRSegment } from "~/lib/asr/useASR";
import { extractPeaks, formatTime } from "~/lib/audio/peaks";
import { useAudioPlayer } from "~/lib/audio/useAudioPlayer";
import { LABELS, SAMPLES, type Sample } from "~/labels";
import { Waveform } from "./Waveform";
import { TranscriptStrip } from "./TranscriptStrip";
import type { ASRMetrics } from "../MetricsBar";
import styles from "./AudioCard.module.scss";

interface Props {
  onTranscript: (text: string) => void;
  onMetrics: (m: ASRMetrics) => void;
  onHasAudio: (hasAudio: boolean) => void;
}

const BAR_COUNT = 56;

export function AudioCard({ onTranscript, onMetrics, onHasAudio }: Props) {
  const asr = useASR();
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [decodeError, setDecodeError] = useState("");
  const [displayedSegments, setDisplayedSegments] = useState<ASRSegment[]>([]);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const samplesRef = useRef<Float32Array | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const player = useAudioPlayer(audioUrl);
  const autoTranscribedRef = useRef(false);
  const lastMirroredResultRef = useRef<typeof asr.result>(null);

  // Lazy-load model on first file.
  useEffect(() => {
    if (file && asr.phase === "idle") asr.load();
  }, [file, asr]);

  // Auto-transcribe whenever fresh samples land and the model is ready.
  // peaks flips on every new file (after decode); phase flips after first load.
  useEffect(() => {
    if (
      samplesRef.current &&
      !autoTranscribedRef.current &&
      (asr.phase === "ready" || asr.phase === "done")
    ) {
      autoTranscribedRef.current = true;
      asr.transcribe(samplesRef.current);
    }
  }, [asr.phase, asr.transcribe, peaks]);

  // Identity-check via ref so a file switch doesn't replay the previous result
  // before the next transcribe call lands.
  useEffect(() => {
    if (!file || !asr.result?.segments) return;
    if (lastMirroredResultRef.current === asr.result) return;
    lastMirroredResultRef.current = asr.result;
    setDisplayedSegments(asr.result.segments);
    onTranscript(asr.result.text);
    onMetrics({ totalMs: asr.result.totalMs, audioMs: audioDuration * 1000 });
  }, [file, asr.result, onTranscript, onMetrics, audioDuration]);

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setDecodeError("");
    setDisplayedSegments([]);
    setTranscriptExpanded(false);
    autoTranscribedRef.current = false;
    // Peg to the current result so the mirror effect waits for a new one.
    // Setting this to null would replay the previous transcript before the
    // next transcribe call lands.
    lastMirroredResultRef.current = asr.result;
    onHasAudio(true);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(f));
    try {
      const { samples, duration } = await decodeFileToPCM(f);
      samplesRef.current = samples;
      setAudioDuration(duration);
      setPeaks(extractPeaks(samples, BAR_COUNT));
    } catch {
      setDecodeError(LABELS.audio.decodeError);
    }
  }, [audioUrl, onHasAudio, asr.result]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const reset = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setFile(null);
    setPeaks([]);
    setAudioDuration(0);
    setDecodeError("");
    setDisplayedSegments([]);
    setTranscriptExpanded(false);
    samplesRef.current = null;
    autoTranscribedRef.current = false;
    lastMirroredResultRef.current = asr.result;
    onTranscript("");
    onHasAudio(false);
  }, [audioUrl, onTranscript, onHasAudio, asr.result]);

  const loadSample = useCallback(async (sample: Sample) => {
    try {
      const resp = await fetch(sample.url);
      if (!resp.ok) throw new Error(`${resp.status}`);
      const blob = await resp.blob();
      const f = new File([blob], sample.filename, { type: blob.type || "audio/wav" });
      await handleFile(f);
    } catch {
      setDecodeError(LABELS.audio.sampleError);
    }
  }, [handleFile]);

  const placeholder = useMemo(() => {
    if (decodeError) return decodeError;
    if (asr.phase === "loading") {
      return asr.fromCache ? LABELS.audio.loadingFromCache : LABELS.audio.downloading(asr.downloadPct);
    }
    if (asr.phase === "transcribing") {
      return asr.chunkProgress
        ? LABELS.audio.transcribingChunk(asr.chunkProgress.chunk, asr.chunkProgress.total)
        : LABELS.audio.transcribing;
    }
    if (asr.phase === "error") return asr.error;
    return LABELS.audio.awaitingTranscript;
  }, [decodeError, asr]);

  if (!file) {
    return (
      <div className={styles.empty}>
        <div
          className={styles.dropzone}
          role="button"
          tabIndex={0}
          aria-label="Drop or pick an audio file"
          data-dragging={dragging || undefined}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <Upload size={20} className={styles.dropIcon} aria-hidden />
          <span className={styles.dropTitle}>{LABELS.audio.dropTitle}</span>
          <span className={styles.dropHint}>{LABELS.audio.dropHint}</span>
        </div>
        <div className={styles.samples}>
          <span className={styles.samplesLabel}>{LABELS.audio.samplesLabel}</span>
          <div className={styles.samplesRow}>
            {SAMPLES.map((s) => (
              <button
                key={s.filename}
                className={styles.sampleChip}
                onClick={() => loadSample(s)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {decodeError && <div className={styles.error}>{decodeError}</div>}
      </div>
    );
  }

  return (
    <section className={styles.card} aria-label={`Audio player: ${file.name}`}>
      <header className={styles.header}>
        <button
          className={styles.playBtn}
          onClick={player.toggle}
          aria-label={player.playing ? LABELS.audio.pause : LABELS.audio.play}
          disabled={!audioUrl}
        >
          {player.playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <span className={styles.filename}>{file.name}</span>
        <span className={styles.spacer} />
        <button
          className={styles.transcriptIcon}
          aria-label={transcriptExpanded ? LABELS.audio.collapseTranscript : LABELS.audio.expandTranscript}
          aria-pressed={transcriptExpanded}
          data-active={asr.phase === "done" || undefined}
          data-expanded={transcriptExpanded || undefined}
          onClick={() => setTranscriptExpanded((v) => !v)}
          disabled={!displayedSegments.length}
        >
          <FileText size={14} />
        </button>
        <span className={styles.time} aria-label={`Current time ${formatTime(player.currentTime)}`}>
          {formatTime(player.currentTime)}
        </span>
        <button
          className={styles.closeBtn}
          onClick={reset}
          aria-label={LABELS.audio.pickDifferent}
          title={LABELS.audio.pickDifferent}
        >
          <X size={14} />
        </button>
      </header>

      <Waveform
        peaks={peaks}
        currentTime={player.currentTime}
        duration={player.duration}
        onSeek={player.seek}
      />

      <TranscriptStrip
        segments={displayedSegments}
        currentTime={player.currentTime}
        placeholder={placeholder}
        onSeek={player.seek}
        expanded={transcriptExpanded}
      />
    </section>
  );
}
