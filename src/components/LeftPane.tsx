import { AudioCard } from "./audio/AudioCard";
import type { ASRMetrics } from "./MetricsBar";

interface Props {
  onTranscript: (text: string) => void;
  onMetrics: (m: ASRMetrics) => void;
  onHasAudio: (hasAudio: boolean) => void;
}

export function LeftPane(props: Props) {
  return <AudioCard {...props} />;
}
