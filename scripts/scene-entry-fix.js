(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const explicitMode = params.get("mode");
  const autoMobile = window.matchMedia("(max-width: 899px)").matches;
  const switcher = document.querySelector(".mm-scene-switcher");
  const menu = switcher?.querySelector(".mm-scene-menu");

  if (!switcher || !menu) return;

  const scene = ["desktop", "mobile", "tv", "drive"].includes(explicitMode) ? explicitMode : "auto";
  const label = ({ auto: "自动", desktop: "电脑", mobile: "手机", tv: "电视", drive: "行车" })[scene] || "自动";
  const shouldUseBottomOnly = autoMobile && (!explicitMode || explicitMode === "mobile");

  if (!shouldUseBottomOnly && !switcher.querySelector(".mm-scene-trigger")) {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "mm-scene-trigger mm-scene-trigger-restored";
    trigger.dataset.mmAction = "toggle-scenes";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.innerHTML = `
      <span class="mm-scene-dot"></span>
      <span>场景 · ${label}</span>
      <span class="mm-scene-caret">⌄</span>`;
    switcher.insertBefore(trigger, menu);
  }

  const style = document.createElement("style");
  style.textContent = `
    /* Keep scene switching reachable in every non-standard surface. */
    @media (max-width: 899px) {
      body[data-ui="desktop"] .mm-scene-switcher {
        top: 66px !important;
        right: 10px !important;
      }
      body.drive-mode .mm-scene-switcher {
        top: 66px !important;
        right: 10px !important;
      }
      body.drive-mode .mm-scene-trigger {
        min-height: 38px !important;
        padding: 0 11px !important;
        border-radius: 11px !important;
        font-size: 10px !important;
      }
    }
  `;
  document.head.appendChild(style);
})();
