# DOCX template contract

- Reference: `C:\Users\65198\Downloads\1.docx`
- SHA-256: `5150d2c57f800f987bf96feab4968a24fef3be71cca5281abd52a37a64dd3bed`
- Reference render: `D:\话术对练\.scratch\docx-fill\reference-render`
- Page count: 2
- Section count: 1

## Page system

- A4 portrait, 8.27 by 11.69 inches.
- Margins: left and right 1.25 inches, top and bottom 1 inch.
- No visible header or footer, no first-page variation, one continuous document section.

## Typography and spacing

- Main title `二、作品情况`: Heading 1, 黑体, 16 pt, black, left aligned.
- Section headings: Heading 1, 楷体_GB2312, 16 pt, black, left aligned.
- Body paragraphs: Body Text, 仿宋_GB2312, 16 pt, black, justified by the source style.
- Source paragraphs use 1.5-line spacing and first-line indentation. Preserve their direct paragraph and run formatting.
- The source has no tables, drawings, images, content controls, fields, footnotes, headers, or footers.

## Content flow and slots

- Preserve paragraph 0 as the main title.
- Preserve paragraphs 1, 4, 7, 11, 14, and 17 as section headings.
- Replace the guidance paragraphs below sections 1 through 5 with one natural response paragraph each; remove their word-limit reminder paragraphs.
- Replace the guidance list below section 6 with available project links, screenshots, supporting materials, and one typical-use example. Do not claim an unavailable video or hosted deployment.
- Keep every section in its current order. The response paragraphs may paginate differently because they replace the prompts, but page geometry and visual system must remain source-derived.

## Package preservation

- Preserve styles, theme, font table, settings, document relationships, custom properties, page setup, and empty header/footer behavior.
- Editable part: body text in `word/document.xml` for the intended slots only.
- Preserve-only parts: all remaining package parts and relationships.

## Fidelity gates

- Retain the source file byte-for-byte at its original path.
- Keep all titles and headings black and source-formatted.
- No clipping, overlap, missing Chinese glyphs, broken indentation, or stranded headings.
- Verify every final page visually at 100 percent and confirm all six sections are present.
