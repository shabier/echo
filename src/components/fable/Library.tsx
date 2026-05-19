import { useCallback, useEffect, useState } from "react";
import { SEEDS, type Seed } from "~/lib/fable/seeds";
import { createStory, deleteStory, listStories } from "~/lib/fable/store";
import type { StoryListItem } from "~/lib/fable/types";
import { useHashRoute } from "~/lib/fable/useHashRoute";
import { SeedCard } from "./SeedCard";
import { StoryCard } from "./StoryCard";
import styles from "./Library.module.scss";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function Library() {
  const { navigate } = useHashRoute();
  const [stories, setStories] = useState<StoryListItem[]>([]);

  const refresh = useCallback(async () => {
    setStories(await listStories());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSelectSeed = useCallback(
    async (seed: Seed) => {
      const story = await createStory(seed.id);
      navigate({ name: "reader", storyId: story.id });
    },
    [navigate],
  );

  const onOpenStory = useCallback(
    (id: string) => navigate({ name: "reader", storyId: id }),
    [navigate],
  );

  const onDeleteStory = useCallback(
    async (id: string) => {
      await deleteStory(id);
      await refresh();
    },
    [refresh],
  );

  return (
    <section className={styles.card} aria-label="Fable library">
      <header className={styles.header}>
        <span className={styles.brand}>Fable</span>
      </header>
      <div className={styles.scroll}>
        {stories.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Open</h2>
            <div className={styles.continueShelf}>
              {stories.map((s, i) => (
                <StoryCard
                  key={s.id}
                  story={s}
                  numeral={ROMAN[i] ?? `${i + 1}`}
                  onOpen={onOpenStory}
                  onDelete={onDeleteStory}
                />
              ))}
            </div>
          </div>
        )}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Begin</h2>
          <div className={styles.shelf}>
            {SEEDS.map((seed, i) => (
              <SeedCard
                key={seed.id}
                seed={seed}
                numeral={ROMAN[i] ?? `${i + 1}`}
                onSelect={onSelectSeed}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
