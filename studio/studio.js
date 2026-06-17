const CHANNEL_NAME = "slide-upa-sync";

const els = {
  app: document.querySelector(".app"),
  projectTitle: document.getElementById("project-title"),
  projectCount: document.getElementById("project-count"),
  projectList: document.getElementById("project-list"),
  slideCount: document.getElementById("slide-count"),
  btnAddSlide: document.getElementById("btn-add-slide"),
  thumbList: document.getElementById("thumb-list"),
  slideFrame: document.getElementById("slide-frame"),
  scriptText: document.getElementById("script-text"),
  scriptDriftBanner: document.getElementById("script-drift-banner"),
  viewPresent: document.getElementById("view-present"),
  viewOverview: document.getElementById("view-overview"),
  overviewList: document.getElementById("overview-list"),
  btnMtg: document.getElementById("btn-mtg"),
  btnGroup: document.getElementById("btn-group"),
  btnUngroup: document.getElementById("btn-ungroup"),
  btnCheckSpacing: document.getElementById("btn-check-spacing"),
  btnDistribute: document.getElementById("btn-distribute"),
  btnSaveEdit: document.getElementById("btn-save-edit"),
  btnDeploy: document.getElementById("btn-deploy"),
  btnSaveScript: document.getElementById("btn-save-script"),
  btnRegenerate: document.getElementById("btn-regenerate"),
  regenerateDialog: document.getElementById("regenerate-dialog"),
  btnRegenerateClose: document.getElementById("btn-regenerate-close"),
  btnRegenerateCancel: document.getElementById("btn-regenerate-cancel"),
  btnRegenerateRun: document.getElementById("btn-regenerate-run"),
  spacingInput: document.getElementById("spacing-input"),
  btnSpacingDec: document.getElementById("btn-spacing-dec"),
  btnSpacingInc: document.getElementById("btn-spacing-inc"),
  btnSpacingApply: document.getElementById("btn-spacing-apply"),
  modeBtns: document.querySelectorAll(".seg__btn"),
};

let state = {
  projects: [],
  projectId: null,
  audienceUrl: null,
  deck: null,
  index: 0,
  audienceWindow: null,
  editDirty: false,
  scriptDirty: false,
  deployUrl: null,
  overrides: { slides: {} },
  /** @type {Array<Record<string, { html: string, imageSrc: string|null }>>} */
  baseline: [],
};

/** @type {Promise<void>|null} */
let savedWaiter = null;

let syncChannel;
try {
  syncChannel = new BroadcastChannel(CHANNEL_NAME);
} catch {
  syncChannel = null;
}

function badgeClass(type) {
  return `badge--${type}`;
}

function broadcastSlide(index) {
  syncChannel?.postMessage({ type: "slide", index });
}

function audienceEmbedUrl(slideIndex) {
  const url = new URL(state.audienceUrl, window.location.origin);
  url.searchParams.set("embed", "studio");
  if (state.projectId) {
    url.searchParams.set("project", state.projectId);
  }
  if (typeof slideIndex === "number") {
    url.searchParams.set("slide", String(slideIndex));
    url.searchParams.set("preview", "1");
  } else if (state.projectId) {
    url.searchParams.set("edit", "1");
  }
  return `${url.pathname}${url.search}`;
}

function sendEditCmd(cmd, extra = {}) {
  els.slideFrame.contentWindow?.postMessage({ target: "slide-upa-edit", cmd, ...extra }, "*");
}

async function fetchProjects() {
  const res = await fetch("/api/projects");
  const data = await res.json();
  return data.projects ?? [];
}

