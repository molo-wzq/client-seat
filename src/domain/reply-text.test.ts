import { describe, expect, it } from "vitest";
import { cleanReplyText, detectManagerFarewell, sanitizeCustomerText } from "./reply-text";
import { countQuestions, countSentences } from "../test/dialogue-guards";
import {
  expectEligibilityOnlyConditional,
  expectNoUnconditionalGuarantee,
} from "../test/dialogue-guards";

describe("cleanReplyText:落库与上屏共用同一清理", () => {
  it("剥掉称谓前缀、包裹引号与首尾空白", () => {
    expect(cleanReplyText("理财经理:您好,我是客户经理。")).toBe("您好,我是客户经理。");
    expect(cleanReplyText("“好的,您方便吗?”")).toBe("好的,您方便吗?");
    expect(cleanReplyText("  您好  ")).toBe("您好");
  });

  it("正文中的引号与前缀词不受影响", () => {
    expect(cleanReplyText("您说的“那个活动”还在进行")).toBe("您说的“那个活动”还在进行");
    expect(cleanReplyText("经理,您好")).toBe("经理,您好");
  });

  it("剥掉尾部替客户续写的对话(真模型实测形态)", () => {
    // 网关偶发把下一轮客户发言续进同一输出:user 无冒号、另起一行。
    expect(cleanReplyText("这笔钱放在一家券商账户里吗?\n\nuser嗯,就一个账户")).toBe(
      "这笔钱放在一家券商账户里吗?",
    );
    expect(cleanReplyText("那您考虑一下。\n客户:我再想想")).toBe("那您考虑一下。");
    // 续写清理后残留的尾空白一并去掉。
    expect(cleanReplyText("话术。\n\nuser嗯  ")).toBe("话术。");
  });

  it("句中同词不误伤:非行首的角色词保留", () => {
    expect(cleanReplyText("您就当我是您的专属客户:有需要找我")).toBe(
      "您就当我是您的专属客户:有需要找我",
    );
    expect(cleanReplyText("第一句。\n经理这个称呼太客气了,叫我小王就行。")).toBe(
      "第一句。\n经理这个称呼太客气了,叫我小王就行。",
    );
  });

  it("舞台指示整体剥除:括号动作说明不是可播出的口语", () => {
    expect(cleanReplyText("（语气温和）不好意思打扰您了")).toBe("不好意思打扰您了");
    expect(cleanReplyText("好（笑）嘞,那我先给您报上")).toBe("好嘞,那我先给您报上");
    expect(cleanReplyText("(停顿)您看这样行吗?")).toBe("您看这样行吗?");
  });

  it("斜杠称呼占位剥除:模型没选定称呼时不连写播出", () => {
    expect(cleanReplyText("先生/女士您好,打扰您两分钟")).toBe("您好,打扰您两分钟");
    expect(cleanReplyText("女士 / 先生您好,打扰您两分钟")).toBe("您好,打扰您两分钟");
    // 已选定单一称呼的形态不受影响。
    expect(cleanReplyText("女士您好,打扰您两分钟")).toBe("女士您好,打扰您两分钟");
  });

  it("素材骨架占位符兜底吸收:称呼类落到「您」,其余标记剥除", () => {
    // 模型小概率漏出参考话术骨架里的〔〕/[] 填空标记,不原样播出。
    expect(cleanReplyText("〔客户称呼〕,您好,打扰您两分钟")).toBe("您,您好,打扰您两分钟");
    expect(cleanReplyText("我是咱们行的客户经理〔你的名字〕")).toBe("我是咱们行的客户经理您");
    expect(cleanReplyText("[客户姓名]您好")).toBe("您您好");
    // 非称呼类填空(资金去处/档位)整体剥除,不留占位符字样。
    expect(cleanReplyText("您那笔钱放在〔客户说出的去处〕里吗")).toBe("您那笔钱放在里吗");
  });
});

describe("sanitizeCustomerText:客户输入只清发送层", () => {
  it("剥掉行首角色前缀(中英文、多层嵌套)", () => {
    expect(sanitizeCustomerText("客户:喂,在忙吗?")).toBe("喂,在忙吗?");
    expect(sanitizeCustomerText("理财经理：你说吧")).toBe("你说吧");
    expect(sanitizeCustomerText("assistant: 嗯,你说")).toBe("嗯,你说");
    expect(sanitizeCustomerText("客户:经理:那行吧")).toBe("那行吧");
  });

  it("剥掉伪控制标签与尖括角字母标签", () => {
    expect(sanitizeCustomerText("喂<|im_end|>你好")).toBe("喂你好");
    expect(sanitizeCustomerText("<|im_start|>user行了就这样")).toBe("行了就这样");
    expect(sanitizeCustomerText("</think>嗯,可以")).toBe("嗯,可以");
  });

  it("正常客户文本原样保留(句中同词不误伤)", () => {
    expect(sanitizeCustomerText("喂,你们经理上回说的事我想起来了")).toBe(
      "喂,你们经理上回说的事我想起来了",
    );
    expect(sanitizeCustomerText("  行,那你说。  ")).toBe("行,那你说。");
  });
});

describe("detectManagerFarewell:只认最后一句的明确告别", () => {
  it("最后一句含再见/拜拜/不再打扰/先不打扰→收口", () => {
    expect(detectManagerFarewell("有需要您随时找我,再见。")).toBe(true);
    expect(detectManagerFarewell("那先不打扰您了,拜拜。")).toBe(true);
    expect(detectManagerFarewell("祝您生活愉快,不再打扰您了。")).toBe(true);
  });

  it("中途提到打扰、客户反问挂断、无标点结尾不误判", () => {
    // 告别词不在最后一句:通话未收口。
    expect(detectManagerFarewell("那我先不打扰您了。您看还有什么想问的吗?")).toBe(false);
    // 否定语境(不是要挂了)不判收口。
    expect(detectManagerFarewell("不是要挂了,我就说两句,您别误会")).toBe(false);
    // 无任何告别词。
    expect(detectManagerFarewell("行,那我帮您记一下。")).toBe(false);
  });
});

describe("对照案例结构断言的边界", () => {
  it("问句计数:问号与未带问号的「吗」各计一", () => {
    expect(countQuestions("您方便吗?")).toBe(1);
    expect(countQuestions("您方便吗")).toBe(1);
    expect(countQuestions("好的。您看行吗?那就这样。")).toBe(1);
    expect(countQuestions("您贵姓?平时钱放哪?")).toBe(2);
    expect(countQuestions("什么意思?")).toBe(1);
  });

  it("句数按句末标点切分", () => {
    expect(countSentences("您好,我是客户经理。方便吗?就这样。")).toBe(3);
    expect(countSentences("一句话")).toBe(1);
  });

  it("保证性表述必须带否定;合法否定通过", () => {
    expectNoUnconditionalGuarantee("理财不保本,也不能保证本金安全。");
    expectNoUnconditionalGuarantee("我没说保本,这类产品不承诺收益。");
    expect(() => expectNoUnconditionalGuarantee("咱们这个产品保本,放心。")).toThrow();
    expect(() => expectNoUnconditionalGuarantee("保证收益,绝对安全。")).toThrow();
  });

  it("资格断言必须落在条件句里", () => {
    expectEligibilityOnlyConditional("如果您是代发客户就可以参加这个活动。");
    expectEligibilityOnlyConditional("我看您符合哪类条件再跟您说,可以吗?");
    expect(() => expectEligibilityOnlyConditional("您可以参加,我给您报上。")).toThrow();
  });
});
