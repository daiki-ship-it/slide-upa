/**
 * slide-upa audience デッキ制御
 * - 矢印キー / クリックで枚送り
 * - F キーで全画面（.deck 要素）
 * - BroadcastChannel で studio からの同期を受信
 */
(function () {
  const CHANNEL_NAME = "slide-upa-sync";
  const params = new URLSearchParams(window.location.search);
  const isPreview = params.get("preview") === "1";
  const isEdit = params.get("edit") === "1";
  const isEmbed = isPreview || params.get("embed") === "studio";
  if (isEmbed) {
    document.body.dataset.embed = "studio";
  }
  const slides = Array.from(document.querySelectorAll(".slide"));
  const deck = document.querySelector(".deck");
  let index = 0;

  function getInitialIndex() {
    const fromQuery = Number.parseInt(params.get("slide"), 10);
    if (!Number.isNaN(fromQuery)) {
      return Math.min(Math.max(fromQuery, 0), slides.length - 1);
    }
    return 0;
  }

  function updatePageNumbers() {
    const total = slides.length;
    slides.forEach((slide, i) => {
      const el = slide.querySelector(".slide__page");
      if (el) el.textContent = `${i + 1} / ${total}`;
    });
  }

  function goTo(nextIndex, broadcast) {
    if (nextIndex < 0 || nextIndex >= slides.length) return;
    slides[index].classList.remove("is-active");
    slides[index].setAttribute("aria-hidden", "true");
    index = nextIndex;
    slides[index].classList.add("is-active");
    slides[index].setAttribute("aria-hidden", "false");
    window.dispatchEvent(new CustomEvent("slide-upa:slide", { detail: { index } }));
    if (broadcast) {
      try {
        const ch = new BroadcastChannel(CHANNEL_NAME);
        ch.postMessage({ type: "slide", index });
        ch.close();
      } catch (_) {
        /* BroadcastChannel 非対応環境は無視 */
      }
    }
  }

  function next(broadcast) {
    goTo(index + 1, broadcast);
  }

  function prev(broadcast) {
    goTo(index - 1, broadcast);
  }

  if (!isPreview) {
    document.addEventListener("keydown", (e) => {
      if (isEdit) {
        if (e.target.isContentEditable || e.target.closest("[contenteditable='true']")) return;
        if (e.key === " ") return;
      }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        next(true);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "ArrowUp") {
        e.preventDefault();
        prev(true);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        next(true);
      } else if (!isEdit && (e.key === "f" || e.key === "F")) {
        if (!document.fullscreenElement && deck?.requestFullscreen) {
          deck.requestFullscreen();
        } else if (document.fullscreenElement) {
          document.exitFullscreen();
        }
      }
    });

    if (!isEdit) {
      deck?.addEventListener("click", (e) => {
        if (e.target.closest("[data-edit-id]")) return;
        const rect = deck.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x > rect.width / 2) next(true);
        else prev(true);
      });
    }

    try {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      ch.onmessage = (e) => {
        if (e.data?.type === "slide" && typeof e.data.index === "number") {
          goTo(e.data.index, false);
        }
      };
    } catch (_) {
      /* studio 未使用時は単体でも動作 */
    }
  }

  if (slides.length > 0) {
    index = getInitialIndex();
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-active", i === index);
      slide.setAttribute("aria-hidden", i === index ? "false" : "true");
    });
    updatePageNumbers();
    window.dispatchEvent(new CustomEvent("slide-upa:slide", { detail: { index } }));
  }
})();
