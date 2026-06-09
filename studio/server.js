import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "output");
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
  return { id: path.basename(id), deck, script, audienceUrl: `/output/${path.basename(id)}/audience.html` };
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
