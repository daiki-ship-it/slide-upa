/**
 * slide-upa 手直しデータ（overrides.json）の読み込み・反映
 * studio 編集モードと MTG（audience）の両方で同じ見た目にする
 */
(function (global) {
  let overrides = { slides: {} };

  function applyTranslate(el, x, y) {
    el.dataset.translateX = String(Math.round(x * 10) / 10);
    el.dataset.translateY = String(Math.round(y * 10) / 10);
    if (el.classList.contains("slide__watermark")) {
      el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    } else {
      el.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
    }
    if (x || y) el.dataset.edited = "1";
  }

  function applyElementState(el, data) {
    if (!data) return;
    if (data.html != null) {
      let html = data.html;
      if (el.classList.contains("slide__hero-title") && el.closest(".slide--chapter")) {
        html = html.replace(/<br\s*\/?>/gi, "");
      }
      el.innerHTML = html;
    }
    if (data.translateX != null || data.translateY != null) {
      applyTranslate(el, data.translateX ?? 0, data.translateY ?? 0);
    }
    if (data.editWidth != null) {
      const w = Number(data.editWidth);
      if (w > 0) {
        el.style.width = `${w}px`;
        el.style.maxWidth = `${w}px`;
        el.dataset.editWidth = String(w);
        el.classList.add("has-edit-size");
        el.dataset.edited = "1";
      }
    }
    if (data.editHeight != null) {
      const h = Number(data.editHeight);
      if (h > 0) {
        el.style.height = `${h}px`;
        el.style.minHeight = `${h}px`;
        el.dataset.editHeight = String(h);
        el.classList.add("has-edit-size");
        el.dataset.edited = "1";
      }
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

  /**
   * ④ 画像スライドで保存されたスロット数に合わせて不足分の枠を追加する。
   * slide-edit.js が bindEditables を呼ぶ前に実行されるため、
   * 追加した枠のクリックハンドラは slide-edit.js 側で後から登録される。
   */
  function ensureVisualSlots(slide, neededCount) {
    const visualArea = slide.querySelector(".slide__visual-area");
    if (!visualArea) return;
    const slots = visualArea.querySelectorAll(".slide__visual-slot");
    if (slots.length >= neededCount) return;
    const prefix = slots[0]?.dataset.editId?.replace(/\d+$/, "") ?? "";
    if (!prefix) return;
    for (let j = slots.length; j < neededCount; j++) {
      const div = document.createElement("div");
      div.className = "slide__visual-slot";
      div.dataset.editId = `${prefix}${j}`;
      div.setAttribute("data-edit-visual", "");
      div.setAttribute("aria-label", "クリックして画像をアップロード");
      // 「枠を追加」ボタンがあればその直前に、なければ末尾に挿入
      const addBtn = visualArea.querySelector(".slide__visual-add");
      if (addBtn) {
        visualArea.insertBefore(div, addBtn);
      } else {
        visualArea.appendChild(div);
      }
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
      // ④ 画像スライド：追加された枠を復元
      if (slide.classList.contains("slide--visual")) {
        // overrides の elements に含まれる最大スロット番号からも必要数を推定
        const slotIds = Object.keys(data.elements).filter((id) => /visual\d+$/.test(id));
        const maxFromElements = slotIds.reduce((max, id) => {
          const m = id.match(/visual(\d+)$/);
          return m ? Math.max(max, Number(m[1]) + 1) : max;
        }, 0);
        const neededCount = Math.max(data.visualSlotCount ?? 0, maxFromElements);
        if (neededCount > 1) ensureVisualSlots(slide, neededCount);
      }

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
