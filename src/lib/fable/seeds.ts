// Pre-seed prompts for Fable. Original openers in r/writingprompts house style.
// Each seed defines tone, voices, and the spine the model continues from.

export type AmbientMood =
  | "rain"
  | "hearth"
  | "vacuum"
  | "creaks"
  | "subway"
  | "surf";

export type SeedAttribution =
  | { kind: "original" }
  | { kind: "external"; author: string; source: string; url: string };

export interface Seed {
  id: string;
  title: string;
  glyph: string;
  prompt: string;
  opener: string;
  voices: {
    narrator: string;
    dialogue: string;
  };
  ambient: AmbientMood;
  attribution: SeedAttribution;
}

export const SEEDS: Seed[] = [
  {
    id: "noir-last-client",
    title: "The Last Client",
    glyph: "❦",
    prompt:
      "She walked into my office at 11:47 PM with a key, a lie, and someone else's blood on her shoes.",
    opener:
      "The rain had been at the windows for three hours when she came in. I knew because I'd been watching the clock instead of the bottle, which is the kind of thing you only notice when you're losing. She set the key on my desk like it weighed something, and I noticed her shoes before I noticed her face. The shoes had a story. The face had only just begun to tell it.\n\n\"I was told you don't ask questions,\" she said.\n\n\"That depends on who's paying,\" I said. It wasn't true, but it sounded better than the truth, which was that I'd ask anything for the right number.",
    voices: { narrator: "am_michael", dialogue: "af_bella" },
    ambient: "rain",
    attribution: { kind: "original" },
  },
  {
    id: "cozy-kettles-promise",
    title: "The Kettle's Promise",
    glyph: "❧",
    prompt: "Every house in the village had a kettle, but only one of them spoke.",
    opener:
      "In the village of Underhollow, every kitchen kept a kettle, and every kettle kept the secrets of the family it served. This was the natural order of things. What was not the natural order was that the Bramble family's kettle, a stout copper thing with a chipped lip, had begun, in the third week of autumn, to speak.\n\nIt said small things at first. \"Mind the draught.\" \"The cat is in the flour again.\" Mira, who was nine and the only one in the house who listened properly, wrote each saying down in a little book she kept under her pillow. By the eighteenth saying, she had begun to suspect that the kettle was warning them about something.",
    voices: { narrator: "bf_emma", dialogue: "bm_george" },
    ambient: "hearth",
    attribution: { kind: "original" },
  },
  {
    id: "scifi-recovery",
    title: "Recovery",
    glyph: "✶",
    prompt: "The colony ship had been silent for forty years when its lights came back on.",
    opener:
      "The Aldebaran's emergency lights came on at 03:14 station time, which was technically a Tuesday, though Tuesdays had stopped meaning anything to anyone aboard her some four decades ago. They came on slowly, in sequence, the way they would have during a routine commissioning — bow first, then ribcage, then aft. From the observation deck of Kepler Station, they looked like a body waking up.\n\n\"Get me Vasquez,\" the duty officer said, and then, when she remembered Vasquez had been retired for eleven years, \"Get me whoever's awake.\"",
    voices: { narrator: "am_onyx", dialogue: "af_nova" },
    ambient: "vacuum",
    attribution: { kind: "original" },
  },
  {
    id: "ghost-tenant-upstairs",
    title: "The Tenant Upstairs",
    glyph: "†",
    prompt: "I have lived alone for sixteen years. The footsteps started in October.",
    opener:
      "I have lived alone in this house for sixteen years. I want that to be on the record before I describe what happened in October, because I have heard every floorboard in every season, and I know the difference between a settling joist and a step.\n\nThe first night, I told myself it was the heating. The second night, I told myself it was a dream. By the fourth night, I had begun to leave a glass of water on the landing, because I had read somewhere that this was what one did, and because I no longer wished to be the only thing in the house with a thirst.",
    voices: { narrator: "bm_lewis", dialogue: "bf_isabella" },
    ambient: "creaks",
    attribution: { kind: "original" },
  },
  {
    id: "heist-cardholder",
    title: "The Cardholder",
    glyph: "❖",
    prompt: "The vault was in a casino, the casino was in a city, and the city was on a train.",
    opener:
      "The job had three rules and Arsen had broken two of them before the train left the platform. The first rule was no hardware. The second was no names. The third was that you did not, under any circumstances, get on the train without confirming that the cardholder was already aboard, because the cardholder was the entire job, and a heist without a cardholder is just an expensive trip across a continent.\n\nArsen took his seat in car four, ordered a coffee he had no intention of drinking, and watched the platform slide past the window. The cardholder was not aboard. The cardholder was, in fact, on a different continent entirely, and had been for some hours.",
    voices: { narrator: "am_eric", dialogue: "af_river" },
    ambient: "subway",
    attribution: { kind: "original" },
  },
  {
    id: "cosmic-tidemarks",
    title: "The Tidemarks",
    glyph: "‡",
    prompt:
      "The tide came in higher every year, and the things it left behind were getting harder to throw away.",
    opener:
      "My grandfather kept a shed, and in the shed he kept the things the sea had brought him over the course of his life. There were ordinary things — bottles, ropes, a child's shoe — and there were less ordinary things, which he had organised by year and by weight and by the degree to which he was willing to look at them.\n\nWhen he died, the shed became mine. I had intended to clear it. That was three summers ago. I have, in that time, removed precisely four items, and added eleven.",
    voices: { narrator: "bm_daniel", dialogue: "af_sky" },
    ambient: "surf",
    attribution: { kind: "original" },
  },
];

export function getSeed(id: string): Seed | undefined {
  return SEEDS.find((s) => s.id === id);
}
