import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** @param {string} id */
export function slugifyProjectId(id) {
  return (
    id
      .replace(/^_+/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "slide"
  );
}

/** @param {string} projectId @param {Date} [at] */
export function buildDomain(projectId, at = new Date()) {
  const slug = slugifyProjectId(projectId);
  const date = at.toISOString().slice(0, 10);
  return `slides-${slug}-${date}.surge.sh`;
}

/** @param {string} src @param {string} dest */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * Surge 用の公開フォルダを作る（元プロジェクトは変更しない）
 * @param {string} projectDir
 * @returns {string} tempDir
 */
export function prepareDeployDir(projectDir) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "slide-upa-deploy-"));
  copyDirRecursive(projectDir, tempDir);

  const audiencePath = path.join(tempDir, "audience.html");
  if (!fs.existsSync(audiencePath)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error("audience.html が見つかりません");
  }

  fs.copyFileSync(audiencePath, path.join(tempDir, "index.html"));
  fs.writeFileSync(path.join(tempDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
  return tempDir;
}

/**
 * @param {string} deployDir
 * @param {string} domain
 */
export function runSurge(deployDir, domain) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "surge", deployDir, "--domain", domain], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      const text = output.trim();
      if (/login required|not authenticated|surge login/i.test(text)) {
        reject(
          new Error(
            "Surge にログインが必要です。ターミナルで npx surge login を実行してください。"
          )
        );
        return;
      }
      reject(new Error(text || `surge が失敗しました（コード ${code}）`));
    });
  });
}

/**
 * @param {string} projectDir
 * @param {string} projectId
 * @param {string} logPath
 */
export async function deployProject(projectDir, projectId, logPath) {
  const domain = buildDomain(projectId);
  const url = `https://${domain}`;
  const tempDir = prepareDeployDir(projectDir);

  try {
    await runSurge(tempDir, domain);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const record = {
    url,
    domain,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(projectDir, "deploy.json"), JSON.stringify(record, null, 2), "utf8");

  const logLine = `${new Date().toISOString().slice(0, 19).replace("T", " ")} | ${url}\n`;
  fs.appendFileSync(logPath, logLine, "utf8");

  return record;
}

/** @param {string} projectDir */
export function readDeployRecord(projectDir) {
  const p = path.join(projectDir, "deploy.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
