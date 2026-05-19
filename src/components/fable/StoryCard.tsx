import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { getSeed } from "~/lib/fable/seeds";
import type { StoryListItem } from "~/lib/fable/types";
import styles from "./StoryCard.module.scss";

interface Props {
  story: StoryListItem;
  numeral: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const MAX_BEATS = 10;

const TIME_UNITS = [
  { ms: 60_000, label: "m" },
  { ms: 3_600_000, label: "h" },
  { ms: 86_400_000, label: "d" },
];

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  for (let i = TIME_UNITS.length - 1; i >= 0; i--) {
    const u = TIME_UNITS[i];
    if (diff >= u.ms) return `${Math.floor(diff / u.ms)}${u.label} ago`;
  }
  return "just now";
}

export function StoryCard({ story, numeral, onOpen, onDelete }: Props) {
  const seed = getSeed(story.seedId);
  const folio = ROMAN[story.beatCount - 1] ?? String(story.beatCount);
  const totalFolio = ROMAN[MAX_BEATS - 1];
  // Two-tap confirm. First click flips to "Forget?" state; second click
  // within 3s deletes. Auto-reverts otherwise. Lighter than a modal,
  // heavier than a single-click destruction.
  const [confirming, setConfirming] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
  }, []);
  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(story.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(story.id);
        }
      }}
      aria-label={`Resume: ${seed?.title ?? "story"}`}
    >
      <span className={styles.numeral} aria-hidden>
        {numeral}.
      </span>
      <span className={styles.body}>
        <span className={styles.titleLine}>
          <span className={styles.titleRow}>
            <span className={styles.title}>{seed?.title ?? "Untitled"}</span>
            <span className={styles.titleUnderline} aria-hidden />
          </span>
          <span className={styles.meta}>
            {folio} / {totalFolio} · {relativeTime(story.updatedAt)}
          </span>
        </span>
        <span className={styles.preview}>{story.preview}</span>
      </span>
      <span className={styles.arrow} aria-hidden>→</span>
      <button
        className={styles.deleteBtn}
        data-confirming={confirming || undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (confirming) {
            onDelete(story.id);
            return;
          }
          setConfirming(true);
          if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
          confirmTimerRef.current = window.setTimeout(() => {
            setConfirming(false);
            confirmTimerRef.current = null;
          }, 3000);
        }}
        aria-label={confirming ? "Forget this story?" : "Delete story"}
        title={confirming ? "Forget this story?" : "Delete"}
      >
        {confirming ? (
          <span className={styles.deleteConfirm}>Forget?</span>
        ) : (
          <Trash2 size={11} />
        )}
      </button>
    </div>
  );
}
