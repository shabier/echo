import { useEffect } from "react";
import { createStory } from "~/lib/fable/store";
import { useHashRoute } from "~/lib/fable/useHashRoute";

interface Props {
  seedId: string;
  replayPath?: number[];
}

// Lands on /seed/:id from a shared URL. Creates a fresh story for the seed
// (and applies the replay path if present) then forwards to the reader.
export function SeedRedirect({ seedId, replayPath }: Props) {
  const { navigate } = useHashRoute();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const story = await createStory(seedId);
        if (cancelled) return;
        navigate({ name: "reader", storyId: story.id, replayPath });
      } catch {
        if (!cancelled) navigate({ name: "library" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seedId, replayPath, navigate]);

  return null;
}
