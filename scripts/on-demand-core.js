(() => {
  "use strict";

  const CONTENT_MODE_KEY = "xiaowei-radio-content-mode-v1";
  const RESUME_KEY = "xiaowei-radio-on-demand-resume-v1";
  const modeButtons = [...document.querySelectorAll("[data-content-mode]")];
  const livePanel = document.getElementById("stations");
  const panel = document.getElementById("onDemandPanel");
  const grid = document.getElementById("catalogGrid");
  const detail = document.getElementById("catalogDetail");
  const episodeList = document.getElementById("episodeList");
  const search = document.getElementById("catalogSearch");
  const searchClearBtn = document.getElementById("catalogSearchClearBtn");
  const accessFilters = document.getElementById("catalogAccess");
  const categoryFilters = document.getElementById("catalogCategories");
  const tools = document.getElementById("onDemandTools");
  const progress = document.getElementById("episodeProgress");
  const elapsedTime = document.getElementById("elapsedTime");
  const durationTime = document.getElementById("durationTime");
  const speed = document.getElementById("playbackSpeed");
  const resumeCard = document.getElementById("resumeCard");
  const resumeTitle = document.getElementById("resumeTitle");
  const resumeMeta = document.getElementById("resumeMeta");
  const detailPlayBtn = document.getElementById("detailPlayBtn");
  const detailCloseBtn = document.getElementById("detailCloseBtn");
  const episodeCountLabel = document.getElementById("episodeCountLabel");
  const episodeSortBtn = document.getElementById("episodeSortBtn");
  const fallbackCover = "assets/three-quarter-mark.svg";

  const state = {
    mode: "live",
    audiobooks: [],
    podcasts: [],
    selected: null,
    playingItem: null,
    playingMode: "",
    trackIndex: -1,
    lastResumeSave: 0,
    skipNextPauseSave: false,
    isScrubbing: false,
    sortDesc: false,
    category: "全部",
    access: "all",
    catalogMeta: { audiobooks: null, podcasts: null },
    audioHealth: null,
    catalogLoadPromise: null,
    catalogsReady: false,
  };

  const AUDIOBOOK_CATEGORY_ORDER = [
    "全部", "中国古典", "现当代文学", "外国名著", "儿童童话", "儿童启蒙",
    "历史人文", "哲学经典", "诗词戏曲", "悬疑推理", "恐怖惊悚", "科幻幻想", "科普知识", "外文原声",
  ];
  const PODCAST_CATEGORY_ORDER = [
    "全部", "故事纪实", "悬疑推理", "恐怖惊悚", "国际社会", "文化阅读", "科技与AI", "科学科普", "商业财经",
    "心理成长", "影视娱乐", "音乐艺术", "旅行见闻", "运动健康", "职场教育", "法律常识", "汽车出行",
  ];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
  }

  function tracksFor(item) {
    return item?.chapters || item?.episodes || [];
  }

  function accessFor(item) {
    if (item?.access) return item.access;
    return item?.source === "公开 RSS" ? "direct" : "overseas";
  }

  function currentItems() {
    return state.mode === "audiobooks" ? state.audiobooks : state.podcasts;
  }

  function resumeData() {
    try {
      const value = JSON.parse(localStorage.getItem(RESUME_KEY));
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function writeResumeData(data) {
    const entries = Object.entries(data)
      .filter(([key, value]) => key !== "_last" && value && Number.isFinite(value.updatedAt))
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt);
    entries.slice(200).forEach(([key]) => delete data[key]);
    localStorage.setItem(RESUME_KEY, JSON.stringify(data));
  }

  function resolvedResume(mode = state.mode) {
    if (!['audiobooks', 'podcasts'].includes(mode)) return null;
    const data = resumeData();
    const items = mode === "audiobooks" ? state.audiobooks : state.podcasts;
    if (!items || !items.length) return null;
    let last = data._last?.[mode];
    let item = last && items.find(candidate => candidate.id === last.itemId);
    let trackIndex = item ? tracksFor(item).findIndex(track => track.id === last.trackId) : -1;

    // Migrate existing per-track progress into the new per-library continuation entry.
    if (!item || trackIndex < 0) {
      const candidates = [];
      items.forEach(candidate => tracksFor(candidate).forEach((track, index) => {
        const saved = data[track.id];
        if (saved && Number(saved.position) >= 1) candidates.push({ saved, item: candidate, trackIndex: index, track });
      }));
      candidates.sort((left, right) => (right.saved.updatedAt || 0) - (left.saved.updatedAt || 0));
      const migrated = candidates[0];
      if (!migrated) return null;
      ({ item, trackIndex } = migrated);
      last = { itemId: item.id, trackId: migrated.track.id, position: migrated.saved.position, updatedAt: migrated.saved.updatedAt };
    }

    const track = tracksFor(item)[trackIndex];
    if (!track) return null;
    const saved = data[track.id];
    const position = Number(saved?.position ?? last?.position) || 0;
    const duration = Number(track.duration) || 0;
    if (position < 1 || (duration > 0 && position >= duration - 5)) return null;
    return { item, track, trackIndex, position };
  }

  function renderResumeCard() {
    const resumed = resolvedResume();
    resumeCard.hidden = !resumed;
    if (!resumed) return;
    resumeTitle.textContent = `${resumed.item.title} · ${resumed.track.title}`;
    resumeMeta.textContent = `${state.mode === "audiobooks" ? `第 ${resumed.track.number || resumed.trackIndex + 1} 章` : `第 ${resumed.trackIndex + 1} 集`} · 上次听到 ${formatTime(resumed.position)}`;
  }

  function saveResume() {
    if (!state.playingItem || state.trackIndex < 0) return;
    const track = tracksFor(state.playingItem)[state.trackIndex];
    const position = Math.floor(audio.currentTime);
    if (!track || !Number.isFinite(position) || position < 1 || !["audiobooks", "podcasts"].includes(state.playingMode)) return;
    const data = resumeData();
    const duration = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : (Number(track.duration) || 0);
    const finished = duration > 0 && position >= duration - 5;
    if (finished) {
      delete data[track.id];
      if (data._last?.[state.playingMode]?.trackId === track.id) delete data._last[state.playingMode];
    } else {
      const updatedAt = Date.now();
      data[track.id] = { position, updatedAt };
      data._last = data._last && typeof data._last === "object" ? data._last : {};
      data._last[state.playingMode] = {
        itemId: state.playingItem.id,
        trackId: track.id,
        position,
        updatedAt,
      };
    }
    writeResumeData(data);
    localStorage.setItem("xiaowei-radio-playback-kind-v1", state.playingMode);
  }

  function clearResume(track, mode) {
    const data = resumeData();
    delete data[track.id];
    if (data._last?.[mode]?.trackId === track.id) delete data._last[mode];
    writeResumeData(data);
  }

  function itemResumeInfo(item, mode = state.mode) {
    if (!item) return null;
    const tracks = tracksFor(item);
    if (!tracks.length) return null;
    const data = resumeData();
    const last = data._last?.[mode];
    if (last && last.itemId === item.id) {
      const idx = tracks.findIndex(t => t.id === last.trackId);
      if (idx >= 0) {
        const track = tracks[idx];
        const pos = Number(data[track.id]?.position ?? last.position) || 0;
        const dur = Number(track.duration) || 0;
        if (pos >= 1 && (!dur || pos < dur - 5)) {
          return { item, track, trackIndex: idx, position: pos };
        }
      }
    }
    let best = null;
    tracks.forEach((track, idx) => {
      const saved = data[track.id];
      const pos = Number(saved?.position) || 0;
      const dur = Number(track.duration) || 0;
      if (pos >= 1 && (!dur || pos < dur - 5)) {
        const updatedAt = Number(saved?.updatedAt) || 0;
        if (!best || updatedAt >= best.updatedAt) {
          best = { item, track, trackIndex: idx, position: pos, updatedAt };
        }
      }
    });
    return best;
  }

  function populateResumedPlayerIfIdle(targetMode = state.mode) {
    if (state.playingItem || targetMode === "live") return;
    const savedKind = localStorage.getItem("xiaowei-radio-playback-kind-v1");
    const isLivePlaying = !audio.paused && playbackKind === "live";
    if (isLivePlaying || (playbackKind === "live" && savedKind === "live")) return;
    const resumed = resolvedResume(targetMode);
    if (!resumed) return;
    state.playingItem = resumed.item;
    state.playingMode = targetMode;
    state.trackIndex = resumed.trackIndex;
    state.selected = resumed.item;
    pendingResumePosition = resumed.position || 0;
    playbackKind = targetMode === "audiobooks" ? "audiobook" : "podcast";
    document.body.classList.add("on-demand-playing");
    document.getElementById("signalLabel").textContent = "ON DEMAND";
    document.getElementById("stationCategory").textContent = `${targetMode === "audiobooks" ? "📖 有声书" : "◉ 播客"} · ${resumed.item.source}`;
    document.getElementById("stationName").textContent = resumed.track.title;
    document.getElementById("stationDesc").textContent = `${resumed.item.title}${resumed.item.author ? ` · ${resumed.item.author}` : ""}`;
    dockStationName.textContent = resumed.track.title;
    dockStationMeta.textContent = `${resumed.item.title} · ${targetMode === "audiobooks" ? "章节" : "单集"} ${resumed.trackIndex + 1}/${tracksFor(resumed.item).length}`;
    document.getElementById("currentFormat").textContent = targetMode === "audiobooks" ? "有声书" : "播客";
    const cover = resumed.item.cover || fallbackCover;
    vinylRecord.classList.add("on-demand-cover");
    vinylRecord.querySelector("img").src = cover;
    dockDisc.querySelector("img").src = cover;
    liveTrack.classList.add("on-demand");
    tools.hidden = false;
    [playToggleBtn, prevBtn, nextBtn, dockPlayBtn, dockPrevBtn, dockNextBtn].forEach(button => { button.disabled = false; });
    setStatus("上次收听");
    setPlaybackControls("paused");
    audio.playbackRate = Number(speed.value);
    const dur = Number(resumed.track.duration) || 0;
    progress.max = String(dur > 0 ? dur : Math.max(100, resumed.position || 0));
    progress.value = String(resumed.position || 0);
    elapsedTime.textContent = formatTime(resumed.position);
    durationTime.textContent = formatTime(dur);
    progress.setAttribute("aria-valuetext", `${formatTime(resumed.position)} / ${formatTime(dur)}`);
  }

  function loadCatalogs() {
    if (state.catalogLoadPromise) return state.catalogLoadPromise;
    state.catalogLoadPromise = Promise.all([
      fetch("data/audiobooks.json", { cache: "no-store" }).then(response => response.ok ? response.json() : { books: [] }).catch(() => ({ books: [] })),
      fetch("data/podcasts.json", { cache: "no-store" }).then(response => response.ok ? response.json() : { shows: [] }).catch(() => ({ shows: [] })),
      fetch("audio-source-health.json", { cache: "no-store" }).then(response => response.ok ? response.json() : null).catch(() => null),
    ]).then(([audiobooks, podcasts, audioHealth]) => {
      state.audiobooks = Array.isArray(audiobooks?.books) ? audiobooks.books : [];
      state.podcasts = Array.isArray(podcasts?.shows) ? podcasts.shows : [];
      state.catalogMeta = { audiobooks, podcasts };
      state.audioHealth = audioHealth;
      state.catalogsReady = true;
      populateResumedPlayerIfIdle(state.mode);
      return state;
    });
    return state.catalogLoadPromise;
  }

  function catalogStatusSuffix() {
    const catalog = state.catalogMeta[state.mode];
    const parts = [];
    if (catalog?.generatedAt) parts.push(`目录更新 ${formatDate(catalog.generatedAt)}`);
    if (state.audioHealth?.generatedAt && Number.isFinite(state.audioHealth.availableCount) && Number.isFinite(state.audioHealth.sourceCount)) {
      parts.push(`音源检查 ${state.audioHealth.availableCount}/${state.audioHealth.sourceCount} · ${formatDate(state.audioHealth.generatedAt)}`);
    }
    return parts.length ? ` · ${parts.join(" · ")}` : "";
  }

  function syncModeContext(mode) {
    const heroBtn = document.getElementById("heroListenBtn");
    const heroOverline = document.querySelector(".hero-overline");
    const heroSlogan = document.querySelector(".hero-slogan");
    const heroH1 = document.querySelector(".hero h1");
    const bentoBrief = document.querySelector(".bento-brief");
    const bentoIndex = document.querySelector(".bento-index");
    const bentoHeading = bentoBrief?.querySelector("h3");
    const bentoText = bentoBrief?.querySelector("p:not(.bento-index)");
    const bentoCount = document.getElementById("bentoStationCount");

    if (mode === "audiobooks") {
      if (heroOverline) heroOverline.textContent = "3/4 DREAM FM · AUDIOBOOK SANCTUARY";
      if (heroH1) heroH1.innerHTML = '<span>声音</span>书房';
      if (heroSlogan) heroSlogan.textContent = "经典文学，字句入耳。随身带走一座声音图书馆。";
      const resumed = resolvedResume("audiobooks");
      if (heroBtn) {
        heroBtn.textContent = resumed ? `▶ 继续收听 《${resumed.item.title}》` : "▶ 浏览声音书房";
      }
      if (bentoIndex) bentoIndex.textContent = "02 / AUDIOBOOK ROOM";
      if (bentoHeading) bentoHeading.textContent = "万卷文学，长情相伴";
      if (bentoText) bentoText.textContent = "古典名著、现当代经典与散文，从上次停留的一句开始。";
      if (bentoCount) bentoCount.textContent = String(state.audiobooks.length || "40+");
      const statDd = bentoCount?.nextElementSibling;
      if (statDd) statDd.textContent = "部书目";
    } else if (mode === "podcasts") {
      if (heroOverline) heroOverline.textContent = "3/4 DREAM FM · PODCAST VOYAGES";
      if (heroH1) heroH1.innerHTML = '<span>播客</span>夜航';
      if (heroSlogan) heroSlogan.textContent = "独立声音，广阔世界。让观点与故事穿透深夜。";
      const resumed = resolvedResume("podcasts");
      if (heroBtn) {
        heroBtn.textContent = resumed ? `▶ 继续收听 《${resumed.item.title}》` : "▶ 探索播客世界";
      }
      if (bentoIndex) bentoIndex.textContent = "02 / PODCAST ROOM";
      if (bentoHeading) bentoHeading.textContent = "听见真实，思考当下";
      if (bentoText) bentoText.textContent = "精选中文独立播客与文化访谈，声音在深夜中共振。";
      if (bentoCount) bentoCount.textContent = String(state.podcasts.length || "30+");
      const statDd = bentoCount?.nextElementSibling;
      if (statDd) statDd.textContent = "档节目";
    } else {
      if (heroOverline) heroOverline.textContent = "3/4 DREAM FM · WISDOM & COMPANIONSHIP";
      if (heroH1) heroH1.innerHTML = '<span>真实</span>声音';
      if (heroSlogan) heroSlogan.textContent = "听见当代，想象未来。电台、有声书与播客的声音文化空间。";
      if (bentoIndex) bentoIndex.textContent = "02 / LISTENING ROOM";
      if (bentoHeading) bentoHeading.textContent = "从一段真实信号开始";
      if (bentoText) bentoText.textContent = "精选直播、文学作品与独立播客，在同一张桌面上切换当下与想象。";
      if (bentoCount && typeof stations !== "undefined") bentoCount.textContent = String(stations.length);
      const statDd = bentoCount?.nextElementSibling;
      if (statDd) statDd.textContent = "个频道";
      if (heroBtn && typeof currentIndex !== "undefined") {
        const preferredIndex = currentIndex >= 0 ? currentIndex : (recents[0] ?? favorites[0] ?? 0);
        heroBtn.textContent = preferredIndex >= 0 && stations[preferredIndex] ? `▶ 继续收听 ${stations[preferredIndex].name}` : "▶ 立即收听";
      }
    }
  }

  function setMode(mode, persist = true, options = {}) {
    if (!["live", "audiobooks", "podcasts"].includes(mode)) return;
    const shouldFocus = options.focus !== false;
    state.mode = mode;
    modeButtons.forEach(button => {
      const active = button.dataset.contentMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    livePanel.hidden = mode !== "live";
    panel.hidden = mode === "live";
    syncModeContext(mode);
    if (mode !== "live") {
      document.getElementById("catalogHeading").textContent = mode === "audiobooks" ? "声音书房" : "播客夜航";
      document.getElementById("catalogOverline").textContent = mode === "audiobooks" ? "AUDIOBOOK LIBRARY" : "PODCAST JOURNEYS";
      search.placeholder = mode === "audiobooks" ? "搜索书名、作者或简介" : "搜索播客节目、主播或话题";
      search.value = "";
      if (searchClearBtn) searchClearBtn.hidden = true;
      state.category = "全部";
      state.access = mode === "audiobooks" ? "direct" : "all";
      state.selected = null;
      state.sortDesc = false;
      detail.hidden = true;
      renderAccessFilters();
      renderCategoryFilters();
      if (state.catalogsReady) {
        renderCatalog();
        renderResumeCard();
        syncModeContext(mode);
      } else {
        grid.innerHTML = '<div class="empty-state">正在准备点播目录…</div>';
        document.getElementById("catalogStatus").textContent = "正在连接目录与音源检查";
        loadCatalogs().then(() => {
          if (state.mode !== mode) return;
          renderAccessFilters();
          renderCategoryFilters();
          renderCatalog();
          renderResumeCard();
          syncModeContext(mode);
        }).catch(error => {
          if (state.mode !== mode) return;
          document.getElementById("catalogStatus").textContent = error.message;
          grid.innerHTML = '<div class="empty-state">点播目录暂时不可用，请稍后重试</div>';
          showToast("点播目录暂时不可用");
        });
      }
      if (shouldFocus) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (persist) localStorage.setItem(CONTENT_MODE_KEY, mode);
  }

  function renderAccessFilters() {
    if (state.mode !== "audiobooks") {
      accessFilters.hidden = true;
      accessFilters.innerHTML = "";
      return;
    }
    const counts = state.audiobooks.reduce((result, item) => {
      const access = accessFor(item);
      result[access] = (result[access] || 0) + 1;
      return result;
    }, {});
    const options = [
      ["direct", `国内直连 ${counts.direct || 0}`],
      ["all", `全部 ${state.audiobooks.length}`],
      ["overseas", `境外资源 ${counts.overseas || 0}`],
    ];
    accessFilters.hidden = false;
    accessFilters.innerHTML = options.map(([value, label]) => {
      const active = value === state.access;
      return `<button type="button" class="catalog-access-button${active ? " active" : ""}" data-book-access="${value}" aria-pressed="${active}">${label}</button>`;
    }).join("");
  }

  function renderCategoryFilters() {
    if (state.mode === "live") {
      categoryFilters.hidden = true;
      categoryFilters.innerHTML = "";
      return;
    }
    const accessibleItems = currentItems().filter(item => state.mode !== "audiobooks" || state.access === "all" || accessFor(item) === state.access);
    const available = new Set(accessibleItems.map(item => item.category || "其他"));
    const order = state.mode === "audiobooks" ? AUDIOBOOK_CATEGORY_ORDER : PODCAST_CATEGORY_ORDER;
    const categories = order.filter(category => category === "全部" || available.has(category));
    [...available].filter(category => !categories.includes(category)).sort().forEach(category => categories.push(category));
    categoryFilters.hidden = false;
    categoryFilters.setAttribute("aria-label", state.mode === "audiobooks" ? "有声书分类" : "播客分类");
    categoryFilters.innerHTML = categories.map(category => {
      const active = category === state.category;
      return `<button type="button" class="catalog-category${active ? " active" : ""}" data-book-category="${escapeHtml(category)}" aria-pressed="${active}">${escapeHtml(category)}</button>`;
    }).join("");
  }

  function renderCatalog() {
    if (state.mode === "live") return;
    if (searchClearBtn) searchClearBtn.hidden = !search.value;
    const query = search.value.trim().toLowerCase();
    const allItems = currentItems();
    const items = allItems.filter(item => {
      const categoryMatch = state.category === "全部" || item.category === state.category;
      const accessMatch = state.mode !== "audiobooks" || state.access === "all" || accessFor(item) === state.access;
      const queryMatch = `${item.title} ${item.author || ""} ${item.category || ""} ${item.description || ""}`.toLowerCase().includes(query);
      return categoryMatch && accessMatch && queryMatch;
    });
    const trackCount = currentItems().reduce((sum, item) => sum + tracksFor(item).length, 0);
    document.getElementById("catalogCount").textContent = items.length !== allItems.length
      ? `${items.length}/${allItems.length} ${state.mode === "audiobooks" ? "本" : "档"}`
      : `${items.length} 个${state.mode === "audiobooks" ? "书目" : "节目"}`;
    document.getElementById("catalogStatus").textContent = state.mode === "audiobooks"
      ? `国内直连 ${state.audiobooks.filter(item => accessFor(item) === "direct").length} 本 · 境外资源 ${state.audiobooks.filter(item => accessFor(item) === "overseas").length} 本 · 共 ${trackCount} 章${catalogStatusSuffix()}`
      : `精选公开 RSS ${state.podcasts.length} 档 · ${trackCount} 个最新单集 · ${new Set(state.podcasts.map(item => item.category)).size} 类${catalogStatusSuffix()}`;
    if (!items.length) {
      const hasFilters = state.category !== "全部" || (state.mode === "audiobooks" && state.access !== "all") || Boolean(query);
      const resetBtn = hasFilters
        ? `<div style="margin-top:14px"><button class="btn" type="button" data-reset-catalog-filter="1" style="padding:0 16px;min-height:38px;font-size:12px">重置筛选与搜索</button></div>`
        : "";
      grid.innerHTML = `<div class="empty-state"><div>没有找到匹配内容<br>请尝试其他关键词或切换全部分类${resetBtn}</div></div>`;
      return;
    }
    grid.innerHTML = items.map(item => {
      const tracks = tracksFor(item);
      const itemResume = itemResumeInfo(item, state.mode);
      const isPlayingThis = state.playingItem?.id === item.id;
      const secondary = state.mode === "audiobooks"
        ? `${accessFor(item) === "direct" ? "国内直连" : "境外源"} · ${item.category || "其他"} · ${tracks.length} 章`
        : `${item.category || "其他"} · ${tracks.length} 个最新单集`;
      const resumeHint = itemResume
        ? ` · 续听第 ${itemResume.track.number || itemResume.trackIndex + 1} ${state.mode === "audiobooks" ? "章" : "集"} ${formatTime(itemResume.position)}`
        : "";
      const queueLabel = itemResume
        ? `将 ${item.title} 的续听章节加入接下来播放`
        : `将 ${item.title} 的第一${state.mode === "audiobooks" ? "章" : "集"}加入接下来播放`;
      return `<div class="catalog-card-row">
        <button class="catalog-card${state.selected?.id === item.id || isPlayingThis ? " active" : ""}" type="button" data-catalog-id="${escapeHtml(item.id)}">
          <img class="catalog-cover" src="${escapeHtml(item.cover || fallbackCover)}" alt="" loading="lazy">
          <span><strong>${escapeHtml(item.title)}${item.contentRating ? ` <em class="catalog-rating">${escapeHtml(item.contentRating)}</em>` : ""}</strong><span>${escapeHtml(secondary + resumeHint)}</span></span>
        </button>
        <button class="catalog-queue-btn" type="button" data-queue-item-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(queueLabel)}" title="${escapeHtml(queueLabel)}">＋</button>
      </div>`;
    }).join("");
    grid.querySelectorAll("img").forEach(image => image.addEventListener("error", () => { image.src = fallbackCover; }, { once: true }));
  }

  function updateDetailPlayButton(item = state.selected) {
    if (!detailPlayBtn || !item) return;
    const isPlayingThis = state.playingItem?.id === item.id && playbackKind !== "live";
    if (isPlayingThis && !audio.paused) {
      const num = tracksFor(item)[state.trackIndex]?.number || (state.trackIndex + 1);
      detailPlayBtn.textContent = `⏸ 暂停 · 第 ${num} ${state.mode === "audiobooks" ? "章" : "集"}`;
      return;
    }
    const itemResume = itemResumeInfo(item, state.mode);
    if (itemResume) {
      const num = itemResume.track.number || (itemResume.trackIndex + 1);
      detailPlayBtn.textContent = `▶ 继续收听 · 第 ${num} ${state.mode === "audiobooks" ? "章" : "集"} (${formatTime(itemResume.position)})`;
    } else {
      detailPlayBtn.textContent = `▶ 立即播放 · 第 1 ${state.mode === "audiobooks" ? "章" : "集"}`;
    }
  }

  function renderEpisodeList(item = state.selected) {
    if (!item) return;
    const tracks = tracksFor(item);
    const savedProgress = resumeData();
    const lastActiveTrackId = savedProgress._last?.[state.mode]?.itemId === item.id ? savedProgress._last[state.mode].trackId : null;
    if (episodeCountLabel) {
      episodeCountLabel.textContent = `全部${state.mode === "audiobooks" ? "章节" : "单集"}（共 ${tracks.length} ${state.mode === "audiobooks" ? "章" : "集"}）`;
    }
    if (episodeSortBtn) {
      episodeSortBtn.textContent = state.sortDesc ? "⇅ 倒序排列" : "⇅ 正序排列";
      episodeSortBtn.classList.toggle("active", state.sortDesc);
      episodeSortBtn.setAttribute("aria-pressed", String(state.sortDesc));
    }
    const indices = tracks.map((_, idx) => idx);
    if (state.sortDesc) indices.reverse();
    episodeList.innerHTML = indices.map(index => {
      const track = tracks[index];
      const saved = savedProgress[track.id];
      const isLastActive = track.id === lastActiveTrackId;
      const isCurrentTrack = state.playingItem?.id === item.id && state.trackIndex === index;
      const pos = Number(saved?.position) || (isLastActive ? Number(savedProgress._last[state.mode].position) : 0);
      const resumable = pos >= 1 && (!track.duration || pos < track.duration - 5);
      let subtitle = state.mode === "audiobooks"
        ? `第 ${track.number || index + 1} 章`
        : formatDate(track.publishedAt) || `第 ${index + 1} 集`;
      if (isCurrentTrack && !audio.paused && playbackKind !== "live") subtitle += " · ● 正在播放";
      else if (resumable) subtitle += ` · 续听至 ${formatTime(pos)}`;
      else if (isLastActive) subtitle += " · 上次收听";
      return `<li class="episode-row"><button class="episode-button${isCurrentTrack ? " active" : ""}${resumable || isLastActive ? " has-resume" : ""}" type="button" data-track-index="${index}">
        <span class="episode-number">${state.mode === "audiobooks" ? String(track.number || index + 1).padStart(2, "0") : (isCurrentTrack && !audio.paused ? "⏸" : "▶")}</span>
        <span class="episode-copy"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(subtitle)}</span></span>
        <span class="episode-duration">${formatTime(track.duration)}</span>
      </button><button class="episode-queue-btn" type="button" data-queue-track-index="${index}" aria-label="将 ${escapeHtml(track.title)} 加入接下来播放" title="加入接下来播放">＋</button></li>`;
    }).join("");
    updateDetailPlayButton(item);
  }

  function selectItem(id, options = {}) {
    const item = currentItems().find(candidate => candidate.id === id);
    if (!item) return;
    const update = () => {
      state.selected = item;
      renderCatalog();
      const tracks = tracksFor(item);
      document.getElementById("detailCover").src = item.cover || fallbackCover;
      document.getElementById("detailTitle").textContent = item.title;
      document.getElementById("detailMeta").textContent = state.mode === "audiobooks"
        ? `${accessFor(item) === "direct" ? "国内直连" : "境外源，可能需要畅通网络"} · ${item.category || "其他"} · ${item.author || "未知作者"} · ${formatTime(item.duration)}${item.contentRating ? ` · ${item.contentRating}` : ""}`
        : `${item.category || "其他"} · ${item.author || "独立播客"} · ${tracks.length} 个最新单集${item.contentRating ? ` · ${item.contentRating}` : ""}`;
      document.getElementById("detailDescription").textContent = item.description || "暂无简介";
      const notice = document.getElementById("detailNotice");
      if (notice) {
        notice.hidden = !item.contentWarning;
        notice.textContent = item.contentWarning ? `内容提示 · ${item.contentWarning}` : "";
      }
      const source = document.getElementById("detailSource");
      source.href = item.sourceUrl || item.feedUrl;
      source.textContent = `来源：${item.source}`;
      renderEpisodeList(item);
      detail.hidden = false;
    };
    if (document.startViewTransition) {
      document.startViewTransition(update);
    } else {
      update();
    }
    if (options.focus !== false) window.setTimeout(() => detail.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function setMediaSession(item, track) {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: item.title,
      album: item.author || "3/4梦想电台",
      artwork: [{ src: new URL(item.cover || fallbackCover, location.href).href }],
    });
    const handlers = {
      seekbackward: details => seek(-(details.seekOffset || 15)),
      seekforward: details => seek(details.seekOffset || 30),
      seekto: details => { if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime; },
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    });
  }

  let pendingResumePosition = 0;
  let loadTimeoutTimer = null;

  function clearLoadTimeout() {
    if (loadTimeoutTimer) {
      window.clearTimeout(loadTimeoutTimer);
      loadTimeoutTimer = null;
    }
  }

  function attemptApplySeek() {
    if (pendingResumePosition <= 0) return;
    const track = tracksFor(state.playingItem)?.[state.trackIndex];
    const duration = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : (Number(track?.duration) || 0);
    if (duration > 0 && pendingResumePosition >= duration - 5) {
      pendingResumePosition = 0;
      return;
    }
    const target = pendingResumePosition;
    try {
      audio.currentTime = target;
      progress.value = String(Math.floor(target));
      elapsedTime.textContent = formatTime(target);
      showToast(`已从 ${formatTime(target)} 继续播放`);
      pendingResumePosition = 0;
    } catch {}
  }

  function loadTrack(index, item = state.selected, mode = state.mode, targetPosition = null) {
    const tracks = tracksFor(item);
    const track = tracks[index];
    if (!item || !track) return;
    saveResume();
    if (!audio.paused) state.skipNextPauseSave = true;
    audio.pause();
    clearLoadTimeout();
    state.playingItem = item;
    state.playingMode = mode;
    document.body.classList.add("on-demand-playing");
    playbackKind = mode === "audiobooks" ? "audiobook" : "podcast";
    localStorage.setItem("xiaowei-radio-playback-kind-v1", mode);
    state.trackIndex = index;
    destroyHls();
    audio.removeAttribute("src");
    audio.load();
    pendingPlayRecord = false;
    document.getElementById("stationCategory").textContent = `${mode === "audiobooks" ? "📖 有声书" : "◉ 播客"} · ${item.source}`;
    document.getElementById("stationName").textContent = track.title;
    document.getElementById("stationDesc").textContent = `${item.title}${item.author ? ` · ${item.author}` : ""}`;
    dockStationName.textContent = track.title;
    dockStationMeta.textContent = `${item.title} · ${mode === "audiobooks" ? "章节" : "单集"} ${index + 1}/${tracks.length}`;
    document.getElementById("currentFormat").textContent = mode === "audiobooks" ? "有声书" : "播客";
    [playToggleBtn, prevBtn, nextBtn, dockPlayBtn, dockPrevBtn, dockNextBtn].forEach(button => { button.disabled = false; });
    prevBtn.setAttribute("aria-label", "上一章节或单集");
    prevBtn.title = "上一章节或单集";
    nextBtn.setAttribute("aria-label", "下一章节或单集");
    nextBtn.title = "下一章节或单集";
    tools.hidden = false;
    document.getElementById("signalLabel").textContent = "ON DEMAND";
    liveTrack.classList.add("on-demand");
    const cover = item.cover || fallbackCover;
    vinylRecord.classList.add("on-demand-cover");
    vinylRecord.querySelector("img").src = cover;
    dockDisc.querySelector("img").src = cover;

    if (targetPosition !== null && targetPosition >= 1) {
      pendingResumePosition = targetPosition;
    } else {
      const saved = resumeData()[track.id];
      pendingResumePosition = (saved && Number(saved.position) >= 1) ? Number(saved.position) : 0;
    }

    const dur = Number(track.duration) || 0;
    progress.max = String(dur > 0 ? dur : Math.max(100, pendingResumePosition || 0));
    progress.value = String(Math.floor(pendingResumePosition || 0));
    elapsedTime.textContent = formatTime(pendingResumePosition || 0);
    durationTime.textContent = formatTime(dur);
    progress.setAttribute("aria-valuetext", `${formatTime(pendingResumePosition || 0)} / ${formatTime(dur)}`);

    if (state.selected?.id === item.id) {
      renderEpisodeList(item);
    }
    renderCatalog();

    audio.src = track.url;
    audio.load();
    audio.defaultPlaybackRate = Number(speed.value);
    audio.playbackRate = Number(speed.value);
    setMediaSession(item, track);
    setStatus("连接中", "loading");

    loadTimeoutTimer = window.setTimeout(() => {
      if (playbackKind !== "live" && audio.paused && statusState === "loading") {
        const isOverseas = accessFor(item) === "overseas";
        showToast(isOverseas ? "境外音源连接较慢，可切换「国内直连」书目" : "音源正在缓冲，请稍候…");
      }
    }, 10000);

    audio.play().then(() => {
      clearLoadTimeout();
      if (pendingResumePosition > 0) attemptApplySeek();
      if (state.selected?.id === item.id) renderEpisodeList(item);
    }).catch(error => {
      clearLoadTimeout();
      setStatus(error.name === "NotAllowedError" ? "请点击播放" : "播放失败", "error");
    });
  }

  function playItem(item, mode = state.mode) {
    if (!item) return;
    if (state.playingItem?.id === item.id && playbackKind !== "live" && state.trackIndex >= 0) {
      const hasSrc = Boolean(audio.getAttribute("src"));
      const isErrored = statusState === "error" || Boolean(audio.error);
      if (!hasSrc || isErrored) {
        const resumePos = pendingResumePosition > 0 ? pendingResumePosition : (Number(progress.value) || null);
        loadTrack(state.trackIndex, item, mode, resumePos);
      } else if (audio.paused) {
        setStatus("连接中", "loading");
        audio.play().then(() => {
          if (pendingResumePosition > 0) attemptApplySeek();
          if (state.selected?.id === item.id) renderEpisodeList(item);
        }).catch(() => {
          loadTrack(state.trackIndex, item, mode, Number(progress.value) || null);
        });
      } else {
        audio.pause();
      }
      return;
    }
    const itemResume = itemResumeInfo(item, mode);
    if (itemResume) {
      loadTrack(itemResume.trackIndex, item, mode, itemResume.position);
    } else {
      loadTrack(0, item, mode, 0);
    }
  }

  function play() {
    if (state.playingItem && state.trackIndex >= 0) {
      const hasSrc = Boolean(audio.getAttribute("src"));
      const isErrored = statusState === "error" || Boolean(audio.error);
      if (!hasSrc || isErrored) {
        const resumePos = pendingResumePosition > 0 ? pendingResumePosition : (Number(progress.value) || null);
        loadTrack(state.trackIndex, state.playingItem, state.playingMode || state.mode, resumePos);
        return;
      }
      setStatus("连接中", "loading");
      audio.play().then(() => {
        if (pendingResumePosition > 0) attemptApplySeek();
        if (state.selected?.id === state.playingItem.id) renderEpisodeList(state.selected);
      }).catch(() => {
        loadTrack(state.trackIndex, state.playingItem, state.playingMode || state.mode, Number(progress.value) || null);
      });
      return;
    }
    if (state.selected) {
      playItem(state.selected, state.mode);
      return;
    }
    const resumed = resolvedResume();
    if (resumed) {
      state.selected = resumed.item;
      renderCatalog();
      selectItem(resumed.item.id);
      loadTrack(resumed.trackIndex, resumed.item, state.mode, resumed.position);
      return;
    }
    const first = currentItems()[0];
    if (first) {
      selectItem(first.id);
      loadTrack(0, first, state.mode);
    }
  }

  function toggle() {
    if (audio.paused) play();
    else audio.pause();
  }

  function step(direction) {
    if (!state.playingItem) return;
    const tracks = tracksFor(state.playingItem);
    if (!tracks.length) return;
    const nextIndex = state.trackIndex < 0 ? 0 : state.trackIndex + direction;
    if (nextIndex < 0 || nextIndex >= tracks.length) {
      showToast(nextIndex < 0 ? "已经是第一章或单集" : "已经播放到最后");
      return;
    }
    loadTrack(nextIndex, state.playingItem, state.playingMode);
  }

  function seek(offset) {
    const track = tracksFor(state.playingItem)?.[state.trackIndex];
    const duration = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : (Number(track?.duration) || 0);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + offset));
      progress.value = String(Math.floor(audio.currentTime));
      elapsedTime.textContent = formatTime(audio.currentTime);
      progress.setAttribute("aria-valuetext", `${formatTime(audio.currentTime)} / ${formatTime(duration)}`);
      saveResume();
    } else if (duration > 0 && state.playingItem) {
      const base = pendingResumePosition > 0 ? pendingResumePosition : (Number(progress.value) || 0);
      const nextPos = Math.min(duration, Math.max(0, base + offset));
      pendingResumePosition = nextPos;
      progress.value = String(Math.floor(nextPos));
      elapsedTime.textContent = formatTime(nextPos);
      progress.setAttribute("aria-valuetext", `${formatTime(nextPos)} / ${formatTime(duration)}`);
    }
  }

  onDemandControls = { play, toggle, step, seek };

  window.radioPlayback = window.radioPlayback || {};
  window.radioPlayback.addOnDemandSource = (mode, itemId, trackIndex) => {
    const items = mode === "audiobooks" ? state.audiobooks : state.podcasts;
    const item = items.find(candidate => candidate.id === itemId);
    const tracks = tracksFor(item);
    let resolvedIndex = trackIndex;
    if (resolvedIndex === null || resolvedIndex === undefined) {
      resolvedIndex = itemResumeInfo(item, mode)?.trackIndex ?? 0;
    }
    const track = tracks[resolvedIndex];
    if (!item || !track) return null;
    return {
      id: `${mode}:${item.id}:${track.id || resolvedIndex}`,
      kind: "on-demand",
      mode,
      itemId: item.id,
      trackId: track.id || "",
      trackIndex: resolvedIndex,
      title: track.title,
      subtitle: `${item.title} · ${mode === "audiobooks" ? `第 ${track.number || resolvedIndex + 1} 章` : `第 ${resolvedIndex + 1} 集`}`,
      cover: item.cover || fallbackCover,
    };
  };
  window.radioPlayback.playOnDemand = async entry => {
    if (!entry || !["audiobooks", "podcasts"].includes(entry.mode)) return false;
    try {
      await loadCatalogs();
      const items = entry.mode === "audiobooks" ? state.audiobooks : state.podcasts;
      const item = items.find(candidate => candidate.id === entry.itemId);
      const tracks = tracksFor(item);
      const indexById = entry.trackId ? tracks.findIndex(track => track.id === entry.trackId) : -1;
      const trackIndex = indexById >= 0 ? indexById : Number(entry.trackIndex);
      if (!item || !tracks[trackIndex]) return false;
      setMode(entry.mode, true, { focus: false });
      selectItem(item.id, { focus: false });
      loadTrack(trackIndex, item, entry.mode);
      return true;
    } catch {
      return false;
    }
  };

  modeButtons.forEach(button => button.addEventListener("click", () => setMode(button.dataset.contentMode)));
  document.querySelectorAll("[data-nav-cat]").forEach(button => button.addEventListener("click", () => setMode("live")));
  document.querySelector(".hero-secondary").addEventListener("click", () => setMode("live"));
  search.addEventListener("input", renderCatalog);
  searchClearBtn?.addEventListener("click", () => {
    search.value = "";
    searchClearBtn.hidden = true;
    renderCatalog();
    search.focus();
  });
  detailPlayBtn?.addEventListener("click", () => {
    if (state.selected) playItem(state.selected, state.mode);
  });
  detailCloseBtn?.addEventListener("click", () => {
    state.selected = null;
    detail.hidden = true;
    renderCatalog();
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  episodeSortBtn?.addEventListener("click", () => {
    state.sortDesc = !state.sortDesc;
    if (state.selected) renderEpisodeList(state.selected);
  });
  accessFilters.addEventListener("click", event => {
    const button = event.target.closest("[data-book-access]");
    if (!button) return;
    state.access = button.dataset.bookAccess;
    state.category = "全部";
    state.selected = null;
    detail.hidden = true;
    renderAccessFilters();
    renderCategoryFilters();
    renderCatalog();
  });
  categoryFilters.addEventListener("click", event => {
    const button = event.target.closest("[data-book-category]");
    if (!button) return;
    state.category = button.dataset.bookCategory;
    state.selected = null;
    detail.hidden = true;
    renderCategoryFilters();
    renderCatalog();
  });
  grid.addEventListener("click", event => {
    if (event.target.closest("[data-reset-catalog-filter]")) {
      search.value = "";
      if (searchClearBtn) searchClearBtn.hidden = true;
      state.category = "全部";
      state.access = "all";
      renderAccessFilters();
      renderCategoryFilters();
      renderCatalog();
      return;
    }
    const queueButton = event.target.closest("[data-queue-item-id]");
    if (queueButton) {
      const itemId = queueButton.dataset.queueItemId;
      const item = currentItems().find(c => c.id === itemId);
      const preferredTrackIndex = item ? (itemResumeInfo(item, state.mode)?.trackIndex ?? 0) : 0;
      window.radioQueue?.addOnDemand?.(state.mode, itemId, preferredTrackIndex);
      return;
    }
    const card = event.target.closest("[data-catalog-id]");
    if (card) selectItem(card.dataset.catalogId);
  });
  resumeCard.addEventListener("click", () => {
    const resumed = resolvedResume();
    if (!resumed) return;
    state.selected = resumed.item;
    renderCatalog();
    selectItem(resumed.item.id);
    loadTrack(resumed.trackIndex, resumed.item, state.mode, resumed.position);
  });
  episodeList.addEventListener("click", event => {
    const queueButton = event.target.closest("[data-queue-track-index]");
    if (queueButton && state.selected) {
      window.radioQueue?.addOnDemand?.(state.mode, state.selected.id, Number(queueButton.dataset.queueTrackIndex));
      return;
    }
    const button = event.target.closest("[data-track-index]");
    if (button) loadTrack(Number(button.dataset.trackIndex));
  });
  document.getElementById("seekBackBtn").addEventListener("click", () => seek(-15));
  document.getElementById("seekForwardBtn").addEventListener("click", () => seek(30));
  speed.addEventListener("change", () => {
    audio.defaultPlaybackRate = Number(speed.value);
    audio.playbackRate = Number(speed.value);
  });
  progress.addEventListener("pointerdown", () => { state.isScrubbing = true; });
  progress.addEventListener("touchstart", () => { state.isScrubbing = true; }, { passive: true });
  progress.addEventListener("input", () => {
    state.isScrubbing = true;
    const val = Number(progress.value) || 0;
    elapsedTime.textContent = formatTime(val);
    progress.setAttribute("aria-valuetext", `${formatTime(val)} / ${durationTime.textContent}`);
  });
  const commitScrub = () => {
    if (!state.isScrubbing) return;
    state.isScrubbing = false;
    const val = Number(progress.value) || 0;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.min(audio.duration, Math.max(0, val));
      saveResume();
    } else if (state.playingItem && state.trackIndex >= 0) {
      pendingResumePosition = val;
      elapsedTime.textContent = formatTime(val);
    }
  };
  progress.addEventListener("change", commitScrub);
  progress.addEventListener("pointerup", commitScrub);
  progress.addEventListener("touchend", commitScrub, { passive: true });

  const onAudioReady = () => {
    if (playbackKind === "live") return;
    clearLoadTimeout();
    const track = tracksFor(state.playingItem)?.[state.trackIndex];
    const duration = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : (Number(track?.duration) || 0);
    progress.max = String(duration || 0);
    durationTime.textContent = formatTime(duration);
    attemptApplySeek();
  };

  audio.addEventListener("loadedmetadata", () => {
    if (playbackKind === "live") return;
    audio.playbackRate = Number(speed.value);
    onAudioReady();
  });
  audio.addEventListener("canplay", onAudioReady, { passive: true });
  audio.addEventListener("playing", () => {
    if (playbackKind === "live") return;
    clearLoadTimeout();
    if (state.selected) renderEpisodeList(state.selected);
  });
  audio.addEventListener("timeupdate", () => {
    if (playbackKind === "live") return;
    if (!state.isScrubbing) {
      progress.value = String(Math.floor(audio.currentTime || 0));
      elapsedTime.textContent = formatTime(audio.currentTime);
      progress.setAttribute("aria-valuetext", `${formatTime(audio.currentTime)} / ${durationTime.textContent}`);
    }
    if (Date.now() - state.lastResumeSave > 5000) {
      state.lastResumeSave = Date.now();
      saveResume();
    }
  });
  audio.addEventListener("ended", () => {
    if (playbackKind === "live") return;
    const item = state.playingItem;
    const mode = state.playingMode;
    const tracks = tracksFor(item);
    const finishedTrack = tracks[state.trackIndex];
    if (finishedTrack) {
      const data = resumeData();
      delete data[finishedTrack.id];
      writeResumeData(data);
    }
    if (window.radioQueue?.playNext?.()) return;
    if (state.trackIndex + 1 < tracks.length) {
      const nextIndex = state.trackIndex + 1;
      const nextTrack = tracks[nextIndex];
      const data = resumeData();
      data._last = data._last && typeof data._last === "object" ? data._last : {};
      data._last[mode] = {
        itemId: item.id,
        trackId: nextTrack.id,
        position: 0,
        updatedAt: Date.now(),
      };
      writeResumeData(data);
      loadTrack(nextIndex, item, mode, 0);
    } else {
      const data = resumeData();
      if (data._last?.[mode]?.itemId === item?.id) delete data._last[mode];
      writeResumeData(data);
      setStatus("已播放完", "ok");
      renderResumeCard();
      renderCatalog();
      if (state.selected?.id === item?.id) renderEpisodeList(item);
    }
  });
  audio.addEventListener("pause", () => {
    if (playbackKind === "live") return;
    clearLoadTimeout();
    if (state.skipNextPauseSave) {
      state.skipNextPauseSave = false;
      return;
    }
    saveResume();
    renderResumeCard();
    renderCatalog();
    if (state.selected) renderEpisodeList(state.selected);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveResume();
  });
  window.addEventListener("pagehide", saveResume);
  window.addEventListener("beforeunload", saveResume);

  const storedMode = localStorage.getItem(CONTENT_MODE_KEY);
  setMode(["audiobooks", "podcasts"].includes(storedMode) ? storedMode : "live", false, { focus: false });
})();
