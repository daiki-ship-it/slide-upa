import fs from "node:fs";
import path from "node:path";
import { parseScript } from "./parse-script.js";
import { renderAudienceHtml, extractEditIds } from "./render-slides.js";
import { writeCanonicalScript } from "./context-script.js";
import { generateVisualImages } from "./generate-visual-images.js";

/** @param {object} deck */
export function chapterTitleEditIds(deck) {
  const ids = new Set();
  for (const slide of deck?.slides ?? []) {
    if (slide.type === "chapter") ids.add(`s${slide.index}-title`);
  }
  return ids;
}

/** @param {string} html */
export function sanitizeChapterTitleHtml(html) {
  return String(html).replace(/<br\s*\/?>/gi, "");
}

/** @param {string} html @param {object} deck */
export function sanitizeChapterTitlesInAudienceHtml(html, deck) {
  let result = html;
  for (const editId of chapterTitleEditIds(deck)) {
    const marker = `data-edit-id="${editId}"`;
    const startIdx = result.indexOf(marker);
    if (startIdx === -1) continue;
    const tagOpenStart = result.lastIndexOf("<", startIdx);
    if (tagOpenStart === -1) continue;
    const openEnd = result.indexOf(">", startIdx);
    if (openEnd === -1) continue;
    const tagMatch = result.slice(tagOpenStart, openEnd + 1).match(/^<(\w+)/);
    if (!tagMatch) continue;
    const contentStart = openEnd + 1;
    const closeTag = `</${tagMatch[1]}>`;
    const closeIdx = result.indexOf(closeTag, contentStart);
    if (closeIdx === -1) continue;
    const inner = result.slice(contentStart, closeIdx);
    const cleaned = sanitizeChapterTitleHtml(inner);
    if (inner !== cleaned) {
      result = result.slice(0, contentStart) + cleaned + result.slice(closeIdx);
    }
  }
  return result;
}

/** @param {object} el */
function overrideHasLayoutState(el) {
  return (
    (el.translateX != null && el.translateX !== 0) ||
    (el.translateY != null && el.translateY !== 0) ||
    el.editWidth != null ||
    el.editHeight != null ||
    el.imageSrc != null ||
    el.charSrc != null ||
    (el.group != null && el.group !== "")
  );
}

/** @param {object} overrides @param {object} deck */
export function stripChapterTitleHtmlOverrides(overrides, deck) {
  const titleIds = chapterTitleEditIds(deck);
  for (const [slideKey, slide] of Object.entries(overrides?.slides ?? {})) {
    for (const [editId, el] of Object.entries(slide?.elements ?? {})) {
      if (!titleIds.has(editId) || el.html == null) continue;
      delete el.html;
      if (!overrideHasLayoutState(el)) {
        delete slide.elements[editId];
      }
    }
    if (slide?.elements && Object.keys(slide.elements).length === 0) {
      delete overrides.slides[slideKey];
    }
  }
  return overrides;
}

/**
 * @param {object} oldOverrides
 * @param {object} oldDeck
 * @param {object} newDeck
 * @param {string} newHtml
 * @param {boolean} preserveOverrides
 */
export function mergeOverrides(oldOverrides, oldDeck, newDeck, newHtml, preserveOverrides) {
  if (!preserveOverrides) {
    return { overrides: { slides: {} }, kept: 0, removed: countOverrideElements(oldOverrides) };
  }

  const validEditIds = extractEditIds(newHtml);
  const oldSlides = oldOverrides?.slides ?? {};
  const oldDeckSlides = oldDeck?.slides ?? [];
  const newDeckSlides = newDeck?.slides ?? [];

  /** @type {Record<string, Record<string, object>>} */
  const headingToOldIndex = {};
  for (const slide of oldDeckSlides) {
    if (slide.heading) headingToOldIndex[slide.heading] = slide.index;
  }

  /** @type {Record<string, number>} */
  const headingToNewIndex = {};
  for (const slide of newDeckSlides) {
    if (slide.heading) headingToNewIndex[slide.heading] = slide.index;
  }

  const newOverrides = { slides: {} };
  const chapterTitles = chapterTitleEditIds({ slides: newDeckSlides });
  let kept = 0;
  let removed = 0;

  for (const [oldKey, slideOverride] of Object.entries(oldSlides)) {
    const oldIndex = Number(oldKey);
    const oldSlideMeta = oldDeckSlides[oldIndex];
    const heading = oldSlideMeta?.heading;
    const newIndex = heading != null ? headingToNewIndex[heading] : oldIndex;
    const targetKey = newIndex != null && newIndex >= 0 ? String(newIndex) : oldKey;

    const elements = slideOverride?.elements ?? {};
    for (const [editId, el] of Object.entries(elements)) {
      if (!validEditIds.has(editId)) {
        removed += 1;
        continue;
      }

      const copied = { ...el };
      if (chapterTitles.has(editId)) {
        if (copied.html != null) delete copied.html;
        if (!overrideHasLayoutState(copied)) {
          removed += 1;
          continue;
        }
      }

      if (!newOverrides.slides[targetKey]) newOverrides.slides[targetKey] = { elements: {} };
      newOverrides.slides[targetKey].elements[editId] = copied;
      kept += 1;
    }
  }

  stripChapterTitleHtmlOverrides(newOverrides, { slides: newDeckSlides });
  return { overrides: newOverrides, kept, removed };
}

