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

const SLIDE_TYPE_LABELS = { title: "表紙", bullets: "要点", quote: "一言", visual: "画像" };

function escXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getFooterIconSrc(html) {
  const m = html.match(/class="slide__icon"[^>]*\bsrc="([^"]+)"/);
  return m ? m[1] : "images/ウパ博士-標準-512×512-透過.png";
}

function resolveCharVariant(iconSrc, variant, imagesDir) {
  const swapped = iconSrc.replace(/[^-/]+-512×512/, `${variant}-512×512`);
  const fname = path.basename(swapped);
  if (fs.existsSync(path.join(imagesDir, fname))) return swapped;
  return iconSrc;
}

function buildNewSlideHtml(idx, type, heading, iconSrc, imagesDir) {
  const s = `s${idx}`;
  const h = escXml(heading);
  const top = `      <div class="slide__bar slide__bar--top" aria-hidden="true"></div>`;
  const bot = `      <div class="slide__bar slide__bar--bottom" aria-hidden="true"></div>`;
  const footer = `      <footer class="slide__footer">
        <img class="slide__icon" data-edit-char src="${iconSrc}" alt="" width="32" height="32">
        <span class="slide__page">0 / 0</span>
      </footer>`;

  if (type === "title") {
    const watermark = resolveCharVariant(iconSrc, "真顔", imagesDir);
    return `<section class="slide slide--title" data-type="title" aria-hidden="true">
${top}
        <img
          class="slide__watermark"
          data-edit-id="${s}-watermark"
          data-edit-char
          src="${watermark}"
          alt=""
          width="560"
          height="560"
          aria-hidden="true"
        >
        <div class="slide__body">
          <h1 class="slide__main-title" data-edit-id="${s}-title" data-edit-text>${h}</h1>
        </div>
${bot}
${footer}
      </section>`;
  }
  if (type === "bullets") {
    return `<section class="slide slide--bullets" data-type="bullets" aria-hidden="true">
${top}
        <div class="slide__body">
          <h2 class="slide__section-title" data-edit-id="${s}-title" data-edit-text>${h}</h2>
          <ul class="slide__list">
            <li class="slide__list-item" data-edit-id="${s}-b0">
              <i data-lucide="arrow-right" class="slide__list-icon" aria-hidden="true"></i>
              <span data-edit-text>ポイント 1</span>
            </li>
            <li class="slide__list-item" data-edit-id="${s}-b1">
              <i data-lucide="arrow-right" class="slide__list-icon" aria-hidden="true"></i>
              <span data-edit-text>ポイント 2</span>
            </li>
            <li class="slide__list-item" data-edit-id="${s}-b2">
              <i data-lucide="arrow-right" class="slide__list-icon" aria-hidden="true"></i>
              <span data-edit-text>ポイント 3</span>
            </li>
          </ul>
        </div>
${bot}
${footer}
      </section>`;
  }
  if (type === "quote") {
    const charSrc = resolveCharVariant(iconSrc, "諭す", imagesDir);
    return `<section class="slide slide--quote" data-type="quote" aria-hidden="true">
${top}
        <div class="slide__body">
          <h2 class="slide__section-title" data-edit-id="${s}-title" data-edit-text>${h}</h2>
          <div class="slide__content">
            <img
              class="slide__quote-char"
              data-edit-id="${s}-char"
              data-edit-char
              src="${charSrc}"
              alt=""
              width="200"
              height="200"
            >
            <div class="slide__bubble" data-edit-id="${s}-bubble">
              <p class="slide__bubble-lead" data-edit-text>ポイントは</p>
              <p class="slide__bubble-key" data-edit-text>ここに書く</p>
            </div>
          </div>
        </div>
${bot}
${footer}
      </section>`;
  }
  // visual (default)
  return `<section class="slide slide--visual" data-type="visual" aria-hidden="true">
${top}
        <div class="slide__body">
          <h2 class="slide__section-title" data-edit-id="${s}-title" data-edit-text>${h}</h2>
          <div class="slide__visual-area">
            <div
              class="slide__visual-slot"
              data-edit-id="${s}-visual0"
              data-edit-visual=""
              aria-label="クリックして画像をアップロード"
            >
            </div>
          </div>
        </div>
${bot}
${footer}
      </section>`;
}

function findSlideEndPositions(html) {
  const positions = [];
  const re = /<section class="slide/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const closeIdx = html.indexOf("</section>", m.index);
    if (closeIdx !== -1) positions.push(closeIdx + "</section>".length);
  }
  return positions;
}

function insertSlideIntoHtml(html, afterIndex, newSlideHtml, newTotal) {
  // Shift existing data-edit-ids for slides AFTER insertion point first
  html = html.replace(/data-edit-id="s(\d+)-/g, (match, n) => {
    if (parseInt(n) > afterIndex) return `data-edit-id="s${parseInt(n) + 1}-`;
    return match;
  });

  const endPositions = findSlideEndPositions(html);
  const insertAt = endPositions[afterIndex];
  html = html.slice(0, insertAt) + "\n\n      " + newSlideHtml + html.slice(insertAt);

  let pageNum = 0;
  html = html.replace(/<span class="slide__page">[^<]*<\/span>/g, () => {
    pageNum++;
    return `<span class="slide__page">${pageNum} / ${newTotal}</span>`;
  });

  return html;
}

