export interface BotEvidence {
  id: string;
  title: string;
  excerpt: string;
}

export interface BotNote {
  id: string;
  text: string;
  evidence: BotEvidence[];
}

export interface BotChatInput {
  text: string;
  history: { speaker: "player" | "pet"; text: string }[];
  notes: BotNote[];
  gameId?: string;
}

export type BotChatEvent =
  | { type: "step"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; text: string; evidence: BotEvidence[]; steps: string[] }
  | { type: "error"; text: string };