/** @param {object} overrides */
function countOverrideElements(overrides) {
  let n = 0;
  for (const slide of Object.values(overrides?.slides ?? {})) {
    n += Object.keys(slide?.elements ?? {}).length;
  }
  return n;
}

/**
 * @param {string} projectDir
 * @param {{ preserveOverrides?: boolean, generateImages?: boolean, forceRegenerateImages?: boolean }} options
 */
export async function regenerateProject(projectDir, options = {}) {
  const {
    preserveOverrides = true,
    generateImages = true,
    forceRegenerateImages = false,
  } = options;
  const scriptPath = path.join(projectDir, "script.md");
  const deckPath = path.join(projectDir, "deck.json");
  const audiencePath = path.join(projectDir, "audience.html");
  const overridesPath = path.join(projectDir, "overrides.json");

  if (!fs.existsSync(scriptPath)) {
    throw Object.assign(new Error("script.md が見つかりません"), { code: "NO_SCRIPT" });
  }

  const scriptContent = fs.readFileSync(scriptPath, "utf8");
  const parsed = parseScript(scriptContent);

  if (parsed.errors.length > 0) {
    const err = new Error("台本の形式エラー");
    err.code = "VALIDATION";
    err.errors = parsed.errors;
    err.warnings = parsed.warnings;
    throw err;
  }

  let slides = parsed.slides;
  let imageResults = [];

  if (generateImages) {
    const gen = await generateVisualImages(slides, projectDir, { forceRegenerateImages });
    slides = gen.slides;
    imageResults = gen.imageResults;
    parsed.warnings.push(...gen.warnings);
  }

  let oldDeck = null;
  if (fs.existsSync(deckPath)) {
    try {
      oldDeck = JSON.parse(fs.readFileSync(deckPath, "utf8"));
    } catch {
      oldDeck = null;
    }
  }

  let oldOverrides = { slides: {} };
  if (fs.existsSync(overridesPath)) {
    try {
      oldOverrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    } catch {
      oldOverrides = { slides: {} };
    }
  }

  const deck = {
    title: parsed.title,
    subtitle: oldDeck?.subtitle ?? "ウパ博士の伴走ミーティング",
    audiencePath: oldDeck?.audiencePath ?? "audience.html",
    contextScript: oldDeck?.contextScript ?? undefined,
    slides: slides.map(({ index, type, typeLabel, heading, script }) => ({
      index,
      type,
      typeLabel,
      heading,
      script,
    })),
  };

  const audienceHtml = sanitizeChapterTitlesInAudienceHtml(
    renderAudienceHtml(parsed.title, slides),
    deck
  );

  const { overrides, kept, removed } = mergeOverrides(
    oldOverrides,
    oldDeck,
    deck,
    audienceHtml,
    preserveOverrides
  );

  fs.writeFileSync(deckPath, JSON.stringify(deck, null, 2), "utf8");
  fs.writeFileSync(audiencePath, audienceHtml, "utf8");
  fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2), "utf8");
  writeCanonicalScript(projectDir, scriptContent);

  return {
    ok: true,
    slideCount: deck.slides.length,
    warnings: parsed.warnings,
    imageResults,
    overridesKept: kept,
    overridesRemoved: removed,
    deck,
  };
}
