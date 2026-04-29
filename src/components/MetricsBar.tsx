import { Github } from "lucide-react";
import { REPO_URLS } from "~/labels";
import styles from "./MetricsBar.module.scss";

export interface ASRMetrics {
  totalMs: number;
  audioMs: number;
}
export interface LLMMetrics {
  tokens: number;
  elapsedMs: number;
}
export interface TTSMetrics {
  device: "webgpu" | "wasm" | null;
  elapsedMs: number;
  durationMs: number;
}

interface Props {
  side: "left" | "right";
  asr?: ASRMetrics | null;
  llm?: LLMMetrics | null;
  tts?: TTSMetrics | null;
}

const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 0 : 0;

export function MetricsBar({ side, asr, llm, tts }: Props) {
  if (side === "left") {
    return (
      <div className={styles.bar}>
        <div className={styles.group}>
          <RepoLink href={REPO_URLS.asr} label="shabier/qwen3-asr.wasm on Github">shabier/qwen3-asr.wasm</RepoLink>
          {cores > 0 && <span className={styles.context}>{cores}-core CPU</span>}
        </div>
        {asr && asr.totalMs > 0 && (
          <div className={styles.group}>
            <Stat label="t">{(asr.totalMs / 1000).toFixed(2)}s</Stat>
            {asr.audioMs > 0 && (
              <Stat label="rtf">{(asr.audioMs / asr.totalMs).toFixed(2)}×</Stat>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <RepoLink href={REPO_URLS.llm} label="shabier/deltanet.wasm on Github">shabier/deltanet.wasm</RepoLink>
      </div>
      {((llm && llm.elapsedMs > 0) || (tts && tts.elapsedMs > 0)) && (
        <div className={styles.group}>
          {llm && llm.elapsedMs > 0 && (
            <>
              <Stat label="tok/s">{(llm.tokens / (llm.elapsedMs / 1000)).toFixed(1)}</Stat>
              <Stat label="t">{(llm.elapsedMs / 1000).toFixed(2)}s</Stat>
            </>
          )}
          {tts && tts.elapsedMs > 0 && (
            <>
              <span className={styles.engine}>TTS</span>
              {tts.durationMs > 0 && (
                <Stat label="rtf">{(tts.durationMs / tts.elapsedMs).toFixed(2)}×</Stat>
              )}
              {tts.device && <Stat label="on">{tts.device}</Stat>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RepoLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.repoLink}
      aria-label={label}
      title={label}
    >
      <Github size={12} />
      <span className={styles.engine}>{children}</span>
    </a>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{children}</span>
    </span>
  );
}
