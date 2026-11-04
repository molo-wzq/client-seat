import { describe, expect, it } from "vitest";
import { buildDefaultResearchReport, loadCurrentResearchReport } from "./report-parser";

describe("周报解析与分段模型", () => {
  it("默认周报构建包含完整的 4 个即查分段", () => {
    const report = buildDefaultResearchReport();
    expect(report.id).toBe("2026-10-23");
    expect(report.period).toContain("2026-10-19");
    expect(report.sections.macro.headline).toContain("底部区间");
    expect(report.sections.macro.cards.length).toBeGreaterThanOrEqual(2);
    expect(report.sections.sector.leadingSectors.length).toBeGreaterThan(0);
    expect(report.sections.product.featuredPool.length).toBeGreaterThan(0);
    expect(report.sections.risk.objections.length).toBeGreaterThan(0);
  });

  it("可复制话术存在且非空", () => {
    const report = buildDefaultResearchReport();
    const copyables = report.sections.macro.cards.filter((c) => Boolean(c.copyableText));
    expect(copyables.length).toBeGreaterThan(0);
    expect(copyables[0]?.copyableText).toContain("张总您好");
  });

  it("loadCurrentResearchReport 读取有效数据", () => {
    const report = loadCurrentResearchReport(process.cwd());
    expect(report.id).toBeTruthy();
    expect(report.sections.product.allocationAdvice.conservative).toContain("防御层");
  });
});
