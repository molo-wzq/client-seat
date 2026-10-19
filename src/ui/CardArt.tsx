import type { ReactNode } from "react";
import type { StrategyCard } from "../domain/types";

/**
 * 策略卡卡面插画(纯矢量,零素材)。
 * 按卡名与沟通目的里的关键词挑一幅题材:开场接通 / 探询需求 / 引入活动 / 推进下一步,
 * 让卡面画面贴合这张卡在电话里干的事;匹配不上时按编号轮换。
 */
export type CardArtMotif = "call" | "probe" | "offer" | "close";

const motifKeywords: Array<[CardArtMotif, RegExp]> = [
  ["close", /预约|报名|下一步|加微信|收口|落到|异议|顾虑|台阶/],
  ["offer", /活动|产品|引入|兴趣|竞品|收益|立减|拉新/],
  ["probe", /探询|需求|现状|追问|只问|了解|习惯|赞美|定位/],
  ["call", /开场|身份|退路|接通|信任|可信/],
];

const motifOrder: CardArtMotif[] = ["call", "probe", "offer", "close"];

export function pickCardArtMotif(card: Pick<StrategyCard, "name" | "currentPurpose">, index = 0): CardArtMotif {
  const text = `${card.name} ${card.currentPurpose ?? ""}`;
  for (const [motif, pattern] of motifKeywords) if (pattern.test(card.name)) return motif;
  for (const [motif, pattern] of motifKeywords) if (pattern.test(text)) return motif;
  return motifOrder[((index % motifOrder.length) + motifOrder.length) % motifOrder.length];
}

const motifArt: Record<CardArtMotif, ReactNode> = {
  // 话筒 + 声波:接通、自报身份
  call: (
    <>
      <path className="art-fill" d="M17 14c-3 2-4 6-2 11 4 10 11 18 21 23 5 2 9 1 11-2l3-4c1-1 1-3-1-4l-7-5c-1-1-3-1-4 0l-3 3c-5-2-9-7-11-12l3-3c1-1 1-3 0-4l-4-7c-1-2-3-2-4-1Z" />
      <path d="M38 12a14 14 0 0 1 14 14M38 19a7 7 0 0 1 7 7" />
    </>
  ),
  // 两只对话气泡 + 问号:探询现状
  probe: (
    <>
      <path className="art-fill" d="M10 14h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H22l-8 7v-7h-4a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z" />
      <path d="M46 24h8a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4h-3v6l-7-6H32a4 4 0 0 1-4-4v-2" />
      <path d="M20 21a4 4 0 1 1 6 3.5c-1.4.8-2 1.6-2 3M24 31.5v.5" />
    </>
  ),
  // 钱币堆 + 上扬箭头:引入活动与产品
  offer: (
    <>
      <ellipse className="art-fill" cx="24" cy="44" rx="13" ry="5" />
      <path d="M11 44v6c0 3 6 5 13 5s13-2 13-5v-6M11 38c0-3 6-5 13-5s13 2 13 5-6 5-13 5-13-2-13-5Zm0 0v6" />
      <path d="M36 28 46 18l5 5 8-10M52 13h7v7" />
    </>
  ),
  // 日历 + 对勾:落到预约、报名或下一步
  close: (
    <>
      <rect className="art-fill" x="12" y="16" width="40" height="36" rx="4" />
      <path d="M12 26h40M22 11v9M42 11v9" />
      <path d="m23 39 6 6 12-12" />
    </>
  ),
};

export function CardArt({ card, index = 0, className = "card-art" }: {
  card: Pick<StrategyCard, "name" | "currentPurpose">;
  index?: number;
  className?: string;
}) {
  const motif = pickCardArtMotif(card, index);
  return (
    <span className={className} data-motif={motif} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">{motifArt[motif]}</svg>
    </span>
  );
}
