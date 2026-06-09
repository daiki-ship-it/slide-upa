/**
 * slide-upa スライド編集（studio 埋め込み専用）
 * - クリックで選択、ドラッグで移動、ダブルクリックでテキスト編集
 * - 位置は transform のみ（flex レイアウトを崩さない）
 */
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get("edit") !== "1" || params.get("embed") !== "studio") return;

  const projectId = params.get("project") ?? "";
  let overrides = { slides: {} };
  let slideIndex = 0;
  const selected = new Set();
  let dragState = null;

  const toast = document.createElement("div");
  toast.className = "slide-edit-toast";
  toast.setAttribute("role", "status");
  document.body.appendChild(toast);

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function postToParent(payload) {
    window.parent.postMessage({ source: "slide-upa-edit", ...payload }, "*");
  }

  function getActiveSlide() {
    return document.querySelector(".slide.is-active");
  }

  function getEditables(slide = getActiveSlide()) {
    return slide ? [...slide.querySelectorAll("[data-edit-id]")] : [];
  }

  function byId(id) {
    return document.querySelector(`[data-edit-id="${id}"]`);
  }

  function clearSelection() {
    selected.forEach((id) => byId(id)?.classList.remove("is-edit-selected"));
    selected.clear();
    postSelection();
  }

  function selectId(id, additive) {
    if (!additive) clearSelection();
    const el = byId(id);
    if (!el) return;
    selected.add(id);
    el.classList.add("is-edit-selected");
    postSelection();
  }

  function postSelection() {
    postToParent({ type: "selection", ids: [...selected], slideIndex });
  }

  function readTranslate(el) {
    const savedX = el.dataset.translateX;
    const savedY = el.dataset.translateY;
    if (savedX != null && savedY != null) {
      return { x: Number.parseFloat(savedX) || 0, y: Number.parseFloat(savedY) || 0 };
    }
    const match = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (match) {
      return { x: Number.parseFloat(match[1]) || 0, y: Number.parseFloat(match[2]) || 0 };
    }
    return { x: 0, y: 0 };
  }

  function writeTranslate(el, x, y) {
    el.style.position = "";
    el.style.left = "";
    el.style.top = "";
    el.style.width = "";
    el.style.margin = "";
    el.style.zIndex = "";
    el.dataset.translateX = String(Math.round(x * 10) / 10);
    el.dataset.translateY = String(Math.round(y * 10) / 10);
    el.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
    if (x || y) el.dataset.edited = "1";
  }

  function getElementState(el) {
    const { x, y } = readTranslate(el);
    return {
      translateX: x,
      translateY: y,
      html: el.innerHTML,
      group: el.dataset.editGroup ?? null,
    };
  }

  function applyElementState(el, data) {
    if (!data) return;
    if (data.html != null) el.innerHTML = data.html;
    if (data.translateX != null || data.translateY != null) {
      writeTranslate(el, data.translateX ?? 0, data.translateY ?? 0);
    } else if (data.left != null || data.top != null) {
      writeTranslate(el, 0, 0);
    }
    if (data.group) {
      el.dataset.editGroup = data.group;
      el.classList.add("is-edit-grouped");
    }
  }

  function applyOverridesForSlide(index) {
    const slide = document.querySelectorAll(".slide")[index];
    if (!slide) return;
    const data = overrides.slides[String(index)];
    if (!data?.elements) return;
    for (const [id, st] of Object.entries(data.elements)) {
      const el = slide.querySelector(`[data-edit-id="${id}"]`);
      if (el) applyElementState(el, st);
    }
  }

  async function loadOverrides() {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/overrides`);
      if (res.ok) overrides = await res.json();
    } catch {
      /* ignore */
    }
  }

  function collectSlideState(index) {
    const slide = document.querySelectorAll(".slide")[index];
    if (!slide) return { elements: {} };
    const elements = {};
    slide.querySelectorAll("[data-edit-id]").forEach((el) => {
      if (el.dataset.edited === "1") {
        elements[el.dataset.editId] = getElementState(el);
      }
    });
    return { elements };
  }

  function markDirty() {
    postToParent({ type: "dirty", slideIndex });
  }

  function getSelectedElements() {
    return [...selected].map(byId).filter(Boolean);
  }

  function getSortedByTop(els) {
    return [...els].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  function measureVerticalGaps(els) {
    const sorted = getSortedByTop(els);
    const gaps = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].getBoundingClientRect();
      const b = sorted[i + 1].getBoundingClientRect();
      gaps.push(Math.round(b.top - a.bottom));
    }
    return { sorted, gaps };
  }

  function removeSpacingGuides() {
    document.querySelectorAll(".slide-edit-guides").forEach((g) => g.remove());
  }

  function clearSnapGuidesForActiveSlide() {
    getActiveSlide()?.querySelector(".slide__body") &&
      window.SlideUpaSnap?.clearSnapGuides(getActiveSlide().querySelector(".slide__body"));
  }

  function showGapGuides(els, gaps) {
    removeSpacingGuides();
    const slide = getActiveSlide();
    const body = slide?.querySelector(".slide__body");
    if (!body) return;
    const layer = document.createElement("div");
    layer.className = "slide-edit-guides";
    body.appendChild(layer);
    const sorted = getSortedByTop(els);
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const uneven = gaps.some((g) => Math.abs(g - avg) > 2);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].getBoundingClientRect();
      const b = sorted[i + 1].getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const mid = (a.bottom + b.top) / 2 - bodyRect.top;
      const line = document.createElement("div");
      line.className = "slide-edit-guide" + (Math.abs(gaps[i] - avg) > 2 ? " is-uneven" : "");
      line.style.top = `${(mid / bodyRect.height) * 100}%`;
      line.innerHTML = `<span class="slide-edit-guide__label">${gaps[i]}px</span>`;
      layer.appendChild(line);
    }
    return { gaps, uneven, avg: Math.round(avg) };
  }

  function groupSelected() {
    if (selected.size < 2) {
      showToast("2つ以上選んでからグループ化してください");
      return;
    }
    const groupId = `g-${Date.now()}`;
    getSelectedElements().forEach((el) => {
      el.dataset.editGroup = groupId;
      el.classList.add("is-edit-grouped");
    });
    showToast(`${selected.size} 件をグループ化しました`);
    markDirty();
  }

  function ungroupSelected() {
    getSelectedElements().forEach((el) => {
      delete el.dataset.editGroup;
      el.classList.remove("is-edit-grouped");
    });
    showToast("グループを解除しました");
    markDirty();
  }

  function distributeVertical() {
    const els = getSelectedElements();
    if (els.length < 2) {
      showToast("2つ以上選んでください");
      return;
    }
    const sorted = getSortedByTop(els);
    const first = sorted[0].getBoundingClientRect();
    const last = sorted[sorted.length - 1].getBoundingClientRect();
    const totalSpan = last.bottom - first.top;
    const heights = sorted.map((el) => el.getBoundingClientRect().height);
    const gap = (totalSpan - heights.reduce((s, h) => s + h, 0)) / (sorted.length - 1);
    let targetTop = first.top;

    sorted.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const base = readTranslate(el);
      const deltaY = targetTop - rect.top;
      writeTranslate(el, base.x, base.y + deltaY);
      targetTop += heights[i] + gap;
    });

    removeSpacingGuides();
    const { gaps, uneven } = showGapGuides(sorted, measureVerticalGaps(sorted).gaps);
    showToast(uneven ? "余白を均等化しました" : "余白はすでに均等です");
    markDirty();
    postToParent({ type: "spacing", gaps, uneven });
  }

  function checkSpacing() {
    const els = getSelectedElements();
    if (els.length < 2) {
      showToast("2つ以上選んでから余白を確認してください");
      return;
    }
    const { gaps, uneven, avg } = showGapGuides(els, measureVerticalGaps(els).gaps);
    showToast(
      uneven
        ? `余白がばらついています（${gaps.join("px / ")}px、平均 ${avg}px）`
        : `余白は均等です（各 ${avg}px）`
    );
    postToParent({ type: "spacing", gaps, uneven });
  }

  async function saveOverrides() {
    const key = String(slideIndex);
    overrides.slides[key] = collectSlideState(slideIndex);
    if (!projectId) return false;
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/overrides`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides),
    });
    if (res.ok) {
      showToast("保存しました（台本は変わりません）");
      postToParent({ type: "saved", slideIndex });
      return true;
    }
    showToast("保存に失敗しました");
    return false;
  }

  function dragTargetsFor(el, shiftKey) {
    const id = el.dataset.editId;
    const ids = new Set([id]);
    if (el.dataset.editGroup) {
      getEditables().forEach((node) => {
        if (node.dataset.editGroup === el.dataset.editGroup) ids.add(node.dataset.editId);
      });
    } else if (shiftKey && selected.has(id)) {
      selected.forEach((selId) => ids.add(selId));
    }
    return [...ids].map(byId).filter(Boolean);
  }

  function endDrag() {
    if (!dragState) return;
    window.removeEventListener("pointermove", dragState.onMove);
    window.removeEventListener("pointerup", dragState.onUp);
    window.removeEventListener("pointercancel", dragState.onUp);
    if (dragState.slideBody) {
      window.SlideUpaSnap?.clearSnapGuides(dragState.slideBody);
    }
    try {
      dragState.el.releasePointerCapture(dragState.pointerId);
    } catch {
      /* ignore */
    }
    dragState = null;
  }

  function onPointerDown(e) {
    const el = e.target.closest("[data-edit-id]");
    if (!el || el.contentEditable === "true") return;
    if (dragState) endDrag();
    e.stopPropagation();
    e.preventDefault();
    selectId(el.dataset.editId, e.shiftKey);

    const nodes = dragTargetsFor(el, e.shiftKey);
    const bases = nodes.map((node) => ({ node, ...readTranslate(node) }));
    const slideBody = el.closest(".slide__body");
    let moved = false;
    let lastDx = 0;
    let lastDy = 0;

    function applyDrag(dx, dy) {
      dragState.bases.forEach(({ node, x, y }) => {
        node.style.transform = `translate(${x + dx}px, ${y + dy}px)`;
        node.style.zIndex = "10";
      });
    }

    function onMove(ev) {
      if (ev.pointerId !== dragState?.pointerId) return;
      let dx = ev.clientX - dragState.startX;
      let dy = ev.clientY - dragState.startY;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        window.SlideUpaSnap?.clearSnapGuides(slideBody);
        return;
      }
      moved = true;
      applyDrag(dx, dy);

      if (window.SlideUpaSnap && slideBody) {
        const activeNodes = dragState.bases.map((b) => b.node);
        const ctx = SlideUpaSnap.getSnapContext(activeNodes, slideBody);
        if (ctx.activeBox) {
          const snap = SlideUpaSnap.calculateSnap({
            activeBox: ctx.activeBox,
            staticTargets: ctx.staticTargets,
            canvasBox: ctx.canvasBox,
          });
          lastDx = dx + snap.snapDx;
          lastDy = dy + snap.snapDy;
          applyDrag(lastDx, lastDy);
          SlideUpaSnap.renderSnapGuides(slideBody, snap, ctx.staticTargets);
        } else {
          lastDx = dx;
          lastDy = dy;
        }
      } else {
        lastDx = dx;
        lastDy = dy;
      }
    }

    function onUp(ev) {
      if (ev.pointerId !== dragState?.pointerId) return;
      window.SlideUpaSnap?.clearSnapGuides(slideBody);
      if (moved) {
        dragState.bases.forEach(({ node, x, y }) => {
          writeTranslate(node, x + lastDx, y + lastDy);
        });
        removeSpacingGuides();
        markDirty();
      } else {
        dragState.bases.forEach(({ node, x, y }) => writeTranslate(node, x, y));
      }
      endDrag();
    }

    dragState = {
      el,
      slideBody,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      bases,
      onMove,
      onUp,
    };

    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onDblClick(e) {
    const el = e.target.closest("[data-edit-id]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const textTarget = e.target.closest("[data-edit-text]") ?? el;
    textTarget.contentEditable = "true";
    textTarget.focus();
    showToast("編集後は Esc で終了");
  }

  function onBlurEditable(e) {
    const el = e.target;
    if (el.contentEditable !== "true") return;
    el.contentEditable = "false";
    el.closest("[data-edit-id]")?.setAttribute("data-edited", "1");
    markDirty();
  }

  function bindEditables() {
    document.querySelectorAll("[data-edit-id]").forEach((el) => {
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("click", (ev) => ev.stopPropagation());
      el.addEventListener("dblclick", onDblClick);
    });
    document.addEventListener("focusout", onBlurEditable);
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || msg.target !== "slide-upa-edit") return;
    if (msg.cmd === "group") groupSelected();
    if (msg.cmd === "ungroup") ungroupSelected();
    if (msg.cmd === "distribute") distributeVertical();
    if (msg.cmd === "checkSpacing") checkSpacing();
    if (msg.cmd === "save") saveOverrides();
    if (msg.cmd === "clearSelection") {
      clearSelection();
      removeSpacingGuides();
    }
  });

  window.addEventListener("slide-upa:slide", (e) => {
    slideIndex = e.detail?.index ?? 0;
    clearSelection();
    removeSpacingGuides();
    clearSnapGuidesForActiveSlide();
    applyOverridesForSlide(slideIndex);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll("[contenteditable='true']").forEach((el) => {
        el.contentEditable = "false";
      });
    }
  });

  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "slide-edit.css";
  document.head.appendChild(style);

  loadOverrides().then(() => {
    document.querySelectorAll(".slide__body").forEach((body) => {
      body.classList.add("is-edit-layer");
    });
    bindEditables();
    slideIndex = [...document.querySelectorAll(".slide")].findIndex((s) =>
      s.classList.contains("is-active")
    );
    if (slideIndex < 0) slideIndex = 0;
    applyOverridesForSlide(slideIndex);
    postToParent({ type: "ready" });
  });
})();
