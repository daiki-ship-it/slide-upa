import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployProject, readDeployRecord } from "./deploy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "output");
const DEPLOY_LOG = path.join(ROOT, "deploy-history.log");
const PORT = Number(process.env.PORT) || 3579;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function listProjects() {
  if (!fs.existsSync(OUTPUT)) return [];
  return fs
    .readdirSync(OUTPUT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const id = d.name;
      const dir = path.join(OUTPUT, id);
      const deckPath = path.join(dir, "deck.json");
      const audiencePath = path.join(dir, "audience.html");
      if (!fs.existsSync(deckPath) || !fs.existsSync(audiencePath)) return null;
      const stat = fs.statSync(dir);
      let title = id;
      let slideCount = 0;
      try {
        const deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));
        title = deck.title ?? title;
        slideCount = deck.slides?.length ?? 0;
      } catch {
        /* ignore */
      }
      return { id, title, slideCount, mtime: stat.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

function projectDir(id) {
  const safe = path.basename(id);
  const dir = path.join(OUTPUT, safe);
  if (!dir.startsWith(OUTPUT) || !fs.existsSync(dir)) return null;
  return dir;
}

function readProject(id) {
  const dir = projectDir(id);
  if (!dir) return null;
  const deckPath = path.join(dir, "deck.json");
  if (!fs.existsSync(deckPath)) return null;
  const deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));
  const scriptPath = path.join(dir, "script.md");
  const script = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";
  const deploy = readDeployRecord(dir);
  return {
    id: path.basename(id),
    deck,
    script,
    audienceUrl: `/output/${path.basename(id)}/audience.html`,
    deploy,
  };
}

function readOverrides(id) {
  const dir = projectDir(id);
  if (!dir) return null;
  const p = path.join(dir, "overrides.json");
  if (!fs.existsSync(p)) return { slides: {} };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { slides: {} };
  }
}

function writeOverrides(id, data) {
  const dir = projectDir(id);
  if (!dir) return false;
  const p = path.join(dir, "overrides.json");
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  return true;
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function sanitizeImageFilename(name) {
  const ext = path.extname(name).toLowerCase();
  if (!IMAGE_EXT.has(ext)) return null;
  const base =
    path
      .basename(name, ext)
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "image";
  return `${base}-${Date.now()}${ext}`;
}

function saveProjectImage(id, filename, buffer) {
  const dir = projectDir(id);
  if (!dir) return null;
  const safeName = sanitizeImageFilename(filename);
  if (!safeName) return null;
  const imagesDir = path.join(dir, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, safeName), buffer);
  return `images/${safeName}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function updateScriptMdSection(scriptContent, heading, newScript) {
  const lines = scriptContent.split("\n");
  const headingLine = `### ${heading}`;

  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === headingLine) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return scriptContent; // 見出しが見つからなければ変更しない

  let nextHeadingIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6} /.test(lines[i])) {
      nextHeadingIdx = i;
      break;
    }
  }

  const sectionLines = lines.slice(headingIdx + 1, nextHeadingIdx);
  const directiveLines = sectionLines.filter((l) => l.trimStart().startsWith("["));

  const newParts = [];
  const trimmedScript = newScript.trim();
  if (trimmedScript) {
    newParts.push("", ...trimmedScript.split("\n"));
    if (directiveLines.length > 0) newParts.push("");
    newParts.push(...directiveLines);
  } else {
    newParts.push(...directiveLines);
  }
  if (nextHeadingIdx < lines.length) newParts.push("");

  return [...lines.slice(0, headingIdx + 1), ...newParts, ...lines.slice(nextHeadingIdx)].join("\n");
}

