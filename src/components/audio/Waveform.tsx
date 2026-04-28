import { useCallback, useRef, useState } from "react";
import styles from "./Waveform.module.scss";

interface Props {
  peaks: number[];
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}

export function Waveform({ peaks, currentTime, duration, onSeek }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const el = containerRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return pct * duration;
    },
    [duration],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
    setDragTime(timeFromClientX(e.clientX));
  }, [duration, timeFromClientX]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragTime(timeFromClientX(e.clientX));
  }, [dragging, timeFromClientX]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    if (dragTime !== null) onSeek(dragTime);
    setDragging(false);
    setDragTime(null);
  }, [dragging, dragTime, onSeek]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const step = e.shiftKey ? 10 : 5;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, currentTime - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(duration, currentTime + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(duration);
    }
  }, [currentTime, duration, onSeek]);

  const displayedTime = dragging && dragTime !== null ? dragTime : currentTime;
  const progress = duration > 0 ? Math.min(1, displayedTime / duration) : 0;
  const playheadIdx = progress * peaks.length;

  return (
    <div
      ref={containerRef}
      className={styles.container}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={duration > 0 ? Math.round(duration) : 0}
      aria-valuenow={Math.round(displayedTime)}
      tabIndex={duration > 0 ? 0 : -1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <svg
        className={styles.bars}
        viewBox={`0 0 ${peaks.length} 100`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {peaks.map((p, i) => {
          const h = Math.max(2, p * 96);
          const past = i < playheadIdx;
          const y1 = (100 - h) / 2;
          const y2 = y1 + h;
          return (
            <line
              key={i}
              className={past ? styles.barPast : styles.barFuture}
              x1={i + 0.5}
              x2={i + 0.5}
              y1={y1}
              y2={y2}
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
    </div>
  );
}
