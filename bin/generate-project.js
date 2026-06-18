#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regenerateProject } from "../lib/generate-from-script.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const forceImages = args.includes("--force-images");
const noImages = args.includes("--no-images");
const projectArg = args.find((a) => !a.startsWith("--"));

if (!projectArg) {
  console.error("使い方: node bin/generate-project.js <output/プロジェクト名> [--force-images] [--no-images]");
  process.exit(1);
}

const projectDir = path.isAbsolute(projectArg) ? projectArg : path.join(ROOT, projectArg);

try {
  const result = await regenerateProject(projectDir, {
    generateImages: !noImages,
    forceRegenerateImages: forceImages,
  });
  console.log(`✅ ${result.slideCount} 枚のスライドを生成しました`);
  if (result.imageResults?.length) {
    for (const r of result.imageResults) {
      console.log(`  ${r.slotId}: ${r.status}${r.message ? ` — ${r.message}` : ""}`);
    }
  }
  if (result.warnings?.length) {
    console.warn("\n警告:\n" + result.warnings.join("\n"));
  }
} catch (e) {
  if (e.code === "VALIDATION") {
    console.error("台本の形式エラー:\n" + (e.errors ?? []).join("\n"));
  } else {
    console.error(e.message ?? e);
  }
  process.exit(1);
}
