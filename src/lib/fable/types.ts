export interface Choice {
  label: string;
}

export interface Beat {
  id: string;
  text: string;
  choices: Choice[];
  pickedChoiceIdx?: number;
  audioBlobId?: string;
}

export interface Story {
  id: string;
  seedId: string;
  beats: Beat[];
  createdAt: number;
  updatedAt: number;
}

export interface StoryListItem {
  id: string;
  seedId: string;
  beatCount: number;
  preview: string;
  updatedAt: number;
}
