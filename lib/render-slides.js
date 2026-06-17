/**
 * スライドメタデータ → audience.html
 */

/** @param {string} str */
function escXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FOOTER_ICON = "images/ウパ博士-標準-512×512-透過.png";

/**
 * @param {number} idx
 * @param {object} slide
 * @param {number} total
 */
function renderSlideSection(idx, slide, total) {
  const s = `s${idx}`;
  const page = idx + 1;
  const top = `        <div class="slide__bar slide__bar--top" aria-hidden="true"></div>`;
  const bot = `        <div class="slide__bar slide__bar--bottom" aria-hidden="true"></div>`;
  const footer = `        <footer class="slide__footer">
          <img class="slide__icon" data-edit-char src="${FOOTER_ICON}" alt="" width="32" height="32">
          <span class="slide__page">${page} / ${total}</span>
        </footer>`;

  switch (slide.type) {
    case "title":
      return `      <!-- ① 表紙 -->
      <section class="slide slide--title" data-type="title" aria-hidden="true">
${top}
        <img
          class="slide__watermark"
          data-edit-id="${s}-watermark"
          data-edit-char
          src="images/ウパ博士-真顔-512×512-透過.png"
          alt=""
          width="560"
          height="560"
          aria-hidden="true"
        >
        <div class="slide__body">
          <h1 class="slide__main-title" data-edit-id="${s}-title" data-edit-text>${slide.titleHtml ?? escXml(slide.heading)}</h1>
        </div>
${bot}
${footer}
      </section>`;

    case "chapter":
      return `      <!-- ⑤ 章 -->
      <section class="slide slide--chapter" data-type="chapter" aria-hidden="true">
${top}
        <div class="slide__body">
          <div class="slide__hero">
            <p class="slide__hero-label" data-edit-id="${s}-label" data-edit-text>CHAPTER</p>
            <h2 class="slide__hero-title" data-edit-id="${s}-title" data-edit-text>${slide.headingHtml ?? escXml(slide.heading)}</h2>
          </div>
          <ol class="slide__timeline">
${renderAgendaTimeline(s, slide.agendaItems ?? [], "chapter")}
          </ol>
        </div>
${bot}
${footer}
      </section>`;

    case "goal":
      return `      <!-- ⑥ ゴール -->
      <section class="slide slide--goal" data-type="goal" aria-hidden="true">
${top}
        <div class="slide__body">
          <div class="slide__hero">
            <img
              class="slide__hero-watermark"
              data-edit-id="${s}-watermark"
              data-edit-char
              src="images/ウパ博士-真顔-512×512-透過.png"
              alt=""
              width="140"
              height="140"
              aria-hidden="true"
            >
            <p class="slide__hero-label" data-edit-id="${s}-label" data-edit-text>TODAY'S GOALS</p>
            <h2 class="slide__hero-title" data-edit-id="${s}-title" data-edit-text>${escXml(slide.heading)}</h2>
          </div>
          <ol class="slide__goals">
${(slide.goalItems ?? [])
  .map(
    (g, i) => `            <li class="slide__goal-item" data-edit-id="${s}-g${i}">
              <span class="slide__goal-num" data-edit-text>${escXml(g.num)}</span>
              <p class="slide__goal-text" data-edit-text>${g.textHtml}</p>
            </li>`
  )
  .join("\n")}
          </ol>
        </div>
${bot}
${footer}
      </section>`;

    case "agenda":
      return `      <!-- ⑦ アジェンダ -->
      <section class="slide slide--agenda" data-type="agenda" aria-hidden="true">
${top}
        <div class="slide__body">
          <div class="slide__hero">
            <p class="slide__hero-label" data-edit-id="${s}-label" data-edit-text>TODAY'S AGENDA</p>
            <h2 class="slide__hero-title" data-edit-id="${s}-title" data-edit-text>${escXml(slide.heading)}</h2>
          </div>
          <ol class="slide__timeline">
${renderAgendaTimeline(s, slide.agendaItems ?? [], "agenda")}
          </ol>
        </div>
${bot}
${footer}
      </section>`;

    case "bullets":
      return `      <!-- ② 要点リスト -->
      <section class="slide slide--bullets" data-type="bullets" aria-hidden="true">
${top}
        <div class="slide__body">
          <h2 class="slide__section-title" data-edit-id="${s}-title" data-edit-text>${escXml(slide.heading)}</h2>
          <ul class="slide__list">
${(slide.bulletItems ?? [])
  .map(
    (text, i) => `            <li class="slide__list-item" data-edit-id="${s}-b${i}">
              <span data-edit-text>${text}</span>
            </li>`
  )
  .join("\n")}
          </ul>
        </div>
${bot}
${footer}
      </section>`;

    case "quote":
      return `      <!-- ③ 大きな一言 -->
      <section class="slide slide--quote" data-type="quote" aria-hidden="true">
${top}
        <div class="slide__body">
          <h2 class="slide__section-title" data-edit-id="${s}-title" data-edit-text>${escXml(slide.heading)}</h2>
          <div class="slide__content">
            <img
              class="slide__quote-char"
              data-edit-id="${s}-char"
              data-edit-char
              src="images/${slide.quoteChar}"
              alt=""
              width="200"
              height="200"
            >
            <div class="slide__bubble" data-edit-id="${s}-bubble">
              <p class="slide__bubble-lead" data-edit-text>${escXml(slide.quoteLead ?? "")}</p>
              <p class="slide__bubble-key" data-edit-text>${escXml(slide.quoteKey ?? "")}</p>
            </div>
          </div>
        </div>
${bot}
${footer}
      </section>`;

    case "visual":
      return `      <!-- ④ 画像メイン -->
      <section class="slide slide--visual" data-type="visual" aria-hidden="true">
${top}
        <div class="slide__body">
          <h2 class="slide__section-title" data-edit-id="${s}-title" data-edit-text>${escXml(slide.heading)}</h2>
          <div class="slide__visual-area">
${(slide.imageSlots ?? [])
  .map((slot, j) => {
    if (slot.charFile) {
      return `            <div
              class="slide__visual-slot has-visual-img"
              data-edit-id="${s}-visual${j}"
              data-edit-visual=""
              aria-label="クリックして画像をアップロード"
            >
              <img class="slide__visual-img" src="images/${slot.charFile}" alt="">
            </div>`;
    }
    return `            <div
              class="slide__visual-slot"
              data-edit-id="${s}-visual${j}"
              data-edit-visual=""
              aria-label="クリックして画像をアップロード"
            >
            </div>`;
  })
  .join("\n")}
          </div>
        </div>
${bot}
${footer}
      </section>`;

    default:
      return "";
  }
}

