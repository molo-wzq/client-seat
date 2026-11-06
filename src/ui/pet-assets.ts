/**
 * 桌宠立绘表(工单 15):男女两版 × 五种表情的图片与展示名。
 * 拆出来让 DeskPet 只管组合,资源引用归一处。
 */
import type { PetEmotion } from "../shared/agent-contract";
import type { PetVariant } from "./DeskPet";
import fCheer from "../assets/desk-pet/f-cheer.webp";
import fPout from "../assets/desk-pet/f-pout.webp";
import fSleepy from "../assets/desk-pet/f-sleepy.webp";
import fThink from "../assets/desk-pet/f-think.webp";
import fWave from "../assets/desk-pet/f-wave.webp";
import mCheer from "../assets/desk-pet/m-cheer.webp";
import mPout from "../assets/desk-pet/m-pout.webp";
import mSleepy from "../assets/desk-pet/m-sleepy.webp";
import mThink from "../assets/desk-pet/m-think.webp";
import mWave from "../assets/desk-pet/m-wave.webp";

export const petImg: Record<PetVariant, Record<PetEmotion, string>> = {
  f: { wave: fWave, think: fThink, cheer: fCheer, sleepy: fSleepy, pout: fPout },
  m: { wave: mWave, think: mThink, cheer: mCheer, sleepy: mSleepy, pout: mPout },
};

export const variantLabel: Record<PetVariant, string> = { f: "女版", m: "男版" };

export const expressionLabel: Record<PetEmotion, string> = {
  wave: "挥手笑",
  think: "拿笔想",
  cheer: "欢呼",
  sleepy: "打瞌睡",
  pout: "鼓腮",
};
