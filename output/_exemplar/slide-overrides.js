/**
 * slide-upa 手直しデータ（overrides.json）の読み込み・反映
 * studio 編集モードと MTG（audience）の両方で同じ見た目にする
 */
(function (global) {
  let overrides = { slides: {} };

  function applyElementState(el, data) {
    if (!data) return;
    if (data.html != null) el.innerHTML = data.html;
    if (data.translateX != null || data.translateY != null) {
      const x = data.translateX ?? 0;
      const y = data.translateY ?? 0;
      el.dataset.translateX = String(Math.round(x * 10) / 10);
      el.dataset.translateY = String(Math.round(y * 10) / 10);
      el.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
      if (x || y) el.dataset.edited = "1";
    }
    if (data.group) {
      el.dataset.editGroup = data.group;
      el.classList.add("is-edit-grouped");
    }
    if (data.imageSrc != null && el.dataset.editVisual === "1") {
      const src = String(data.imageSrc);
      if (!/^images\/[^/]+$/.test(src)) return;
      el.innerHTML = `<img class="slide__visual-img" src="${src}" alt="">`;
      el.classList.add("has-visual-img");
      el.dataset.edited = "1";
    }
    if (data.charSrc != null && el.hasAttribute("data-edit-char")) {
      const src = String(data.charSrc);
      if (!/^images\/[^/]+$/.test(src)) return;
      el.setAttribute("src", src);
      el.dataset.edited = "1";
    }
  }

  function applyGlobal() {
    if (!overrides.global?.charIcon) return;
    const src = String(overrides.global.charIcon);
    if (!/^images\/[^/]+$/.test(src)) return;
    document.querySelectorAll(".slide__icon[data-edit-char]").forEach((icon) => {
      icon.setAttribute("src", src);
    });
  }

  function applyForSlide(index) {
    const slide = document.querySelectorAll(".slide")[index];
    if (!slide) return;
    const data = overrides.slides[String(index)];
    if (data?.elements) {
      for (const [id, st] of Object.entries(data.elements)) {
        const el = slide.querySelector(`[data-edit-id="${id}"]`);
        if (el) applyElementState(el, st);
      }
      if (global.lucide) global.lucide.createIcons();
    }
    // フッターアイコンはグローバル設定を適用
    if (overrides.global?.charIcon) {
      const src = String(overrides.global.charIcon);
      if (/^images\/[^/]+$/.test(src)) {
        slide.querySelectorAll(".slide__icon[data-edit-char]").forEach((icon) => {
          icon.setAttribute("src", src);
        });
      }
    }
  }

  async function load(options = {}) {
    const { projectId, localUrl = "overrides.json" } = options;
    if (projectId) {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/overrides`, {
          cache: "no-store",
        });
        if (res.ok) {
          overrides = await res.json();
          return overrides;
        }
      } catch {
        /* API 不可時は同梱ファイルへ */
      }
    }
    try {
      const res = await fetch(localUrl, { cache: "no-store" });
      if (res.ok) overrides = await res.json();
    } catch {
      /* 未保存プロジェクトは overrides なしで OK */
    }
    return overrides;
  }

  function getData() {
    return overrides;
  }

  function setData(data) {
    overrides = data;
  }

  function bindSlideListener() {
    window.addEventListener("slide-upa:slide", (e) => {
      applyForSlide(e.detail?.index ?? 0);
    });
  }

  async function initAudience(options = {}) {
    await load(options);
    // グローバル設定を全スライドに一括適用
    applyGlobal();
    const slides = document.querySelectorAll(".slide");
    const active = [...slides].findIndex((s) => s.classList.contains("is-active"));
    applyForSlide(active >= 0 ? active : 0);
    bindSlideListener();
  }

  global.SlideUpaOverrides = {
    load,
    applyForSlide,
    applyGlobal,
    applyElementState,
    getData,
    setData,
    initAudience,
    bindSlideListener,
  };

  const params = new URLSearchParams(window.location.search);
  if (params.get("edit") !== "1") {
    const projectId = params.get("project") ?? "";
    const run = () => global.SlideUpaOverrides.initAudience({ projectId });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }
})(window);
