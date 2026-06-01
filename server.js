const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;

// ── 统计数据结构 ──────────────────────────────────
const stats = {
  /** 当前活跃连接数（最近 60s 内发过心跳） */
  active: 0,
  /** 所有 session 的最近心跳时间戳, key=sid */
  sessions: new Map(),
  /** 今日峰值 */
  peakToday: 0,
  /** 每分钟历史记录 */
  history: [],
};

// 每 60s 记录一次快照到 history
setInterval(() => {
  const now = Date.now();
  const alive = now - 60_000;

  // 清理过期会话（超过 60s 无心跳）
  for (const [sid, ts] of stats.sessions) {
    if (ts < alive) stats.sessions.delete(sid);
  }

  stats.active = stats.sessions.size;
  if (stats.active > stats.peakToday) stats.peakToday = stats.active;

  stats.history.push({
    t: new Date().toISOString(),
    n: stats.active,
  });
  // 保留最近 24h 的数据
  const cutoff = now - 86_400_000;
  while (stats.history.length && new Date(stats.history[0].t).getTime() < cutoff) {
    stats.history.shift();
  }
}, 60_000);

// ── HTTP 服务 ────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── /stats 返回 JSON ──
  if (url.pathname === "/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      active: stats.active,
      peakToday: stats.peakToday,
      today: new Date().toISOString().slice(0, 10),
      history: stats.history.slice(-1440), // 最多 1440 条（1 条/分钟 = 24h）
    }));
    return;
  }

  // ── 静态文件 ──
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  // 安全处理：防止路径穿越
  filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.join(__dirname, filePath);

  if (!abs.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(abs, (err, data) => {
    if (err) {
      // 如果找不到文件，返回 index.html（SPA fallback）
      fs.readFile(path.join(__dirname, "index.html"), (err2, data2) => {
        if (err2) {
          res.writeHead(500);
          res.end("Internal Server Error");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// ── WebSocket 服务 ───────────────────────────────
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const sid = Math.random().toString(36).slice(2, 10);
  stats.sessions.set(sid, Date.now());
  stats.active = stats.sessions.size;

  // 定时检查心跳，每 30s 发一次 ping
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  }, 30_000);

  ws.on("pong", () => {
    stats.sessions.set(sid, Date.now());
    stats.active = stats.sessions.size;
  });

  ws.on("close", () => {
    clearInterval(interval);
    stats.sessions.delete(sid);
    stats.active = stats.sessions.size;
  });

  ws.on("error", () => {
    clearInterval(interval);
    stats.sessions.delete(sid);
    stats.active = stats.sessions.size;
  });
});

server.listen(PORT, () => {
  console.log(`📻 电台服务已启动`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   → 统计数据: http://localhost:${PORT}/stats`);
  console.log(`   → 统计看板: http://localhost:${PORT}/stats.html`);
});
