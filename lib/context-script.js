import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SLIDE_UPA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(SLIDE_UPA_ROOT, "..");

/**
 * deck.json の contextScript（SRC ルートからの相対パス）を絶対パスにする。
 */
export function resolveContextScriptPath(deck) {
  const rel = deck?.contextScript;
  if (!rel || typeof rel !== "string") return null;
  const resolved = path.resolve(WORKSPACE_ROOT, rel);
  if (!resolved.startsWith(WORKSPACE_ROOT)) return null;
  return resolved;
}

export function canonicalScriptPath(projectDir) {
  return path.join(projectDir, "script.md");
}

/**
 * slide-upa/output/{id}/script.md を正本とし、Context 側を相対シンボリックリンクにする。
 * 既存の通常ファイルは削除してリンクに置き換える（正本の内容が優先）。
 */
export function ensureContextScriptSymlink(projectDir) {
  const deckPath = path.join(projectDir, "deck.json");
  if (!fs.existsSync(deckPath)) {
    return { ok: false, reason: "deck.json not found" };
  }

  let deck;
  try {
    deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));
  } catch {
    return { ok: false, reason: "invalid deck.json" };
  }

  const contextPath = resolveContextScriptPath(deck);
  if (!contextPath) {
    return { ok: true, skipped: true };
  }

  const canonical = canonicalScriptPath(projectDir);
  if (!fs.existsSync(canonical)) {
    return { ok: false, reason: "script.md not found in project" };
  }

  fs.mkdirSync(path.dirname(contextPath), { recursive: true });

  const relTarget = path.relative(path.dirname(contextPath), canonical);

  if (fs.existsSync(contextPath)) {
    const stat = fs.lstatSync(contextPath);
    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(contextPath);
      const resolved = path.resolve(path.dirname(contextPath), current);
      if (resolved === canonical) {
        return { ok: true, already: true, contextPath, canonical };
      }
      fs.unlinkSync(contextPath);
    } else {
      fs.unlinkSync(contextPath);
    }
  }

  fs.symlinkSync(relTarget, contextPath);
  return { ok: true, linked: true, contextPath, canonical };
}

export function writeCanonicalScript(projectDir, content) {
  const scriptPath = canonicalScriptPath(projectDir);
  fs.writeFileSync(scriptPath, content, "utf8");
  return ensureContextScriptSymlink(projectDir);
}

export function linkAllContextScripts(outputDir = path.join(SLIDE_UPA_ROOT, "output")) {
  if (!fs.existsSync(outputDir)) return [];

  return fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_exemplar")
    .map((d) => ({
      id: d.name,
      ...ensureContextScriptSymlink(path.join(outputDir, d.name)),
    }));
}
