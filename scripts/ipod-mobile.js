(() => {
  "use strict";

  const wheel = document.getElementById("ipodWheel");
  if (!wheel) return;
  document.body.classList.add("ipod-ready");

  const trigger = action => {
    const target = action === "prev" ? "#prevBtn" : action === "next" ? "#nextBtn" : "#playToggleBtn";
    const button = document.querySelector(target);
    if (button && !button.disabled) button.click();
  };

  wheel.querySelectorAll("[data-ipod-action]").forEach(button => {
    button.addEventListener("click", () => trigger(button.dataset.ipodAction));
  });

  const selectBtn = wheel.querySelector('[data-ipod-action="select"]');
  const syncSelectIcon = () => {
    const mainBtn = document.getElementById("playToggleBtn");
    const state = mainBtn?.dataset?.playbackState;
    if (!selectBtn) return;
    if (state === "playing") {
      selectBtn.textContent = "⏸";
      selectBtn.setAttribute("aria-label", "暂停");
    } else if (state === "retry") {
      selectBtn.textContent = "↻";
      selectBtn.setAttribute("aria-label", "重试播放");
    } else {
      selectBtn.textContent = "▶";
      selectBtn.setAttribute("aria-label", "播放");
    }
  };

  const playToggleBtn = document.getElementById("playToggleBtn");
  if (playToggleBtn) {
    new MutationObserver(syncSelectIcon).observe(playToggleBtn, { attributes: true, attributeFilter: ["data-playback-state", "aria-pressed"] });
  }
  syncSelectIcon();

  let startX = 0;
  let startY = 0;
  let tracking = false;

  wheel.addEventListener("touchstart", event => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    tracking = true;
  }, { passive: true });

  wheel.addEventListener("touchend", event => {
    if (!tracking) return;
    tracking = false;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    if (distance < 24) return;
    const previous = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX < 0 : deltaY < 0;
    trigger(previous ? "prev" : "next");
  }, { passive: true });
})();
