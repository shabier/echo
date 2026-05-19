import styles from "./VoiceIndicator.module.scss";

interface Props {
  voiceLabel: string;
  playing: boolean;
  role: "narrator" | "dialogue" | "idle";
}

// Three-bar equalizer + label, in the Eleven Labs voice-presence vocabulary.
// Sits in the reader footer; pulses while the narrator is actively reading,
// and shifts color/posture when the active voice swaps to dialogue.
export function VoiceIndicator({ voiceLabel, playing, role }: Props) {
  return (
    <span
      className={styles.wrap}
      data-playing={playing || undefined}
      data-role={role}
      aria-live="polite"
      aria-label={playing ? `Reading: ${voiceLabel}` : "Narrator idle"}
    >
      <span className={styles.bars} aria-hidden>
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
      </span>
      <span>{voiceLabel}</span>
    </span>
  );
}
