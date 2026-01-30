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

// 아키텍처 페이지
app.get("/architecture", (req, res) => {
  res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HomePulse - 프로젝트 구조</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
  .container { max-width: 1200px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .header h1 { margin: 0; color: #fff; font-size: 28px; }
  .header a { color: rgba(255,255,255,0.8); text-decoration: none; font-size: 14px; }
  .header a:hover { color: #fff; }

  .card { background: #fff; border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
  .card h2 { margin: 0 0 20px 0; color: #333; font-size: 20px; display: flex; align-items: center; gap: 10px; }
  .card h3 { margin: 20px 0 12px 0; color: #555; font-size: 16px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px; }

  /* 아키텍처 다이어그램 */
  .arch-diagram {
    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
    border-radius: 12px;
    padding: 30px;
    position: relative;
    overflow: hidden;
  }

  .arch-layer {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin: 15px 0;
    flex-wrap: wrap;
  }

  .arch-box {
    background: #fff;
    border: 2px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px 24px;
    text-align: center;
    min-width: 140px;
    transition: all 0.3s ease;
    cursor: pointer;
    position: relative;
  }

  .arch-box:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 25px rgba(0,0,0,0.15);
  }

  .arch-box.server { border-color: #4CAF50; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: #fff; }
  .arch-box.db { border-color: #2196F3; background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%); color: #fff; }
  .arch-box.monitor { border-color: #FF9800; background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%); color: #fff; }
  .arch-box.notify { border-color: #9C27B0; background: linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%); color: #fff; }
  .arch-box.device { border-color: #607D8B; background: linear-gradient(135deg, #607D8B 0%, #455A64 100%); color: #fff; }
  .arch-box.user { border-color: #E91E63; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: #fff; }

  .arch-box-icon { font-size: 28px; margin-bottom: 8px; }
  .arch-box-title { font-weight: 600; font-size: 14px; }
  .arch-box-desc { font-size: 11px; opacity: 0.9; margin-top: 4px; }

  .arch-arrow {
    text-align: center;
    color: #94a3b8;
    font-size: 24px;
    margin: 8px 0;
  }

  .arch-label {
    position: absolute;
    font-size: 11px;
    color: #64748b;
    background: #fff;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }

  /* 파일 구조 */
  .file-tree {
    font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    font-size: 13px;
    background: #1e293b;
    color: #e2e8f0;
    border-radius: 12px;
    padding: 20px;
    overflow-x: auto;
  }

  .file-tree .folder { color: #fbbf24; }
  .file-tree .file { color: #60a5fa; }
  .file-tree .comment { color: #64748b; }
  .file-tree .highlight { color: #4ade80; }

  /* 데이터 흐름 */
  .flow-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .flow-step {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 16px;
    background: #f8fafc;
    border-radius: 12px;
    border-left: 4px solid;
    transition: all 0.3s ease;
  }

  .flow-step:hover {
    background: #f1f5f9;
    transform: translateX(4px);
  }

  .flow-step.step1 { border-color: #4CAF50; }
  .flow-step.step2 { border-color: #2196F3; }
  .flow-step.step3 { border-color: #FF9800; }
  .flow-step.step4 { border-color: #9C27B0; }
  .flow-step.step5 { border-color: #E91E63; }

  .flow-number {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }

  .step1 .flow-number { background: #4CAF50; }
  .step2 .flow-number { background: #2196F3; }
  .step3 .flow-number { background: #FF9800; }
  .step4 .flow-number { background: #9C27B0; }
  .step5 .flow-number { background: #E91E63; }

  .flow-content h4 { margin: 0 0 4px 0; font-size: 15px; color: #334155; }
  .flow-content p { margin: 0; font-size: 13px; color: #64748b; line-height: 1.5; }
  .flow-content code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 12px; }

  /* 기술 스택 */
  .tech-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
  }

  .tech-item {
    background: #f8fafc;
    border-radius: 10px;
    padding: 16px;
    text-align: center;
    transition: all 0.3s ease;
  }

  .tech-item:hover {
    background: #f1f5f9;
    transform: scale(1.02);
  }

  .tech-icon { font-size: 32px; margin-bottom: 8px; }
  .tech-name { font-weight: 600; font-size: 14px; color: #334155; }
  .tech-desc { font-size: 11px; color: #64748b; margin-top: 4px; }

  /* API 엔드포인트 */
  .api-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .api-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
    font-size: 13px;
  }

  .api-method {
    padding: 4px 8px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 11px;
    min-width: 50px;
    text-align: center;
  }

  .api-method.get { background: #dcfce7; color: #166534; }
  .api-method.post { background: #fef3c7; color: #92400e; }

  .api-path { font-family: monospace; color: #334155; }
  .api-desc { color: #64748b; margin-left: auto; }

  /* 네비게이션 버튼 */
  .nav-buttons {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: rgba(255,255,255,0.2);
    color: #fff;
    text-decoration: none;
    border-radius: 8px;
    font-size: 14px;
    transition: all 0.3s ease;
  }

  .nav-btn:hover {
    background: rgba(255,255,255,0.3);
    transform: translateY(-2px);
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🏗️ HomePulse 아키텍처</h1>
    <div class="nav-buttons">
      <a href="/" class="nav-btn">📊 대시보드</a>
      <a href="/graph" class="nav-btn">📈 그래프</a>
    </div>
  </div>

  <!-- 시스템 아키텍처 -->
  <div class="card">
    <h2>🔧 시스템 아키텍처</h2>
    <div class="arch-diagram">

      <!-- 사용자 레이어 -->
      <div class="arch-layer">
        <div class="arch-box user">
          <div class="arch-box-icon">👤</div>
          <div class="arch-box-title">사용자</div>
          <div class="arch-box-desc">웹 브라우저</div>
        </div>
        <div class="arch-box user">
          <div class="arch-box-icon">📱</div>
          <div class="arch-box-title">텔레그램</div>
          <div class="arch-box-desc">모바일 알림</div>
        </div>
      </div>

      <div class="arch-arrow">⬇️ HTTP Request / Push Notification</div>

      <!-- 서버 레이어 -->
      <div class="arch-layer">
        <div class="arch-box server">
          <div class="arch-box-icon">🖥️</div>
          <div class="arch-box-title">Express Server</div>
          <div class="arch-box-desc">:8787 (API + 페이지)</div>
        </div>
      </div>

      <div class="arch-arrow">⬇️ ⬆️</div>

      <!-- 코어 레이어 -->
      <div class="arch-layer">
        <div class="arch-box monitor">
          <div class="arch-box-icon">⏱️</div>
          <div class="arch-box-title">Monitor</div>
          <div class="arch-box-desc">60초 주기 체크</div>
        </div>
        <div class="arch-box db">
          <div class="arch-box-icon">💾</div>
          <div class="arch-box-title">SQLite</div>
          <div class="arch-box-desc">WAL 모드</div>
        </div>
        <div class="arch-box notify">
          <div class="arch-box-icon">🔔</div>
          <div class="arch-box-title">Notify</div>
          <div class="arch-box-desc">Telegram API</div>
        </div>
      </div>

      <div class="arch-arrow">⬇️ HTTP/TCP Check</div>

      <!-- 디바이스 레이어 -->
      <div class="arch-layer">
        <div class="arch-box device">
          <div class="arch-box-icon">📡</div>
          <div class="arch-box-title">공유기</div>
          <div class="arch-box-desc">TCP :80</div>
        </div>
        <div class="arch-box device">
          <div class="arch-box-icon">💿</div>
          <div class="arch-box-title">NAS</div>
          <div class="arch-box-desc">HTTP :5000</div>
        </div>
        <div class="arch-box device">
          <div class="arch-box-icon">📹</div>
          <div class="arch-box-title">IP카메라</div>
          <div class="arch-box-desc">TCP :554</div>
        </div>
      </div>

    </div>
  </div>

  <div class="grid">
    <!-- 데이터 흐름 -->
    <div class="card">
      <h2>🔄 데이터 흐름</h2>
      <div class="flow-container">
        <div class="flow-step step1">
          <div class="flow-number">1</div>
          <div class="flow-content">
            <h4>헬스체크 실행</h4>
            <p><code>monitor.js</code>가 60초마다 <code>checks.js</code>를 호출하여 각 장비에 HTTP/TCP 요청</p>
          </div>
        </div>
        <div class="flow-step step2">
          <div class="flow-number">2</div>
          <div class="flow-content">
            <h4>응답 분석 & 저장</h4>
            <p>응답 상태(UP/DOWN)와 응답시간(ms)을 <code>db.js</code>를 통해 SQLite에 저장</p>
          </div>
        </div>
        <div class="flow-step step3">
          <div class="flow-number">3</div>
          <div class="flow-content">
            <h4>상태 변화 감지</h4>
            <p>이전 상태와 비교하여 변화 발생 시에만 이벤트 기록 (알림 피로 방지)</p>
          </div>
        </div>
        <div class="flow-step step4">
          <div class="flow-number">4</div>
          <div class="flow-content">
            <h4>알림 발송</h4>
            <p>상태 변화 시 <code>notify.js</code>가 Telegram Bot API로 즉시 푸시 알림 전송</p>
          </div>
        </div>
        <div class="flow-step step5">
          <div class="flow-number">5</div>
          <div class="flow-content">
            <h4>대시보드 표시</h4>
            <p>사용자가 웹 접속 시 <code>server.js</code>가 DB 조회 후 실시간 데이터 렌더링</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 파일 구조 -->
    <div class="card">
      <h2>📁 프로젝트 구조</h2>
      <div class="file-tree">
<span class="folder">homepulse/</span>
├── <span class="folder">src/</span>
│   ├── <span class="file">server.js</span>      <span class="comment"># Express 서버 + 라우팅</span>
│   ├── <span class="file">monitor.js</span>     <span class="comment"># 모니터링 스케줄러</span>
│   ├── <span class="file">checks.js</span>      <span class="comment"># HTTP/TCP 헬스체크</span>
│   ├── <span class="file">db.js</span>          <span class="comment"># SQLite 데이터베이스</span>
│   └── <span class="file">notify.js</span>      <span class="comment"># 텔레그램 알림</span>
├── <span class="folder">data/</span>              <span class="comment"># DB 파일 저장</span>
│   └── <span class="file highlight">homepulse.sqlite</span>
├── <span class="file">devices.json</span>       <span class="comment"># 모니터링 대상 설정</span>
├── <span class="file">docker-compose.yml</span>
├── <span class="file">Dockerfile</span>
├── <span class="file">package.json</span>
└── <span class="file">.env</span>               <span class="comment"># 환경변수</span>
      </div>

      <h3>📊 데이터베이스 스키마</h3>
      <div class="file-tree">
<span class="highlight">device_state</span>     <span class="comment"># 현재 장비 상태</span>
├── id, name, is_up
├── last_change_ts, last_check_ts
└── last_message

<span class="highlight">events</span>           <span class="comment"># 상태 변화 이력</span>
├── device_id, device_name
├── type (UP/DOWN)
└── message, ts

<span class="highlight">response_times</span>   <span class="comment"># 응답시간 기록</span>
├── device_id, response_time
├── is_up, ts
└── <span class="comment">(7일 후 자동 삭제)</span>
      </div>
    </div>
  </div>

  <div class="grid">
    <!-- 기술 스택 -->
    <div class="card">
      <h2>⚡ 기술 스택</h2>
      <div class="tech-grid">
        <div class="tech-item">
          <div class="tech-icon">💚</div>
          <div class="tech-name">Node.js 20+</div>
          <div class="tech-desc">비동기 런타임</div>
        </div>
        <div class="tech-item">
          <div class="tech-icon">🚂</div>
          <div class="tech-name">Express</div>
          <div class="tech-desc">웹 프레임워크</div>
        </div>
        <div class="tech-item">
          <div class="tech-icon">🗃️</div>
          <div class="tech-name">SQLite</div>
          <div class="tech-desc">WAL 모드 DB</div>
        </div>
        <div class="tech-item">
          <div class="tech-icon">📊</div>
          <div class="tech-name">Chart.js</div>
          <div class="tech-desc">시계열 그래프</div>
        </div>
        <div class="tech-item">
          <div class="tech-icon">📨</div>
          <div class="tech-name">Telegram</div>
          <div class="tech-desc">푸시 알림</div>
        </div>
        <div class="tech-item">
          <div class="tech-icon">🐳</div>
          <div class="tech-name">Docker</div>
          <div class="tech-desc">컨테이너 배포</div>
        </div>
      </div>
    </div>

    <!-- API 엔드포인트 -->
    <div class="card">
      <h2>🔌 API 엔드포인트</h2>
      <div class="api-list">
        <div class="api-item">
          <span class="api-method get">GET</span>
          <span class="api-path">/</span>
          <span class="api-desc">메인 대시보드</span>
        </div>
        <div class="api-item">
          <span class="api-method get">GET</span>
          <span class="api-path">/graph</span>
          <span class="api-desc">응답시간 그래프</span>
        </div>
        <div class="api-item">
          <span class="api-method get">GET</span>
          <span class="api-path">/architecture</span>
          <span class="api-desc">프로젝트 구조</span>
        </div>
        <div class="api-item">
          <span class="api-method get">GET</span>
          <span class="api-path">/api/status</span>
          <span class="api-desc">장비 상태</span>
        </div>
        <div class="api-item">
          <span class="api-method get">GET</span>
          <span class="api-path">/api/events</span>
          <span class="api-desc">이벤트 로그</span>
        </div>
        <div class="api-item">
          <span class="api-method get">GET</span>
          <span class="api-path">/api/summary</span>
          <span class="api-desc">일일 요약</span>
        </div>
        <div class="api-item">
          <span class="api-method post">POST</span>
          <span class="api-path">/api/summary/send</span>
          <span class="api-desc">요약 발송</span>
        </div>
        <div class="api-item">
          <span class="api-method get">GET</span>
          <span class="api-path">/api/response-times</span>
          <span class="api-desc">응답시간 데이터</span>
        </div>
        <div class="api-item">
          <span class="api-method get">GET</span>
          <span class="api-path">/api/response-times/stats</span>
          <span class="api-desc">응답시간 통계</span>
        </div>
      </div>
    </div>
  </div>

  <!-- 주요 기능 설명 -->
  <div class="card">
    <h2>✨ 핵심 기능 상세</h2>
    <div class="grid">
      <div>
        <h3>🔍 헬스체크</h3>
        <ul style="color:#64748b;line-height:1.8">
          <li><strong>HTTP 체크</strong>: fetch()로 상태 코드 검증</li>
          <li><strong>TCP 체크</strong>: net.Socket으로 포트 연결 확인</li>
          <li><strong>응답시간 측정</strong>: Date.now() 차이 계산</li>
          <li><strong>타임아웃</strong>: 기본 1200ms, 커스텀 가능</li>
        </ul>
      </div>
      <div>
        <h3>🚨 알림 시스템</h3>
        <ul style="color:#64748b;line-height:1.8">
          <li><strong>상태 변화만</strong>: 동일 상태는 알림 X</li>
          <li><strong>즉시 푸시</strong>: Telegram Bot API</li>
          <li><strong>일일 요약</strong>: 매일 오전 9시 자동</li>
          <li><strong>Graceful 실패</strong>: 알림 실패해도 서비스 유지</li>
        </ul>
      </div>
      <div>
        <h3>📊 대시보드</h3>
        <ul style="color:#64748b;line-height:1.8">
          <li><strong>실시간 상태</strong>: UP/DOWN 즉시 확인</li>
          <li><strong>이벤트 로그</strong>: 최근 30개 표시</li>
          <li><strong>응답시간 그래프</strong>: Chart.js 시계열</li>
          <li><strong>자동 갱신</strong>: 30초마다 업데이트</li>
        </ul>
      </div>
      <div>
        <h3>💾 데이터 관리</h3>
        <ul style="color:#64748b;line-height:1.8">
          <li><strong>SQLite WAL</strong>: 동시 읽기/쓰기</li>
          <li><strong>자동 정리</strong>: 7일 이후 응답시간 삭제</li>
          <li><strong>이벤트 영구 저장</strong>: 장애 이력 보존</li>
          <li><strong>인덱스 최적화</strong>: 빠른 조회</li>
        </ul>
      </div>
    </div>
  </div>

  <div style="text-align:center;color:rgba(255,255,255,0.7);margin-top:24px;font-size:13px">
    HomePulse v1.0 - 홈/개인 인프라 관제 시스템
  </div>
</div>
</body>
</html>
  `);
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
    <div style="display:flex;gap:8px">
      <a href="/graph" style="background:#4CAF50;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">📈 그래프</a>
      <a href="/architecture" style="background:#667eea;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px">🏗️ 구조</a>
    </div>
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
