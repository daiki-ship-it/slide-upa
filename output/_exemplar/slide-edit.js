/**
 * slide-upa スライド編集（studio 埋め込み専用）
 * - クリックで選択、ドラッグで移動、ダブルクリックでテキスト編集
 * - 位置は transform のみ（flex レイアウトを崩さない）
 * - data-edit-char 要素クリックでキャラクターピッカーを開く
 * - ④ 画像スライドで「枠を追加」ボタンを表示
 */
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get("edit") !== "1" || params.get("embed") !== "studio") return;

  const projectId = params.get("project") ?? "";
  let slideIndex = 0;
  const selected = new Set();
  let dragState = null;
  let pendingVisualSlot = null;

  // bindEditables を複数回呼んでも二重バインドしないための管理セット
  const bound = new WeakSet();

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp,image/gif";
  fileInput.hidden = true;
  document.body.appendChild(fileInput);

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
    reportSpacingInfo();
  }

  function reportSpacingInfo() {
    const els = getSelectedElements();
    if (els.length < 2) {
      postToParent({ type: "spacingInfo", count: els.length });
      return;
    }
    const { gaps } = measureVerticalGaps(els);
    const avg = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    postToParent({ type: "spacingInfo", count: els.length, gaps, avg });
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
    const state = {
      translateX: x,
      translateY: y,
      html: el.innerHTML,
      group: el.dataset.editGroup ?? null,
    };
    if (el.dataset.editVisual === "1") {
      const img = el.querySelector(".slide__visual-img");
      if (img) state.imageSrc = img.getAttribute("src");
    }
    if (el.hasAttribute("data-edit-char") && el.tagName === "IMG") {
      state.charSrc = el.getAttribute("src");
    }
    return state;
  }

  function applyOverridesForSlide(index) {
    window.SlideUpaOverrides?.applyForSlide(index);
  }

  async function loadOverrides() {
    if (!projectId || !window.SlideUpaOverrides) return;
    await SlideUpaOverrides.load({ projectId });
  }

  function collectSlideState(index) {
    const slide = document.querySelectorAll(".slide")[index];
    if (!slide) return { elements: {} };
    const elements = {};
    slide.querySelectorAll("[data-edit-id]").forEach((el) => {
      const hasVisualImage = el.hasAttribute("data-edit-visual") && el.querySelector(".slide__visual-img");
      if (el.dataset.edited === "1" || hasVisualImage) {
        elements[el.dataset.editId] = getElementState(el);
      }
    });
    const state = { elements };
    // ④ 画像スライドのスロット数を保存（復元時に枠数を再現するため）
    if (slide.classList.contains("slide--visual")) {
      const count = slide.querySelectorAll(".slide__visual-slot").length;
      if (count > 0) state.visualSlotCount = count;
    }
    return state;
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

  function getCanvasScale() {
    const scaler = document.querySelector(".slide-scaler");
    if (!scaler) return 1;
    const transform = getComputedStyle(scaler).transform;
    if (!transform || transform === "none") return 1;
    return new DOMMatrix(transform).a || 1;
  }

  function screenToCanvas(delta) {
    return delta / getCanvasScale();
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
      const deltaY = screenToCanvas(targetTop - rect.top);
      writeTranslate(el, base.x, base.y + deltaY);
      targetTop += heights[i] + gap;
    });

    removeSpacingGuides();
    const { gaps, uneven } = showGapGuides(sorted, measureVerticalGaps(sorted).gaps);
    showToast(uneven ? "余白を均等化しました" : "余白はすでに均等です");
    markDirty();
    reportSpacingInfo();
    postToParent({ type: "spacing", gaps, uneven });
  }

  function adjustSpacing(targetGap) {
    const els = getSelectedElements();
    if (els.length < 2) {
      showToast("2つ以上選んでから余白を調整してください");
      return;
    }
    const gap = Math.max(0, Math.round(Number(targetGap)));
    if (Number.isNaN(gap)) {
      showToast("余白は数字で入力してください");
      return;
    }
    const sorted = getSortedByTop(els);
    const firstTop = sorted[0].getBoundingClientRect().top;
    const heights = sorted.map((el) => el.getBoundingClientRect().height);
    let targetTop = firstTop;

    sorted.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const base = readTranslate(el);
      const deltaY = screenToCanvas(targetTop - rect.top);
      writeTranslate(el, base.x, base.y + deltaY);
      targetTop += heights[i] + gap;
    });

    const { gaps, uneven } = showGapGuides(sorted, measureVerticalGaps(sorted).gaps);
    showToast(`縦の余白を ${gap}px に揃えました`);
    markDirty();
    reportSpacingInfo();
    postToParent({ type: "spacing", gaps, uneven, targetGap: gap });
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
    reportSpacingInfo();
  }

  function setVisualSlotImage(slot, src) {
    slot.innerHTML = `<img class="slide__visual-img" src="${src}" alt="">`;
    slot.dataset.edited = "1";
    slot.classList.add("has-visual-img");
    markDirty();
    showToast("画像をセットしました。「保存」で確定してください");
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("画像の読み込みに失敗しました"));
          return;
        }
        const base64 = result.split(",")[1];
        if (!base64) {
          reject(new Error("画像の読み込みに失敗しました"));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      reader.readAsDataURL(file);
    });
  }

  async function uploadVisualImage(file) {
    if (!projectId) {
      showToast("プロジェクトが読み込まれていません");
      return null;
    }
    const data = await readFileAsBase64(file);
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, data }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || "画像のアップロードに失敗しました");
    }
    return payload.src;
  }

  function onVisualSlotClick(e) {
    const slot = e.target.closest("[data-edit-visual]");
    if (!slot) return;
    e.preventDefault();
    e.stopPropagation();
    pendingVisualSlot = slot;
    fileInput.value = "";
    fileInput.click();
  }

  async function onVisualFileSelected() {
    const file = fileInput.files?.[0];
    const slot = pendingVisualSlot;
    pendingVisualSlot = null;
    if (!file || !slot) return;
    try {
      showToast("画像をアップロード中…");
      const src = await uploadVisualImage(file);
      if (src) setVisualSlotImage(slot, src);
    } catch (err) {
      showToast(err.message || "画像のアップロードに失敗しました");
    }
  }

  // ── ④ 画像スライド：枠を追加 ────────────────────────────────

  function addVisualSlotButtons() {
    document.querySelectorAll(".slide--visual").forEach((slide) => {
      const visualArea = slide.querySelector(".slide__visual-area");
      if (!visualArea || visualArea.querySelector(".slide__visual-add")) return;
      const btn = document.createElement("button");
      btn.className = "slide__visual-add";
      btn.type = "button";
      btn.setAttribute("aria-label", "画像枠を追加");
      btn.innerHTML = '<span aria-hidden="true">＋</span> 枠を追加';
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onAddVisualSlot(visualArea);
      });
      visualArea.appendChild(btn);
    });
  }

  function onAddVisualSlot(visualArea) {
    const slots = [...visualArea.querySelectorAll(".slide__visual-slot")];
    if (!slots.length) return;
    const prefix = slots[0].dataset.editId?.replace(/\d+$/, "") ?? "";
    if (!prefix) return;
    const div = document.createElement("div");
    div.className = "slide__visual-slot";
    div.dataset.editId = `${prefix}${slots.length}`;
    div.setAttribute("data-edit-visual", "");
    div.setAttribute("aria-label", "クリックして画像をアップロード");
    visualArea.insertBefore(div, visualArea.querySelector(".slide__visual-add"));
    bindEditables();
    markDirty();
    showToast("画像枠を追加しました");
  }

  // ── キャラクターピッカー ──────────────────────────────────────

  function formatCharName(filename) {
    const noExt = filename.replace(/\.png$/i, "").replace(/-512[×x]512-透過$/, "");
    const dashIdx = noExt.indexOf("-");
    if (dashIdx > 0) {
      return noExt.slice(0, dashIdx) + "\n" + noExt.slice(dashIdx + 1);
    }
    return noExt;
  }

  function setCharImage(targetEl, filename) {
    const src = `images/${filename}`;
    if (targetEl.classList.contains("slide__icon")) {
      document.querySelectorAll(".slide__icon[data-edit-char]").forEach((icon) => {
        icon.setAttribute("src", src);
      });
      const ov = SlideUpaOverrides.getData();
      ov.global = ov.global ?? {};
      ov.global.charIcon = src;
      SlideUpaOverrides.setData(ov);
    } else {
      targetEl.setAttribute("src", src);
      targetEl.dataset.edited = "1";
    }
    markDirty();
    showToast("キャラクターを変更しました。「保存」で確定してください");
  }

  async function openCharPicker(targetEl) {
    let files;
    try {
      const res = await fetch("/api/characters");
      if (!res.ok) throw new Error();
      const data = await res.json();
      files = data.characters;
    } catch {
      showToast("キャラクター一覧の取得に失敗しました");
      return;
    }

    document.querySelector(".slide-char-picker")?.remove();

    const currentSrc = targetEl.getAttribute("src") ?? "";
    const overlay = document.createElement("div");
    overlay.className = "slide-char-picker";

    const panel = document.createElement("div");
    panel.className = "slide-char-picker__panel";

    const header = document.createElement("div");
    header.className = "slide-char-picker__header";

    const title = document.createElement("span");
    title.className = "slide-char-picker__title";
    title.textContent = "キャラクターを選択";

    const closeBtn = document.createElement("button");
    closeBtn.className = "slide-char-picker__close";
    closeBtn.setAttribute("aria-label", "閉じる");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => overlay.remove());

    header.appendChild(title);
    header.appendChild(closeBtn);

    const note = document.createElement("p");
    note.className = "slide-char-picker__note";
    note.textContent = "※ 点線枠は画像アップロード用です（このピッカーとは別機能）";

    const grid = document.createElement("div");
    grid.className = "slide-char-picker__grid";

    files.forEach((filename) => {
      const item = document.createElement("div");
      item.className = "slide-char-picker__item";
      if (currentSrc.endsWith(filename)) item.classList.add("is-current");

      const img = document.createElement("img");
      img.src = `/assets/characters/${filename}`;
      img.alt = filename;

      const label = document.createElement("span");
      label.className = "slide-char-picker__label";
      label.textContent = formatCharName(filename);

      item.appendChild(img);
      item.appendChild(label);
      item.addEventListener("click", () => {
        overlay.remove();
        setCharImage(targetEl, filename);
      });
      grid.appendChild(item);
    });

    panel.appendChild(header);
    panel.appendChild(note);
    panel.appendChild(grid);
    overlay.appendChild(panel);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    function onEsc(e) {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", onEsc);
      }
    }
    document.addEventListener("keydown", onEsc);
  }

  function onCharClick(e) {
    e.preventDefault();
    e.stopPropagation();
    openCharPicker(e.currentTarget);
  }

  // ─────────────────────────────────────────────────────────────

  async function saveOverrides() {
    const ov = SlideUpaOverrides.getData();
    // 全スライドを一括保存（枠数など他スライドの変更も確実に保存）
    document.querySelectorAll(".slide").forEach((_, i) => {
      ov.slides[String(i)] = collectSlideState(i);
    });
    SlideUpaOverrides.setData(ov);
    if (!projectId) return false;
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/overrides`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SlideUpaOverrides.getData()),
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
    if (!el || el.contentEditable === "true" || el.dataset.editVisual === "1" || el.hasAttribute("data-edit-char")) return;
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
    if (el.hasAttribute("data-edit-char")) return;
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
      if (bound.has(el)) return;
      bound.add(el);
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("click", (ev) => ev.stopPropagation());
      el.addEventListener("dblclick", onDblClick);
    });
    document.querySelectorAll("[data-edit-visual]").forEach((slot) => {
      if (bound.has(slot)) return;
      bound.add(slot);
      slot.addEventListener("click", onVisualSlotClick);
    });
    document.querySelectorAll("[data-edit-char]").forEach((el) => {
      if (bound.has(el)) return;
      bound.add(el);
      el.addEventListener("click", onCharClick);
    });
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || msg.target !== "slide-upa-edit") return;
    if (msg.cmd === "group") groupSelected();
    if (msg.cmd === "ungroup") ungroupSelected();
    if (msg.cmd === "distribute") distributeVertical();
    if (msg.cmd === "checkSpacing") checkSpacing();
    if (msg.cmd === "adjustSpacing") adjustSpacing(msg.gap);
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
    // 他スライドへ移動したとき、復元で追加されたスロットへハンドラをバインド
    bindEditables();
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
    slideIndex = [...document.querySelectorAll(".slide")].findIndex((s) =>
      s.classList.contains("is-active")
    );
    if (slideIndex < 0) slideIndex = 0;
    // グローバル設定（フッターアイコン）を全スライドに一括適用
    window.SlideUpaOverrides?.applyGlobal?.();
    // オーバーライドを先に適用してからバインド（追加スロットも正しくバインドされる）
    applyOverridesForSlide(slideIndex);
    bindEditables();
    // ④ 画像スライドに「枠を追加」ボタンを注入
    addVisualSlotButtons();
    // グローバルなリスナーは一度だけ登録
    fileInput.addEventListener("change", onVisualFileSelected);
    document.addEventListener("focusout", onBlurEditable);
    postToParent({ type: "ready" });
  });
})();
