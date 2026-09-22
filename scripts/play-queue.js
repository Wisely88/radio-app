(() => {
  "use strict";

  const QUEUE_KEY = "xiaowei-radio-play-queue-v1";
  const MAX_QUEUE_ITEMS = 50;
  const queueToggleButtons = [
    document.getElementById("queueToggleBtn"),
    document.getElementById("dockQueueToggleBtn"),
  ].filter(Boolean);
  const countNodes = [
    document.getElementById("queueCount"),
    document.getElementById("dockQueueCount"),
  ].filter(Boolean);
  let queue = readQueue();
  let lastFocusedElement = null;

  const panel = document.createElement("section");
  panel.className = "queue-sheet";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "queueSheetTitle");
  panel.innerHTML = `
    <div class="queue-sheet-backdrop" data-queue-close></div>
    <div class="queue-sheet-panel">
      <header class="queue-sheet-header">
        <div>
          <p>LISTENING QUEUE</p>
          <h2 id="queueSheetTitle">接下来播放</h2>
        </div>
        <div class="queue-sheet-actions">
          <button class="queue-clear-btn" type="button" data-queue-clear>清空</button>
          <button class="queue-close-btn" type="button" data-queue-close aria-label="关闭接下来播放">×</button>
        </div>
      </header>
      <p class="queue-sheet-status" id="queueSheetStatus" role="status"></p>
      <ol class="queue-list" id="queueList"></ol>
    </div>`;
  document.body.appendChild(panel);

  function notify(message) {
    window.radioPlayback?.notify?.(message);
  }

  function readQueue() {
    try {
      const saved = JSON.parse(localStorage.getItem(QUEUE_KEY));
      if (!Array.isArray(saved)) return [];
      return saved.map(normalizeEntry).filter(Boolean).slice(0, MAX_QUEUE_ITEMS);
    } catch {
      return [];
    }
  }

  function normalizeEntry(value) {
    if (!value || typeof value !== "object" || !["live", "on-demand"].includes(value.kind)) return null;
    const id = String(value.id || "").slice(0, 500);
    const title = String(value.title || "未命名内容").slice(0, 300);
    const subtitle = String(value.subtitle || "").slice(0, 300);
    if (!id) return null;
    if (value.kind === "live") {
      const stationId = String(value.stationId || "").slice(0, 500);
      return stationId ? { id, kind: "live", stationId, title, subtitle, cover: "assets/three-quarter-mark.svg" } : null;
    }
    const mode = value.mode === "audiobooks" ? "audiobooks" : value.mode === "podcasts" ? "podcasts" : "";
    const itemId = String(value.itemId || "").slice(0, 500);
    const trackId = String(value.trackId || "").slice(0, 500);
    const trackIndex = Number(value.trackIndex);
    if (!mode || !itemId || !Number.isInteger(trackIndex) || trackIndex < 0) return null;
    return {
      id, kind: "on-demand", mode, itemId, trackId, trackIndex, title, subtitle,
      cover: String(value.cover || "assets/three-quarter-mark.svg").slice(0, 1000),
    };
  }

  function persist() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function updateCounts() {
    countNodes.forEach(node => { node.textContent = String(queue.length); });
    queueToggleButtons.forEach(button => {
      button.classList.toggle("has-items", queue.length > 0);
      button.setAttribute("aria-label", `打开接下来播放，共 ${queue.length} 项`);
    });
  }

  function makeButton(className, label, action, index) {
    const button = document.createElement("button");
    button.className = className;
    button.type = "button";
    button.textContent = label;
    button.dataset.queueAction = action;
    button.dataset.queueIndex = String(index);
    return button;
  }

  function render() {
    const list = panel.querySelector("#queueList");
    const status = panel.querySelector("#queueSheetStatus");
    const clearButton = panel.querySelector("[data-queue-clear]");
    list.replaceChildren();
    status.textContent = queue.length ? `共 ${queue.length} 项。播放结束或点按下一首时，会优先播放这里的内容。` : "队列为空。可从频道或节目列表点按“＋”加入。";
    clearButton.disabled = queue.length === 0;

    if (!queue.length) {
      const empty = document.createElement("li");
      empty.className = "queue-empty";
      empty.textContent = "还没有安排下一段声音";
      list.appendChild(empty);
      updateCounts();
      return;
    }

    queue.forEach((entry, index) => {
      const row = document.createElement("li");
      row.className = "queue-item";
      const order = document.createElement("span");
      order.className = "queue-order";
      order.textContent = String(index + 1).padStart(2, "0");
      const art = document.createElement("img");
      art.className = "queue-art";
      art.alt = "";
      art.src = entry.cover || "assets/three-quarter-mark.svg";
      art.addEventListener("error", () => { art.src = "assets/three-quarter-mark.svg"; }, { once: true });
      const copy = document.createElement("div");
      copy.className = "queue-copy";
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const meta = document.createElement("span");
      meta.textContent = entry.subtitle;
      copy.append(title, meta);
      const controls = document.createElement("div");
      controls.className = "queue-item-controls";
      const play = makeButton("queue-item-play", "播放", "play", index);
      play.setAttribute("aria-label", `立即播放 ${entry.title}`);
      const remove = makeButton("queue-item-remove", "移除", "remove", index);
      remove.setAttribute("aria-label", `从队列移除 ${entry.title}`);
      controls.append(play, remove);
      row.append(order, art, copy, controls);
      list.appendChild(row);
    });
    updateCounts();
  }

  function open() {
    if (!panel.hidden) return;
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.hidden = false;
    queueToggleButtons.forEach(button => button.setAttribute("aria-expanded", "true"));
    render();
    panel.querySelector(".queue-close-btn")?.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    queueToggleButtons.forEach(button => button.setAttribute("aria-expanded", "false"));
    lastFocusedElement?.focus?.();
  }

  function add(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      notify("该内容暂时无法加入队列");
      return false;
    }
    if (queue.some(item => item.id === normalized.id)) {
      notify("已在接下来播放中");
      return false;
    }
    if (queue.length >= MAX_QUEUE_ITEMS) {
      notify(`队列最多保存 ${MAX_QUEUE_ITEMS} 项`);
      return false;
    }
    queue.push(normalized);
    persist();
    render();
    notify(`已加入接下来播放：${normalized.title}`);
    return true;
  }

  async function playEntry(entry) {
    if (entry.kind === "live") return window.radioPlayback?.playLive?.(entry.stationId) === true;
    const result = window.radioPlayback?.playOnDemand?.(entry);
    return result === true || await result;
  }

  function consume(index = 0) {
    const entry = queue[index];
    if (!entry) return false;
    queue.splice(index, 1);
    persist();
    render();
    Promise.resolve(playEntry(entry)).then(played => {
      if (!played) {
        notify(`内容已更新，跳过：${entry.title}`);
        if (queue.length) consume(0);
      }
    });
    return true;
  }

  function remove(index) {
    const [removed] = queue.splice(index, 1);
    if (!removed) return;
    persist();
    render();
    notify(`已从队列移除：${removed.title}`);
  }

  queueToggleButtons.forEach(button => button.addEventListener("click", open));
  panel.addEventListener("click", event => {
    if (event.target.closest("[data-queue-close]")) {
      close();
      return;
    }
    if (event.target.closest("[data-queue-clear]")) {
      queue = [];
      persist();
      render();
      notify("已清空接下来播放");
      return;
    }
    const button = event.target.closest("[data-queue-action]");
    if (!button) return;
    const index = Number(button.dataset.queueIndex);
    if (!Number.isInteger(index) || index < 0) return;
    if (button.dataset.queueAction === "play") {
      consume(index);
      close();
    } else if (button.dataset.queueAction === "remove") {
      remove(index);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      close();
    }
  });

  window.radioQueue = {
    addLive(index) {
      return add(window.radioPlayback?.addLiveSource?.(index));
    },
    addOnDemand(mode, itemId, trackIndex) {
      return add(window.radioPlayback?.addOnDemandSource?.(mode, itemId, trackIndex));
    },
    playNext() {
      return consume(0);
    },
    open,
  };

  render();
})();
