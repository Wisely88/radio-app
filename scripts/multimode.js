(() => {
  "use strict";

  const UI_MODE_KEY = "dreamfm-ui-mode-v1";
  const DRIVE_MODE_KEY = "xiaowei-radio-drive-mode-v1";
  const CONTENT_MODE_KEY = "xiaowei-radio-content-mode-v1";
  const params = new URLSearchParams(location.search);
  const explicitMode = params.get("mode");
  const autoMode = window.matchMedia("(max-width: 899px)").matches ? "mobile" : "desktop";
  const mode = ["desktop", "mobile", "tv", "drive"].includes(explicitMode) ? explicitMode : autoMode;

  document.body.classList.add("multimode-ready");
  document.body.dataset.ui = mode === "drive" ? autoMode : mode;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const byId = id => document.getElementById(id);

  function click(selector) {
    const element = $(selector);
    if (element) element.click();
  }

  function setUrlMode(nextMode) {
    const url = new URL(location.href);
    url.searchParams.delete("drive");

    if (nextMode === "drive") {
      url.searchParams.set("mode", "drive");
      localStorage.setItem(DRIVE_MODE_KEY, "1");
      localStorage.setItem(UI_MODE_KEY, "drive");
    } else {
      localStorage.setItem(DRIVE_MODE_KEY, "0");
      if (nextMode === "auto") {
        url.searchParams.delete("mode");
        localStorage.removeItem(UI_MODE_KEY);
      } else {
        url.searchParams.set("mode", nextMode);
        localStorage.setItem(UI_MODE_KEY, nextMode);
      }
    }

    location.href = url.toString();
  }

  function currentSceneMode() {
    if (explicitMode && ["desktop", "mobile", "tv", "drive"].includes(explicitMode)) return explicitMode;
    return "auto";
  }

  function sceneLabel(value) {
    return ({ auto: "自动", desktop: "电脑", mobile: "手机", tv: "电视", drive: "行车" })[value] || "自动";
  }

  function currentContentMode() {
    return $("[data-content-mode].active")?.dataset.contentMode || "live";
  }

  function activateContent(modeName) {
    click(`[data-content-mode="${modeName}"]`);
    window.setTimeout(syncChrome, 0);
  }

  function activateLiveCategory(category) {
    activateContent("live");
    window.setTimeout(() => click(`[data-cat="${category}"]`), 20);
  }

  function focusSearch() {
    const search = currentContentMode() === "live" ? byId("stationSearch") : byId("catalogSearch");
    search?.focus();
    search?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function toggleFavoriteCurrent() {
    const active = $(".channel.active");
    const button = active?.closest(".channel-row")?.querySelector(".favorite-btn");
    button?.click();
  }

  function makeButton(icon, label, action, extra = "") {
    return `<button type="button" class="mm-rail-btn ${extra}" data-mm-action="${action}"><span class="mm-icon">${icon}</span><span>${label}</span></button>`;
  }

  function guardInitialCatalogScroll() {
    const panel = byId("onDemandPanel");
    const storedMode = localStorage.getItem(CONTENT_MODE_KEY);
    if (!panel || !["audiobooks", "podcasts"].includes(storedMode)) return;

    const original = panel.scrollIntoView.bind(panel);
    let suppress = true;
    panel.scrollIntoView = (...args) => {
      if (suppress) {
        suppress = false;
        panel.scrollIntoView = original;
        return;
      }
      original(...args);
    };
    window.setTimeout(() => {
      if (suppress) panel.scrollIntoView = original;
    }, 5000);
  }

  function installSceneSwitcher() {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "styles/mode-switch.css?v=20260916-scene-3";
    document.head.appendChild(css);

    const scene = currentSceneMode();
    const switcher = document.createElement("div");
    const mobileOnly = autoMode === "mobile" && mode !== "tv";
    switcher.className = `mm-scene-switcher${mobileOnly ? " mm-mobile-scenes-only" : ""}`;
    switcher.innerHTML = `
      ${mobileOnly ? "" : `<button type="button" class="mm-scene-trigger" data-mm-action="toggle-scenes" aria-expanded="false" aria-haspopup="true">
        <span class="mm-scene-dot"></span>
        <span>场景 · ${sceneLabel(scene)}</span>
        <span class="mm-scene-caret">⌄</span>
      </button>`}
      <div class="mm-scene-menu" hidden role="menu" aria-label="切换使用场景">
        <button type="button" role="menuitem" data-mm-scene="auto"><span>◌</span><strong>自动</strong><small>跟随当前屏幕</small></button>
        <button type="button" role="menuitem" data-mm-scene="desktop"><span>▣</span><strong>电脑</strong><small>工作台布局</small></button>
        <button type="button" role="menuitem" data-mm-scene="mobile"><span>▯</span><strong>手机</strong><small>移动端布局</small></button>
        <button type="button" role="menuitem" data-mm-scene="tv"><span>▤</span><strong>电视</strong><small>遥控器大屏</small></button>
        <button type="button" role="menuitem" data-mm-scene="drive"><span>▰</span><strong>行车</strong><small>低干扰大按钮</small></button>
      </div>`;
    document.body.appendChild(switcher);

    switcher.querySelectorAll("[data-mm-scene]").forEach(button => {
      button.classList.toggle("active", button.dataset.mmScene === scene);
    });
  }

  function toggleSceneMenu(force) {
    const menu = $(".mm-scene-menu");
    if (!menu) return;
    const trigger = $(".mm-scene-trigger");
    const open = typeof force === "boolean" ? force : menu.hidden;
    menu.hidden = !open;
    trigger?.setAttribute("aria-expanded", String(open));
  }

  function installChrome() {
    const rail = document.createElement("aside");
    rail.className = "mm-desktop-rail";
    rail.setAttribute("aria-label", "桌面导航");
    rail.innerHTML = `
      <div class="mm-rail-title">DREAM FM · WORKBENCH</div>
      <div class="mm-rail-group"><div class="mm-rail-label">收听</div>
        ${makeButton("◉", "直播电台", "live")}
        ${makeButton("▣", "有声书", "audiobooks")}
        ${makeButton("◫", "播客", "podcasts")}
      </div>
      <div class="mm-rail-group"><div class="mm-rail-label">我的</div>
        ${makeButton("★", "收藏", "favorites")}
        ${makeButton("↻", "最近", "recent")}
        ${makeButton("⌕", "搜索", "search")}
      </div>
      <div class="mm-rail-group"><div class="mm-rail-label">直播分类</div>
        ${makeButton("📰", "资讯", "cat-news")}
        ${makeButton("🚗", "交通", "cat-traffic")}
        ${makeButton("🎵", "音乐", "cat-music")}
        ${makeButton("🌐", "综合", "cat-general")}
        ${makeButton("📖", "有声", "cat-audio")}
      </div>
      <div class="mm-rail-group"><div class="mm-rail-label">场景</div>
        ${makeButton("▤", "电视模式", "tv")}
        ${makeButton("▰", "行车模式", "drive")}
      </div>`;
    document.body.appendChild(rail);

    const now = document.createElement("aside");
    now.className = "mm-now-rail";
    now.setAttribute("aria-label", "正在播放");
    now.innerHTML = `
      <div class="mm-now-kicker">NOW PLAYING</div>
      <div class="mm-now-disc" id="mmNowDisc"><img src="assets/three-quarter-mark.svg" alt=""></div>
      <div class="mm-now-category" id="mmNowCategory">等待选择频道</div>
      <h3 class="mm-now-title" id="mmNowTitle">3/4梦想电台</h3>
      <p class="mm-now-desc" id="mmNowDesc">从频道、有声书或播客中选择内容开始收听。</p>
      <div class="mm-now-state" id="mmNowState">待机</div>
      <div class="mm-now-controls">
        <button type="button" data-mm-action="prev" aria-label="上一项">←</button>
        <button type="button" class="mm-primary" data-mm-action="play">▶ 播放</button>
        <button type="button" data-mm-action="next" aria-label="下一项">→</button>
      </div>
      <div class="mm-now-actions">
        <button type="button" data-mm-action="favorite">★ 收藏当前</button>
        <button type="button" data-mm-action="search">⌕ 搜索内容</button>
      </div>`;
    document.body.appendChild(now);

    const mobile = document.createElement("nav");
    mobile.className = "mm-mobile-nav";
    mobile.setAttribute("aria-label", "移动端主导航");
    mobile.innerHTML = `<div class="mm-mobile-nav-inner">
      <button class="mm-mobile-btn" type="button" data-mm-action="live"><span>◉</span><span>直播</span></button>
      <button class="mm-mobile-btn" type="button" data-mm-action="audiobooks"><span>▣</span><span>有声书</span></button>
      <button class="mm-mobile-btn" type="button" data-mm-action="podcasts"><span>◫</span><span>播客</span></button>
      <button class="mm-mobile-btn" type="button" data-mm-action="favorites"><span>★</span><span>收藏</span></button>
      <button class="mm-mobile-btn" type="button" data-mm-action="toggle-scenes"><span>▦</span><span>场景</span></button>
    </div>`;
    document.body.appendChild(mobile);

    const tvExit = document.createElement("button");
    tvExit.type = "button";
    tvExit.className = "mm-tv-exit";
    tvExit.dataset.mmAction = "exit-tv";
    tvExit.textContent = "退出电视模式";
    document.body.appendChild(tvExit);

    installSceneSwitcher();

    document.body.addEventListener("click", event => {
      const sceneButton = event.target.closest("[data-mm-scene]");
      if (sceneButton) {
        setUrlMode(sceneButton.dataset.mmScene);
        return;
      }

      const button = event.target.closest("[data-mm-action]");
      if (!button) {
        if (!event.target.closest(".mm-scene-switcher")) toggleSceneMenu(false);
        return;
      }

      const action = button.dataset.mmAction;
      if (action === "live") activateContent("live");
      else if (action === "audiobooks") activateContent("audiobooks");
      else if (action === "podcasts") activateContent("podcasts");
      else if (action === "favorites") activateLiveCategory("favorites");
      else if (action === "recent") activateLiveCategory("recent");
      else if (action === "search") focusSearch();
      else if (action?.startsWith("cat-")) activateLiveCategory(action.slice(4));
      else if (action === "play") click("#playToggleBtn");
      else if (action === "prev") click("#prevBtn");
      else if (action === "next") click("#nextBtn");
      else if (action === "favorite") toggleFavoriteCurrent();
      else if (action === "tv") setUrlMode("tv");
      else if (action === "drive") setUrlMode("drive");
      else if (action === "exit-tv") setUrlMode("auto");
      else if (action === "toggle-scenes") toggleSceneMenu();
    });
  }

  function syncChrome() {
    const title = byId("stationName")?.textContent?.trim() || "3/4梦想电台";
    const category = byId("stationCategory")?.textContent?.trim() || "等待选择频道";
    const desc = byId("stationDesc")?.textContent?.trim() || "从频道、有声书或播客中选择内容开始收听。";
    const status = byId("liveBadge")?.textContent?.trim() || "待机";
    const playing = status.includes("直播") || status.includes("播放") || status.includes("缓冲") || status.includes("连接");

    if (byId("mmNowTitle")) byId("mmNowTitle").textContent = title;
    if (byId("mmNowCategory")) byId("mmNowCategory").textContent = category;
    if (byId("mmNowDesc")) byId("mmNowDesc").textContent = desc;
    if (byId("mmNowState")) {
      byId("mmNowState").textContent = status;
      byId("mmNowState").classList.toggle("playing", playing);
    }
    byId("mmNowDisc")?.classList.toggle("playing", status.includes("直播") || status === "播放中");

    const mainPlay = byId("playToggleBtn")?.textContent?.trim();
    const mmPlay = $(".mm-now-controls [data-mm-action='play']");
    if (mmPlay && mainPlay) mmPlay.textContent = mainPlay;

    const contentMode = currentContentMode();
    $$(".mm-rail-btn, .mm-mobile-btn").forEach(button => {
      const action = button.dataset.mmAction;
      const contentAction = ["live", "audiobooks", "podcasts"].includes(action);
      button.classList.toggle("active", contentAction && action === contentMode);
    });
  }

  function installObservers() {
    ["stationName", "stationCategory", "stationDesc", "liveBadge", "playToggleBtn"].forEach(id => {
      const node = byId(id);
      if (node) new MutationObserver(syncChrome).observe(node, { subtree: true, childList: true, characterData: true, attributes: true });
    });

    $$('[data-content-mode]').forEach(button => {
      new MutationObserver(syncChrome).observe(button, { attributes: true, attributeFilter: ["class", "aria-pressed"] });
    });
    [byId("stations"), byId("onDemandPanel")].filter(Boolean).forEach(panel => {
      new MutationObserver(syncChrome).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    });

    document.addEventListener("click", event => {
      if (event.target.closest("[data-content-mode], .tab, .channel, .catalog-card, .episode-button")) {
        window.setTimeout(syncChrome, 50);
      }
    });

    const audio = byId("audio");
    audio?.addEventListener("playing", () => document.body.classList.add("has-played"));
    audio?.addEventListener("playing", syncChrome);
    audio?.addEventListener("pause", syncChrome);
  }

  function normalizeDriveMode() {
    const driveButton = byId("driveModeBtn");

    if (explicitMode !== "drive") {
      localStorage.setItem(DRIVE_MODE_KEY, "0");
      if (document.body.classList.contains("drive-mode")) driveButton?.click();
      return;
    }

    document.body.dataset.ui = autoMode;
    localStorage.setItem(DRIVE_MODE_KEY, "1");
    window.setTimeout(() => {
      if (!document.body.classList.contains("drive-mode")) driveButton?.click();
    }, 80);

    driveButton?.addEventListener("click", () => {
      window.setTimeout(() => {
        if (!document.body.classList.contains("drive-mode")) setUrlMode("auto");
      }, 0);
    });
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function focusables() {
    return $$('button:not([disabled]), a[href], select:not([disabled]), input:not([disabled])').filter(isVisible);
  }

  function spatialFocus(direction) {
    const items = focusables();
    if (!items.length) return;
    const current = document.activeElement;
    if (!items.includes(current)) {
      items[0].focus();
      return;
    }

    const from = current.getBoundingClientRect();
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    let winner = null;
    let best = Infinity;

    items.forEach(item => {
      if (item === current) return;
      const rect = item.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = x - fx;
      const dy = y - fy;
      if (direction === "left" && dx >= -4) return;
      if (direction === "right" && dx <= 4) return;
      if (direction === "up" && dy >= -4) return;
      if (direction === "down" && dy <= 4) return;
      const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
      const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      const score = primary + cross * 2.1;
      if (score < best) {
        best = score;
        winner = item;
      }
    });

    winner?.focus({ preventScroll: false });
    winner?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }

  function installTvControls() {
    if (document.body.dataset.ui !== "tv") return;
    document.addEventListener("keydown", event => {
      const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      if (map[event.key]) {
        event.preventDefault();
        spatialFocus(map[event.key]);
      } else if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        setUrlMode("auto");
      } else if (event.key === "MediaPlayPause") {
        click("#playToggleBtn");
      }
    });
    window.setTimeout(() => focusables()[0]?.focus(), 250);
  }

  guardInitialCatalogScroll();
  installChrome();
  installObservers();
  normalizeDriveMode();
  installTvControls();
  window.setTimeout(syncChrome, 0);
})();