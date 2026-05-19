// "Your turn" earcon for the choice moment. Two-note descending chime
// synthesized via Web Audio — no asset, no ambient bed dependency. Subtle
// enough to fit under narration TTS without feeling gamey.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

export function playChoiceSting() {
  const audio = getContext();
  if (!audio) return;
  // Browsers gate AudioContext until first user gesture; resume is a no-op
  // otherwise.
  if (audio.state === "suspended") void audio.resume();
  const now = audio.currentTime;
  const notes = [
    { freq: 880, start: 0, dur: 0.22, vol: 0.045 },
    { freq: 659.25, start: 0.07, dur: 0.42, vol: 0.04 },
  ];
  for (const n of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    gain.gain.setValueAtTime(0, now + n.start);
    gain.gain.linearRampToValueAtTime(n.vol, now + n.start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + n.start);
    osc.stop(now + n.start + n.dur + 0.05);
  }
}
