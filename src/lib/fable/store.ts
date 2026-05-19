import { getSeed } from "./seeds";
import { deleteStory, getStory, listStories, newId, saveStory } from "./db";
import type { Beat, Story } from "./types";

export { newId };

export async function createStory(seedId: string): Promise<Story> {
  const seed = getSeed(seedId);
  if (!seed) throw new Error(`Unknown seed: ${seedId}`);
  const now = Date.now();
  const story: Story = {
    id: newId(),
    seedId,
    beats: [
      {
        id: newId(),
        text: seed.opener,
        choices: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  await saveStory(story);
  return story;
}

export async function appendBeat(storyId: string, beat: Beat): Promise<Story> {
  const story = await getStory(storyId);
  if (!story) throw new Error(`Story not found: ${storyId}`);
  story.beats.push(beat);
  story.updatedAt = Date.now();
  await saveStory(story);
  return story;
}

export async function setChoiceForBeat(
  storyId: string,
  beatId: string,
  choiceIdx: number,
): Promise<Story> {
  const story = await getStory(storyId);
  if (!story) throw new Error(`Story not found: ${storyId}`);
  const beat = story.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error(`Beat not found: ${beatId}`);
  beat.pickedChoiceIdx = choiceIdx;
  story.updatedAt = Date.now();
  await saveStory(story);
  return story;
}

export async function setBeatChoices(
  storyId: string,
  beatId: string,
  choices: { label: string }[],
): Promise<Story> {
  const story = await getStory(storyId);
  if (!story) throw new Error(`Story not found: ${storyId}`);
  const beat = story.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error(`Beat not found: ${beatId}`);
  beat.choices = choices;
  story.updatedAt = Date.now();
  await saveStory(story);
  return story;
}

export async function attachAudio(
  storyId: string,
  beatId: string,
  audioBlobId: string,
): Promise<Story> {
  const story = await getStory(storyId);
  if (!story) throw new Error(`Story not found: ${storyId}`);
  const beat = story.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error(`Beat not found: ${beatId}`);
  beat.audioBlobId = audioBlobId;
  story.updatedAt = Date.now();
  await saveStory(story);
  return story;
}

export { getStory, listStories, deleteStory };
