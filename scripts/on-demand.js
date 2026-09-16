(() => {
  "use strict";

  const version = "20260916-mobile-tune-6";
  const MODE_SWITCH_KEY = "dreamfm-mode-switch-target-v1";

  // Capture scene selections before multimode.js handles the click. This lets the
  // next document distinguish a deliberate scene switch from a normal refresh.
  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-mm-scene]");
    if (!button) return;
    const target = button.dataset.mmScene || "auto";
    sessionStorage.setItem(MODE_SWITCH_KEY, target);
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }, true);

  const switchedTo = sessionStorage.getItem(MODE_SWITCH_KEY);
  if (switchedTo && "scrollRestoration" in history) history.scrollRestoration = "manual";

  function loadStyle(href) {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = `${href}?v=${version}`;
    document.head.appendChild(style);
  }

  loadStyle("styles/multimode.css");
  loadStyle("styles/mobile-tune.css");

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${src}?v=${version}`;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  function settleSceneScroll(target) {
    if (!target) return;
    const settle = () => {
      if (target === "drive") {
        document.getElementById("radioApp")?.scrollIntoView({ block: "start" });
      } else {
        window.scrollTo(0, 0);
      }
    };

    settle();
    requestAnimationFrame(settle);
    window.setTimeout(settle, 120);
    window.setTimeout(() => {
      settle();
      sessionStorage.removeItem(MODE_SWITCH_KEY);
      if ("scrollRestoration" in history) history.scrollRestoration = "auto";
    }, 420);
  }

  loadScript("scripts/on-demand-core.js")
    .then(() => loadScript("scripts/multimode.js"))
    .then(() => loadScript("scripts/scene-entry-fix.js"))
    .then(() => settleSceneScroll(switchedTo))
    .catch(error => console.error("Dream FM UI bootstrap failed", error));
})();
