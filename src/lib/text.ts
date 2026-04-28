// TTS otherwise reads "asterisk asterisk" out loud.
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The 0.8B model templates suggestions ("What did you say about the X?",
// "What did you say about the Y?"...). Chop a shared prefix once it's clearly
// boilerplate so the chips show only the differentiator.
export function tightenSuggestions(items: string[]): string[] {
  if (items.length < 2) return items;
  const split = items.map((s) => s.split(/\s+/));
  const minLen = Math.min(...split.map((w) => w.length));
  let common = 0;
  for (let i = 0; i < minLen; i++) {
    const w = split[0][i].toLowerCase();
    if (split.every((s) => s[i].toLowerCase() === w)) common++;
    else break;
  }
  if (common < 3) return items;
  if (split.some((s) => s.length - common < 2)) return items;
  return split.map((words) => {
    const tail = words.slice(common).join(" ");
    return tail.charAt(0).toUpperCase() + tail.slice(1);
  });
}
