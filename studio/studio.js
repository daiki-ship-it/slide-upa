const CHANNEL_NAME = "slide-upa-sync";

const els = {
  app: document.querySelector(".app"),
  projectTitle: document.getElementById("project-title"),
  projectCount: document.getElementById("project-count"),
  projectList: document.getElementById("project-list"),
  slideCount: document.getElementById("slide-count"),
  thumbList: document.getElementById("thumb-list"),
  slideFrame: document.getElementById("slide-frame"),
  scriptText: document.getElementById("script-text"),
  viewPresent: document.getElementById("view-present"),
  viewOverview: document.getElementById("view-overview"),
  overviewList: document.getElementById("overview-list"),
  btnMtg: document.getElementById("btn-mtg"),
  btnGroup: document.getElementById("btn-group"),
  btnUngroup: document.getElementById("btn-ungroup"),
  btnCheckSpacing: document.getElementById("btn-check-spacing"),
  btnDistribute: document.getElementById("btn-distribute"),
  btnSaveEdit: document.getElementById("btn-save-edit"),
  editStatus: document.getElementById("edit-status"),
  modeBtns: document.querySelectorAll(".seg__btn"),
};

let state = {
  projects: [],
  projectId: null,
  audienceUrl: null,
  deck: null,
  index: 0,
  audienceWindow: null,
};

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

function sendEditCmd(cmd) {
  els.slideFrame.contentWindow?.postMessage({ target: "slide-upa-edit", cmd }, "*");
}

async function fetchProjects() {
  const res = await fetch("/api/projects");
  const data = await res.json();
  return data.projects ?? [];
}

async function loadProject(id) {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Project not found");
  const data = await res.json();
  state.projectId = data.id;
  state.deck = data.deck;
  state.audienceUrl = data.audienceUrl;
  state.index = 0;

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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb" + (i === state.index ? " is-active" : "");
    btn.dataset.index = String(i);
    btn.innerHTML = `
      <div class="thumb__row">
        <span class="thumb__num">${i + 1}</span>
        <span class="badge ${badgeClass(slide.type)}">${slide.typeLabel}</span>
      </div>
      <p class="thumb__title">${escapeHtml(slide.heading)}</p>
    `;
    btn.addEventListener("click", () => goTo(i, true));
    li.appendChild(btn);
    els.thumbList.appendChild(li);
  });
}

function renderOverview() {
  const slides = state.deck?.slides ?? [];
  els.overviewList.replaceChildren();
  slides.forEach((slide, i) => {
    const card = document.createElement("article");
    card.className = "overview-card";
    card.innerHTML = `
      <div class="overview-card__preview">
        <iframe class="overview-card__frame" src="${audienceEmbedUrl(i)}" title="スライド ${i + 1}" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>
      </div>
      <div class="overview-card__body">
        <div class="overview-card__head">
          <span class="badge ${badgeClass(slide.type)}">${slide.typeLabel}</span>
          <span class="thumb__num">${i + 1} / ${slides.length}</span>
        </div>
        <h2 class="overview-card__heading">${escapeHtml(slide.heading)}</h2>
        <p class="overview-card__script">${escapeHtml(slide.script)}</p>
      </div>
    `;
    els.overviewList.appendChild(card);
  });
}

function goTo(index, broadcast) {
  const slides = state.deck?.slides ?? [];
  if (index < 0 || index >= slides.length) return;
  state.index = index;
  const slide = slides[index];

  els.thumbList.querySelectorAll(".thumb").forEach((el, i) => {
    const active = i === index;
    el.classList.toggle("is-active", active);
    if (!active) el.blur();
  });

  els.scriptText.textContent = slide.script;

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

function openMtg() {
  if (!state.audienceUrl) return;
  const url = new URL(state.audienceUrl, window.location.origin);
  if (state.projectId) url.searchParams.set("project", state.projectId);
  state.audienceWindow = window.open(`${url.pathname}${url.search}`, "slide-upa-audience");
  setTimeout(() => broadcastSlide(state.index), 500);
}

els.btnMtg.addEventListener("click", openMtg);
els.btnGroup.addEventListener("click", () => sendEditCmd("group"));
els.btnUngroup.addEventListener("click", () => sendEditCmd("ungroup"));
els.btnCheckSpacing.addEventListener("click", () => sendEditCmd("checkSpacing"));
els.btnDistribute.addEventListener("click", () => sendEditCmd("distribute"));
els.btnSaveEdit.addEventListener("click", () => sendEditCmd("save"));

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || msg.source !== "slide-upa-edit") return;
  if (msg.type === "selection") {
    const n = msg.ids?.length ?? 0;
    els.editStatus.textContent = n > 0 ? `${n} 件選択中` : "要素をクリックして選択";
  }
  if (msg.type === "dirty") {
    els.editStatus.textContent = "未保存の変更あり";
  }
  if (msg.type === "saved") {
    els.editStatus.textContent = "保存済み";
  }
  if (msg.type === "spacing" && msg.uneven) {
    els.editStatus.textContent = "余白がばらついています";
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
