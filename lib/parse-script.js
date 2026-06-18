/**
 * script.md → スライドメタデータ（slide-upa 生成ルール正本）
 */

const TYPE_LABELS = {
  title: "表紙",
  chapter: "章",
  goal: "ゴール",
  agenda: "アジェンダ",
  bullets: "要点",
  quote: "一言",
  visual: "画像",
};

const CONVERSATION_RE = /^\*\*(ウパ博士|パニっくん)[：:]/;
const GOAL_NUMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

/** @param {string} text */
export function mdBoldToStrong(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** @param {string} text */
function stripMarkdownBold(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/** @param {string} line */
function parseHeadingLevel(line) {
  const m = line.match(/^(#{1,3})\s+(.+)$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

/** @param {string} body */
function extractBulletLines(body) {
  return body
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

/** @param {string} body */
function scriptBodyFromSection(body) {
  return body
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (t === "[visual]" || t === "[goal]" || t === "[agenda]") return false;
      if (/^\[image:\s/.test(t)) return false;
      if (/^\[quote:\s/.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

/** @param {string} body */
function hasMarker(body, marker) {
  return body.split("\n").some((l) => l.trim() === marker);
}

/** @param {string} body */
function findQuote(body) {
  for (const line of body.split("\n")) {
    const m = line.trim().match(/^\[quote:\s*(.+)\]$/);
    if (m) return m[1].trim();
  }
  return null;
}

/** @param {string} body */
function findImageLines(body) {
  return body
    .split("\n")
    .filter((l) => /^\[image:\s/.test(l.trim()))
    .map((l) => {
      const m = l.trim().match(/^\[image:\s*(.+)\]$/);
      return m ? m[1].trim() : "";
    })
    .filter(Boolean);
}

/** @param {string} quoteText */
export function splitQuote(quoteText) {
  const idx = quoteText.indexOf("「");
  if (idx >= 0) {
    return {
      lead: quoteText.slice(0, idx).replace(/[\s、。，．]+$/u, ""),
      key: quoteText.slice(idx),
    };
  }
  return { lead: "", key: quoteText };
}

/** @param {string} line */
function parseAgendaLine(line) {
  const parts = line.split(/\s*[—–-]\s/u);
  if (parts.length >= 2) {
    const label = stripMarkdownBold(parts[0].trim());
    const text = parts.slice(1).join(" — ").trim();
    return { label, text, textHtml: mdBoldToStrong(text) };
  }
  return { label: stripMarkdownBold(line), text: "", textHtml: "" };
}

/** @param {string[]} bulletLines */
function parseGoalItems(bulletLines) {
  const items = [];
  let autoNum = 0;
  for (const line of bulletLines) {
    const numMatch = line.match(/^\*\*([①②③④⑤⑥⑦⑧⑨⑩])\*\*/);
    const numMatch2 = line.match(/^\*\*([①②③④⑤⑥⑦⑧⑨⑩])([^*]*)\*\*/);
    let num;
    let text;
    if (numMatch) {
      num = numMatch[1];
      text = line.slice(numMatch[0].length).trim();
    } else if (numMatch2) {
      num = numMatch2[1];
      const label = numMatch2[2];
      const rest = line.slice(numMatch2[0].length);
      text = label ? `**${label}**${rest}` : rest.trim();
    } else {
      num = GOAL_NUMS[autoNum] ?? String(autoNum + 1);
      autoNum += 1;
      text = line;
    }
    items.push({ num, textHtml: mdBoldToStrong(text) });
  }
  return items;
}

/** @param {string} heading */
function detectSectionType(heading, body) {
  if (hasMarker(body, "[visual]")) return "visual";
  if (findQuote(body)) return "quote";
  if (heading.includes("ゴール") || hasMarker(body, "[goal]")) return "goal";
  if (heading.includes("アジェンダ") || hasMarker(body, "[agenda]")) return "agenda";
  return "bullets";
}

/** @param {string} chapterHeading */
export function extractChapterLabel(chapterHeading) {
  const m = chapterHeading.match(/(第\d+章)/);
  return m ? m[1] : null;
}

/** 章スライドを作らない章か（オープニング用） */
function chapterSkipsSlide(heading, introBody) {
  if (heading.trim() === "オープニング") return true;
  return hasMarker(introBody, "[no-chapter]");
}

/** @param {string} text */
function insertTitleBreaks(text) {
  if ([...text].length < 18) return text;
  const mid = Math.ceil(text.length / 2);
  for (let i = mid; i < text.length; i++) {
    if (/[・、\s]/.test(text[i])) {
      return `${text.slice(0, i)}<br>${text.slice(i + 1)}`;
    }
  }
  return `${text.slice(0, mid)}<br>${text.slice(mid)}`;
}

/**
 * @param {string} content
 * @returns {{ title: string, slides: object[], agendaItems: object[], errors: string[], warnings: string[] }}
 */
export function parseScript(content) {
  const errors = [];
  const warnings = [];
  const lines = content.split("\n");

  let title = "";
  const chapters = [];
  let currentChapter = null;
  let currentSection = null;
  let pendingIntro = [];

  for (const line of lines) {
    if (CONVERSATION_RE.test(line.trim())) {
      errors.push("会話形式の行があります。一人語り形式に書き直してください（`**ウパ博士：**` 等を削除）。");
    }

    const h = parseHeadingLevel(line);
    if (!h) {
      if (currentSection) {
        currentSection.bodyLines.push(line);
      } else if (currentChapter) {
        pendingIntro.push(line);
      }
      continue;
    }

    if (h.level === 1) {
      if (!title) title = h.text;
      currentChapter = null;
      currentSection = null;
      pendingIntro = [];
      continue;
    }

    if (h.level === 2) {
      if (currentSection && currentChapter) {
        currentSection.body = currentSection.bodyLines.join("\n").trim();
        currentChapter.sections.push(currentSection);
        currentSection = null;
      }
      if (currentChapter) {
        currentChapter.introBody = pendingIntro.join("\n").trim();
        chapters.push(currentChapter);
      }
      currentChapter = { heading: h.text, introBody: "", sections: [] };
      pendingIntro = [];
      currentSection = null;
      continue;
    }

    if (h.level === 3) {
      if (currentSection && currentChapter) {
        currentSection.body = currentSection.bodyLines.join("\n").trim();
        currentChapter.sections.push(currentSection);
      }
      if (!currentChapter) {
        errors.push(`### 見出し「${h.text}」の前に ## 章見出しがありません。`);
        continue;
      }
      currentSection = { heading: h.text, bodyLines: [] };
    }
  }

  if (currentSection && currentChapter) {
    currentSection.body = currentSection.bodyLines.join("\n").trim();
    currentChapter.sections.push(currentSection);
  }
  if (currentChapter) {
    currentChapter.introBody = pendingIntro.join("\n").trim();
    chapters.push(currentChapter);
  }

  if (!title) {
    errors.push("# タイトルが見出しがありません。先頭行に `# 講義タイトル` を追加してください。");
  }
  if (chapters.length === 0 && chapters.every((c) => c.sections.length === 0)) {
    const hasSection = chapters.some((c) => c.sections.length > 0);
    if (!hasSection) {
      errors.push("## 章または ### 節の見出しがありません。`## 章タイトル` と `### 節タイトル` を追加してください。");
    }
  }

  // Find agenda items from agenda section
  let agendaItems = [];
  for (const ch of chapters) {
    for (const sec of ch.sections) {
      if (sec.heading.includes("アジェンダ") || hasMarker(sec.body, "[agenda]")) {
        agendaItems = extractBulletLines(sec.body).map(parseAgendaLine);
        break;
      }
    }
    if (agendaItems.length) break;
  }

  /** @type {Record<string, string>} */
  const chapterTitleByLabel = {};
  for (const ch of chapters) {
    const label = extractChapterLabel(ch.heading);
    if (label) chapterTitleByLabel[label] = ch.heading;
  }

  // Validate visual sections
  for (const ch of chapters) {
    for (const sec of ch.sections) {
      if (hasMarker(sec.body, "[visual]")) {
        const images = findImageLines(sec.body);
        if (images.length === 0) {
          errors.push(
            `「${sec.heading}」に [visual] がありますが [image:] がありません。[visual] の直下に [image: 説明] を追加してください。`
          );
        }
      }
      if (!hasMarker(sec.body, "[visual]") && findImageLines(sec.body).length > 0) {
        warnings.push(`「${sec.heading}」の [image:] は無視します。[visual] マーカーを追加すると画像スライドになります。`);
      }
    }
  }

  if (errors.length > 0) {
    return { title, slides: [], agendaItems, errors, warnings };
  }

  const slides = [];
  let index = 0;

  slides.push({
    index: index++,
    type: "title",
    typeLabel: TYPE_LABELS.title,
    heading: title,
    script: "",
    titleHtml: insertTitleBreaks(title),
  });

  for (const ch of chapters) {
    if (ch.sections.length > 0) {
      const skipChapterSlide = chapterSkipsSlide(ch.heading, ch.introBody);

      if (!skipChapterSlide) {
        const chapterLabel = extractChapterLabel(ch.heading);
        let currentAgendaIndex = -1;
        if (chapterLabel && agendaItems.length) {
          currentAgendaIndex = agendaItems.findIndex((a) => a.label === chapterLabel);
        }

        slides.push({
          index: index++,
          type: "chapter",
          typeLabel: TYPE_LABELS.chapter,
          heading: ch.heading,
          script: agendaItems.map((a) => `- **${a.label}** — ${a.text}`).join("\n"),
          agendaItems: agendaItems.map((a, i) => ({
            ...a,
            current: i === currentAgendaIndex,
            chapterTitle: chapterTitleByLabel[a.label] ?? null,
          })),
        });
      }

      for (const sec of ch.sections) {
        const body = sec.body;
        const type = detectSectionType(sec.heading, body);
        const script = scriptBodyFromSection(body);
        const slide = {
          index: index++,
          type,
          typeLabel: TYPE_LABELS[type],
          heading: sec.heading,
          script,
        };

        if (type === "goal") {
          const bullets = extractBulletLines(body);
          slide.goalItems = parseGoalItems(bullets);
        } else if (type === "agenda") {
          slide.agendaItems = extractBulletLines(body).map(parseAgendaLine);
        } else if (type === "bullets") {
          const bullets = extractBulletLines(body);
          if (bullets.length > 0) {
            slide.bulletItems = bullets.map((b) => mdBoldToStrong(b));
          } else {
            const para = script.split("\n\n")[0] || script.split("\n")[0] || sec.heading;
            slide.bulletItems = [mdBoldToStrong(para.trim())];
            warnings.push(`要約が必要な節があります（${sec.heading}）。段落を1項目として表示しています。`);
          }
        } else if (type === "quote") {
          const quoteText = findQuote(body);
          const { lead, key } = splitQuote(quoteText ?? "");
          slide.quoteLead = lead;
          slide.quoteKey = key;
          slide.quoteChar = pickQuoteChar(quoteText ?? sec.heading);
        } else if (type === "visual") {
          slide.imageSlots = findImageLines(body).map((desc) => ({
            description: desc,
            charFile: pickImageChar(desc),
          }));
          slide.visualBodyHtml = script ? mdBoldToStrong(script) : "";
        }

        slides.push(slide);
      }
    } else {
      // ## with no ### → bullets slide
      const body = ch.introBody;
      const bullets = extractBulletLines(body);
      const slide = {
        index: index++,
        type: "bullets",
        typeLabel: TYPE_LABELS.bullets,
        heading: ch.heading,
        script: body,
      };
      if (bullets.length > 0) {
        slide.bulletItems = bullets.map((b) => mdBoldToStrong(b));
      } else {
        slide.bulletItems = [mdBoldToStrong(body.trim() || ch.heading)];
        warnings.push(`要約が必要な節があります（${ch.heading}）。`);
      }
      slides.push(slide);
    }
  }

  // Re-index
  slides.forEach((s, i) => {
    s.index = i;
  });

  return { title, slides, agendaItems, errors, warnings };
}

/** @param {string} text */
function pickQuoteChar(text) {
  return pickImageChar(text) ?? "ウパ博士-諭す-512×512-透過.png";
}

/** @param {string} desc */
export function pickImageChar(desc) {
  if (desc.includes("ウパ博士")) {
    if (/思考|分析|考え|悩/.test(desc)) return "ウパ博士-思考、分析-512×512-透過.png";
    if (/教え|伝え|強調|諭/.test(desc)) return "ウパ博士-諭す-512×512-透過.png";
    return "ウパ博士-標準-512×512-透過.png";
  }
  if (desc.includes("パニっくん")) {
    if (/驚|びっくり/.test(desc)) return "パニっくん-驚き-512×512-透過.png";
    if (/焦|急|慌/.test(desc)) return "パニっくん-焦り-512×512-透過.png";
    if (/パニック|混乱|ひどく慌/.test(desc)) return "パニっくん-ひどく慌てている-512×512-透過.png";
    if (/疑|不審/.test(desc)) return "パニっくん-疑っている-512×512-透過.png";
    if (/涙|感動|つら/.test(desc)) return "パニっくん-涙ぐむ-512×512-透過.png";
    if (/マジ|信じられ|衝撃/.test(desc)) return "パニっくん-マジ？-512×512-透過.png";
    if (/得意|調子/.test(desc)) return "パニっくん-調子に乗ってる-512×512-透過.png";
    if (/反発|反対/.test(desc)) return "パニっくん-強く反発する-512×512-透過.png";
    if (/落ち込|自信がない/.test(desc)) return "パニっくん-自信がない、落ち込んでいる-512×512-透過.png";
    return "パニっくん-標準-512×512-透過.png";
  }
  return null;
}
