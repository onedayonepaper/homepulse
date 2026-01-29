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
