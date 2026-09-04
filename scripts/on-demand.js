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
  const tools = document.getElementById("onDemandTools");
  const progress = document.getElementById("episodeProgress");
  const elapsedTime = document.getElementById("elapsedTime");
  const durationTime = document.getElementById("durationTime");
  const speed = document.getElementById("playbackSpeed");
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
  };

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

  function saveResume() {
    const track = tracksFor(state.playingItem)[state.trackIndex];
    if (!track || !Number.isFinite(audio.currentTime)) return;
    const data = resumeData();
    data[track.id] = { position: Math.floor(audio.currentTime), updatedAt: Date.now() };
    localStorage.setItem(RESUME_KEY, JSON.stringify(data));
  }

  function setMode(mode, persist = true) {
    if (!["live", "audiobooks", "podcasts"].includes(mode)) return;
    state.mode = mode;
    modeButtons.forEach(button => {
      const active = button.dataset.contentMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    livePanel.hidden = mode !== "live";
    panel.hidden = mode === "live";
    if (mode !== "live") {
      document.getElementById("catalogHeading").textContent = mode === "audiobooks" ? "声音书房" : "播客夜航";
      document.getElementById("catalogOverline").textContent = mode === "audiobooks" ? "AUDIOBOOK LIBRARY" : "PODCAST JOURNEYS";
      search.placeholder = mode === "audiobooks" ? "搜索书名或作者" : "搜索播客节目";
      search.value = "";
      state.selected = null;
      detail.hidden = true;
      renderCatalog();
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (persist) localStorage.setItem(CONTENT_MODE_KEY, mode);
  }

  function renderCatalog() {
    if (state.mode === "live") return;
    const query = search.value.trim().toLowerCase();
    const items = currentItems().filter(item => `${item.title} ${item.author || ""} ${item.description || ""}`.toLowerCase().includes(query));
    const trackCount = currentItems().reduce((sum, item) => sum + tracksFor(item).length, 0);
    document.getElementById("catalogCount").textContent = `${items.length} 个${state.mode === "audiobooks" ? "书目" : "节目"}`;
    document.getElementById("catalogStatus").textContent = state.mode === "audiobooks"
      ? `LibriVox 精选 ${state.audiobooks.length} 本 · ${trackCount} 个章节`
      : `精选公开 RSS ${state.podcasts.length} 档 · ${trackCount} 个最新单集`;
    if (!items.length) {
      grid.innerHTML = '<div class="empty-state">没有找到匹配内容</div>';
      return;
    }
    grid.innerHTML = items.map(item => {
      const tracks = tracksFor(item);
      const secondary = state.mode === "audiobooks"
        ? `${item.author || "未知作者"} · ${tracks.length} 章`
        : `${tracks.length} 个最新单集`;
      return `<button class="catalog-card${state.selected?.id === item.id ? " active" : ""}" type="button" data-catalog-id="${escapeHtml(item.id)}">
        <img class="catalog-cover" src="${escapeHtml(item.cover || fallbackCover)}" alt="" loading="lazy">
        <span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(secondary)}</span></span>
      </button>`;
    }).join("");
    grid.querySelectorAll("img").forEach(image => image.addEventListener("error", () => { image.src = fallbackCover; }, { once: true }));
  }

  function selectItem(id) {
    const item = currentItems().find(candidate => candidate.id === id);
    if (!item) return;
    state.selected = item;
    state.trackIndex = -1;
    renderCatalog();
    const tracks = tracksFor(item);
    document.getElementById("detailCover").src = item.cover || fallbackCover;
    document.getElementById("detailTitle").textContent = item.title;
    document.getElementById("detailMeta").textContent = state.mode === "audiobooks"
      ? `${item.author || "未知作者"} · ${item.language || ""} · ${formatTime(item.duration)}`
      : `${item.author || "独立播客"} · ${tracks.length} 个最新单集`;
    document.getElementById("detailDescription").textContent = item.description || "暂无简介";
    const source = document.getElementById("detailSource");
    source.href = item.sourceUrl || item.feedUrl;
    source.textContent = `来源：${item.source}`;
    episodeList.innerHTML = tracks.map((track, index) => {
      const subtitle = state.mode === "audiobooks"
        ? `第 ${track.number || index + 1} 章`
        : formatDate(track.publishedAt);
      return `<li><button class="episode-button" type="button" data-track-index="${index}">
        <span class="episode-number">${state.mode === "audiobooks" ? String(track.number || index + 1).padStart(2, "0") : "▶"}</span>
        <span class="episode-copy"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(subtitle)}</span></span>
        <span class="episode-duration">${formatTime(track.duration)}</span>
      </button></li>`;
    }).join("");
    detail.hidden = false;
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
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

  function loadTrack(index, item = state.selected, mode = state.mode) {
    const tracks = tracksFor(item);
    const track = tracks[index];
    if (!item || !track) return;
    saveResume();
    state.playingItem = item;
    state.playingMode = mode;
    document.body.classList.add("on-demand-playing");
    playbackKind = mode === "audiobooks" ? "audiobook" : "podcast";
    state.trackIndex = index;
    destroyHls();
    audio.pause();
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
    episodeList.querySelectorAll(".episode-button").forEach((button, buttonIndex) => button.classList.toggle("active", state.selected?.id === item.id && buttonIndex === index));
    audio.src = track.url;
    audio.load();
    audio.defaultPlaybackRate = Number(speed.value);
    audio.playbackRate = Number(speed.value);
    setMediaSession(item, track);
    setStatus("连接中", "loading");
    audio.play().catch(error => setStatus(error.name === "NotAllowedError" ? "请点击播放" : "播放失败", "error"));
  }

  function play() {
    if (state.playingItem && state.trackIndex >= 0) {
      audio.play().catch(() => setStatus("播放失败", "error"));
      return;
    }
    if (!state.selected) {
      const first = currentItems()[0];
      if (!first) return;
      selectItem(first.id);
    }
    if (state.trackIndex < 0) loadTrack(0);
    else audio.play().catch(() => setStatus("播放失败", "error"));
  }

  function toggle() {
    if (audio.paused) play();
    else audio.pause();
  }

  function step(direction) {
    if (!state.playingItem) return;
    const tracks = tracksFor(state.playingItem);
    if (!tracks.length) return;
    const nextIndex = state.trackIndex < 0 ? 0 : (state.trackIndex + direction + tracks.length) % tracks.length;
    loadTrack(nextIndex, state.playingItem, state.playingMode);
  }

  function seek(offset) {
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + offset));
  }

  onDemandControls = { play, toggle, step };

  modeButtons.forEach(button => button.addEventListener("click", () => setMode(button.dataset.contentMode)));
  document.querySelectorAll("[data-nav-cat]").forEach(button => button.addEventListener("click", () => setMode("live")));
  document.querySelector(".hero-secondary").addEventListener("click", () => setMode("live"));
  search.addEventListener("input", renderCatalog);
  grid.addEventListener("click", event => {
    const card = event.target.closest("[data-catalog-id]");
    if (card) selectItem(card.dataset.catalogId);
  });
  episodeList.addEventListener("click", event => {
    const button = event.target.closest("[data-track-index]");
    if (button) loadTrack(Number(button.dataset.trackIndex));
  });
  document.getElementById("seekBackBtn").addEventListener("click", () => seek(-15));
  document.getElementById("seekForwardBtn").addEventListener("click", () => seek(30));
  speed.addEventListener("change", () => {
    audio.defaultPlaybackRate = Number(speed.value);
    audio.playbackRate = Number(speed.value);
  });
  progress.addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(progress.value);
  });

  audio.addEventListener("loadedmetadata", () => {
    if (playbackKind === "live") return;
    audio.playbackRate = Number(speed.value);
    progress.max = String(Number.isFinite(audio.duration) ? audio.duration : 0);
    durationTime.textContent = formatTime(audio.duration);
    const track = tracksFor(state.playingItem)[state.trackIndex];
    const saved = track ? resumeData()[track.id] : null;
    if (saved && saved.position > 5 && saved.position < audio.duration - 10) audio.currentTime = saved.position;
  });
  audio.addEventListener("timeupdate", () => {
    if (playbackKind === "live") return;
    progress.value = String(audio.currentTime || 0);
    elapsedTime.textContent = formatTime(audio.currentTime);
    if (Date.now() - state.lastResumeSave > 5000) {
      state.lastResumeSave = Date.now();
      saveResume();
    }
  });
  audio.addEventListener("ended", () => {
    if (playbackKind !== "live") step(1);
  });
  window.addEventListener("beforeunload", saveResume);

  Promise.all([
    fetch("data/audiobooks.json").then(response => { if (!response.ok) throw new Error("有声书目录读取失败"); return response.json(); }),
    fetch("data/podcasts.json").then(response => { if (!response.ok) throw new Error("播客目录读取失败"); return response.json(); }),
  ]).then(([audiobooks, podcasts]) => {
    state.audiobooks = audiobooks.books || [];
    state.podcasts = podcasts.shows || [];
    const storedMode = localStorage.getItem(CONTENT_MODE_KEY);
    setMode(["audiobooks", "podcasts"].includes(storedMode) ? storedMode : "live", false);
  }).catch(error => {
    document.getElementById("catalogStatus").textContent = error.message;
    showToast("点播目录暂时不可用");
  });
})();
