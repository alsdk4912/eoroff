import { DatabaseSync } from "node:sqlite";

let db;

const NURSE_NAMES = [
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

const ADMIN_NAMES = ["관리자", "진기숙"];

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

  seedIfEmpty();
  return db;
}

function seedIfEmpty() {
  const usersCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (usersCount > 0) return;

  const insertUser = db.prepare(
    "INSERT INTO users (id, name, employee_no, role, password) VALUES (?, ?, ?, ?, ?)"
  );

  let nurseIdx = 1;
  for (const name of NURSE_NAMES) {
    const employeeNo = `N${String(nurseIdx).padStart(4, "0")}`;
    insertUser.run(`u_nurse_${nurseIdx}`, name, employeeNo, "NURSE", "1234");
    nurseIdx += 1;
  }

  let adminIdx = 1;
  for (const name of ADMIN_NAMES) {
    const employeeNo = `A${String(adminIdx).padStart(4, "0")}`;
    insertUser.run(`u_admin_${adminIdx}`, name, employeeNo, "ADMIN", "1234");
    adminIdx += 1;
  }

  const insertGoldkey = db.prepare(
    "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, ?, ?)"
  );
  for (let i = 1; i <= NURSE_NAMES.length; i += 1) {
    insertGoldkey.run(`u_nurse_${i}`, 1, 0, 1);
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

import { DatabaseSync } from "node:sqlite";
import { initialGoldkeys, initialRequests, users } from "../src/data/sampleData.js";

let db;

export function initDb() {
  db = new DatabaseSync("./backend/app.sqlite");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      employee_no TEXT NOT NULL,
      role TEXT NOT NULL,
      password TEXT
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

  ensureColumn("users", "password", "TEXT");

  seedIfEmpty();
  seedDefaultPasswords();
  return db;
}

function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return;

  const insertUser = db.prepare(
    "INSERT INTO users (id, name, employee_no, role, password) VALUES (?, ?, ?, ?, ?)"
  );
  for (const u of users) {
    insertUser.run(u.id, u.name, u.employeeNo, u.role, "1234");
  }

  const insertGk = db.prepare(
    "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, ?, ?)"
  );
  for (const g of initialGoldkeys) {
    insertGk.run(g.userId, g.quotaTotal, g.usedCount, g.remainingCount);
  }

  const insertReq = db.prepare(
    "INSERT INTO requests (id, user_id, leave_date, leave_type, status, requested_at, memo) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const r of initialRequests) {
    insertReq.run(r.id, r.userId, r.leaveDate, r.leaveType, r.status, r.requestedAt, r.memo ?? "");
  }
}

function ensureColumn(table, column, typeSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
}

function seedDefaultPasswords() {
  db.exec("UPDATE users SET password = COALESCE(password, '1234') WHERE password IS NULL OR password = ''");
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
