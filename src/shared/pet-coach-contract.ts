export const PET_COACH_QUESTION_LIMIT = 240;
export const PET_COACH_REPLY_LIMIT = 1200;
export const PET_COACH_HISTORY_LIMIT = 4;

export interface PetCoachExchange {
  question: string;
  reply: string;
}

export interface PetCoachRequest {
  turnNumber: number;
  revision?: number;
  question: string;
  history: PetCoachExchange[];
}

export type PetCoachResponse = { mode: "demo" } | { mode: "model"; reply: string };
