import type { Seed } from "~/lib/fable/seeds";
import styles from "./SeedCard.module.scss";

interface Props {
  seed: Seed;
  numeral: string;
  onSelect: (seed: Seed) => void;
}

export function SeedCard({ seed, numeral, onSelect }: Props) {
  return (
    <button
      className={styles.card}
      onClick={() => onSelect(seed)}
      aria-label={`Begin: ${seed.title}`}
    >
      <span className={styles.numeral} aria-hidden>
        {numeral}.
      </span>
      <span className={styles.body}>
        <span className={styles.titleRow}>
          <span className={styles.title}>{seed.title}</span>
          <span className={styles.titleUnderline} aria-hidden />
        </span>
        <span className={styles.prompt}>{seed.prompt}</span>
      </span>
      <span className={styles.arrow} aria-hidden>→</span>
    </button>
  );
}
