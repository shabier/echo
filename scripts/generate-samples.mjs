#!/usr/bin/env node
/**
 * Pre-generate the three sample audio files using kokoro-js, one voice each.
 * Outputs to public/samples/. Run with: node scripts/generate-samples.mjs
 */
import { KokoroTTS } from "kokoro-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "samples");

const SAMPLES = [
  {
    name: "talk",
    voice: "af_heart",
    text:
      "Hey, quick update on the project. We shipped the new dashboard yesterday, " +
      "and the team is iterating on the onboarding flow this week.",
  },
  {
    name: "voicemail",
    voice: "am_michael",
    text:
      "Hi, this is Alex calling about your appointment on Thursday. " +
      "Could you give me a call back when you get a chance? Thanks.",
  },
  {
    name: "note",
    voice: "bf_emma",
    text:
      "Reminder to myself: pick up groceries tonight, finish the proposal draft, " +
      "and email Maria about the offsite location.",
  },
  {
    name: "memo",
    voice: "af_bella",
    text:
      "Quick memo on the architecture review. The team agreed that splitting the " +
      "ingest pipeline into two stages will give us better backpressure handling " +
      "and clearer ownership boundaries between the parser and the writer. " +
      "We also discussed moving the deduplication step earlier in the flow, " +
      "right after parsing, so downstream services don't have to redo that work. " +
      "Next steps: I'll write up the migration plan by Friday, share it with the " +
      "platform team, and we can target the rollout for the following sprint.",
  },
];

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`→ Loading kokoro from ${MODEL_ID}…`);
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8" });
  const available = Object.keys(tts.voices);
  console.log(`✓ Loaded. ${available.length} voices available.`);

  for (const s of SAMPLES) {
    const voice = available.includes(s.voice) ? s.voice : available[0];
    if (voice !== s.voice) {
      console.warn(`! ${s.voice} unavailable, falling back to ${voice}`);
    }
    process.stdout.write(`→ ${s.name} (${voice})… `);
    const audio = await tts.generate(s.text, { voice });
    const wav = audio.toWav();
    const buf = Buffer.from(wav instanceof ArrayBuffer ? wav : wav.buffer ?? await wav.arrayBuffer());
    const outPath = path.join(OUT_DIR, `${s.name}.wav`);
    await writeFile(outPath, buf);
    const dur = (audio.audio.length / audio.sampling_rate).toFixed(2);
    console.log(`✓ ${dur}s, ${(buf.length / 1024).toFixed(0)} KB`);
  }
  console.log(`\nDone. Files written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
