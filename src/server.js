import "dotenv/config";
import express from "express";
import { initDb, listDeviceStates, listEvents, getEventStats, getUptimeStats } from "./db.js";
import { startMonitor } from "./monitor.js";
import { sendTelegram } from "./notify.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const db = initDb(process.env.DB_PATH || "/data/homepulse.sqlite");

startMonitor({ db, env: process.env });

app.get("/api/status", (req, res) => {
  res.json({ devices: listDeviceStates(db) });
});

app.get("/api/events", (req, res) => {
  res.json({ events: listEvents(db, 50) });
});

// 일일 요약 API
app.get("/api/summary", (req, res) => {
  const now = new Date();

  // 어제 00:00:00 ~ 23:59:59
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const startTs = Math.floor(yesterday.getTime() / 1000);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const endTs = Math.floor(todayStart.getTime() / 1000);

  const stats = getEventStats(db, startTs, endTs);
  const uptime = getUptimeStats(db);

  res.json({
    date: yesterday.toISOString().split("T")[0],
    current: uptime,
    yesterday: {
      downCount: stats.downCount,
      upCount: stats.upCount,
      deviceDownCounts: stats.deviceDownCounts
    }
  });
});

// 일일 요약 즉시 발송 (테스트용)
app.post("/api/summary/send", async (req, res) => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const startTs = Math.floor(yesterday.getTime() / 1000);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const endTs = Math.floor(todayStart.getTime() / 1000);

  const stats = getEventStats(db, startTs, endTs);
  const uptime = getUptimeStats(db);

  const dateStr = yesterday.toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric"
  });

  let msg = `📊 일일 요약 리포트\n`;
  msg += `📅 ${dateStr}\n\n`;
  msg += `📡 현재 상태: ${uptime.upCount}/${uptime.total} UP (${uptime.uptimePercent}%)\n`;

  if (stats.downCount === 0) {
    msg += `\n✨ 어제 장애 0건! 완벽한 하루였습니다.`;
  } else {
    msg += `\n⚠️ 어제 장애: ${stats.downCount}건\n`;
    const deviceList = Object.entries(stats.deviceDownCounts)
      .map(([name, count]) => `  - ${name}: ${count}회`)
      .join("\n");
    if (deviceList) msg += deviceList;
  }

  await sendTelegram(msg, process.env);
  res.json({ success: true, message: msg });
});

app.get("/", (req, res) => {
  const devices = listDeviceStates(db);
  const events = listEvents(db, 30);

  const rows = devices.map(d => `
    <tr>
      <td>${escapeHtml(d.name)}</td>
      <td style="font-weight:700; color:${d.is_up ? "#1a7f37" : "#d1242f"}">
        ${d.is_up ? "UP" : "DOWN"}
      </td>
      <td>${new Date(d.last_check_ts*1000).toLocaleString("ko-KR")}</td>
      <td>${escapeHtml(d.last_message || "")}</td>
    </tr>
  `).join("");

  const evRows = events.map(e => `
    <tr>
      <td>${new Date(e.ts*1000).toLocaleString("ko-KR")}</td>
      <td>${escapeHtml(e.device_name)}</td>
      <td>${e.type}</td>
      <td>${escapeHtml(e.message || "")}</td>
    </tr>
  `).join("");

  res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HomePulse</title>
<style>
  body{font-family:system-ui;margin:24px}
  table{border-collapse:collapse;width:100%;margin:12px 0}
  th,td{border-bottom:1px solid #eee;padding:10px;text-align:left;font-size:14px}
  .card{border:1px solid #eee;border-radius:14px;padding:14px;margin:14px 0}
  .muted{color:#666}
</style>
</head>
<body>
  <h2>HomePulse</h2>
  <div class="muted">로컬 관제(HTTP/TCP) + 텔레그램 알림</div>

  <div class="card">
    <h3>기기 상태</h3>
    <table>
      <thead><tr><th>이름</th><th>상태</th><th>마지막 체크</th><th>메시지</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='4'>아직 데이터 없음</td></tr>"}</tbody>
    </table>
  </div>

  <div class="card">
    <h3>최근 이벤트</h3>
    <table>
      <thead><tr><th>시간</th><th>기기</th><th>타입</th><th>메시지</th></tr></thead>
      <tbody>${evRows || "<tr><td colspan='4'>이벤트 없음</td></tr>"}</tbody>
    </table>
  </div>

  <div class="muted">devices.json 수정 → 컨테이너 재시작하면 반영</div>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`HomePulse listening on :${PORT}`);
});

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
