// Sub-sentence segmenter. Splits prose into narration chunks tagged by voice.
//
// A sentence may contain multiple voice spans:
//   `Bramble said, "Mind the draught," and turned away.`
//   → ["Bramble said,", "Mind the draught,", "and turned away."]
//   →  narrator        dialogue              narrator
//
// Each chunk carries the sentence index it belongs to, so the reader can
// drive sentence-level highlighting even when a single sentence is split
// across voices.

export interface NarrationChunk {
  text: string;
  isDialogue: boolean;
  sentenceIdx: number;
}

const QUOTE_CHARS = new Set(['"', "\u201C", "\u201D"]);

export function segmentSentences(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    const seg = new Seg("en", { granularity: "sentence" });
    return Array.from(seg.segment(text), (s) => s.segment.trim()).filter(
      (s) => s.length > 0,
    );
  }
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])|\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Walk a sentence and emit chunks, switching tag whenever we cross a quote
// boundary. Quotes themselves are kept on the dialogue side; the narrator
// hook strips them before synthesis.
function splitSentenceByQuotes(sentence: string, sentenceIdx: number): NarrationChunk[] {
  const out: NarrationChunk[] = [];
  let buf = "";
  let inQuote = false;

  const flush = (asDialogue: boolean) => {
    const trimmed = buf.trim();
    if (trimmed) {
      out.push({ text: trimmed, isDialogue: asDialogue, sentenceIdx });
    }
    buf = "";
  };

  for (let i = 0; i < sentence.length; i++) {
    const c = sentence[i];
    if (QUOTE_CHARS.has(c)) {
      if (inQuote) {
        // Closing quote: keep it on the dialogue side.
        buf += c;
        flush(true);
        inQuote = false;
      } else {
        // Opening quote: flush any narration first, then start dialogue with
        // the opening quote attached.
        flush(false);
        buf = c;
        inQuote = true;
      }
    } else {
      buf += c;
    }
  }
  if (buf.trim()) flush(inQuote);
  return out;
}

export function chunkProse(text: string): NarrationChunk[] {
  const sentences = segmentSentences(text);
  const out: NarrationChunk[] = [];
  for (let s = 0; s < sentences.length; s++) {
    out.push(...splitSentenceByQuotes(sentences[s], s));
  }
  return out;
}
