import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ASRSegment } from "~/lib/asr/useASR";
import { BrailleLabel } from "../BrailleLabel";
import styles from "./TranscriptStrip.module.scss";

interface Props {
  segments: ASRSegment[];
  currentTime: number;
  placeholder?: string;
  onSeek: (t: number) => void;
  expanded?: boolean;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

interface WordPos {
  start: number;
  center: number;
}

/**
 * Build word-level timestamps by linearly interpolating across each segment's duration
 * proportional to character offset. qwen3-asr only gives us segment-level timing,
 * so it's approximate, but visually convincing.
 */
function buildWords(segments: ASRSegment[]): Word[] {
  const out: Word[] = [];
  for (const seg of segments) {
    const text = seg.text;
    const len = text.length || 1;
    const segDur = seg.end - seg.start;
    let cursor = 0;
    const matches = text.match(/\S+\s*/g) ?? [];
    for (const m of matches) {
      const charStart = cursor;
      const charEnd = cursor + m.length;
      out.push({
        text: m,
        start: seg.start + (charStart / len) * segDur,
        end: seg.start + (charEnd / len) * segDur,
      });
      cursor = charEnd;
    }
  }
  return out;
}

// Visual focal point sits this many ms ahead of audio currentTime, so the active word
// reaches center slightly before the listener hears it (matches reading-ahead instinct).
// Linear lerp keeps the lead constant regardless of word length.
const FOCAL_LEAD_MS = 80;

export function TranscriptStrip({ segments, currentTime, placeholder, onSeek, expanded }: Props) {
  const words = useMemo(() => buildWords(segments), [segments]);
  const stripRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [positions, setPositions] = useState<WordPos[]>([]);
  const [stripWidth, setStripWidth] = useState(0);
  const [overflows, setOverflows] = useState(false);

  // Track strip width via ResizeObserver so translate stays accurate on resize
  useLayoutEffect(() => {
    if (expanded) return;
    const el = stripRef.current;
    if (!el) return;
    setStripWidth(el.offsetWidth);
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setStripWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [expanded]);

  // Re-measure word centers whenever the word list changes (collapsed only)
  useLayoutEffect(() => {
    if (expanded || !words.length) {
      setPositions([]);
      return;
    }
    const next: WordPos[] = words.map((w, i) => {
      const el = wordRefs.current[i];
      return {
        start: w.start,
        center: el ? el.offsetLeft + el.offsetWidth / 2 : 0,
      };
    });
    setPositions(next);
  }, [words, expanded]);

  const activeIdx = useMemo(() => {
    if (!words.length) return -1;
    let idx = 0;
    for (let i = 0; i < words.length; i++) {
      if (words[i].start <= currentTime) idx = i;
      else break;
    }
    return idx;
  }, [words, currentTime]);

  // Continuous translate. Lerp focal point between consecutive word centers using a
  // forward-shifted clock, so the visual leads the audio by FOCAL_LEAD_MS.
  const translate = useMemo(() => {
    if (expanded || !positions.length || !stripWidth) return 0;
    const focalTime = currentTime + FOCAL_LEAD_MS / 1000;
    let focalIdx = 0;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i].start <= focalTime) focalIdx = i;
      else break;
    }
    const cur = positions[focalIdx];
    const next = positions[focalIdx + 1];
    let center = cur.center;
    if (next) {
      const span = next.start - cur.start;
      const t = span > 0 ? Math.min(1, Math.max(0, (focalTime - cur.start) / span)) : 0;
      center = cur.center + (next.center - cur.center) * t;
    }
    return stripWidth / 2 - center;
  }, [expanded, positions, currentTime, stripWidth]);

  // In expanded mode, scroll active word to vertical center of the scroller
  useLayoutEffect(() => {
    if (!expanded || activeIdx < 0) return;
    const wordEl = wordRefs.current[activeIdx];
    const scroller = textRef.current;
    if (!wordEl || !scroller) return;
    const wordCenter = wordEl.offsetTop + wordEl.offsetHeight / 2;
    const target = wordCenter - scroller.clientHeight / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [expanded, activeIdx]);

  // Track whether expanded content overflows; fades only show when scrollable
  useLayoutEffect(() => {
    if (!expanded) {
      setOverflows(false);
      return;
    }
    const scroller = textRef.current;
    if (!scroller) return;
    const measure = () => setOverflows(scroller.scrollHeight > scroller.clientHeight + 1);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(scroller);
    return () => obs.disconnect();
  }, [expanded, words]);

  if (!words.length) {
    return (
      <div
        className={`${styles.strip} ${styles.empty} ${expanded ? styles.expanded : ""}`}
        ref={stripRef}
      >
        <BrailleLabel className={styles.placeholder} label={placeholder ?? "—"} />
      </div>
    );
  }

  const className = [
    styles.strip,
    expanded && styles.expanded,
    expanded && !overflows && styles.noFade,
  ].filter(Boolean).join(" ");

  return (
    <div className={className} ref={stripRef}>
      <div
        className={styles.text}
        ref={textRef}
        style={expanded ? undefined : { transform: `translate3d(${translate}px, 0, 0)` }}
      >
        {words.map((w, i) => (
          <span
            key={i}
            ref={(el) => { wordRefs.current[i] = el; }}
            className={styles.word}
            data-played={i <= activeIdx ? "" : undefined}
            data-active={i === activeIdx ? "" : undefined}
            onClick={() => onSeek(w.start)}
          >
            {w.text}
          </span>
        ))}
      </div>
    </div>
  );
}
