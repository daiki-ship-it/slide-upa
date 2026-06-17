#!/usr/bin/env node
/**
 * deck.json の contextScript に従い、Context 側 script.md を slide-upa 正本へのシンボリックリンクにする。
 *
 * 使い方:
 *   node studio/link-context-script.js                    # output 内の全プロジェクト
 *   node studio/link-context-script.js 2026-06-18-joint-ssot
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureContextScriptSymlink,
  linkAllContextScripts,
} from "../lib/context-script.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(__dirname, "..", "output");

const projectId = process.argv[2];

const results = projectId
  ? [{ id: projectId, ...ensureContextScriptSymlink(path.join(OUTPUT, projectId)) }]
  : linkAllContextScripts(OUTPUT);

for (const r of results) {
  if (r.skipped) {
    console.log(`${r.id}: contextScript なし（スキップ）`);
  } else if (r.already) {
    console.log(`${r.id}: 既にリンク済み → ${r.contextPath}`);
  } else if (r.linked) {
    console.log(`${r.id}: リンク作成 → ${r.contextPath}`);
  } else {
    console.error(`${r.id}: 失敗 — ${r.reason ?? "unknown"}`);
    process.exitCode = 1;
  }
}
