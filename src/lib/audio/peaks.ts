/** Downsample PCM to per-bar absolute peaks, normalized to 0..1. */
export function extractPeaks(samples: Float32Array, barCount: number): number[] {
  const peaks: number[] = new Array(barCount);
  const samplesPerBar = Math.max(1, samples.length / barCount);
  let max = 0;
  for (let i = 0; i < barCount; i++) {
    const start = Math.floor(i * samplesPerBar);
    const end = Math.min(samples.length, Math.floor((i + 1) * samplesPerBar));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > peak) peak = v;
    }
    peaks[i] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) {
    for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i] / max;
  }
  return peaks;
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
