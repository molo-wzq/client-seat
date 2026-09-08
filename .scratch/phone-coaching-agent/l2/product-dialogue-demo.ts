// 代表性对话演示(L2 验证工件,ADR 0003 决定 4;不属于产品实现)
//
// 用法(仓库根目录):
//   npx tsx .scratch/phone-coaching-agent/l2/product-dialogue-demo.ts <p02|p03|s1|s2>
//
// - 理财经理由真实模型扮演,提示词取自产品当前装配逻辑(src/adapters/prompts.ts),
//   策略卡为产品种子 SC1–SC3;与旧版 conversation-demo.mjs(独立提示词)的区别即在于此。
// - 客户由脚本轮次扮演,轮次按画像性格预写;通话结束(模型收口/轮数上限/轮次用尽)即停。
// - 密钥:环境变量 MIMO_API_KEY,其次 ../l1/tools/.env.local。
// - 产物:同目录 demo-conversation-{02..05}-*.md,已存在则跳过。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAICompatibleModelAdapter } from "../../../src/adapters/openai-model-adapter";
import { FakeModelAdapter } from "../../../src/adapters/fake-model-adapter";
import { createProductCore } from "../../../src/domain/product-core";
import { InMemoryStorage } from "../../../src/product/in-process-product-api";
import type { CopywritingPort, DialoguePort } from "../../../src/domain/ports";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function loadKey(): string {
  if (process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
  const envFile = path.join(DIR, "..", "l1", "tools", ".env.local");
  const m = fs.readFileSync(envFile, "utf8").match(/^MIMO_API_KEY=(.+)$/m);
  if (!m) throw new Error("未找到 MIMO_API_KEY(环境变量或 l1/tools/.env.local)");
  return m[1].trim();
}

interface PersonaScript {
  file: string;
  title: string;
  note?: string;
  /** 非内置画像先经 savePersona 存为自定义画像;内置画像直接用其 id。 */
  custom?: { name: string; visible: string[]; hidden: string[] };
  personaId?: string;
  customerTurns: string[];
}

const SCRIPTS: Record<string, PersonaScript> = {
  p02: {
    file: "demo-conversation-02-p02到期资金稳健阿姨.md",
    title: "P02 到期资金·稳健阿姨(真实素材提取,存量维护·跟进触达)",
    personaId: "p02-daoqi-wenjian",
    customerTurns: [
      "喂,你好。",
      "方便的,你说。",
      "哦,是那笔钱到账了啊。我不用的,你帮我看看放哪好吧,哪个理财好?",
      "礼拜五我要过来的,大概十点。",
      "好的好的,我回去看看到期日。",
      "那些先不存啦,都是三年的定期。",
      "嗯,好的好的,那就这样,再见。",
    ],
  },
  p03: {
    file: "demo-conversation-03-p03定期到期话少客户.md",
    title: "P03 定期到期·话少客户(真实素材提取,存量维护·到期续存,首次电话)",
    personaId: "p03-dingqi-huashao",
    customerTurns: [
      "喂。",
      "啊,是我,哪笔定期?",
      "哦,周六到期啊……我用不到,续着吧。",
      "嗯。",
      "我那边银行还有笔钱,大概一月中旬到期。",
      "五十万?那差不多够得着的。",
      "一月十五号左右吧,到时候你再打给我。",
      "行,就这样啊。",
    ],
  },
  s1: {
    file: "demo-conversation-04-s1软拒绝-合成.md",
    title: "S1 忙·推脱型(合成验证画像)",
    note: "合成画像与脚本(ADR 0003 追加决议 8/9),验证软拒绝下的降压与体面收口。",
    custom: {
      name: "忙·推脱型(合成)",
      visible: [
        "某银行代发工资客户,代发关系正常",
        "符合本期代发客户拉新活动参与条件",
        "与本经理首次接触,无历史服务记录",
      ],
      hidden: [
        "接电话时手头总在忙,反感被占用时间",
        "最近被保险电销烦过,一听推销就推脱(再说吧/钱都有安排)",
        "资金确实有安排(货币基金),不打算动",
        "对「发资料不用回复」这类零负担动作不反感",
      ],
    },
    customerTurns: [
      "喂?忙着呢,哪位?",
      "行,你说,长话短说。",
      "哎呀,再说吧再说吧,我钱都有安排的,暂时不考虑。",
      "嗯嗯,到时候再看吧。",
      "……行吧,那你发过来吧。",
      "嗯,好,再见。",
    ],
  },
  s2: {
    file: "demo-conversation-05-s2明确拒绝-合成.md",
    title: "S2 明确拒绝型(合成验证画像)",
    note: "合成画像与脚本(ADR 0003 追加决议 8/9),验证明确拒绝下的接住收口路径。",
    custom: {
      name: "明确拒绝型(合成)",
      visible: ["某银行存量客户,有代发关系", "与本经理首次接触,无历史服务记录"],
      hidden: [
        "对银行推销电话强烈反感,接通即拒绝(不需要/别老打电话了)",
        "不会辱骂,但挂电话很果断",
        "若对方道歉干脆、不纠缠,会正常道别",
      ],
    },
    customerTurns: ["喂。", "不用不用,我不需要,你们别老打电话了。", "嗯。", "行,知道了。", "嗯,拜拜。"],
  },
};

async function main() {
  const personaKey = process.argv[2] ?? "";
  const spec = SCRIPTS[personaKey];
  if (!spec) {
    throw new Error(`用法: npx tsx product-dialogue-demo.ts <${Object.keys(SCRIPTS).join("|")}>`);
  }
  const outFile = path.join(DIR, spec.file);
  if (fs.existsSync(outFile)) {
    console.log(`已存在,跳过:${spec.file}`);
    return;
  }

  const real = new OpenAICompatibleModelAdapter({
    apiKey: loadKey(),
    baseUrl: process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1",
    model: process.env.MIMO_MODEL || "mimo-v2.5",
  });
  // 文案口用伪实现(策略卡即种子 SC1–SC3,确定性);对话口用真实模型——
  // 本演示验证的是「产品当前提示词 + 当前策略库」的对话质量。
  const core = createProductCore({
    copywriting: new FakeModelAdapter() as CopywritingPort,
    dialogue: real as DialoguePort,
    storage: new InMemoryStorage(),
  });

  const material = await core.analyzeTranscript({ transcript: "seed" });
  await core.publishMaterialCards(material.id);

  let personaId: string;
  if (spec.custom) {
    personaId = (await core.savePersona(spec.custom)).id;
  } else {
    personaId = spec.personaId!;
  }

  const conversation = await core.startConversation(personaId);
  const lines: string[] = [];
  let used = 0;

  for (const text of spec.customerTurns) {
    const after = await core.sendCustomerTurn(conversation.id, text);
    const turns = after.turns;
    const managerText = turns.at(-1)?.text ?? "(无回复)";
    lines.push(`- **客户**:${text}`);
    lines.push(`- **经理**:${managerText}`);
    console.log(`经理:${managerText.slice(0, 60)}${managerText.length > 60 ? "…" : ""}`);
    used += 1;
    if (after.status === "ended") break;
  }

  await core.finishConversation(conversation.id);
  const result = await core.getResult(conversation.id);

  const pathLines = result.strategyPath
    .map((e) => {
      const expr = e.keyExpression.slice(0, 50) + (e.keyExpression.length > 50 ? "…" : "");
      return `${e.turnNumber}. **${e.cardName}**(第 ${e.turnNumber} 轮)——「${expr}」〔来源:${e.source?.materialTitle ?? "无"} ${e.source?.turnRange ?? ""}〕`;
    })
    .join("\n");

  const managerTurnCount = result.turns.filter((t) => t.speaker === "manager").length;
  const md = `# Demo 对话记录:${spec.title}

- 日期:${new Date().toISOString()}
- 模型:mimo-v2.5(理财经理);客户由脚本轮次扮演
- 提示词:产品当前装配逻辑(src/adapters/prompts.ts);策略卡:种子 SC1–SC3
- 画像:${spec.title.split("(")[0]!.trim()}${spec.note ? `\n- ${spec.note}` : ""}
- 轮数:经理 ${managerTurnCount} 轮;客户脚本使用 ${used}/${spec.customerTurns.length} 轮

## 对话记录

${lines.join("\n")}

## 结果(产品 getResult 口径)

- 主要目标:${result.mainGoal}
- 沟通结果:${result.outcome}
- 结束原因:${result.endReason}

## 策略路径(引用的已发布策略卡)

${pathLines || "(无策略卡引用)"}

## 观察记录

- (分析结论由分析人补记;本文件为 L2 验证工件)
`;

  fs.writeFileSync(outFile, md, "utf8");
  console.log(`已写入 ${spec.file}`);
}

main().catch((e) => {
  console.error("演示失败:", (e as Error).message);
  process.exit(1);
});
