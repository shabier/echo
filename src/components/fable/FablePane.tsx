import { Library } from "./Library";
import { Reader } from "./Reader";
import { SeedRedirect } from "./SeedRedirect";
import { useHashRoute } from "~/lib/fable/useHashRoute";
import type { LLMMetrics, TTSMetrics } from "../MetricsBar";

interface Props {
  onLLMMetrics: (m: LLMMetrics) => void;
  onTTSMetrics: (m: TTSMetrics) => void;
}

export function FablePane({ onLLMMetrics, onTTSMetrics }: Props) {
  const { route } = useHashRoute();
  switch (route.name) {
    case "reader":
      return (
        <Reader
          storyId={route.storyId}
          onLLMMetrics={onLLMMetrics}
          onTTSMetrics={onTTSMetrics}
        />
      );
    case "seed":
      return <SeedRedirect seedId={route.seedId} replayPath={route.replayPath} />;
    case "library":
    default:
      return <Library />;
  }
}
