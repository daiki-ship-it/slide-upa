/**
 * slide-upa スライド編集（studio 埋め込み専用）
 * - クリックで選択、ドラッグで移動、ダブルクリックでテキスト編集
 * - 選択中のテキストボックスはハンドルでサイズ調整（overrides に保存）
 * - 位置は transform のみ（flex レイアウトを崩さない）
 * - data-edit-char 要素クリックでキャラクターピッカーを開く
 * - ④ 画像スライドで「枠を追加」「×削除」ボタンを表示
 */
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get("edit") !== "1" || params.get("embed") !== "studio") return;

  const projectId = params.get("project") ?? "";
  let slideIndex = 0;
  const selected = new Set();
  let dragState = null;
  let resizeState = null;
  let pendingVisualSlot = null;

  const RESIZE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const RESIZE_MIN = 48;

  // ハンドラ種別ごとに WeakSet を分ける（同じ要素が複数のループで処理されても二重バインドしない）
  const boundId = new WeakSet();     // [data-edit-id] 用（ドラッグ・テキスト編集）
  const boundVisual = new WeakSet(); // [data-edit-visual] 用（画像アップロード）
  const boundChar = new WeakSet();   // [data-edit-char] 用（キャラ選択）
  const suppressNextClick = new WeakSet(); // ドラッグ直後の click を抑止

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
    updateResizeHandles();
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
    updateResizeHandles();
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

  function formatTransform(el, x, y) {
    if (el.classList.contains("slide__watermark")) {
      return `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }
    return x || y ? `translate(${x}px, ${y}px)` : "";
  }

  function writeTranslate(el, x, y) {
    el.style.position = "";
    el.style.left = "";
    el.style.top = "";
    el.style.margin = "";
    el.style.zIndex = "";
    el.dataset.translateX = String(Math.round(x * 10) / 10);
    el.dataset.translateY = String(Math.round(y * 10) / 10);
    el.style.transform = formatTransform(el, x, y);
    if (x || y) el.dataset.edited = "1";
  }

  function readSize(el) {
    const w = el.dataset.editWidth;
    const h = el.dataset.editHeight;
    return {
      width: w != null ? Number.parseFloat(w) || null : null,
      height: h != null ? Number.parseFloat(h) || null : null,
    };
  }

  function writeSize(el, width, height) {
    if (width != null && width >= RESIZE_MIN) {
      const w = Math.round(width * 10) / 10;
      el.style.width = `${w}px`;
      el.style.maxWidth = `${w}px`;
      el.dataset.editWidth = String(w);
    }
    if (height != null && height >= RESIZE_MIN) {
      const h = Math.round(height * 10) / 10;
      el.style.height = `${h}px`;
      el.style.minHeight = `${h}px`;
      el.dataset.editHeight = String(h);
    }
    if (width != null || height != null) {
      el.classList.add("has-edit-size");
      el.dataset.edited = "1";
    }
  }

  function isResizable(el) {
    if (!el || el.hasAttribute("data-edit-visual")) return false;
    if (el.hasAttribute("data-edit-char") && el.tagName === "IMG") return false;
    return true;
  }

  function getElementCanvasRect(el) {
    const body = el?.closest(".slide__body");
    if (!body) return null;
    const scale = getCanvasScale();
    const elRect = el.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      left: (elRect.left - bodyRect.left) / scale,
      top: (elRect.top - bodyRect.top) / scale,
      width: elRect.width / scale,
      height: elRect.height / scale,
    };
  }

  function getResizeLayer() {
    const body = getActiveSlide()?.querySelector(".slide__body");
    if (!body) return null;
    let layer = body.querySelector(".slide-edit-resize-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "slide-edit-resize-layer";
      layer.setAttribute("aria-hidden", "true");
      const frame = document.createElement("div");
      frame.className = "slide-edit-selection-frame";
      layer.appendChild(frame);
      RESIZE_DIRS.forEach((dir) => {
        const handle = document.createElement("div");
        handle.className = `slide-edit-resize-handle slide-edit-resize-handle--${dir}`;
        handle.dataset.dir = dir;
        handle.addEventListener("pointerdown", onResizePointerDown);
        layer.appendChild(handle);
      });
      body.appendChild(layer);
    }
    return layer;
  }

  function positionResizeHandles(el, layer = getResizeLayer()) {
    if (!el || !layer) return;
    const rect = getElementCanvasRect(el);
    if (!rect) return;
    const { left, top, width: w, height: h } = rect;
    const frame = layer.querySelector(".slide-edit-selection-frame");
    if (frame) {
      frame.style.left = `${left}px`;
      frame.style.top = `${top}px`;
      frame.style.width = `${w}px`;
      frame.style.height = `${h}px`;
    }
    const points = {
      nw: [left, top],
      n: [left + w / 2, top],
      ne: [left + w, top],
      e: [left + w, top + h / 2],
      se: [left + w, top + h],
      s: [left + w / 2, top + h],
      sw: [left, top + h],
      w: [left, top + h / 2],
    };
    layer.querySelectorAll(".slide-edit-resize-handle").forEach((handle) => {
      const [x, y] = points[handle.dataset.dir] ?? [0, 0];
      handle.style.left = `${x}px`;
      handle.style.top = `${y}px`;
    });
  }

  function updateResizeHandles() {
    const layer = getResizeLayer();
    document.querySelectorAll(".is-resize-target").forEach((node) => node.classList.remove("is-resize-target"));
    if (!layer) return;
    if (selected.size !== 1) {
      layer.hidden = true;
      return;
    }
    const el = byId([...selected][0]);
    if (!el || !isResizable(el)) {
      layer.hidden = true;
      return;
    }
    el.classList.add("is-resize-target");
    layer.hidden = false;
    positionResizeHandles(el, layer);
  }

  function endResize() {
    if (!resizeState) return;
    window.removeEventListener("pointermove", resizeState.onMove);
    window.removeEventListener("pointerup", resizeState.onUp);
    window.removeEventListener("pointercancel", resizeState.onUp);
    try {
      resizeState.handle.releasePointerCapture(resizeState.pointerId);
    } catch {
      /* ignore */
    }
    resizeState = null;
    updateResizeHandles();
  }

  function onResizePointerDown(e) {
    if (selected.size !== 1) return;
    const el = byId([...selected][0]);
    if (!el || !isResizable(el)) return;
    if (dragState) endDrag();
    e.preventDefault();
    e.stopPropagation();

    const saved = readSize(el);
    const startW = saved.width ?? el.offsetWidth;
    const startH = saved.height ?? el.offsetHeight;
    const { x: startTx, y: startTy } = readTranslate(el);

    function onMove(ev) {
      if (ev.pointerId !== resizeState?.pointerId) return;
      const dx = screenToCanvas(ev.clientX - resizeState.startX);
      const dy = screenToCanvas(ev.clientY - resizeState.startY);
      const dir = resizeState.dir;
      let w = resizeState.startW;
      let h = resizeState.startH;
      let tx = resizeState.startTx;
      let ty = resizeState.startTy;

      if (dir.includes("e")) w = Math.max(RESIZE_MIN, resizeState.startW + dx);
      if (dir.includes("w")) {
        w = Math.max(RESIZE_MIN, resizeState.startW - dx);
        tx = resizeState.startTx + (resizeState.startW - w);
      }
      if (dir.includes("s")) h = Math.max(RESIZE_MIN, resizeState.startH + dy);
      if (dir.includes("n")) {
        h = Math.max(RESIZE_MIN, resizeState.startH - dy);
        ty = resizeState.startTy + (resizeState.startH - h);
      }

      writeSize(el, w, h);
      writeTranslate(el, tx, ty);
      positionResizeHandles(el);
    }

    function onUp(ev) {
      if (ev.pointerId !== resizeState?.pointerId) return;
      markDirty();
      endResize();
    }

    resizeState = {
      el,
      dir: e.currentTarget.dataset.dir,
      handle: e.currentTarget,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startW,
      startH,
      startTx,
      startTy,
      onMove,
      onUp,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function getElementState(el) {
    const { x, y } = readTranslate(el);
    const { width, height } = readSize(el);
    let html = el.innerHTML;
    if (el.classList.contains("slide__hero-title") && el.closest(".slide--chapter")) {
      html = html.replace(/<br\s*\/?>/gi, "");
    }
    const state = {
      translateX: x,
      translateY: y,
      html,
      group: el.dataset.editGroup ?? null,
    };
    if (width != null) state.editWidth = width;
    if (height != null) state.editHeight = height;
    if (el.hasAttribute("data-edit-visual")) {
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
    const slide = getActiveSlide();
    if (slide) window.SlideUpaSnap?.clearSnapGuides(slide);
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
    // 削除ボタンを再追加（innerHTML で消えるため）
    refreshVisualSlotUI();
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
    if (suppressNextClick.has(slot)) {
      suppressNextClick.delete(slot);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // 削除ボタンのクリックは除外
    if (e.target.closest(".slide__visual-remove")) return;
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

  // ── ④ 画像スライド：枠の追加・削除 UI ──────────────────────────

  function renumberVisualSlots(visualArea) {
    [...visualArea.querySelectorAll(".slide__visual-slot")].forEach((slot, i) => {
      const prefix = slot.dataset.editId?.replace(/\d+$/, "") ?? "";
      if (prefix) slot.dataset.editId = `${prefix}${i}`;
    });
  }

  /**
   * 「＋ 枠を追加」ボタンと「× 削除」ボタンを全 visual スライドに整備する。
   * 複数回呼ばれても安全（既存ボタンの重複なし、表示/非表示の更新のみ）。
   */
  function refreshVisualSlotUI() {
    document.querySelectorAll(".slide--visual").forEach((slide) => {
      const visualArea = slide.querySelector(".slide__visual-area");
      if (!visualArea) return;

      // 「＋ 枠を追加」ボタン
      if (!visualArea.querySelector(".slide__visual-add")) {
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
      }

      // 各スロットの「× 削除」ボタン
      const slots = [...visualArea.querySelectorAll(".slide__visual-slot")];
      slots.forEach((slot) => {
        if (!slot.querySelector(".slide__visual-remove")) {
          const btn = document.createElement("button");
          btn.className = "slide__visual-remove";
          btn.type = "button";
          btn.setAttribute("aria-label", "この枠を削除");
          btn.textContent = "×";
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onRemoveVisualSlot(slot, visualArea);
          });
          slot.appendChild(btn);
        }
        // 1枠のときは削除ボタンを隠す（最後の1枠は消せない）
        slot.querySelector(".slide__visual-remove").style.display =
          slots.length > 1 ? "" : "none";
      });
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
    refreshVisualSlotUI();
    markDirty();
    showToast("画像枠を追加しました");
  }

  function onRemoveVisualSlot(slot, visualArea) {
    slot.remove();
    renumberVisualSlots(visualArea);
    bindEditables();
    refreshVisualSlotUI();
    markDirty();
    showToast("画像枠を削除しました");
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
    const el = e.currentTarget;
    if (suppressNextClick.has(el)) {
      suppressNextClick.delete(el);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    openCharPicker(el);
  }

  function getSlideBodyFor(el) {
    return el.closest(".slide__body") ?? el.closest(".slide")?.querySelector(".slide__body") ?? null;
  }

  function getSlideFor(el) {
    return el.closest(".slide");
  }

  // ─────────────────────────────────────────────────────────────
  // 台本（script.md）同期 — スライド上のテキスト編集を保存時に反映

  function htmlToMarkdownInline(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    if (!root) return "";

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (node.nodeName === "STRONG" || node.nodeName === "B") {
        return `**${[...node.childNodes].map(walk).join("")}**`;
      }
      if (node.nodeName === "BR") return "\n";
      return [...node.childNodes].map(walk).join("");
    };

    return walk(root)
      .replace(/\u00a0/g, " ")
      .replace(/\n+/g, "\n")
      .trim();
  }

  function getSlideTitleText(slide) {
    const el = slide.querySelector("[data-edit-id$='-title']");
    if (!el) return "";
    return htmlToMarkdownInline(el.innerHTML).replace(/\n/g, " ").trim();
  }

  function slideHasTextEdits(slide) {
    return [...slide.querySelectorAll("[data-edit-id]")].some((el) => {
      if (el.hasAttribute("data-edit-visual") || el.hasAttribute("data-edit-char")) return false;
      if (el.dataset.edited !== "1") return false;
      return el.hasAttribute("data-edit-text") || el.querySelector("[data-edit-text]");
    });
  }

  function collectTextPatches(slide) {
    const patches = [];
    const seen = new Set();

    slide.querySelectorAll("[data-edit-id]").forEach((host) => {
      if (host.dataset.edited !== "1") return;
      if (host.hasAttribute("data-edit-visual") || host.hasAttribute("data-edit-char")) return;

      if (host.hasAttribute("data-edit-text")) {
        const key = `${host.dataset.editId}:self`;
        if (seen.has(key)) return;
        seen.add(key);
        let html = host.innerHTML;
        if (host.classList.contains("slide__hero-title") && host.closest(".slide--chapter")) {
          html = html.replace(/<br\s*\/?>/gi, "");
        }
        patches.push({ editId: host.dataset.editId, mode: "self", html });
        return;
      }

      if (host.querySelector(".slide__bubble-key")) {
        const key = `${host.dataset.editId}:quote`;
        if (seen.has(key)) return;
        seen.add(key);
        patches.push({
          editId: host.dataset.editId,
          mode: "quote",
          leadHtml: host.querySelector(".slide__bubble-lead")?.innerHTML ?? "",
          keyHtml: host.querySelector(".slide__bubble-key")?.innerHTML ?? "",
        });
        return;
      }

      host.querySelectorAll("[data-edit-text]").forEach((textEl) => {
        const key = `${host.dataset.editId}:span`;
        if (seen.has(key)) return;
        seen.add(key);
        patches.push({ editId: host.dataset.editId, mode: "span", html: textEl.innerHTML });
      });
    });

    return patches;
  }

  function extractScriptSyncForSlide(slide, index) {
    const type = slide.dataset.type || "bullets";
    const heading = getSlideTitleText(slide);
    const textPatches = collectTextPatches(slide);

    if (type === "title") {
      return { index, heading, script: "", textPatches };
    }
    if (type === "chapter") {
      const items = [...slide.querySelectorAll(".slide__agenda-item")].map((li) => {
        const labelEl = li.querySelector(".slide__agenda-label");
        const textEl = li.querySelector(".slide__agenda-text");
        const labelMd = labelEl ? htmlToMarkdownInline(labelEl.innerHTML) : "";
        const textMd = textEl ? htmlToMarkdownInline(textEl.innerHTML) : "";
        return labelMd ? `- **${labelMd}** — ${textMd}` : `- ${textMd}`;
      });
      return { index, heading, script: items.join("\n"), skipBody: true, textPatches };
    }
    if (type === "goal") {
      const items = [...slide.querySelectorAll(".slide__goal-item")].map((li) => {
        const num = li.querySelector(".slide__goal-num")?.textContent?.trim() ?? "";
        const textEl = li.querySelector(".slide__goal-text");
        const textMd = textEl ? htmlToMarkdownInline(textEl.innerHTML) : "";
        return num ? `- **${num}**${textMd}` : `- ${textMd}`;
      });
      return { index, heading, script: items.join("\n"), textPatches };
    }
    if (type === "agenda") {
      const items = [...slide.querySelectorAll(".slide__agenda-item")].map((li) => {
        const labelEl = li.querySelector(".slide__agenda-label");
        const textEl = li.querySelector(".slide__agenda-text");
        const labelMd = labelEl ? htmlToMarkdownInline(labelEl.innerHTML) : "";
        const textMd = textEl ? htmlToMarkdownInline(textEl.innerHTML) : "";
        return labelMd ? `- **${labelMd}** — ${textMd}` : `- ${textMd}`;
      });
      return { index, heading, script: items.join("\n"), textPatches };
    }
    if (type === "visual") {
      const bodyEl = slide.querySelector(".slide__visual-text");
      const bodyEdited = bodyEl?.dataset.edited === "1";
      if (!bodyEdited) {
        return { index, heading, skipBody: true, textPatches };
      }
      const scriptBody = bodyEl ? htmlToMarkdownInline(bodyEl.innerHTML).trim() : "";
      return { index, heading, script: scriptBody, textPatches };
    }
    if (type === "quote") {
      const bubble = slide.querySelector(".slide__bubble");
      const lead = bubble?.querySelector(".slide__bubble-lead");
      const key = bubble?.querySelector(".slide__bubble-key");
      const parts = [lead, key].filter(Boolean).map((el) => htmlToMarkdownInline(el.innerHTML));
      const quoteText = parts.join("");
      return {
        index,
        heading,
        script: quoteText ? `[quote: ${quoteText}]` : "",
        textPatches,
      };
    }
    if (type === "bullets") {
      const items = [...slide.querySelectorAll(".slide__list-item [data-edit-text]")].map(
        (el) => `- ${htmlToMarkdownInline(el.innerHTML)}`
      );
      return { index, heading, script: items.join("\n"), textPatches };
    }
    return null;
  }

  function collectScriptSync() {
    const sync = [];
    document.querySelectorAll(".slide").forEach((slide, index) => {
      if (!slideHasTextEdits(slide)) return;
      const item = extractScriptSyncForSlide(slide, index);
      if (item) sync.push(item);
    });
    return sync;
  }

  async function saveOverrides() {
    const ov = SlideUpaOverrides.getData();
    // 全スライドを一括保存（枠数など他スライドの変更も確実に保存）
    document.querySelectorAll(".slide").forEach((_, i) => {
      ov.slides[String(i)] = collectSlideState(i);
    });
    SlideUpaOverrides.setData(ov);
    if (!projectId) return false;

    const scriptSync = collectScriptSync();
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/overrides`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...SlideUpaOverrides.getData(), scriptSync }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(
        data.scriptSynced > 0 ? "保存しました（台本にも反映）" : "保存しました"
      );
      postToParent({
        type: "saved",
        slideIndex,
        scriptSynced: data.scriptSynced ?? 0,
        deck: data.deck ?? null,
      });
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
    if (dragState.slideRoot) {
      window.SlideUpaSnap?.clearSnapGuides(dragState.slideRoot);
    }
    try {
      dragState.el.releasePointerCapture(dragState.pointerId);
    } catch {
      /* ignore */
    }
    dragState = null;
  }

  function onPointerDown(e) {
    if (e.target.closest(".slide-edit-resize-handle")) return;
    const el = e.target.closest("[data-edit-id]");
    if (!el || el.contentEditable === "true") return;
    if (resizeState) endResize();
    if (dragState) endDrag();
    e.stopPropagation();
    e.preventDefault();
    selectId(el.dataset.editId, e.shiftKey);

    const nodes = dragTargetsFor(el, e.shiftKey);
    const bases = nodes.map((node) => ({ node, ...readTranslate(node) }));
    const slideRoot = getSlideFor(el);
    let moved = false;
    let lastDx = 0;
    let lastDy = 0;

    function applyDrag(dx, dy) {
      dragState.bases.forEach(({ node, x, y }) => {
        node.style.transform = formatTransform(node, x + dx, y + dy);
        node.style.zIndex = "10";
      });
    }

    function onMove(ev) {
      if (ev.pointerId !== dragState?.pointerId) return;
      let dx = screenToCanvas(ev.clientX - dragState.startX);
      let dy = screenToCanvas(ev.clientY - dragState.startY);
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        window.SlideUpaSnap?.clearSnapGuides(slideRoot);
        return;
      }
      moved = true;
      applyDrag(dx, dy);

      if (window.SlideUpaSnap && slideRoot) {
        const activeNodes = dragState.bases.map((b) => b.node);
        const ctx = SlideUpaSnap.getSnapContext(activeNodes, slideRoot);
        if (ctx.activeBox) {
          const snap = SlideUpaSnap.calculateSnap({
            activeBox: ctx.activeBox,
            staticTargets: ctx.staticTargets,
            canvasBox: ctx.canvasBox,
          });
          lastDx = dx + snap.snapDx;
          lastDy = dy + snap.snapDy;
          applyDrag(lastDx, lastDy);
          SlideUpaSnap.renderSnapGuides(slideRoot, snap, ctx.staticTargets, ctx.extent);
        } else {
          lastDx = dx;
          lastDy = dy;
        }
      } else {
        lastDx = dx;
        lastDy = dy;
      }
      if (selected.size === 1) positionResizeHandles(el);
    }

    function onUp(ev) {
      if (ev.pointerId !== dragState?.pointerId) return;
      window.SlideUpaSnap?.clearSnapGuides(slideRoot);
      if (moved) {
        dragState.bases.forEach(({ node, x, y }) => {
          writeTranslate(node, x + lastDx, y + lastDy);
        });
        if (el.hasAttribute("data-edit-char") || el.hasAttribute("data-edit-visual")) {
          suppressNextClick.add(el);
        }
        removeSpacingGuides();
        markDirty();
      } else {
        dragState.bases.forEach(({ node, x, y }) => writeTranslate(node, x, y));
      }
      endDrag();
      updateResizeHandles();
    }

    dragState = {
      el,
      slideRoot,
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
    if (el.hasAttribute("data-edit-char") || el.hasAttribute("data-edit-visual")) return;
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
    // [data-edit-id]：ドラッグ・テキスト編集ハンドラ
    document.querySelectorAll("[data-edit-id]").forEach((el) => {
      if (boundId.has(el)) return;
      boundId.add(el);
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("click", (ev) => ev.stopPropagation());
      el.addEventListener("dblclick", onDblClick);
    });
    // [data-edit-visual]：画像アップロードハンドラ（別の WeakSet で管理）
    document.querySelectorAll("[data-edit-visual]").forEach((slot) => {
      if (boundVisual.has(slot)) return;
      boundVisual.add(slot);
      slot.addEventListener("click", onVisualSlotClick);
    });
    // [data-edit-char]：キャラクターピッカーハンドラ（別の WeakSet で管理）
    document.querySelectorAll("[data-edit-char]").forEach((el) => {
      if (boundChar.has(el)) return;
      boundChar.add(el);
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
    bindEditables();
    refreshVisualSlotUI();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll("[contenteditable='true']").forEach((el) => {
        el.contentEditable = "false";
      });
    }
  });

  window.addEventListener("resize", () => {
    if (selected.size === 1) updateResizeHandles();
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
    window.SlideUpaOverrides?.applyGlobal?.();
    applyOverridesForSlide(slideIndex);
    bindEditables();
    refreshVisualSlotUI();
    fileInput.addEventListener("change", onVisualFileSelected);
    document.addEventListener("focusout", onBlurEditable);
    postToParent({ type: "ready" });
  });
})();
