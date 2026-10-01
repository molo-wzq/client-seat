import { describe, expect, it } from "vitest";
import { extractCardNumbers, hasOutOfCardNumber } from "./product-facts";
import { SEED_PRODUCT_CARD } from "./seed";
import type { ConversationTurn } from "./types";

function turns(...texts: Array<[ConversationTurn["speaker"], string]>): ConversationTurn[] {
  return texts.map(([speaker, text], i) => ({ number: i + 1, speaker, text }));
}

describe("extractCardNumbers:带量词数字提取与归一", () => {
  it("阿拉伯与中文数字都提取,万统一折元", () => {
    expect(extractCardNumbers("像20万档就有150块")).toEqual([
      { canonical: 200000, unit: "yuan" },
      { canonical: 150, unit: "yuan" },
    ]);
    expect(extractCardNumbers("您这十五万,到二十万档还差5万")).toEqual([
      { canonical: 150000, unit: "yuan" },
      { canonical: 200000, unit: "yuan" },
      { canonical: 50000, unit: "yuan" },
    ]);
  });

  it("比例与天数各归各的单位", () => {
    expect(extractCardNumbers("参考年化约2%到3%,T+1到账")).toEqual([
      { canonical: 2, unit: "percent" },
      { canonical: 3, unit: "percent" },
    ]);
    expect(extractCardNumbers("放7天也行")).toEqual([{ canonical: 7, unit: "day" }]);
  });

  it("日期、轮次、无单位数字不抓", () => {
    expect(extractCardNumbers("本月底31号前报名,通话最多12轮,T+1")).toEqual([]);
    expect(extractCardNumbers("您是第1位")).toEqual([]);
  });

  it("约数后缀(来/多)不失效", () => {
    expect(extractCardNumbers("大概二十来万")).toEqual([{ canonical: 200000, unit: "yuan" }]);
  });
});

describe("hasOutOfCardNumber:白名单核对", () => {
  it("产品卡事实与客户口述数字放行", () => {
    expect(
      hasOutOfCardNumber("您这15万到20万档,能拿150块立减金", SEED_PRODUCT_CARD, [
        ...turns(["customer", "大概十五万吧"]),
      ]),
    ).toBe(false);
    expect(hasOutOfCardNumber("参考年化2%到3%,5万档给50元", SEED_PRODUCT_CARD, [])).toBe(false);
  });

  it("此前经理报过的数字不重复记账", () => {
    expect(
      hasOutOfCardNumber("刚才说的20万档还有效", SEED_PRODUCT_CARD, [
        ...turns(["customer", "你好"], ["manager", "像20万档就有150块"]),
      ]),
    ).toBe(false);
  });

  it("卡外数字被抓:编造收益与编造权益", () => {
    expect(hasOutOfCardNumber("咱这产品年化3.5%,很稳", SEED_PRODUCT_CARD, [])).toBe(true);
    expect(hasOutOfCardNumber("存10万给80块立减金", SEED_PRODUCT_CARD, [])).toBe(true);
  });

  it("客户自己的数字被经理复述不算卡外", () => {
    expect(
      hasOutOfCardNumber("您刚才说有8万,报到5万档就够", SEED_PRODUCT_CARD, [
        ...turns(["customer", "我有8万闲钱"]),
      ]),
    ).toBe(false);
  });
});
