import fs from "fs";
import { checkDevice } from "./checks.js";
import { addEvent, getDeviceState, upsertDeviceState, getEventStats, getUptimeStats } from "./db.js";
import { sendTelegram } from "./notify.js";

export function loadDevices() {
  const raw = fs.readFileSync("./devices.json", "utf-8");
  return JSON.parse(raw);
}

export function startMonitor({ db, env }) {
  const intervalSec = Number(env.CHECK_INTERVAL_SEC || 60);

  async function tick() {
    const devices = loadDevices();
    const now = Math.floor(Date.now() / 1000);

    for (const d of devices) {
      const res = await checkDevice(d);
      const prev = getDeviceState(db, d.id);

      const isUp = res.ok ? 1 : 0;
      const prevUp = prev ? prev.is_up : null;

      const changed = prevUp === null || prevUp !== isUp;
      const lastChange = changed ? now : (prev?.last_change_ts ?? now);

      upsertDeviceState(db, {
        id: d.id,
        name: d.name,
        is_up: isUp,
        last_change_ts: lastChange,
        last_check_ts: now,
        last_message: res.message
      });

      if (changed) {
        const type = isUp ? "UP" : "DOWN";
        addEvent(db, {
          device_id: d.id,
          device_name: d.name,
          type,
          message: res.message,
          ts: now
        });

        const emoji = isUp ? "✅" : "🚨";
        const msg = `${emoji} ${d.name} ${type}\n- ${res.message}\n- ${new Date(now * 1000).toLocaleString("ko-KR")}`;
        await sendTelegram(msg, env);
      }
    }
  }

  // 즉시 1회 + 주기 실행
  tick();
  setInterval(tick, intervalSec * 1000);

  // 일일 요약 스케줄러 시작
  startDailySummary({ db, env });
}

// 일일 요약 알림
export function startDailySummary({ db, env }) {
  const summaryHour = Number(env.DAILY_SUMMARY_HOUR || 9); // 기본 오전 9시

  async function sendDailySummary() {
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

    const dateStr = yesterday.toLocaleDateString("ko-KR", {
      year: "numeric", month: "long", day: "numeric"
    });

    let msg = `📊 일일 요약 리포트\n`;
    msg += `📅 ${dateStr}\n\n`;

    // 현재 상태
    msg += `📡 현재 상태: ${uptime.upCount}/${uptime.total} UP (${uptime.uptimePercent}%)\n`;

    // 어제 장애 통계
    if (stats.downCount === 0) {
      msg += `\n✨ 어제 장애 0건! 완벽한 하루였습니다.`;
    } else {
      msg += `\n⚠️ 어제 장애: ${stats.downCount}건\n`;

      // 장비별 장애 횟수
      const deviceList = Object.entries(stats.deviceDownCounts)
        .map(([name, count]) => `  - ${name}: ${count}회`)
        .join("\n");

      if (deviceList) {
        msg += deviceList;
      }
    }

    await sendTelegram(msg, env);
    console.log(`[${new Date().toISOString()}] Daily summary sent`);
  }

  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(summaryHour, 0, 0, 0);

    // 이미 지났으면 내일
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const msUntilNext = next.getTime() - now.getTime();

    console.log(`[${new Date().toISOString()}] Daily summary scheduled for ${next.toLocaleString("ko-KR")}`);

    setTimeout(() => {
      sendDailySummary();
      // 다음날 스케줄
      setInterval(sendDailySummary, 24 * 60 * 60 * 1000);
    }, msUntilNext);
  }

  scheduleNext();

  // 테스트용: 환경변수로 즉시 발송
  if (env.SEND_SUMMARY_NOW === "true") {
    sendDailySummary();
  }
}
