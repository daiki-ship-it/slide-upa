/**
 * slide-upa audience デッキ制御
 * - 矢印キー / クリックで枚送り
 * - F キーで全画面（.deck 要素）
 * - BroadcastChannel で studio からの同期を受信
 */
(function () {
  const CHANNEL_NAME = "slide-upa-sync";
  const slides = Array.from(document.querySelectorAll(".slide"));
  const deck = document.querySelector(".deck");
  let index = 0;

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

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
      e.preventDefault();
      next(true);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      prev(true);
    } else if (e.key === "f" || e.key === "F") {
      if (!document.fullscreenElement && deck?.requestFullscreen) {
        deck.requestFullscreen();
      } else if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    }
  });

  deck?.addEventListener("click", (e) => {
    const rect = deck.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > rect.width / 2) next(true);
    else prev(true);
  });

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

  if (slides.length > 0) {
    slides[0].classList.add("is-active");
    slides[0].setAttribute("aria-hidden", "false");
    updatePageNumbers();
  }
})();
