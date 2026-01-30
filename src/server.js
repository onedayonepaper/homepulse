import "dotenv/config";
import express from "express";
import { initDb, listDeviceStates, listEvents, getEventStats, getUptimeStats, getAllResponseTimes, getResponseTimeStats } from "./db.js";
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

// 응답시간 API
app.get("/api/response-times", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 1440); // 최대 24시간 (1분 간격 기준)
  const data = getAllResponseTimes(db, limit);
  res.json(data);
});

// 응답시간 통계 API
app.get("/api/response-times/stats", (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 168); // 최대 7일
  const devices = listDeviceStates(db);

  const stats = {};
  for (const d of devices) {
    stats[d.id] = {
      name: d.name,
      ...getResponseTimeStats(db, d.id, hours)
    };
  }

  res.json(stats);
});

// 그래프 페이지
app.get("/graph", (req, res) => {
  const devices = listDeviceStates(db);

  res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HomePulse - 응답시간 그래프</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  body{font-family:system-ui;margin:24px;background:#fafafa}
  .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
  .header h2{margin:0}
  .header a{color:#666;text-decoration:none}
  .card{background:#fff;border:1px solid #eee;border-radius:14px;padding:20px;margin:14px 0}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px}
  .stat-card{background:#f8f9fa;border-radius:10px;padding:16px;text-align:center}
  .stat-value{font-size:28px;font-weight:700;color:#1a7f37}
  .stat-label{color:#666;font-size:13px;margin-top:4px}
  .chart-container{position:relative;height:300px}
  .muted{color:#666;font-size:13px}
  .legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px}
  .legend-item{display:flex;align-items:center;gap:6px;font-size:13px}
  .legend-color{width:12px;height:12px;border-radius:2px}
</style>
</head>
<body>
  <div class="header">
    <h2>📈 응답시간 모니터링</h2>
    <a href="/">← 대시보드로 돌아가기</a>
  </div>

  <div class="stats" id="stats">
    <div class="stat-card">
      <div class="stat-value" id="avg-all">-</div>
      <div class="stat-label">전체 평균 (ms)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="max-all">-</div>
      <div class="stat-label">최대 응답시간 (ms)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="min-all">-</div>
      <div class="stat-label">최소 응답시간 (ms)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="checks-all">-</div>
      <div class="stat-label">체크 횟수 (24h)</div>
    </div>
  </div>

  <div class="card">
    <h3>응답시간 추이 (최근 1시간)</h3>
    <div class="chart-container">
      <canvas id="responseChart"></canvas>
    </div>
    <div class="legend" id="legend"></div>
  </div>

  <div class="card">
    <h3>장비별 통계 (24시간)</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid #eee">
          <th style="text-align:left;padding:10px">장비</th>
          <th style="text-align:right;padding:10px">평균</th>
          <th style="text-align:right;padding:10px">최대</th>
          <th style="text-align:right;padding:10px">최소</th>
          <th style="text-align:right;padding:10px">체크 수</th>
        </tr>
      </thead>
      <tbody id="statsTable"></tbody>
    </table>
  </div>

  <div class="muted" style="margin-top:20px">
    30초마다 자동 갱신 | 데이터 보관: 7일
  </div>

<script>
const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];
let chart = null;

async function loadData() {
  const [timesRes, statsRes] = await Promise.all([
    fetch('/api/response-times?limit=60'),
    fetch('/api/response-times/stats?hours=24')
  ]);

  const times = await timesRes.json();
  const stats = await statsRes.json();

  updateChart(times);
  updateStats(stats);
}

function updateChart(data) {
  const ctx = document.getElementById('responseChart').getContext('2d');
  const deviceIds = Object.keys(data);

  const datasets = deviceIds.map((id, i) => {
    const device = data[id];
    return {
      label: device.name,
      data: device.data.map(d => ({
        x: new Date(d.ts * 1000),
        y: d.response_time
      })),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '20',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 5
    };
  });

  // 범례 업데이트
  const legendEl = document.getElementById('legend');
  legendEl.innerHTML = deviceIds.map((id, i) =>
    '<div class="legend-item"><div class="legend-color" style="background:' + colors[i % colors.length] + '"></div>' + data[id].name + '</div>'
  ).join('');

  if (chart) {
    chart.data.datasets = datasets;
    chart.update('none');
  } else {
    chart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.label + ': ' + (ctx.parsed.y ?? '-') + 'ms'
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'ms' },
            grid: { color: '#f0f0f0' }
          }
        }
      }
    });
  }
}

function updateStats(stats) {
  const deviceIds = Object.keys(stats);
  let totalAvg = 0, totalMax = 0, totalMin = Infinity, totalCount = 0, validDevices = 0;

  const rows = deviceIds.map(id => {
    const s = stats[id];
    if (s.avg !== null) {
      totalAvg += s.avg;
      totalMax = Math.max(totalMax, s.max || 0);
      totalMin = Math.min(totalMin, s.min || Infinity);
      totalCount += s.count;
      validDevices++;
    }
    return '<tr style="border-bottom:1px solid #eee">' +
      '<td style="padding:10px">' + s.name + '</td>' +
      '<td style="text-align:right;padding:10px">' + (s.avg ?? '-') + ' ms</td>' +
      '<td style="text-align:right;padding:10px">' + (s.max ?? '-') + ' ms</td>' +
      '<td style="text-align:right;padding:10px">' + (s.min ?? '-') + ' ms</td>' +
      '<td style="text-align:right;padding:10px">' + s.count + '</td>' +
    '</tr>';
  }).join('');

  document.getElementById('statsTable').innerHTML = rows;
  document.getElementById('avg-all').textContent = validDevices ? Math.round(totalAvg / validDevices) : '-';
  document.getElementById('max-all').textContent = totalMax || '-';
  document.getElementById('min-all').textContent = totalMin === Infinity ? '-' : totalMin;
  document.getElementById('checks-all').textContent = totalCount;
}

// Chart.js 어댑터 로드 후 실행
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js';
script.onload = () => {
  loadData();
  setInterval(loadData, 30000);
};
document.head.appendChild(script);
</script>
</body>
</html>
  `);
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
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div>
      <h2 style="margin:0">HomePulse</h2>
      <div class="muted">로컬 관제(HTTP/TCP) + 텔레그램 알림</div>
    </div>
    <a href="/graph" style="background:#4CAF50;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">📈 응답시간 그래프</a>
  </div>

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
