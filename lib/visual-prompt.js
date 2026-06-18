/**
 * @param {{ heading: string, description: string }} params
 * @returns {string}
 */
export function buildVisualPrompt({ heading, description }) {
  const noText =
    /文字なし|文字ラベルなし|文字は入れない|no text/i.test(description);

  const lines = [
    "Create a single educational presentation slide illustration.",
    "",
    "Style requirements:",
    "- Clean flat diagram on white background",
    "- 16:9 landscape slide composition",
    "- Simple shapes, arrows, and icons — no photorealism",
    "- Accent color: teal #0d9488; secondary: dark gray",
    "- Minimal decoration, professional training slide look",
  ];

  if (noText) {
    lines.push(
      "- CRITICAL: Do not include any text, letters, numbers, or labels in the image",
      "- Use icons and symbols only to convey meaning",
    );
  } else {
    lines.push("- Japanese text labels must be legible and spelled exactly as specified");
  }

  lines.push(
    "",
    `Slide section title (for context only, do not render as text): ${heading}`,
    `Diagram to draw: ${description}`,
    "",
    "Output one diagram only. No watermark or footer text.",
  );

  return lines.join("\n");
}

/** @param {string} description */
export function shouldSkipAutoGenerate(description) {
  return /キャプチャ|スクリーンショット|画面キャプチャ|screenshot|screen\s*capture/i.test(description);
}
