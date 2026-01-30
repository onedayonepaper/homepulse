import Database from "better-sqlite3";

export function initDb(dbPath = "/data/homepulse.sqlite") {
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS device_state (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_up INTEGER NOT NULL,
      last_change_ts INTEGER NOT NULL,
      last_check_ts INTEGER NOT NULL,
      last_message TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT,
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      response_time INTEGER,
      is_up INTEGER NOT NULL,
      ts INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_response_times_device_ts
    ON response_times(device_id, ts DESC);
  `);

  return db;
}

export function upsertDeviceState(db, row) {
  const stmt = db.prepare(`
    INSERT INTO device_state (id, name, is_up, last_change_ts, last_check_ts, last_message)
    VALUES (@id, @name, @is_up, @last_change_ts, @last_check_ts, @last_message)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      is_up=excluded.is_up,
      last_change_ts=excluded.last_change_ts,
      last_check_ts=excluded.last_check_ts,
      last_message=excluded.last_message
  `);
  stmt.run(row);
}

export function getDeviceState(db, id) {
  return db.prepare(`SELECT * FROM device_state WHERE id=?`).get(id);
}

export function listDeviceStates(db) {
  return db.prepare(`SELECT * FROM device_state ORDER BY name ASC`).all();
}

export function addEvent(db, ev) {
  db.prepare(`
    INSERT INTO events (device_id, device_name, type, message, ts)
    VALUES (@device_id, @device_name, @type, @message, @ts)
  `).run(ev);
}

export function listEvents(db, limit = 50) {
  return db.prepare(`SELECT * FROM events ORDER BY ts DESC LIMIT ?`).all(limit);
}

// 특정 기간의 이벤트 통계
export function getEventStats(db, startTs, endTs) {
  const events = db.prepare(`
    SELECT * FROM events
    WHERE ts >= ? AND ts < ?
    ORDER BY ts ASC
  `).all(startTs, endTs);

  const downEvents = events.filter(e => e.type === "DOWN");
  const upEvents = events.filter(e => e.type === "UP");

  // 장비별 장애 횟수
  const deviceDownCounts = {};
  for (const e of downEvents) {
    deviceDownCounts[e.device_name] = (deviceDownCounts[e.device_name] || 0) + 1;
  }

  return {
    totalEvents: events.length,
    downCount: downEvents.length,
    upCount: upEvents.length,
    deviceDownCounts,
    events
  };
}

// 가동률 계산 (단순화: 현재 UP인 장비 비율)
export function getUptimeStats(db) {
  const devices = listDeviceStates(db);
  const total = devices.length;
  const upCount = devices.filter(d => d.is_up === 1).length;
  const uptimePercent = total > 0 ? ((upCount / total) * 100).toFixed(1) : 0;

  return {
    total,
    upCount,
    downCount: total - upCount,
    uptimePercent
  };
}

// 응답시간 기록
export function addResponseTime(db, row) {
  db.prepare(`
    INSERT INTO response_times (device_id, response_time, is_up, ts)
    VALUES (@device_id, @response_time, @is_up, @ts)
  `).run(row);
}

// 특정 장비의 응답시간 조회 (최근 N개)
export function getResponseTimes(db, deviceId, limit = 60) {
  return db.prepare(`
    SELECT * FROM response_times
    WHERE device_id = ?
    ORDER BY ts DESC
    LIMIT ?
  `).all(deviceId, limit).reverse(); // 시간순 정렬
}

// 모든 장비의 최근 응답시간 조회
export function getAllResponseTimes(db, limit = 60) {
  const devices = listDeviceStates(db);
  const result = {};

  for (const d of devices) {
    result[d.id] = {
      name: d.name,
      data: getResponseTimes(db, d.id, limit)
    };
  }

  return result;
}

// 응답시간 통계 (평균, 최대, 최소)
export function getResponseTimeStats(db, deviceId, hours = 24) {
  const sinceTs = Math.floor(Date.now() / 1000) - (hours * 3600);

  const stats = db.prepare(`
    SELECT
      AVG(response_time) as avg,
      MAX(response_time) as max,
      MIN(response_time) as min,
      COUNT(*) as count
    FROM response_times
    WHERE device_id = ? AND ts >= ? AND response_time IS NOT NULL
  `).get(deviceId, sinceTs);

  return {
    avg: stats.avg ? Math.round(stats.avg) : null,
    max: stats.max,
    min: stats.min,
    count: stats.count
  };
}

// 오래된 응답시간 데이터 정리 (기본 7일)
export function cleanupResponseTimes(db, daysToKeep = 7) {
  const cutoffTs = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 3600);
  const result = db.prepare(`DELETE FROM response_times WHERE ts < ?`).run(cutoffTs);
  return result.changes;
}
