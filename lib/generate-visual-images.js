import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateSlideImage } from "./gemini-client.js";
import { buildVisualPrompt, shouldSkipAutoGenerate } from "./visual-prompt.js";

const MANIFEST_NAME = "manifest.json";

/** @param {string} text */
function hashDescription(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * @param {string} projectDir
 * @returns {{ dir: string, manifestPath: string, manifest: Record<string, object> }}
 */
function loadManifest(projectDir) {
  const dir = path.join(projectDir, "images", "gen");
  const manifestPath = path.join(dir, MANIFEST_NAME);
  fs.mkdirSync(dir, { recursive: true });
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
  }
  return { dir, manifestPath, manifest };
}

/**
 * @param {object[]} slides
 * @param {string} projectDir
 * @param {{ forceRegenerateImages?: boolean }} options
 */
export async function generateVisualImages(slides, projectDir, options = {}) {
  const { forceRegenerateImages = false } = options;
  const warnings = [];
  const imageResults = [];
  const { dir, manifestPath, manifest } = loadManifest(projectDir);

  let hasApiKey = true;
  try {
    const { loadSlideUpaEnv } = await import("./load-env.js");
    loadSlideUpaEnv();
    if (!process.env.GEMINI_API_KEY?.trim()) hasApiKey = false;
  } catch {
    hasApiKey = false;
  }

  if (!hasApiKey) {
    warnings.push("GEMINI_API_KEY が未設定のため、[image:] の自動生成をスキップしました。");
    return { slides, imageResults, warnings };
  }

  for (const slide of slides) {
    if (slide.type !== "visual" || !slide.imageSlots?.length) continue;

    const slideId = `s${slide.index}`;

    for (let j = 0; j < slide.imageSlots.length; j++) {
      const slot = slide.imageSlots[j];
      const slotKey = `${slideId}-visual${j}`;
      const relFile = `gen/${slotKey}.png`;
      const absFile = path.join(projectDir, "images", relFile);

      if (slot.charFile) {
        imageResults.push({ slotId: slotKey, status: "skipped", message: "キャラクター画像を使用" });
        continue;
      }

      if (shouldSkipAutoGenerate(slot.description)) {
        imageResults.push({
          slotId: slotKey,
          status: "skipped",
          message: "画面キャプチャは手動アップロードが必要です",
        });
        warnings.push(`「${slide.heading}」の [image:] はキャプチャ指示のため自動生成しません。studio でアップロードしてください。`);
        continue;
      }

      const descHash = hashDescription(slot.description);
      const cached = manifest[slotKey];

      if (!forceRegenerateImages && cached?.descriptionHash === descHash && cached?.file) {
        const cachedAbs = path.join(projectDir, "images", cached.file);
        if (fs.existsSync(cachedAbs)) {
          slot.generatedFile = cached.file;
          imageResults.push({ slotId: slotKey, status: "cached", message: cached.file });
          continue;
        }
      }

      const prompt = buildVisualPrompt({
        heading: slide.heading,
        description: slot.description,
        script: slide.script,
      });

      try {
        console.log(`[slide-upa] 画像生成中: ${slotKey} …`);
        const { buffer, mimeType, model } = await generateSlideImage(prompt);
        fs.writeFileSync(absFile, buffer);
        slot.generatedFile = relFile;
        manifest[slotKey] = {
          descriptionHash: descHash,
          description: slot.description,
          file: relFile,
          model,
          mimeType,
          createdAt: new Date().toISOString(),
        };
        imageResults.push({ slotId: slotKey, status: "generated", message: relFile, model });
      } catch (e) {
        const message = e?.message ?? String(e);
        imageResults.push({ slotId: slotKey, status: "failed", message });
        warnings.push(`「${slide.heading}」の画像生成に失敗しました: ${message}`);
        console.error(`[slide-upa] 画像生成失敗 ${slotKey}:`, e);
      }
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { slides, imageResults, warnings };
}