function serveFile(res, filePath) {
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/projects") {
    sendJson(res, 200, { projects: listProjects() });
    return;
  }

  if (url.pathname === "/api/characters" && req.method === "GET") {
    const charsDir = path.join(ROOT, "assets", "characters");
    let files = [];
    if (fs.existsSync(charsDir)) {
      files = fs.readdirSync(charsDir).filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));
    }
    sendJson(res, 200, { characters: files });
    return;
  }

  const overridesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/overrides$/);
  if (overridesMatch) {
    const id = decodeURIComponent(overridesMatch[1]);
    if (req.method === "GET") {
      const data = readOverrides(id);
      if (!data) {
        sendJson(res, 404, { error: "Project not found" });
        return;
      }
      sendJson(res, 200, data);
      return;
    }
    if (req.method === "PUT") {
      readBody(req)
        .then((body) => {
          if (!writeOverrides(id, body)) {
            sendJson(res, 404, { error: "Project not found" });
            return;
          }
          sendJson(res, 200, { ok: true });
        })
        .catch(() => {
          sendJson(res, 400, { error: "Invalid JSON" });
        });
      return;
    }
  }

  const deployMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/deploy$/);
  if (deployMatch && req.method === "POST") {
    const id = decodeURIComponent(deployMatch[1]);
    const dir = projectDir(id);
    if (!dir) {
      sendJson(res, 404, { error: "Project not found" });
      return;
    }
    deployProject(dir, path.basename(id), DEPLOY_LOG)
      .then((record) => {
        sendJson(res, 200, record);
      })
      .catch((err) => {
        sendJson(res, 500, { error: err.message || "Deploy failed" });
      });
    return;
  }

  const imageMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/images$/);
  if (imageMatch && req.method === "POST") {
    const id = decodeURIComponent(imageMatch[1]);
    if (!projectDir(id)) {
      sendJson(res, 404, { error: "Project not found" });
      return;
    }
    readBody(req)
      .then((body) => {
        const filename = typeof body.filename === "string" ? body.filename : "image.png";
        const data = typeof body.data === "string" ? body.data : "";
        if (!data) {
          sendJson(res, 400, { error: "画像データがありません" });
          return;
        }
        const buffer = Buffer.from(data, "base64");
        if (buffer.length > 10 * 1024 * 1024) {
          sendJson(res, 400, { error: "画像が大きすぎます（10MB まで）" });
          return;
        }
        const src = saveProjectImage(id, filename, buffer);
        if (!src) {
          sendJson(res, 400, { error: "PNG / JPEG / WebP / GIF のみアップロードできます" });
          return;
        }
        sendJson(res, 200, { src });
      })
      .catch(() => {
        sendJson(res, 400, { error: "Invalid JSON" });
      });
    return;
  }

  const scriptSlideMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/script-slide$/);
  if (scriptSlideMatch && req.method === "PUT") {
    const id = decodeURIComponent(scriptSlideMatch[1]);
    readBody(req)
      .then((body) => {
        const dir = projectDir(id);
        if (!dir) {
          sendJson(res, 404, { error: "Project not found" });
          return;
        }
        const deckPath = path.join(dir, "deck.json");
        const deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));
        const index = Number(body.index);
        if (!Number.isFinite(index) || index < 0 || index >= deck.slides.length) {
          sendJson(res, 400, { error: "Invalid slide index" });
          return;
        }
        if (typeof body.script !== "string") {
          sendJson(res, 400, { error: "script must be a string" });
          return;
        }
        deck.slides[index].script = body.script;
        fs.writeFileSync(deckPath, JSON.stringify(deck, null, 2), "utf8");

        const scriptPath = path.join(dir, "script.md");
        if (fs.existsSync(scriptPath)) {
          const updated = updateScriptMdSection(
            fs.readFileSync(scriptPath, "utf8"),
            deck.slides[index].heading,
            body.script
          );
          fs.writeFileSync(scriptPath, updated, "utf8");
        }

        sendJson(res, 200, { ok: true });
      })
      .catch(() => sendJson(res, 400, { error: "Invalid JSON" }));
    return;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === "GET") {
    const data = readProject(decodeURIComponent(projectMatch[1]));
    if (!data) {
      sendJson(res, 404, { error: "Project not found" });
      return;
    }
    sendJson(res, 200, data);
    return;
  }

  const pathname = decodeURIComponent(url.pathname);

  let filePath;
  if (pathname === "/" || pathname === "/studio" || pathname === "/studio/") {
    filePath = path.join(__dirname, "index.html");
  } else if (pathname.startsWith("/studio/")) {
    filePath = path.join(__dirname, pathname.slice("/studio/".length));
  } else if (pathname.startsWith("/output/")) {
    filePath = path.join(ROOT, pathname);
  } else if (pathname.startsWith("/assets/")) {
    filePath = path.join(ROOT, pathname);
  } else {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  serveFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`slide-upa studio: http://localhost:${PORT}/`);
});
