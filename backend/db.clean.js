import { DatabaseSync } from "node:sqlite";

let db;

export function initDb() {
  db = new DatabaseSync("./backend/app.sqlite");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      employee_no TEXT NOT NULL,
      role TEXT NOT NULL,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goldkeys (
      user_id TEXT PRIMARY KEY,
      quota_total INTEGER NOT NULL,
      used_count INTEGER NOT NULL,
      remaining_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      leave_date TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      memo TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      leave_request_id TEXT NOT NULL,
      content TEXT NOT NULL,
      agreed_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cancellations (
      id TEXT PRIMARY KEY,
      leave_request_id TEXT NOT NULL,
      cancelled_by TEXT NOT NULL,
      cancel_reason TEXT NOT NULL,
      cancelled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS selections (
      id TEXT PRIMARY KEY,
      leave_request_id TEXT NOT NULL,
      selected_by TEXT NOT NULL,
      selected_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      before_quota INTEGER NOT NULL,
      after_quota INTEGER NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS holidays (
      holiday_date TEXT PRIMARY KEY,
      holiday_name TEXT NOT NULL,
      is_holiday INTEGER NOT NULL,
      synced_at TEXT NOT NULL
    );
  `);

  seedDefaultsIfEmpty();
  ensureGoldkeyDefaults();
  return db;
}

function seedDefaultsIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return;

  const names = [
    "오민아",
    "이양희",
    "김해림",
    "손다솜",
    "양현아",
    "유진",
    "이지선",
    "임희종",
    "장성필",
    "장지은",
    "정수영",
    "최유경",
    "최유리",
    "최종선",
    "허정숙",
    "이현숙",
  ];
  const admins = ["관리자", "진기숙"];

  const insertUser = db.prepare(
    "INSERT INTO users (id, name, employee_no, role, password) VALUES (?, ?, ?, ?, ?)"
  );
  names.forEach((name, idx) => {
    insertUser.run(`u_nurse_${idx + 1}`, name, `N${String(idx + 1).padStart(4, "0")}`, "NURSE", "1234");
  });
  admins.forEach((name, idx) => {
    insertUser.run(`u_admin_${idx + 1}`, name, `A${String(idx + 1).padStart(4, "0")}`, "ADMIN", "1234");
  });

  const insertGoldkey = db.prepare(
    "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, ?, ?)"
  );
  names.forEach((_, idx) => {
    insertGoldkey.run(`u_nurse_${idx + 1}`, 10, 0, 10);
  });
}

function ensureGoldkeyDefaults() {
  const nurses = queryAll("SELECT id FROM users WHERE role = 'NURSE'");
  const insertGoldkey = db.prepare(
    "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, ?, ?)"
  );

  for (const nurse of nurses) {
    const row = queryOne("SELECT quota_total, used_count, remaining_count FROM goldkeys WHERE user_id = ?", nurse.id);
    if (!row) {
      insertGoldkey.run(nurse.id, 10, 0, 10);
      continue;
    }

    const used = Number(row.used_count || 0);
    const quota = Number(row.quota_total || 0);
    if (quota !== 10) {
      const remaining = Math.max(0, 10 - used);
      execute(
        "UPDATE goldkeys SET quota_total = 10, remaining_count = ? WHERE user_id = ?",
        remaining,
        nurse.id
      );
    }
  }
}

export function queryAll(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function queryOne(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function execute(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/** SQLite 동기 트랜잭션 (요청 INSERT + 골드키 차감 등) */
export function runTransaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

