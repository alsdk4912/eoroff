import fs from "fs";
import path from "path";
import { createClient } from "@libsql/client";

let client;
/** initDb 이후 로컬일 때만 절대경로 (헬스·로그용) */
let resolvedDbPath = "";

function resolveLocalDbPath() {
  if (process.env.SQLITE_PATH) return path.resolve(process.env.SQLITE_PATH);
  return path.resolve(process.cwd(), "backend", "app.sqlite");
}

/** Turso / libSQL 원격 (환경변수 둘 다 있을 때) */
export function isUsingRemoteDb() {
  const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;
  return Boolean(url && token);
}

export function getResolvedDbPath() {
  if (isUsingRemoteDb()) {
    const raw = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_DATABASE_URL || "";
    try {
      const normalized = raw.replace(/^libsql:/i, "https:");
      const u = new URL(normalized);
      return `remote:${u.hostname}`;
    } catch {
      return "remote:libsql";
    }
  }
  return resolvedDbPath;
}

/**
 * Render 무료 + 로컬 파일 SQLite만 위험.
 * Turso(원격 libSQL)면 재배포해도 DB는 Turso 쪽에 남음.
 */
export function isLikelyEphemeralDeployRisk() {
  if (isUsingRemoteDb()) return false;
  return process.env.RENDER === "true" && !process.env.SQLITE_PATH;
}

const DDL = `
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
  leave_nature TEXT NOT NULL DEFAULT 'PERSONAL',
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
`;

export async function initDb() {
  if (isUsingRemoteDb()) {
    const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;
    client = createClient({ url, authToken });
  } else {
    const dbPath = resolveLocalDbPath();
    resolvedDbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fileUrl = path.isAbsolute(dbPath) ? `file:${dbPath}` : `file:${path.resolve(dbPath)}`;
    client = createClient({ url: fileUrl });
  }

  if (isLikelyEphemeralDeployRisk()) {
    console.warn(
      "[db] RENDER + 로컬 파일 + SQLITE_PATH 없음 → 재배포 시 SQLite가 초기화될 수 있습니다. 무료로 유지하려면 Turso(libSQL)를 쓰고 TURSO_DATABASE_URL·TURSO_AUTH_TOKEN을 설정하세요."
    );
  } else {
    console.log(
      `[db] ${isUsingRemoteDb() ? "libSQL 원격 (Turso 등)" : "SQLite 파일"}: ${getResolvedDbPath()}`
    );
  }

  if (!isUsingRemoteDb()) {
    await client.execute("PRAGMA journal_mode = WAL");
  }

  await client.executeMultiple(DDL.trim());

  await ensureRequestsLeaveNatureColumn();

  await seedDefaultsIfEmpty();
  await ensureGoldkeyDefaults();
  return client;
}

/** 기존 DB에 leave_nature 컬럼 추가 (Turso·로컬 공통) */
async function ensureRequestsLeaveNatureColumn() {
  const cols = await queryAll("PRAGMA table_info(requests)");
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("leave_nature")) {
    await execute("ALTER TABLE requests ADD COLUMN leave_nature TEXT NOT NULL DEFAULT 'PERSONAL'");
  }
}

async function seedDefaultsIfEmpty() {
  const row = await queryOne("SELECT COUNT(*) AS c FROM users");
  if (Number(row?.c || 0) > 0) return;

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

  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    await execute(
      "INSERT INTO users (id, name, employee_no, role, password) VALUES (?, ?, ?, ?, ?)",
      `u_nurse_${idx + 1}`,
      name,
      `N${String(idx + 1).padStart(4, "0")}`,
      "NURSE",
      "1234"
    );
  }
  for (let idx = 0; idx < admins.length; idx++) {
    const name = admins[idx];
    await execute(
      "INSERT INTO users (id, name, employee_no, role, password) VALUES (?, ?, ?, ?, ?)",
      `u_admin_${idx + 1}`,
      name,
      `A${String(idx + 1).padStart(4, "0")}`,
      "ADMIN",
      "1234"
    );
  }

  for (let idx = 0; idx < names.length; idx++) {
    await execute(
      "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, ?, ?)",
      `u_nurse_${idx + 1}`,
      10,
      0,
      10
    );
  }
}

async function ensureGoldkeyDefaults() {
  const nurses = await queryAll("SELECT id FROM users WHERE role = 'NURSE'");

  for (const nurse of nurses) {
    const row = await queryOne(
      "SELECT quota_total, used_count, remaining_count FROM goldkeys WHERE user_id = ?",
      nurse.id
    );
    if (!row) {
      await execute(
        "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, ?, ?)",
        nurse.id,
        10,
        0,
        10
      );
      continue;
    }

    const used = Number(row.used_count || 0);
    const quota = Number(row.quota_total || 0);
    if (quota !== 10) {
      const remaining = Math.max(0, 10 - used);
      await execute(
        "UPDATE goldkeys SET quota_total = 10, remaining_count = ? WHERE user_id = ?",
        remaining,
        nurse.id
      );
    }
  }
}

export async function queryAll(sql, ...params) {
  const r = await client.execute({ sql, args: params });
  return r.rows;
}

export async function queryOne(sql, ...params) {
  const rows = await queryAll(sql, ...params);
  return rows[0];
}

export async function execute(sql, ...params) {
  const r = await client.execute({ sql, args: params });
  return {
    changes: Number(r.rowsAffected ?? 0),
    lastInsertRowid: r.lastInsertRowid,
  };
}

/**
 * libSQL 트랜잭션 (로컬·Turso 공통: write → execute → commit / 오류 시 rollback)
 * @param {(tx: { execute: typeof execute }) => Promise<void>} fn
 */
export async function runTransaction(fn) {
  const tx = await client.transaction("write");
  try {
    const wrap = {
      execute: async (sql, ...args) => {
        const r = await tx.execute({ sql, args });
        return {
          changes: Number(r.rowsAffected ?? 0),
          lastInsertRowid: r.lastInsertRowid,
        };
      },
    };
    await fn(wrap);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}