async function fetchOverrides(id) {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/overrides`, { cache: "no-store" });
  if (!res.ok) return { slides: {} };
  return res.json();
}

async function loadSlideBaseline(audienceUrl) {
  const res = await fetch(audienceUrl, { cache: "no-store" });
  if (!res.ok) return [];
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll(".slide")].map((slide) => {
    const elements = {};
    slide.querySelectorAll("[data-edit-id]").forEach((el) => {
      const isVisual = el.hasAttribute("data-edit-visual");
      elements[el.dataset.editId] = {
        html: el.innerHTML,
        imageSrc: isVisual ? el.querySelector(".slide__visual-img")?.getAttribute("src") ?? null : null,
      };
    });
    return elements;
  });
}

function htmlToComparableText(html) {
  const doc = new DOMParser().parseFromString(`<div id="wrap">${html}</div>`, "text/html");
  return (doc.getElementById("wrap")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function normalizeImageSrc(src) {
  if (!src) return "";
  try {
    const url = new URL(src, window.location.origin);
    return url.pathname.replace(/^\/output\/[^/]+\//, "");
  } catch {
    return String(src).trim();
  }
}

function slideHasTextDrift(slideIndex) {
  const slideOverrides = state.overrides?.slides?.[String(slideIndex)];
  if (!slideOverrides?.elements) return false;

  const baseline = state.baseline[slideIndex] ?? {};
  for (const [id, override] of Object.entries(slideOverrides.elements)) {
    const base = baseline[id];
    if (override.imageSrc != null) {
      const baseSrc = base?.imageSrc ?? null;
      if (normalizeImageSrc(override.imageSrc) !== normalizeImageSrc(baseSrc)) {
        return true;
      }
    }
    if (override.html != null && base?.html != null) {
      if (htmlToComparableText(override.html) !== htmlToComparableText(base.html)) {
        return true;
      }
    }
  }
  return false;
}

function updateDriftUi() {
  const hasDrift = slideHasTextDrift(state.index);
  els.scriptDriftBanner?.classList.toggle("is-hidden", !hasDrift);

  els.thumbList.querySelectorAll(".thumb").forEach((el, i) => {
    const mark = el.querySelector(".thumb__drift");
    if (mark) mark.hidden = !slideHasTextDrift(i);
  });
}

async function loadProject(id) {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Project not found");
  const data = await res.json();
  state.projectId = data.id;
  state.deck = data.deck;
  state.audienceUrl = data.audienceUrl;
  state.deployUrl = data.deploy?.url ?? null;
  state.editDirty = false;
  state.index = 0;
  state.overrides = await fetchOverrides(id);
  state.baseline = await loadSlideBaseline(data.audienceUrl);

  els.projectTitle.textContent = data.deck.title ?? data.id;
  els.slideCount.textContent = `全 ${data.deck.slides.length} 枚`;
  els.slideFrame.src = audienceEmbedUrl();

  renderProjectList();
  renderThumbs();
  renderOverview();
  goTo(0, false);
}

function renderProjectList() {
  const projects = state.projects;
  els.projectCount.textContent = `全 ${projects.length} 件`;
  els.projectList.replaceChildren();

  projects.forEach((project) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const active = project.id === state.projectId;
    btn.type = "button";
    btn.className = "project" + (active ? " is-active" : "");
    btn.dataset.id = project.id;
    if (!active) btn.blur();
    const slideLabel = project.slideCount ? `全 ${project.slideCount} 枚` : "";
    btn.innerHTML = `
      <p class="project__title">${escapeHtml(project.title)}</p>
      ${slideLabel ? `<p class="project__meta">${escapeHtml(slideLabel)}</p>` : ""}
    `;
    btn.addEventListener("click", () => selectProject(project.id));
    li.appendChild(btn);
    els.projectList.appendChild(li);
  });

  els.projectList.querySelector(".project.is-active")?.scrollIntoView({
    block: "nearest",
    behavior: "smooth",
  });
}

async function selectProject(id) {
  if (id === state.projectId) return;
  try {
    await loadProject(id);
  } catch (e) {
    console.error(e);
  }
}

function renderThumbs() {
  const slides = state.deck?.slides ?? [];
  els.thumbList.replaceChildren();
  slides.forEach((slide, i) => {
    const li = document.createElement("li");
    li.className = "thumb-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb" + (i === state.index ? " is-active" : "");
    btn.dataset.index = String(i);
    btn.innerHTML = `
      <div class="thumb__row">
        <span class="thumb__num">${i + 1}</span>
        <span class="badge ${badgeClass(slide.type)}">${slide.typeLabel}</span>
        <span class="thumb__drift" title="台本と表示がずれている可能性" hidden aria-hidden="true">⚠</span>
      </div>
      <p class="thumb__title">${escapeHtml(slide.heading)}</p>
    `;
    btn.addEventListener("click", () => goTo(i, true));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "thumb__delete";
    delBtn.setAttribute("title", `スライド ${i + 1} を削除`);
    delBtn.setAttribute("aria-label", `スライド ${i + 1} を削除`);
    delBtn.innerHTML = `<i data-lucide="x" aria-hidden="true"></i>`;
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (slides.length <= 1) { alert("最後のスライドは削除できません"); return; }
      if (!confirm(`スライド ${i + 1}「${slide.heading}」を削除しますか？`)) return;
      await deleteSlide(i);
    });

    li.appendChild(btn);
    li.appendChild(delBtn);
    els.thumbList.appendChild(li);
  });
  if (window.lucide) lucide.createIcons({ nodes: els.thumbList.querySelectorAll("[data-lucide]") });
}

async function deleteSlide(index) {
  if (!state.projectId) return;
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(state.projectId)}/slides/${index}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "スライドの削除に失敗しました");
    }
    const targetIndex = Math.max(0, index - 1);
    await loadProject(state.projectId);
    goTo(targetIndex, false);
  } catch (err) {
    alert(err.message);
    console.error(err);
  }
}

function renderOverview() {
  const slides = state.deck?.slides ?? [];
  els.overviewList.replaceChildren();
  slides.forEach((slide, i) => {
    const card = document.createElement("article");
    card.className = "overview-card";
    const drift = slideHasTextDrift(i);
    card.innerHTML = `
      <div class="overview-card__preview">
        <iframe class="overview-card__frame" src="${audienceEmbedUrl(i)}" title="スライド ${i + 1}" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>
      </div>
      <div class="overview-card__body">
        <div class="overview-card__head">
          <span class="badge ${badgeClass(slide.type)}">${slide.typeLabel}</span>
          <span class="thumb__num">${i + 1} / ${slides.length}</span>
        </div>
        ${
          drift
            ? `<p class="overview-card__drift"><i data-lucide="alert-triangle" aria-hidden="true"></i>手直し済み — 台本と表示がずれている可能性があります</p>`
            : ""
        }
        <h2 class="overview-card__heading">${escapeHtml(slide.heading)}</h2>
        <p class="overview-card__script">${escapeHtml(slide.script)}</p>
      </div>
    `;
    els.overviewList.appendChild(card);
  });
  if (window.lucide) lucide.createIcons({ nodes: els.overviewList.querySelectorAll("[data-lucide]") });
}

async function saveScriptSlide() {
  if (!state.projectId) return;
  const script = els.scriptText.value;
  const index = state.index;
  const res = await fetch(`/api/projects/${encodeURIComponent(state.projectId)}/script-slide`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, script }),
  });
  if (!res.ok) throw new Error("台本の保存に失敗しました");
  state.deck.slides[index].script = script;
  state.scriptDirty = false;
  els.btnSaveScript.classList.add("is-hidden");
}

function openRegenerateDialog() {
  els.regenerateDialog?.showModal();
  if (window.lucide) lucide.createIcons();
}

function closeRegenerateDialog() {
  els.regenerateDialog?.close();
}

async function runRegenerate() {
  if (!state.projectId) return;
  closeRegenerateDialog();

  if (state.scriptDirty) {
    await saveScriptSlide().catch((err) => {
      alert(err.message);
      throw err;
    });
  }

  const policy = document.querySelector('input[name="overrides-policy"]:checked')?.value ?? "preserve";
  const preserveOverrides = policy === "preserve";

  els.btnRegenerate.disabled = true;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(state.projectId)}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preserveOverrides }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 422 && Array.isArray(data.errors)) {
        alert(`台本の形式エラー:\n\n${data.errors.join("\n")}`);
        return;
      }
      throw new Error(data.error ?? "再生成に失敗しました");
    }

    const prevIndex = state.index;
    await loadProject(state.projectId);
    const maxIndex = (state.deck?.slides?.length ?? 1) - 1;
    goTo(Math.min(prevIndex, maxIndex), false);

    const parts = [`${data.slideCount} 枚のスライドを再生成しました。`];
    if (Array.isArray(data.warnings) && data.warnings.length > 0) {
      parts.push(`\n警告:\n${data.warnings.join("\n")}`);
    }
    if (preserveOverrides && (data.overridesRemoved ?? 0) > 0) {
      parts.push(`\n手直し: ${data.overridesKept ?? 0} 件を保持、${data.overridesRemoved} 件を削除しました。`);
    }
    alert(parts.join(""));
  } finally {
    els.btnRegenerate.disabled = false;
  }
}

async function goTo(index, broadcast) {
  if (state.scriptDirty && state.projectId) {
    await saveScriptSlide().catch(console.error);
  }

  const slides = state.deck?.slides ?? [];
  if (index < 0 || index >= slides.length) return;
  state.index = index;
  const slide = slides[index];

  els.thumbList.querySelectorAll(".thumb").forEach((el, i) => {
    const active = i === index;
    el.classList.toggle("is-active", active);
    if (!active) el.blur();
  });

  els.scriptText.value = slide.script ?? "";
  state.scriptDirty = false;
  els.btnSaveScript.classList.add("is-hidden");

  updateDriftUi();

  els.thumbList.querySelector(".thumb.is-active")?.scrollIntoView({
    block: "nearest",
    behavior: "smooth",
  });

  if (broadcast) broadcastSlide(index);
}

function setMode(mode) {
  els.app.dataset.mode = mode;
  els.viewPresent.classList.toggle("is-hidden", mode !== "present");
  els.viewOverview.classList.toggle("is-hidden", mode !== "overview");
  els.modeBtns.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function waitForSaved(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!state.editDirty) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      savedWaiter = null;
      reject(new Error("保存がタイムアウトしました。もう一度お試しください。"));
    }, timeoutMs);
    savedWaiter = {
      resolve: () => {
        clearTimeout(timer);
        savedWaiter = null;
        resolve();
      },
      reject: (err) => {
        clearTimeout(timer);
        savedWaiter = null;
        reject(err);
      },
    };
    sendEditCmd("save");
  });
}

async function readJsonResponse(res) {
  const text = await res.text();
  try {
    return { data: JSON.parse(text), ok: res.ok, status: res.status };
  } catch {
    if (res.status === 404) {
      throw new Error(
        "公開機能が見つかりません。studio を一度止めて npm start で再起動してください。"
      );
    }
    throw new Error(text.trim() || "公開に失敗しました");
  }
}

const DEPLOY_PREVIEW_TARGET = "slide-upa-surge-preview";

function openDeployPreviewTab() {
  const tab = window.open("about:blank", DEPLOY_PREVIEW_TARGET);
  if (!tab) return null;
  tab.document.title = "Surge 公開中…";
  tab.document.body.innerHTML =
    '<p style="font-family:sans-serif;padding:2rem;color:#334155">Surge に公開しています…<br><small>数十秒かかることがあります</small></p>';
  return tab;
}

function navigateDeployPreviewTab(tab, url) {
  if (tab && !tab.closed) {
    tab.location.replace(url);
    tab.opener = null;
    return true;
  }
  const reopened = window.open(url, DEPLOY_PREVIEW_TARGET);
  if (reopened) {
    reopened.opener = null;
    return true;
  }
  return false;
}

async function copyDeployUrl(url) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // 新しいタブにフォーカスが移ると Chrome ではコピーできないことがある
    return false;
  }
}

async function deployToSurge() {
  if (!state.projectId) return;

  // Chrome: noopener だと tab が null になり about:blank のまま動かせない
  const previewTab = openDeployPreviewTab();
  if (!previewTab) {
    alert(
      "ポップアップがブロックされています。Chrome のアドレスバー右で「ポップアップを常に許可」にしてから、もう一度 Surge公開 を押してください。"
    );
    return;
  }

  els.btnDeploy.disabled = true;
  try {
    if (state.editDirty) {
      await waitForSaved();
    }
    const res = await fetch(`/api/projects/${encodeURIComponent(state.projectId)}/deploy`, {
      method: "POST",
    });
    const { data, ok } = await readJsonResponse(res);
    if (!ok) throw new Error(data.error || "公開に失敗しました");
    state.deployUrl = data.url;

    if (!navigateDeployPreviewTab(previewTab, data.url)) {
      alert(`公開は完了しました。ブラウザで開いてください:\n${data.url}`);
    }

    await copyDeployUrl(data.url);
  } catch (err) {
    if (previewTab && !previewTab.closed) previewTab.close();
    alert(err.message || "公開に失敗しました");
    console.error(err);
  } finally {
    els.btnDeploy.disabled = false;
  }
}

function openMtg() {
  if (!state.audienceUrl) return;
  const url = new URL(state.audienceUrl, window.location.origin);
  if (state.projectId) url.searchParams.set("project", state.projectId);
  state.audienceWindow = window.open(`${url.pathname}${url.search}`, "slide-upa-audience");
  setTimeout(() => broadcastSlide(state.index), 500);
}

function setSpacingControlEnabled(enabled) {
  els.spacingInput.disabled = !enabled;
  els.btnSpacingDec.disabled = !enabled;
  els.btnSpacingInc.disabled = !enabled;
  els.btnSpacingApply.disabled = !enabled;
}

function applySpacingFromInput() {
  const gap = Number.parseInt(els.spacingInput.value, 10);
  if (Number.isNaN(gap) || gap < 0) return;
  sendEditCmd("adjustSpacing", { gap });
}

function stepSpacingInput(delta) {
  const current = Number.parseInt(els.spacingInput.value, 10);
  const base = Number.isNaN(current) ? 40 : current;
  const next = Math.min(240, Math.max(0, base + delta));
  els.spacingInput.value = String(next);
}

// --- Slide picker ---
const pickerDialog = document.getElementById("slide-picker");
const pickerSub = document.getElementById("slide-picker-sub");

function openSlidePicker() {
  pickerSub.textContent = `スライド ${state.index + 1} の後に挿入`;
  pickerDialog.showModal();
}

document.getElementById("btn-picker-close").addEventListener("click", () => pickerDialog.close());

pickerDialog.addEventListener("click", (e) => {
  if (e.target === pickerDialog) pickerDialog.close();
});

pickerDialog.querySelectorAll(".tpl-card").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const type = btn.dataset.type;
    pickerDialog.close();
    await addSlideAfterCurrent(type);
  });
});

async function addSlideAfterCurrent(type) {
  if (!state.projectId) return;
  const afterIndex = state.index;
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(state.projectId)}/slides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ afterIndex, type, heading: "新しいスライド" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "スライドの追加に失敗しました");
    }
    const data = await res.json();
    await loadProject(state.projectId);
    goTo(data.newSlideIndex, false);
  } catch (err) {
    alert(err.message);
    console.error(err);
  }
}

els.btnAddSlide.addEventListener("click", openSlidePicker);
// --- end Slide picker ---

els.btnMtg.addEventListener("click", openMtg);
els.btnGroup.addEventListener("click", () => sendEditCmd("group"));
els.btnUngroup.addEventListener("click", () => sendEditCmd("ungroup"));
els.btnCheckSpacing.addEventListener("click", () => sendEditCmd("checkSpacing"));
els.btnDistribute.addEventListener("click", () => sendEditCmd("distribute"));
els.btnSpacingApply.addEventListener("click", applySpacingFromInput);
els.btnSpacingDec.addEventListener("click", () => stepSpacingInput(-1));
els.btnSpacingInc.addEventListener("click", () => stepSpacingInput(1));
els.spacingInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    applySpacingFromInput();
  }
});
els.btnSaveEdit.addEventListener("click", () => sendEditCmd("save"));
els.btnDeploy.addEventListener("click", deployToSurge);
els.btnSaveScript.addEventListener("click", () => saveScriptSlide().catch((err) => alert(err.message)));
els.btnRegenerate.addEventListener("click", openRegenerateDialog);
els.btnRegenerateClose?.addEventListener("click", closeRegenerateDialog);
els.btnRegenerateCancel?.addEventListener("click", closeRegenerateDialog);
els.btnRegenerateRun?.addEventListener("click", () => runRegenerate().catch((err) => alert(err.message)));
els.scriptText.addEventListener("input", () => {
  state.scriptDirty = true;
  els.btnSaveScript.classList.remove("is-hidden");
});

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || msg.source !== "slide-upa-edit") return;
  if (msg.type === "spacingInfo") {
    if ((msg.count ?? 0) >= 2 && typeof msg.avg === "number") {
      els.spacingInput.value = String(msg.avg);
      setSpacingControlEnabled(true);
    } else {
      setSpacingControlEnabled(false);
    }
  }
  if (msg.type === "dirty") {
    state.editDirty = true;
  }
  if (msg.type === "saved") {
    state.editDirty = false;
    savedWaiter?.resolve();
    if (state.projectId) {
      const reloadDeck = msg.deck
        ? Promise.resolve(msg.deck)
        : fetch(`/api/projects/${encodeURIComponent(state.projectId)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => data?.deck ?? null);

      Promise.all([fetchOverrides(state.projectId), reloadDeck])
        .then(async ([overrides, deck]) => {
          state.overrides = overrides;
          if (deck) {
            state.deck = deck;
            els.projectTitle.textContent = deck.title ?? state.projectId;
            renderThumbs();
            const slide = deck.slides[state.index];
            if (slide && !state.scriptDirty) {
              els.scriptText.value = slide.script ?? "";
            }
          }
          if (msg.scriptSynced > 0 && state.audienceUrl) {
            state.baseline = await loadSlideBaseline(state.audienceUrl);
            els.slideFrame.src = audienceEmbedUrl();
          }
          updateDriftUi();
          renderOverview();
        })
        .catch(console.error);
    }
  }
});

