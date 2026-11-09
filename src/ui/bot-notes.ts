import type { XiaobeiEvidence, XiaobeiNote } from "../shared/agent-contract";

export const BOT_NOTES_KEY = "desk-pet-notes";
export const BOT_NOTES_LIMIT = 30;

export function readBotEvidence(value: unknown): XiaobeiEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { id, title, excerpt } = item;
    return typeof id === "string" && typeof title === "string" && typeof excerpt === "string"
      ? [{ id: id.slice(0, 150), title: title.slice(0, 240), excerpt: excerpt.slice(0, 850) }]
      : [];
  });
}

export function loadBotNotes(): XiaobeiNote[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(BOT_NOTES_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.slice(-BOT_NOTES_LIMIT).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { id, text, evidence } = item;
      return typeof id === "string" && typeof text === "string"
        ? [{ id, text: text.slice(0, 4800), evidence: readBotEvidence(evidence) }]
        : [];
    });
  } catch {
    return [];
  }
}
