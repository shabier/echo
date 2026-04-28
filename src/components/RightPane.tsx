import { ChatCard } from "./chat/ChatCard";
import type { LLMMetrics, TTSMetrics } from "./MetricsBar";

interface Props {
  transcript: string;
  hasAudio: boolean;
  onLLMMetrics: (m: LLMMetrics) => void;
  onTTSMetrics: (m: TTSMetrics) => void;
}

export function RightPane(props: Props) {
  return <ChatCard {...props} />;
}