els.modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

document.addEventListener("keydown", (e) => {
  if (els.app.dataset.mode !== "present") return;
  if (e.target.matches("input, textarea, select")) return;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    goTo(state.index + 1, true);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    goTo(state.index - 1, true);
  }
});

if (syncChannel) {
  syncChannel.onmessage = (e) => {
    if (e.data?.type === "slide" && typeof e.data.index === "number") {
      goTo(e.data.index, false);
    }
  };
}

els.slideFrame.addEventListener("load", () => {
  setTimeout(() => broadcastSlide(state.index), 200);
});

// --- Rulers ---
const SLIDE_W = 1280;
const SLIDE_H = 720;

const rulerH = document.getElementById("ruler-h");
const rulerV = document.getElementById("ruler-v");

function pickTickInterval(slideLength, renderedPx) {
  const scale = renderedPx / slideLength;
  for (const v of [10, 20, 25, 50, 100, 200, 250, 500]) {
    if (v * scale >= 55) return v;
  }
  return 500;
}

function drawHRuler(canvas, frameW) {
  if (!canvas || frameW <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const H = 20;
  canvas.width = Math.round(frameW * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = frameW + "px";
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const scale = frameW / SLIDE_W;
  const interval = pickTickInterval(SLIDE_W, frameW);
  const half = interval / 2;

  ctx.fillStyle = "hsl(200,14%,21%)";
  ctx.fillRect(0, 0, frameW, H);

  ctx.strokeStyle = "hsl(192,18%,58%)";
  ctx.lineWidth = 0.75;

  // Half-interval minor ticks
  for (let pos = half; pos < SLIDE_W; pos += interval) {
    const x = Math.round(pos * scale) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x, H - 5);
    ctx.stroke();
  }

  // Major ticks + labels
  ctx.font = `9px "Inter", "Noto Sans JP", system-ui, sans-serif`;
  ctx.fillStyle = "hsl(192,14%,68%)";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  for (let pos = 0; pos <= SLIDE_W; pos += interval) {
    const x = Math.round(pos * scale) + 0.5;
    ctx.strokeStyle = "hsl(192,18%,58%)";
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x, H - 10);
    ctx.stroke();
    if (pos > 0) {
      ctx.fillText(String(pos), x + 2, 2);
    }
  }
}

