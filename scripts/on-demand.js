(() => {
  "use strict";

  const version = "20260916-multimode-1";

  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = `styles/multimode.css?v=${version}`;
  document.head.appendChild(style);

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
