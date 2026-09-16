from __future__ import annotations

import hashlib
import shutil
import tempfile
import zipfile
from pathlib import Path

from lxml import etree


SOURCE = Path(r"C:\Users\65198\Downloads\1.docx")
OUTPUT = Path(r"D:\话术对练\作品情况填写版.docx")
EXPECTED_SHA256 = "5150d2c57f800f987bf96feab4968a24fef3be71cca5281abd52a37a64dd3bed"

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

REPLACEMENTS = {
    "简要说明作品应用于什么工作场景，当前主要存在什么痛点、难点或堵点。":
        "作品用于银行理财经理首次联系存量生客前后的话术练习。现在的难点不是缺少优秀录音，而是经验散在录音和个人笔记里，主要靠口头带教，复用起来比较慢；常见培训又偏向背话术，员工很难站在客户角度感受开场、探询和收口是否合适。真实客户数据和正式沟通也不适合拿来反复试错。",
    "简要说明AI智能体如何解决上述问题，包括主要功能、使用方式、基本流程以及所使用的AI能力或工具。":
        "Client Seat把流程做成一场“客户席”对练：先把脱敏录音转成分角色文字稿，AI生成案例分析和1—3张策略卡草稿，团队修改确认后再发布。对练时，员工扮演客户，选择带有可见信息和隐藏想法的生客画像；AI扮演理财经理，只能读取可见信息和已发布策略卡，根据客户当下反应推进或收口。结束后，系统展示每轮用了哪张策略卡，并回到原始录音轮次复盘。系统用到语音转写、大模型结构化分析、多轮对话生成和规则校验；未配置模型时也能用演示模式走完整流程。",
    "说明作品目前已实现的功能和实际效果，可结合具体任务说明使用前后的变化，如工作时间缩短、人工操作减少、质量提升、操作流程简化等。":
        "目前已跑通“录音导入—转写校对—策略提炼—人工发布—模拟对话—复盘追溯”的Web闭环，并完成真实录音摄入验收和端到端自动化测试。原来要人工反复听录音、整理方法，再找人陪练；现在一段素材可以沉淀成带来源的策略卡，员工随时换客户画像重练，复盘也能直接定位到具体策略和原始轮次，减少重复整理和陪练成本。系统还限制对话轮次，并在客户明确拒绝时体面收口。项目尚未开展正式的小范围业务试用，当前效果以功能验收和演示验证为主。",
    "简要说明作品在应用场景、智能体设计、工作流程、工具组合或使用方式等方面的创新之处。":
        "比较特别的是，员工不再扮演理财经理，而是坐到“客户席”，亲自感受开场、追问和推进是否让人舒服。系统也不让AI直接模仿整段录音，而是先把经验拆成“客户信号—沟通目的—动作链—表达原则”的策略卡。卡片要经过人工确认才能上场；每轮用卡还可以回到原始片段，方便判断AI有没有乱用。",
    "说明作品对经营管理、客户服务、风险防控或办公提效等方面的价值，以及后续在其他部门、机构、岗位或类似场景推广应用的可能性。":
        "对个人，产品把零散经验变成随时可练、可复盘的方法，降低陪练组织成本；对团队，优秀通话可以持续沉淀，策略是否好用也能在不同客户画像中反复验证。隐藏信息隔离、产品事实卡和人工发布机制，可以减少AI臆测和不合规表达。下一步可先在网点新员工、转岗客户经理和晨夕会训练中小范围试用；方法成熟后，可换素材和规则扩展到保险、客服、催收等沟通场景。进入真实业务前，仍需补齐合规评审、数据权限和使用边界。",
    "可提供以下一种或多种材料：":
        "1.作品链接：https://github.com/molo-wzq/client-seat",
    "1.AI智能体访问方式或作品链接；":
        "2.访问方式：下载项目后按README启动，浏览器打开http://localhost:5173；未配置模型时可直接用演示模式体验。",
    "2.主要功能截图；":
        "3.主要截图：布置幕、对局幕、结算页、策略卡列表，文件见docs/ui-setup.png、docs/ui-table.png、docs/ui-postgame.png、docs/ui-cards.png。",
    "3.演示视频；":
        "4.配套材料：交互式游戏手册docs/game-manual.html、产品架构图docs/architecture-external.html、参赛使用说明docs/client-seat-submission-guide.md。",
    "4.典型使用案例；":
        "5.典型案例：员工选择存量生客画像入座，AI根据已发布策略卡完成首次触达；结束后按轮次复盘策略路径和原始素材片段。",
}

