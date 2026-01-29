import fs from "fs";
import { checkDevice } from "./checks.js";
import { addEvent, getDeviceState, upsertDeviceState } from "./db.js";
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
}
