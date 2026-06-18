/**
 * [image:] 説明から「伝えたいこと」と図の内容を分離する。
 * @param {string} description
 */
export function parseImageDescription(description) {
  const allowText =
    /文字あり|ラベルあり|text\s*ok|labels?\s*ok/i.test(description);

  let takeaway = "";
  let diagram = description.trim();

  diagram = diagram
    .replace(/文字なし|文字ラベルなし|文字は入れない|no text/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const quotedTakeaway = description.match(/伝えたいこと[「『:：]\s*([^」』]+)[」』]?/u);
  if (quotedTakeaway) {
    takeaway = quotedTakeaway[1].trim();
    diagram = diagram.replace(/伝えたいこと[「『:：][^」』]+[」』]?\s*/u, "").trim();
  } else {
    const plainTakeaway = description.match(/伝えたいこと[:：]\s*(.+?)(?=。|\s*比喩[:：]|$)/u);
    if (plainTakeaway) {
      takeaway = plainTakeaway[1].trim();
      diagram = diagram.replace(/伝えたいこと[:：].+?(?=。|\s*比喩[:：]|$)/u, "").trim();
    }
  }

  const metaphorMatch = diagram.match(/比喩[:：]\s*(.+)$/su);
  if (metaphorMatch) {
    diagram = metaphorMatch[1].trim();
  } else {
    const legacyDiagramMatch = diagram.match(/図[:：]\s*(.+)$/su);
    if (legacyDiagramMatch) {
      diagram = legacyDiagramMatch[1].trim();
    }
  }

  diagram = diagram.replace(/^[。、.\s]+/u, "").trim();

  return { allowText, takeaway, diagram };
}

/**
 * @param {{ heading: string, description: string, script?: string }} params
 * @returns {string}
 */
export function buildVisualPrompt({ heading, description, script = "" }) {
  const { allowText, takeaway, diagram } = parseImageDescription(description);

  const lines = [
    "Create a single educational presentation slide illustration.",
    "The viewer must grasp the core idea within 2 seconds — training slide, not decorative art.",
    "",
    "Cognitive clarity without text (most important):",
    "- Communicate ONE clear takeaway through composition alone — no words needed",
    "- Use a visual story: before→after, scattered→unified, many→one, chaos→order, or problem→solution",
    "- Make contrast obvious with size, color weight, line thickness, and spacing",
    "  (messy/small/faded on the left → clean/large/bold on the right)",
    "- Each icon must be instantly recognizable and visually distinct from the others",
    "- Use universal symbols only (arrows, stars, folder shapes, document shapes)",
    "- Prefer left-to-right flow for processes; use a central hub when things aggregate",
    "- The final / resolved state should be the largest and most visually prominent element",
    "",
    "Style requirements:",
    "- Clean flat diagram on white background",
    "- 16:9 landscape slide composition",
    "- Simple shapes, arrows, and icons — no photorealism",
    "- Accent color: teal #0d9488; secondary: dark gray",
    "- Minimal decoration, professional training slide look",
  ];

  if (allowText) {
    lines.push("- Short text labels are allowed only when explicitly requested in the diagram description");
  } else {
    lines.push(
      "- CRITICAL: Zero text in the image — no letters, numbers, Japanese characters, captions, titles, or labels",
      "- Do not render the slide heading or narration as text",
      "- Meaning must come from icons, spatial layout, contrast, and arrows alone",
    );
  }

  if (takeaway) {
    lines.push("", `Core message to express visually (do NOT write this as text): ${takeaway}`);
  }

  const narration = script?.trim();
  if (narration) {
    lines.push(
      "",
      "Narration context (for your understanding only — do NOT render any of this as text):",
      narration.slice(0, 600),
    );
  }

  lines.push(
    "",
    `Slide topic (context only, never render as text): ${heading}`,
    `Visual metaphor to draw: ${diagram || description}`,
    "",
    "Output one diagram only. No watermark or footer text.",
  );

  return lines.join("\n");
}

/** @param {string} description */
export function shouldSkipAutoGenerate(description) {
  return /キャプチャ|スクリーンショット|画面キャプチャ|screenshot|screen\s*capture/i.test(description);
}