/**
 * @param {string} s
 * @param {object[]} items
 * @param {"chapter"|"agenda"} mode
 */
function renderAgendaTimeline(s, items, mode) {
  const isChapter = mode === "chapter";
  return items
    .map((item, i) => {
      const isCurrent = isChapter && item.current;
      const currentClass = isCurrent ? " slide__agenda-item--current" : "";
      const labelHtml = isCurrent
        ? `<strong>${escXml(item.label)}</strong>`
        : escXml(item.label);
      const textLine = item.textHtml
        ? isCurrent
          ? `\n              <p class="slide__agenda-text" data-edit-text><strong>${item.textHtml}</strong></p>`
          : `\n              <p class="slide__agenda-text" data-edit-text>${item.textHtml}</p>`
        : "";
      return `            <li class="slide__agenda-item${currentClass}" data-edit-id="${s}-a${i}">
              <span class="slide__timeline-dot" aria-hidden="true"></span>
              <span class="slide__agenda-label" data-edit-text>${labelHtml}</span>${textLine}
            </li>`;
    })
    .join("\n");
}

/**
 * @param {string} title
 * @param {object[]} slides
 */
export function renderAudienceHtml(title, slides) {
  const total = slides.length;
  const sections = slides.map((slide, i) => renderSlideSection(i, slide, total)).join("\n\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escXml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>
  <link rel="stylesheet" href="slides.css">
</head>
<body>
  <div class="deck" role="application" aria-label="スライドプレゼンテーション">
    <div class="slide-scaler">
    <div class="slide-viewport">

${sections}

    </div>
    </div>
  </div>

  <script>
    if (window.lucide) lucide.createIcons();
  </script>
  <script src="slides.js"></script>
  <script src="slide-overrides.js"></script>
  <script src="slide-snap.js"></script>
  <script src="slide-edit.js"></script>
</body>
</html>
`;
}

/**
 * @param {string} html
 * @returns {Set<string>}
 */
export function extractEditIds(html) {
  const ids = new Set();
  const re = /data-edit-id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

/**
 * @param {string} html
 * @returns {Map<string, number>}
 */
export function extractEditIdSlideIndex(html) {
  /** @type {Map<string, number>} */
  const map = new Map();
  const sectionRe = /<section[^>]*data-type="[^"]*"[^>]*>([\s\S]*?)<\/section>/g;
  let sectionMatch;
  let slideIndex = 0;
  while ((sectionMatch = sectionRe.exec(html)) !== null) {
    const block = sectionMatch[1];
    const idRe = /data-edit-id="([^"]+)"/g;
    let idMatch;
    while ((idMatch = idRe.exec(block)) !== null) {
      map.set(idMatch[1], slideIndex);
    }
    slideIndex += 1;
  }
  return map;
}