REMOVE = {
    "建议不超过200字。",
    "建议不超过300字。",
    "如已开展实际试用，可简要说明试用范围及反馈情况。",
    "5.其他能够体现作品实际效果的材料。",
}


def paragraph_text(paragraph: etree._Element) -> str:
    return "".join(paragraph.xpath(".//w:t/text()", namespaces=NS))


def replace_paragraph_text(paragraph: etree._Element, text: str) -> None:
    text_nodes = paragraph.xpath(".//w:t", namespaces=NS)
    if not text_nodes:
        raise RuntimeError(f"Paragraph has no text node: {paragraph_text(paragraph)!r}")
    text_nodes[0].text = text
    text_nodes[0].set(XML_SPACE, "preserve")
    for node in text_nodes[1:]:
        node.text = ""


def set_keep_with_next(paragraph: etree._Element) -> None:
    paragraph_properties = paragraph.find("w:pPr", NS)
    if paragraph_properties is None:
        paragraph_properties = etree.Element(f"{{{NS['w']}}}pPr")
        paragraph.insert(0, paragraph_properties)
    keep_next = paragraph_properties.find("w:keepNext", NS)
    if keep_next is None:
        keep_next = etree.SubElement(paragraph_properties, f"{{{NS['w']}}}keepNext")
    keep_next.set(f"{{{NS['w']}}}val", "1")


def set_body_text_style(paragraph: etree._Element) -> None:
    paragraph_properties = paragraph.find("w:pPr", NS)
    if paragraph_properties is None:
        raise RuntimeError("Paragraph properties missing")
    style = paragraph_properties.find("w:pStyle", NS)
    if style is None:
        style = etree.SubElement(paragraph_properties, f"{{{NS['w']}}}pStyle")
    style.set(f"{{{NS['w']}}}val", "11")
    alignment = paragraph_properties.find("w:jc", NS)
    if alignment is None:
        alignment = etree.SubElement(paragraph_properties, f"{{{NS['w']}}}jc")
    alignment.set(f"{{{NS['w']}}}val", "left")
    indentation = paragraph_properties.find("w:ind", NS)
    if indentation is None:
        indentation = etree.SubElement(paragraph_properties, f"{{{NS['w']}}}ind")
    for attribute in ("firstLine", "firstLineChars"):
        indentation.attrib.pop(f"{{{NS['w']}}}{attribute}", None)
    indentation.set(f"{{{NS['w']}}}left", "640")
    indentation.set(f"{{{NS['w']}}}hanging", "640")


def main() -> None:
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise RuntimeError(f"Reference changed: {digest}")

    with tempfile.TemporaryDirectory(prefix="docx-fill-") as tmp:
        work = Path(tmp)
        with zipfile.ZipFile(SOURCE, "r") as archive:
            archive.extractall(work)

        document_path = work / "word" / "document.xml"
        parser = etree.XMLParser(remove_blank_text=False)
        tree = etree.parse(str(document_path), parser)
        body = tree.getroot().find("w:body", NS)
        if body is None:
            raise RuntimeError("Document body missing")

        seen_replacements: set[str] = set()
        seen_removals: set[str] = set()
        for paragraph in list(body.xpath("./w:p", namespaces=NS)):
            current = paragraph_text(paragraph)
            if current in REPLACEMENTS:
                replace_paragraph_text(paragraph, REPLACEMENTS[current])
                if current in {
                    "可提供以下一种或多种材料：",
                    "1.AI智能体访问方式或作品链接；",
                    "2.主要功能截图；",
                    "3.演示视频；",
                    "4.典型使用案例；",
                }:
                    set_body_text_style(paragraph)
                seen_replacements.add(current)
            elif current in REMOVE:
                body.remove(paragraph)
                seen_removals.add(current)

        missing_replacements = set(REPLACEMENTS) - seen_replacements
        missing_removals = REMOVE - seen_removals
        if missing_replacements or missing_removals:
            raise RuntimeError(
                f"Unmatched slots. replacements={missing_replacements}, removals={missing_removals}"
            )

        for paragraph in body.xpath("./w:p", namespaces=NS):
            if paragraph_text(paragraph).startswith("（"):
                set_keep_with_next(paragraph)

        tree.write(
            str(document_path),
            xml_declaration=True,
            encoding="UTF-8",
            standalone=True,
        )

        if OUTPUT.exists():
            OUTPUT.unlink()
        with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(work.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(work).as_posix())

    for label, value in list(REPLACEMENTS.items())[:5]:
        print(f"{label[:12]}... -> {len(value)} chars")
    print(OUTPUT)


if __name__ == "__main__":
    main()
