import type { ProductCore } from "../../src/domain/product-core";
import type { BotEvidence, BotNote } from "../../src/shared/pet-bot-contract";
import type { CurrentResearchReport } from "../../src/domain/research-report";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const archiveKinds = ["games", "cards", "research", "notes"] as const;
export type ArchiveKind = (typeof archiveKinds)[number];
type ArchiveEntry = BotEvidence & { kind: ArchiveKind };

export async function loadBotReports(directory: string): Promise<CurrentResearchReport[]> {
  const names = await readdir(directory).catch(() => []);
  const reports = new Map<string, CurrentResearchReport>();
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const report: CurrentResearchReport = JSON.parse(await readFile(path.join(directory, name), "utf8"));
      const { macro, sector, product, risk } = report.sections;
      const validCards = (items: unknown): boolean => Array.isArray(items)
        && items.every((item) => item && typeof item.title === "string" && typeof item.content === "string");
      if (![report.id, report.period, report.updatedAt, macro.title, macro.headline, sector.title, sector.summary,
        product.title, risk.title, risk.summary].every((field) => typeof field === "string")
        || !validCards(macro.cards) || !validCards(sector.cards) || !validCards(product.cards)
        || !Array.isArray(risk.objections) || !risk.objections.every((item) =>
          item && typeof item.question === "string" && typeof item.reply === "string")) continue;
      const old = reports.get(report.id);
      if (!old || report.updatedAt >= old.updatedAt) reports.set(report.id, report);
    } catch {
      // A partially imported archive file should not hide other periods.
    }
  }
  return [...reports.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createBotArchive(
  core: Pick<ProductCore, "listConversations" | "listMaterials">,
  readReports: () => Promise<CurrentResearchReport[]>,
) {
  return async (notes: BotNote[]) => {
    const [games, materials, reports] = await Promise.all([
      core.listConversations(), core.listMaterials(), readReports(),
    ]);
    const entries: ArchiveEntry[] = [
      ...games.flatMap((game): ArchiveEntry[] => {
        const title = `${game.createdAt.slice(0, 10)} 对局 ${game.id.slice(0, 8)}`;
        const entries: ArchiveEntry[] = [...game.turns].reverse().map((turn) => ({
          kind: "games",
          id: `game:${game.id}:${turn.number}`,
          title: `${title} · 第 ${turn.number} 轮`,
          excerpt: `${turn.speaker === "manager" ? "经理" : "客户"}：${turn.text}`,
        }));
        if (game.outcomeSummary || game.endReason) entries.unshift({
          kind: "games", id: `game:${game.id}`, title: `${title} · 复盘`,
          excerpt: [game.outcomeSummary, game.endReason].filter(Boolean).join("。"),
        });
        return entries;
      }),
      ...materials.flatMap((material) => material.cards
        .filter((card) => card.status === "published")
        .map((card): ArchiveEntry => ({
          kind: "cards", id: `card:${card.id}`,
          title: `${card.name} · ${material.title} ${card.sourceExcerpt.turnRange}`,
          excerpt: [card.applicableScenario, card.currentPurpose, ...card.referenceScripts].join("\n"),
        }))),
      ...reports.flatMap((report): ArchiveEntry[] => {
        const { macro, sector, product, risk } = report.sections;
        const sections = [
          { title: macro.title, text: macro.headline, cards: macro.cards },
          { title: sector.title, text: sector.summary, cards: sector.cards },
          { title: product.title, text: Object.values(product.allocationAdvice ?? {}).join("\n"), cards: product.cards },
          { title: risk.title, text: risk.summary, cards: risk.objections.map((o) => ({ title: o.question, content: o.reply })) },
        ];
        return sections.flatMap(({ title, text, cards }, section) => [
          { kind: "research", id: `report:${report.id}:${section}`, title: `${report.period} · ${title}`, excerpt: text },
          ...cards.map((card, i): ArchiveEntry => ({
            kind: "research", id: `report:${report.id}:${section}:${i}`,
            title: `${report.period} · ${card.title}`, excerpt: card.content,
          })),
        ]);
      }),
      ...notes.map((note): ArchiveEntry => ({
        kind: "notes", id: `note:${note.id}`, title: "个人练习笔记", excerpt: note.text,
      })),
    ];
    return {
      periods: [...new Set(reports.map((report) => report.period))],
      search(query: string, kinds: readonly ArchiveKind[], gameId?: string): BotEvidence[] {
        const normalized = query.toLowerCase().trim();
        const words = normalized.match(/[a-z0-9]{2,}|[\u3400-\u9fff]+/g) ?? [];
        const terms = [...new Set(words.flatMap((word) => /^[\u3400-\u9fff]{3,}$/.test(word)
          ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))]
          : [word]))];
        return kinds.flatMap((kind) => {
          const matches = entries
            .filter((entry) => entry.kind === kind && (!gameId || kind !== "games"
              || entry.id === `game:${gameId}` || entry.id.startsWith(`game:${gameId}:`)))
            .map((entry) => {
              const haystack = `${entry.title}\n${entry.excerpt}`.toLowerCase();
              const score = normalized ? terms.reduce((sum, term) => sum + (haystack.includes(term) ? term.length : 0), 0) : 1;
              return { entry, score };
            })
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score);
          const results: BotEvidence[] = [];
          const sources = new Map<string, number>();
          const diversify = (kind === "games" && !gameId) || kind === "research";
          for (const { entry: { id, title, excerpt } } of matches) {
            const source = id.split(":")[1];
            const seen = sources.get(source) ?? 0;
            if (diversify && seen >= 2) continue;
            sources.set(source, seen + 1);
            results.push({ id, title, excerpt: excerpt.slice(0, 850) });
            if (results.length === 4) break;
          }
          return results;
        });
      },
    };
  };
}
