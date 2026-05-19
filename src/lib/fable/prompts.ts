import type { Seed } from "./seeds";
import type { Beat } from "./types";

export const BEAT_SYSTEM_PROMPT = `You are continuing an interactive story. Write only the next passage, in the same voice, tense, and style as the prior text. Stay in the established setting, characters, and details.

Write 70 to 110 words of prose. End the prose at a moment of decision — a fork the reader will choose from. Do not write the choices into the prose itself. Do not repeat the protagonist's last action verbatim — push the story forward.

You may use light markdown to give the prose visual texture. Use it sparingly — these are stress marks, not decoration:
- *italics* for a stressed word or quiet emphasis (max one *italic phrase* per sentence)
- **bold** for a forceful moment — anger, urgency, a shout (max one **bold phrase** per beat, often zero)
- A line beginning with > for a note, sign, letter, or screen the protagonist reads. Keep blockquoted lines short (under 12 words).

Most sentences should have no markdown at all. Markdown is reserved for moments where plain prose would lose the inflection.

Then, on new lines after the prose, write exactly 3 numbered choices in this format:
1. <6 to 10 word action or line of dialogue>
2. <6 to 10 word action or line of dialogue>
3. <6 to 10 word action or line of dialogue>

The three choices MUST be distinct from each other. Never repeat the same action or near-identical wording across choices. If two feel similar, change one to a different angle: risk vs caution, speak vs act, advance vs retreat. Each choice should plausibly send the story in a different direction.

Choices are concrete actions or spoken lines from the protagonist's perspective. No meta commentary, no narration, no "you" — just what the protagonist does or says next. Do not write anything after the third choice. Do not explain. Do not preface.`;

// Used only for the very first decision point: the opener is hand-written, so
// we don't want any continuation prose — just the three choices.
export const CHOICES_ONLY_SYSTEM_PROMPT = `Given the opening of a story, write exactly 3 numbered choices the protagonist could make next. Format:
1. <6 to 10 word action or line of dialogue>
2. <6 to 10 word action or line of dialogue>
3. <6 to 10 word action or line of dialogue>

The three choices MUST be distinct from each other in action, tone, or outcome. Never repeat the same action or near-identical wording across choices. Vary risk vs caution, speak vs act, advance vs retreat.

Each choice is a concrete action or spoken line from the protagonist's perspective. No prose, no preface, no narration, no "you". Output only the three numbered lines.`;

// Used when the first attempt produced duplicate or collapsed choices. The
// emphasis on "different actions" is doubled and the model is told its prior
// attempt was wrong.
export const CHOICES_RETRY_SYSTEM_PROMPT = `Your previous attempt produced choices that were too similar or repeated. Write 3 numbered choices that are CLEARLY DIFFERENT from each other. Format:
1. <6 to 10 word action or line of dialogue>
2. <6 to 10 word action or line of dialogue>
3. <6 to 10 word action or line of dialogue>

Make the three choices contrast: different actions, different tones, different consequences. One careful, one bold, one unexpected — or any other axis of contrast. No two choices may share the same first three words. Output only the three numbered lines, nothing else.`;

export function buildBeatUserMessage(seed: Seed, beats: Beat[]): string {
  // beats[0] is always the opener (no prior choice). beats[1..] each follow a choice.
  const lines: string[] = [];
  lines.push(`Title: ${seed.title}`);
  lines.push(`Premise: ${seed.prompt}`);
  lines.push("");
  lines.push(beats[0].text);

  for (let i = 1; i < beats.length; i++) {
    const prev = beats[i - 1];
    const chosen =
      prev.pickedChoiceIdx != null && prev.choices[prev.pickedChoiceIdx]
        ? prev.choices[prev.pickedChoiceIdx].label
        : null;
    if (chosen) {
      lines.push("");
      lines.push(`(The protagonist chose: ${chosen})`);
    }
    lines.push("");
    lines.push(beats[i].text);
  }

  // Prompt for the *next* beat, given the most-recent pick.
  const last = beats[beats.length - 1];
  const lastChoice =
    last.pickedChoiceIdx != null && last.choices[last.pickedChoiceIdx]
      ? last.choices[last.pickedChoiceIdx].label
      : null;
  if (lastChoice) {
    lines.push("");
    lines.push(`(The protagonist chose: ${lastChoice})`);
  }
  lines.push("");
  lines.push("Continue the story.");

  return lines.join("\n");
}

export interface ParsedBeat {
  text: string;
  choices: string[];
}

const CHOICE_RE = /^\s*(\d+)[.)]\s+(.+?)\s*$/;

export function parseBeat(raw: string): ParsedBeat {
  const lines = raw.split(/\r?\n/);
  const proseLines: string[] = [];
  const choices: string[] = [];
  let inChoices = false;

  for (const line of lines) {
    const m = line.match(CHOICE_RE);
    if (m) {
      inChoices = true;
      choices.push(stripWrappingQuotes(m[2]));
      continue;
    }
    if (inChoices) {
      // Stop collecting prose after the first numbered line. Ignore anything
      // between or after the choices that isn't itself a numbered line.
      continue;
    }
    proseLines.push(line);
  }

  const text = proseLines.join("\n").trim();
  return { text, choices: choices.slice(0, 3) };
}

function stripWrappingQuotes(s: string): string {
  return s.replace(/^["'`]+|["'`]+$/g, "").trim();
}

// Drop near-duplicate choices (small models sometimes echo themselves three
// times). Compare on lowercased + de-punctuated text so trivial variants
// collapse together.
export function dedupeChoices(choices: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of choices) {
    const key = c
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Light pre-pass before kokoro. Normalize whitespace, harmonize dashes/quotes,
// collapse repeated punctuation, and strip artifacts that the model
// phonemizes literally (stage directions, ALL CAPS prose, stacked
// punctuation). Stacked terminators in particular cause kokoro to insert a
// "weird breath" artifact — see hexgrad model card discussion #13.
export function normalizeForTTS(text: string): string {
  return text
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, "—")
    .replace(/\s*—\s*/g, " — ")
    // Collapse 3+ dots into a single ellipsis character (community-validated
    // shorthand for a "suspenseful" pause; cleaner than "...").
    .replace(/\.{3,}/g, "…")
    // Drop bracketed stage directions like [warmly] or [pause]; kokoro reads
    // them as words.
    .replace(/\[[^\]]+\]/g, "")
    // Dedupe stacked terminators ("!!!" or "?!?") down to a single mark.
    // 2+ same terminator => 1; mixed terminators keep the first.
    .replace(/([.!?])\1+/g, "$1")
    .replace(/(!\?|\?!)+!?/g, (m) => m[0])
    // ALL CAPS words longer than 3 letters get downcased — kokoro reads them
    // as letter sequences. Acronyms (≤3 letters) survive.
    .replace(/\b[A-Z]{4,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Strip light markdown markers so kokoro reads the underlying prose, not the
// asterisks. The visible reader keeps the markdown — emphasis is rendered via
// styled <em>/<strong>/<blockquote> spans that animate when their sentence
// becomes active.
export function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/^\s*>\s*/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