function addSlideToDeck(deck, afterIndex, type, heading) {
  const typeLabel = SLIDE_TYPE_LABELS[type] ?? type;
  const newSlides = [
    ...deck.slides.slice(0, afterIndex + 1),
    { index: afterIndex + 1, type, typeLabel, heading, script: "" },
    ...deck.slides.slice(afterIndex + 1),
  ];
  newSlides.forEach((s, i) => { s.index = i; });
  return { ...deck, slides: newSlides };
}

function shiftOverrides(overrides, afterIndex) {
  const slides = overrides.slides ?? {};
  const newSlides = {};
  for (const [key, value] of Object.entries(slides)) {
    const idx = parseInt(key, 10);
    newSlides[idx > afterIndex ? String(idx + 1) : key] = value;
  }
  return { ...overrides, slides: newSlides };
}

function removeSlideFromHtml(html, index, newTotal) {
  const re = /<section class="slide/g;
  let count = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (count === index) {
      const closeIdx = html.indexOf("</section>", m.index);
      if (closeIdx === -1) return html;
      html = html.slice(0, m.index) + html.slice(closeIdx + "</section>".length);
      break;
    }
    count++;
  }
  html = html.replace(/\n{3,}/g, "\n\n");
  html = html.replace(/data-edit-id="s(\d+)-/g, (match, n) => {
    const num = parseInt(n);
    if (num > index) return `data-edit-id="s${num - 1}-`;
    return match;
  });
  let pageNum = 0;
  html = html.replace(/<span class="slide__page">[^<]*<\/span>/g, () => {
    pageNum++;
    return `<span class="slide__page">${pageNum} / ${newTotal}</span>`;
  });
  return html;
}

function removeSlideFromDeck(deck, index) {
  const newSlides = deck.slides.filter((_, i) => i !== index);
  newSlides.forEach((s, i) => { s.index = i; });
  return { ...deck, slides: newSlides };
}

function unshiftOverrides(overrides, index) {
  const slides = overrides.slides ?? {};
  const newSlides = {};
  for (const [key, value] of Object.entries(slides)) {
    const idx = parseInt(key, 10);
    if (idx === index) continue;
    newSlides[idx > index ? String(idx - 1) : key] = value;
  }
  return { ...overrides, slides: newSlides };
}

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

  const slidesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/slides$/);
  if (slidesMatch && req.method === "POST") {
    const id = decodeURIComponent(slidesMatch[1]);
    readBody(req)
      .then((body) => {
        const dir = projectDir(id);
        if (!dir) { sendJson(res, 404, { error: "Project not found" }); return; }

        const afterIndex = Number(body.afterIndex);
        const type = String(body.type ?? "bullets");
        const heading = String(body.heading ?? "新しいスライド");

        if (!Object.hasOwn(SLIDE_TYPE_LABELS, type)) {
          sendJson(res, 400, { error: "Invalid slide type" }); return;
        }

        const deckPath = path.join(dir, "deck.json");
        const audiencePath = path.join(dir, "audience.html");
        const imagesDir = path.join(dir, "images");

        const deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));
        const audienceHtml = fs.readFileSync(audiencePath, "utf8");

        if (!Number.isFinite(afterIndex) || afterIndex < 0 || afterIndex >= deck.slides.length) {
          sendJson(res, 400, { error: "Invalid afterIndex" }); return;
        }

        const newSlideIdx = afterIndex + 1;
        const newTotal = deck.slides.length + 1;
        const iconSrc = getFooterIconSrc(audienceHtml);
        const newSlideHtml = buildNewSlideHtml(newSlideIdx, type, heading, iconSrc, imagesDir);
        const newAudienceHtml = insertSlideIntoHtml(audienceHtml, afterIndex, newSlideHtml, newTotal);
        const newDeck = addSlideToDeck(deck, afterIndex, type, heading);
        const newOverrides = shiftOverrides(readOverrides(id) ?? { slides: {} }, afterIndex);

        fs.writeFileSync(deckPath, JSON.stringify(newDeck, null, 2), "utf8");
        fs.writeFileSync(audiencePath, newAudienceHtml, "utf8");
        writeOverrides(id, newOverrides);

        sendJson(res, 200, { ok: true, deck: newDeck, newSlideIndex: newSlideIdx });
      })
      .catch(() => sendJson(res, 400, { error: "Invalid JSON" }));
    return;
  }

  const slideIndexMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/slides\/(\d+)$/);
  if (slideIndexMatch && req.method === "DELETE") {
    const id = decodeURIComponent(slideIndexMatch[1]);
    const index = parseInt(slideIndexMatch[2], 10);
    const dir = projectDir(id);
    if (!dir) { sendJson(res, 404, { error: "Project not found" }); return; }

    const deckPath = path.join(dir, "deck.json");
    const audiencePath = path.join(dir, "audience.html");
    const deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));

    if (index < 0 || index >= deck.slides.length) {
      sendJson(res, 400, { error: "Invalid slide index" }); return;
    }
    if (deck.slides.length <= 1) {
      sendJson(res, 400, { error: "最後のスライドは削除できません" }); return;
    }

    const newTotal = deck.slides.length - 1;
    const newAudienceHtml = removeSlideFromHtml(fs.readFileSync(audiencePath, "utf8"), index, newTotal);
    const newDeck = removeSlideFromDeck(deck, index);
    const newOverrides = unshiftOverrides(readOverrides(id) ?? { slides: {} }, index);

    fs.writeFileSync(deckPath, JSON.stringify(newDeck, null, 2), "utf8");
    fs.writeFileSync(audiencePath, newAudienceHtml, "utf8");
    writeOverrides(id, newOverrides);

    sendJson(res, 200, { ok: true, deck: newDeck });
    return;
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
