/**
 * slide-upa スマートガイド & スナップ（Google スライド風）
 * 計算ロジックの正本。TypeScript 化する場合は calculateSnapping.ts へ移植可。
 */
(function (global) {
  const SNAP_THRESHOLD = 5;
  const X_KEYS = ["left", "centerX", "right"];
  const Y_KEYS = ["top", "centerY", "bottom"];

  /** @typedef {{ left:number, top:number, right:number, bottom:number, width:number, height:number, centerX:number, centerY:number }} SnapBox */
  /** @typedef {{ box: SnapBox, el?: HTMLElement|null, id: string }} SnapTarget */
  /** @typedef {{ axis:"x"|"y", position:number, activeEdge:string, targetEdge:string, targetId:string, targetEl?: HTMLElement|null }} AlignmentPair */
  /** @typedef {{ axis:"x"|"y", position:number, pairs: AlignmentPair[] }} AlignmentGuide */

  function getCanvasScale() {
    const scaler = document.querySelector(".slide-scaler");
    if (!scaler) return 1;
    const transform = getComputedStyle(scaler).transform;
    if (!transform || transform === "none") return 1;
    return new DOMMatrix(transform).a || 1;
  }

  /**
   * @param {DOMRect} rect
   * @param {DOMRect} origin
   * @param {number} [scale]
   * @returns {SnapBox}
   */
  function rectToBox(rect, origin, scale = 1) {
    const left = (rect.left - origin.left) / scale;
    const top = (rect.top - origin.top) / scale;
    const right = (rect.right - origin.left) / scale;
    const bottom = (rect.bottom - origin.top) / scale;
    return {
      left,
      top,
      right,
      bottom,
      width: rect.width / scale,
      height: rect.height / scale,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
    };
  }

  /** @param {SnapBox[]} boxes @returns {SnapBox|null} */
  function mergeBoxes(boxes) {
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map((b) => b.left));
    const top = Math.min(...boxes.map((b) => b.top));
    const right = Math.max(...boxes.map((b) => b.right));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
    };
  }

  /** @param {SnapBox} box @param {number} dx @param {number} dy */
  function shiftBox(box, dx, dy) {
    return {
      ...box,
      left: box.left + dx,
      top: box.top + dy,
      right: box.right + dx,
      bottom: box.bottom + dy,
      centerX: box.centerX + dx,
      centerY: box.centerY + dy,
    };
  }

  /**
   * @param {SnapBox} activeBox
   * @param {SnapTarget[]} staticTargets
   * @param {SnapBox|null} canvasBox
   * @param {"x"|"y"} axis
   * @param {number} threshold
   */
  function snapOneAxis(activeBox, staticTargets, canvasBox, axis, threshold) {
    const keys = axis === "x" ? X_KEYS : Y_KEYS;
    const anchors = keys.map((k) => activeBox[k]);
    /** @type {number[]} */
    const targets = [];
    if (canvasBox) keys.forEach((k) => targets.push(canvasBox[k]));
    staticTargets.forEach(({ box }) => keys.forEach((k) => targets.push(box[k])));

    let bestDelta = 0;
    let bestDist = threshold + 1;

    for (const anchor of anchors) {
      for (const target of targets) {
        const delta = target - anchor;
        const dist = Math.abs(delta);
        if (dist <= threshold && dist < bestDist) {
          bestDist = dist;
          bestDelta = delta;
        }
      }
    }

    return bestDist <= threshold ? bestDelta : 0;
  }

  /**
   * @param {SnapBox} activeBox
   * @param {SnapTarget[]} staticTargets
   * @param {SnapBox|null} canvasBox
   * @param {number} tolerance
   * @returns {AlignmentGuide[]}
   */
  function collectAlignmentDetails(activeBox, staticTargets, canvasBox, tolerance) {
    /** @type {Map<string, AlignmentGuide>} */
    const guideMap = new Map();

    /** @type {SnapTarget[]} */
    const allTargets = [];
    if (canvasBox) {
      allTargets.push({ box: canvasBox, el: null, id: "canvas" });
    }
    allTargets.push(...staticTargets);

    for (const axis of /** @type {const} */ (["x", "y"])) {
      const keys = axis === "x" ? X_KEYS : Y_KEYS;
      for (const activeEdge of keys) {
        const activeVal = activeBox[activeEdge];
        for (const target of allTargets) {
          for (const targetEdge of keys) {
            const targetVal = target.box[targetEdge];
            if (Math.abs(activeVal - targetVal) > tolerance) continue;

            const guideKey = `${axis}:${Math.round(targetVal * 100)}`;
            let guide = guideMap.get(guideKey);
            if (!guide) {
              guide = { axis, position: targetVal, pairs: [] };
              guideMap.set(guideKey, guide);
            }

            const pairKey = `${activeEdge}:${targetEdge}:${target.id}`;
            if (guide.pairs.some((p) => `${p.activeEdge}:${p.targetEdge}:${p.targetId}` === pairKey)) {
              continue;
            }

            guide.pairs.push({
              axis,
              position: targetVal,
              activeEdge,
              targetEdge,
              targetId: target.id,
              targetEl: target.el,
            });
          }
        }
      }
    }

    return [...guideMap.values()];
  }

  /**
   * @param {AlignmentGuide} guide
   * @param {SnapBox} activeBox
   * @param {SnapTarget[]} staticTargets
   */
  function guideSegment(guide, activeBox, staticTargets) {
    /** @type {SnapBox[]} */
    const boxes = [activeBox];
    for (const pair of guide.pairs) {
      if (pair.targetId === "canvas") continue;
      const target = staticTargets.find((t) => t.id === pair.targetId);
      if (target) boxes.push(target.box);
    }
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    return { left, right, top, bottom };
  }

  /**
   * @param {{ activeBox: SnapBox, staticTargets: SnapTarget[], canvasBox: SnapBox|null, threshold?: number }} input
   */
  function calculateSnap(input) {
    const threshold = input.threshold ?? SNAP_THRESHOLD;
    const staticTargets = input.staticTargets ?? [];
    const snapDx = snapOneAxis(input.activeBox, staticTargets, input.canvasBox, "x", threshold);
    const afterX = shiftBox(input.activeBox, snapDx, 0);
    const snapDy = snapOneAxis(afterX, staticTargets, input.canvasBox, "y", threshold);
    const finalBox = shiftBox(afterX, 0, snapDy);
    const guides = collectAlignmentDetails(finalBox, staticTargets, input.canvasBox, 0.5);
    return { snapDx, snapDy, guides, activeBox: finalBox };
  }

  /**
   * ドラッグ中のスナップ文脈を DOM から構築
   * @param {HTMLElement[]} activeNodes
   * @param {HTMLElement} slideEl `.slide` 要素（1280×720 のスライド全体）
   */
  function getSnapContext(activeNodes, slideEl) {
    const scale = getCanvasScale();
    const slideRect = slideEl.getBoundingClientRect();
    const canvasBox = rectToBox(slideRect, slideRect, scale);
    const activeSet = new Set(activeNodes);

    /** @type {SnapTarget[]} */
    const staticTargets = [];
    slideEl.querySelectorAll("[data-edit-id]").forEach((el) => {
      if (!activeSet.has(el)) {
        staticTargets.push({
          box: rectToBox(el.getBoundingClientRect(), slideRect, scale),
          el,
          id: el.dataset.editId ?? "",
        });
      }
    });

    const activeBox = mergeBoxes(
      activeNodes.map((node) => rectToBox(node.getBoundingClientRect(), slideRect, scale))
    );

    return {
      slideRect,
      canvasBox,
      staticTargets,
      activeBox,
      extent: { width: canvasBox.width, height: canvasBox.height },
    };
  }

  /**
   * @param {HTMLElement} container
   * @param {{ guides: AlignmentGuide[], activeBox: SnapBox|null }} result
   * @param {SnapTarget[]} staticTargets
   * @param {{ width: number, height: number }|null} [extent]
   */
  function renderSnapGuides(container, result, staticTargets, extent) {
    clearSnapGuides(container);
    if (!result.guides.length || !result.activeBox) return;

    const layer = document.createElement("div");
    layer.className = "slide-edit-snap-guides";
    layer.setAttribute("aria-hidden", "true");
    container.appendChild(layer);

    for (const guide of result.guides) {
      const isCanvasCenter = guide.pairs.some((p) => p.targetId === "canvas");
      const line = document.createElement("div");
      line.className = `slide-edit-snap-guide slide-edit-snap-guide--${guide.axis}`;
      if (isCanvasCenter) {
        line.classList.add(`is-canvas-center--${guide.axis}`);
        if (guide.axis === "x" && extent) {
          line.style.left = `${guide.position}px`;
          line.style.top = "0";
          line.style.height = `${extent.height}px`;
        } else if (guide.axis === "y" && extent) {
          line.style.top = `${guide.position}px`;
          line.style.left = "0";
          line.style.width = `${extent.width}px`;
        }
      } else {
        const seg = guideSegment(guide, result.activeBox, staticTargets);
        if (guide.axis === "x") {
          line.style.left = `${guide.position}px`;
          line.style.top = `${seg.top}px`;
          line.style.height = `${Math.max(seg.bottom - seg.top, 1)}px`;
        } else {
          line.style.top = `${guide.position}px`;
          line.style.left = `${seg.left}px`;
          line.style.width = `${Math.max(seg.right - seg.left, 1)}px`;
        }
      }
      layer.appendChild(line);
    }
  }

  /** @param {HTMLElement} container */
  function clearSnapGuides(container) {
    container?.querySelectorAll(".slide-edit-snap-guides").forEach((el) => el.remove());
  }

  global.SlideUpaSnap = {
    SNAP_THRESHOLD,
    calculateSnap,
    getSnapContext,
    renderSnapGuides,
    clearSnapGuides,
    rectToBox,
    mergeBoxes,
  };
})(window);
