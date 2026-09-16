(() => {
  "use strict";

  const version = "20260916-mobile-tune-2";

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

  loadScript("scripts/on-demand-core.js")
    .then(() => loadScript("scripts/multimode.js"))
    .catch(error => console.error("Dream FM UI bootstrap failed", error));
})();