function drawVRuler(canvas, frameH) {
  if (!canvas || frameH <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const W = 20;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(frameH * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = frameH + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const scale = frameH / SLIDE_H;
  const interval = pickTickInterval(SLIDE_H, frameH);
  const half = interval / 2;

  ctx.fillStyle = "hsl(200,14%,21%)";
  ctx.fillRect(0, 0, W, frameH);

  ctx.strokeStyle = "hsl(192,18%,58%)";
  ctx.lineWidth = 0.75;

  // Half-interval minor ticks
  for (let pos = half; pos < SLIDE_H; pos += interval) {
    const y = Math.round(pos * scale) + 0.5;
    ctx.beginPath();
    ctx.moveTo(W, y);
    ctx.lineTo(W - 5, y);
    ctx.stroke();
  }

  // Major ticks + labels (rotated)
  ctx.font = `9px "Inter", "Noto Sans JP", system-ui, sans-serif`;
  ctx.fillStyle = "hsl(192,14%,68%)";

  for (let pos = 0; pos <= SLIDE_H; pos += interval) {
    const y = Math.round(pos * scale) + 0.5;
    ctx.beginPath();
    ctx.moveTo(W, y);
    ctx.lineTo(W - 10, y);
    ctx.stroke();
    if (pos > 0) {
      ctx.save();
      ctx.translate(W - 12, y - 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(String(pos), 0, 0);
      ctx.restore();
    }
  }
}

function updateRulers() {
  const frame = els.slideFrame;
  if (!frame) return;
  const w = frame.offsetWidth;
  const h = frame.offsetHeight;
  if (w <= 0 || h <= 0) return;
  drawHRuler(rulerH, w);
  drawVRuler(rulerV, h);
}

if (els.slideFrame && (rulerH || rulerV)) {
  const rulerObserver = new ResizeObserver(updateRulers);
  rulerObserver.observe(els.slideFrame);
}
// --- end Rulers ---

async function init() {
  state.projects = await fetchProjects();
  if (state.projects.length === 0) {
    els.projectTitle.textContent = "プロジェクトがありません";
    els.projectCount.textContent = "0 件";
    return;
  }
  await loadProject(state.projects[0].id);
}

init().catch(console.error);
