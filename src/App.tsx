import { useState } from "react";
import { LeftPane } from "./components/LeftPane";
import { RightPane } from "./components/RightPane";
import {
  MetricsBar,
  type ASRMetrics,
  type LLMMetrics,
  type TTSMetrics,
} from "./components/MetricsBar";
import styles from "./App.module.scss";

export function App() {
  const [transcript, setTranscript] = useState("");
  const [hasAudio, setHasAudio] = useState(false);
  const [asrMetrics, setAsrMetrics] = useState<ASRMetrics | null>(null);
  const [llmMetrics, setLlmMetrics] = useState<LLMMetrics | null>(null);
  const [ttsMetrics, setTtsMetrics] = useState<TTSMetrics | null>(null);

  return (
    <main className={styles.app}>
      <section className={styles.pane}>
        <LeftPane
          onTranscript={setTranscript}
          onMetrics={setAsrMetrics}
          onHasAudio={setHasAudio}
        />
      </section>
      <section className={styles.pane}>
        <RightPane
          transcript={transcript}
          hasAudio={hasAudio}
          onLLMMetrics={setLlmMetrics}
          onTTSMetrics={setTtsMetrics}
        />
      </section>
      <footer className={styles.metricsLeft}>
        <MetricsBar side="left" asr={asrMetrics} />
      </footer>
      <footer className={styles.metricsRight}>
        <MetricsBar side="right" llm={llmMetrics} tts={ttsMetrics} />
      </footer>
    </main>
  );
}
