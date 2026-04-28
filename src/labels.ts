export interface Sample {
  label: string;
  filename: string;
  url: string;
}

export const SAMPLES: Sample[] = [
  { label: "Talk", filename: "talk.wav", url: "/samples/talk.wav" },
  { label: "Voicemail", filename: "voicemail.wav", url: "/samples/voicemail.wav" },
  { label: "Note", filename: "note.wav", url: "/samples/note.wav" },
  { label: "Memo", filename: "memo.wav", url: "/samples/memo.wav" },
];

export const REPO_URLS = {
  asr: "https://github.com/shabier/qwen3-asr.wasm",
  llm: "https://github.com/shabier/deltanet.wasm",
} as const;

export const FALLBACK_SUGGESTIONS = [
  "Summarize in one line.",
  "What's the key point?",
  "Any action items?",
];

export const CHAT_SYSTEM_PROMPT =
  "You are a concise assistant answering questions about an audio transcript. " +
  "The transcript captures what one person — the speaker — said out loud. " +
  "Track perspective carefully: first-person pronouns (I, me, my, myself) refer to the speaker, " +
  "and any named people are other parties the speaker mentions or addresses — " +
  "never conflate the speaker with those people. " +
  "Tasks the speaker assigns to themselves are theirs, not the named person's. " +
  "Answer factually from the transcript; if it doesn't say, reply that the transcript doesn't cover it. " +
  "Quote brief snippets when helpful. If asked for a timestamp, reply with mm:ss.\n\nTranscript:\n";

export const SUGGESTIONS_SYSTEM_PROMPT =
  "You generate short follow-up questions about audio transcripts. " +
  "Reply with exactly 3 questions, one per line, each 4 to 6 words and ending with '?'. " +
  "Each question opens with a different word, and each focuses on a different topic from the transcript. " +
  "Do not use the words 'speaker', 'listener', or 'transcript'. " +
  "Plain text only, no numbering, no quotes, no preface.";

export const LABELS = {
  audio: {
    dropTitle: "Drop audio",
    dropHint: "mp3, wav, m4a, webm or click to browse",
    samplesLabel: "or try a sample",
    awaitingTranscript: "Awaiting transcript…",
    transcribing: "Transcribing…",
    transcribingChunk: (chunk: number, total: number) => `Transcribing… chunk ${chunk}/${total}`,
    loadingFromCache: "Loading model from cache…",
    downloading: (pct: number) => `Downloading model… ${pct.toFixed(0)}%`,
    decodeError: "Could not decode audio.",
    sampleError: "Could not load sample.",
    pickDifferent: "Pick a different file",
    expandTranscript: "Expand transcript",
    collapseTranscript: "Collapse transcript",
    play: "Play",
    pause: "Pause",
  },
  chat: {
    emptyTitle: "Ask about your audio",
    emptyHint: "Pick a sample on the left to start chatting",
    promptHint: "Ask anything about the transcript.",
    placeholderEmpty: "Pick a sample to start chatting…",
    placeholderReady: "Ask about the transcript…",
    placeholderReading: "Reading transcript…",
    placeholderThinking: "Thinking…",
    send: "Send",
    clearChat: "Clear chat",
    speakReply: "Speak this reply",
    pausePlayback: "Pause playback",
    copyReply: "Copy reply",
    copied: "Copied",
  },
} as const;
