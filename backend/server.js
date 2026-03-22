import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { execute, initDb, queryAll, queryOne } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

initDb();
const PORT = process.env.PORT || 4000;

app.get("/api/health", (_, res) => res.json({ ok: true, storage: "sqlite" }));

app.get("/api/bootstrap", (_, res) => {
  res.json({
    users: queryAll("SELECT id, name, employee_no, role FROM users"),
    goldkeys: queryAll("SELECT * FROM goldkeys"),
    requests: queryAll("SELECT * FROM requests"),
    notes: queryAll("SELECT * FROM notes"),
    cancellations: queryAll("SELECT * FROM cancellations"),
    selections: queryAll("SELECT * FROM selections"),
    logs: queryAll("SELECT * FROM logs"),
    holidays: queryAll("SELECT * FROM holidays"),
  });
});

app.post("/api/login", (req, res) => {
  const { loginName, password } = req.body;
  const name = String(loginName ?? "").trim();
  if (!name) return res.status(400).json({ error: "이름을 입력해주세요." });

  // 사번 패턴(영문+숫자)으로 입력하면 로그인 막기
  if (/^[A-Za-z]?\d+$/.test(name)) {
    return res.status(400).json({ error: "사번 로그인은 비활성화되었습니다. 이름으로 로그인해주세요." });
  }

  const rows = queryAll(
    "SELECT id, name, employee_no, role FROM users WHERE name = ? AND password = ?",
    name,
    password
  );

  if (rows.length === 0) return res.status(401).json({ error: "이름 또는 비밀번호가 올바르지 않습니다." });
  if (rows.length > 1) return res.status(409).json({ error: "동명이인이 있어 로그인할 수 없습니다." });
  res.json({ ok: true, user: rows[0] });
});

app.post("/api/change-password", (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ error: "새 비밀번호는 4자 이상이어야 합니다." });

  const user = queryOne("SELECT id FROM users WHERE id = ? AND password = ?", userId, currentPassword);
  if (!user) return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다." });

  execute("UPDATE users SET password = ? WHERE id = ?", newPassword, userId);
  res.json({ ok: true });
});

app.get("/api/admin/users", (_, res) => {
  res.json({
    users: queryAll("SELECT id, name, employee_no, role FROM users ORDER BY role DESC, name ASC"),
  });
});

app.post("/api/admin/users/:id/reset-password", (req, res) => {
  const { adminUserId, nextPassword } = req.body;
  const admin = queryOne("SELECT id FROM users WHERE id = ? AND role = 'ADMIN'", adminUserId);
  if (!admin) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  execute("UPDATE users SET password = COALESCE(?, '1234') WHERE id = ?", nextPassword ?? "1234", req.params.id);
  res.json({ ok: true });
});

app.post("/api/requests", (req, res) => {
  execute(
    "INSERT INTO requests (id, user_id, leave_date, leave_type, status, requested_at, memo) VALUES (?, ?, ?, ?, ?, ?, ?)",
    req.body.id,
    req.body.userId,
    req.body.leaveDate,
    req.body.leaveType,
    req.body.status,
    req.body.requestedAt,
    req.body.memo ?? ""
  );
  res.json({ ok: true });
});

app.post("/api/requests/:id/cancel", (req, res) => {
  execute("UPDATE requests SET status = 'CANCELLED' WHERE id = ?", req.params.id);
  execute(
    "INSERT INTO cancellations (id, leave_request_id, cancelled_by, cancel_reason, cancelled_at) VALUES (?, ?, ?, ?, ?)",
    req.body.cancellationId,
    req.params.id,
    req.body.cancelledBy,
    req.body.cancelReason,
    req.body.cancelledAt
  );
  res.json({ ok: true });
});

app.post("/api/requests/:id/select", (req, res) => {
  execute("UPDATE requests SET status = 'SELECTED' WHERE id = ?", req.params.id);
  execute(
    "INSERT INTO selections (id, leave_request_id, selected_by, selected_at) VALUES (?, ?, ?, ?)",
    req.body.selectionId,
    req.params.id,
    req.body.selectedBy,
    req.body.selectedAt
  );
  res.json({ ok: true });
});

app.post("/api/requests/:id/reject", (req, res) => {
  execute("UPDATE requests SET status = 'REJECTED' WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

app.post("/api/notes", (req, res) => {
  execute(
    "INSERT INTO notes (id, leave_request_id, content, agreed_order) VALUES (?, ?, ?, ?)",
    req.body.id,
    req.body.leaveRequestId,
    req.body.content,
    req.body.agreedOrder
  );
  res.json({ ok: true });
});

app.patch("/api/goldkeys/:userId", (req, res) => {
  const row = queryOne("SELECT * FROM goldkeys WHERE user_id = ?", req.params.userId);
  if (!row) return res.status(404).json({ error: "not found" });

  const before = row.quota_total;
  const quota = Number(req.body.nextQuota);
  const remaining = Math.max(0, quota - row.used_count);

  execute("UPDATE goldkeys SET quota_total = ?, remaining_count = ? WHERE user_id = ?", quota, remaining, req.params.userId);
  execute(
    "INSERT INTO logs (id, user_id, before_quota, after_quota, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
    req.body.logId,
    req.params.userId,
    before,
    quota,
    req.body.changedBy,
    req.body.changedAt
  );
  res.json({ ok: true });
});

app.post("/api/holidays/sync", async (req, res) => {
  const count = await syncHolidays(req.body.serviceKey, req.body.year, req.body.month);
  res.json({ ok: true, count });
});

app.get("/api/admin/backup-sql", (_, res) => {
  const sql = generateBackupSql();
  res.setHeader("Content-Type", "application/sql; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sql"`
  );
  res.send(sql);
});

app.post("/api/admin/restore-sql", (req, res) => {
  const sql = String(req.body.sql ?? "");
  if (!sql.trim()) return res.status(400).json({ error: "sql is required" });
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s};`);
  for (const stmt of statements) execute(stmt);
  res.json({ ok: true, restoredStatements: statements.length });
});

cron.schedule("0 3 * * *", async () => {
  const key = process.env.KASI_SERVICE_KEY;
  if (!key) return;
  const now = new Date();
  await syncHolidays(key, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
});

async function syncHolidays(serviceKey, year, month) {
  if (!serviceKey) return 0;
  const url = new URL("https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("solYear", year);
  url.searchParams.set("solMonth", month);
  url.searchParams.set("_type", "json");

  const response = await fetch(url.toString());
  if (!response.ok) return 0;
  const json = await response.json();
  const items = json?.response?.body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];

  for (const it of list) {
    execute(
      "INSERT INTO holidays (holiday_date, holiday_name, is_holiday, synced_at) VALUES (?, ?, ?, ?) ON CONFLICT(holiday_date) DO UPDATE SET holiday_name=excluded.holiday_name, is_holiday=excluded.is_holiday, synced_at=excluded.synced_at",
      toIsoDate(it.locdate),
      String(it.dateName ?? "공휴일"),
      String(it.isHoliday) === "Y" ? 1 : 0,
      new Date().toISOString()
    );
  }
  return list.length;
}

function toIsoDate(locdate) {
  const s = String(locdate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function generateBackupSql() {
  const tables = ["users", "goldkeys", "requests", "notes", "cancellations", "selections", "logs", "holidays"];
  let out = "BEGIN;\n\n";
  for (const table of tables) {
    const rows = queryAll(`SELECT * FROM ${table}`);
    out += `DELETE FROM ${table};\n`;
    for (const row of rows) {
      const cols = Object.keys(row);
      const values = cols.map((c) => toSqlValue(row[c])).join(", ");
      out += `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${values});\n`;
    }
    out += "\n";
  }
  out += "COMMIT;\n";
  return out;
}

function toSqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replaceAll("'", "''")}'`;
}

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});

import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { execute, initDb, queryAll, queryOne } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

initDb();
const PORT = process.env.PORT || 4000;

app.get("/api/health", (_, res) => res.json({ ok: true, storage: "sqlite" }));

app.get("/api/bootstrap", (_, res) => {
  res.json({
    users: queryAll("SELECT id, name, employee_no, role FROM users"),
    goldkeys: queryAll("SELECT * FROM goldkeys"),
    requests: queryAll("SELECT * FROM requests"),
    notes: queryAll("SELECT * FROM notes"),
    cancellations: queryAll("SELECT * FROM cancellations"),
    selections: queryAll("SELECT * FROM selections"),
    logs: queryAll("SELECT * FROM logs"),
    holidays: queryAll("SELECT * FROM holidays"),
  });
});

app.post("/api/login", (req, res) => {
  const { loginName, loginId, employeeNo, password } = req.body;
  const name = String(loginName ?? loginId ?? employeeNo ?? "").trim();
  if (!name) {
    return res.status(400).json({ error: "이름을 입력해주세요." });
  }

  // Force name-based login only.
  if (/^[A-Za-z]?\d+$/.test(name)) {
    return res.status(400).json({ error: "사번 로그인은 비활성화되었습니다. 이름으로 로그인해주세요." });
  }

  const rows = queryAll(
    "SELECT id, name, employee_no, role FROM users WHERE REPLACE(name, ' ', '') = REPLACE(?, ' ', '') AND password = ?",
    name,
    password
  );
  if (rows.length === 0) {
    return res.status(401).json({ error: "이름 또는 비밀번호가 올바르지 않습니다." });
  }
  if (rows.length > 1) {
    return res.status(409).json({ error: "동명이인이 있어 로그인할 수 없습니다. 관리자에게 문의해주세요." });
  }
  res.json({ ok: true, user: rows[0] });
});

app.post("/api/change-password", (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: "새 비밀번호는 4자 이상이어야 합니다." });
  }
  const user = queryOne("SELECT id FROM users WHERE id = ? AND password = ?", userId, currentPassword);
  if (!user) return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다." });
  execute("UPDATE users SET password = ? WHERE id = ?", newPassword, userId);
  res.json({ ok: true });
});

app.get("/api/admin/users", (_, res) => {
  res.json({ users: queryAll("SELECT id, name, employee_no, role FROM users ORDER BY role DESC, name ASC") });
});

app.post("/api/admin/users/:id/reset-password", (req, res) => {
  const { adminUserId, nextPassword } = req.body;
  const admin = queryOne("SELECT id FROM users WHERE id = ? AND role = 'ADMIN'", adminUserId);
  if (!admin) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  execute("UPDATE users SET password = ? WHERE id = ?", nextPassword || "1234", req.params.id);
  res.json({ ok: true });
});

app.post("/api/requests", (req, res) => {
  execute(
    "INSERT INTO requests (id, user_id, leave_date, leave_type, status, requested_at, memo) VALUES (?, ?, ?, ?, ?, ?, ?)",
    req.body.id,
    req.body.userId,
    req.body.leaveDate,
    req.body.leaveType,
    req.body.status,
    req.body.requestedAt,
    req.body.memo ?? ""
  );
  res.json({ ok: true });
});

app.post("/api/requests/:id/cancel", (req, res) => {
  execute("UPDATE requests SET status = 'CANCELLED' WHERE id = ?", req.params.id);
  execute(
    "INSERT INTO cancellations (id, leave_request_id, cancelled_by, cancel_reason, cancelled_at) VALUES (?, ?, ?, ?, ?)",
    req.body.cancellationId,
    req.params.id,
    req.body.cancelledBy,
    req.body.cancelReason,
    req.body.cancelledAt
  );
  res.json({ ok: true });
});

app.post("/api/requests/:id/select", (req, res) => {
  execute("UPDATE requests SET status = 'SELECTED' WHERE id = ?", req.params.id);
  execute(
    "INSERT INTO selections (id, leave_request_id, selected_by, selected_at) VALUES (?, ?, ?, ?)",
    req.body.selectionId,
    req.params.id,
    req.body.selectedBy,
    req.body.selectedAt
  );
  res.json({ ok: true });
});

app.post("/api/requests/:id/reject", (req, res) => {
  execute("UPDATE requests SET status = 'REJECTED' WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

app.post("/api/notes", (req, res) => {
  execute(
    "INSERT INTO notes (id, leave_request_id, content, agreed_order) VALUES (?, ?, ?, ?)",
    req.body.id,
    req.body.leaveRequestId,
    req.body.content,
    req.body.agreedOrder
  );
  res.json({ ok: true });
});

app.patch("/api/goldkeys/:userId", (req, res) => {
  const row = queryOne("SELECT * FROM goldkeys WHERE user_id = ?", req.params.userId);
  if (!row) return res.status(404).json({ error: "not found" });
  const remaining = Math.max(0, Number(req.body.nextQuota) - Number(row.used_count));
  execute(
    "UPDATE goldkeys SET quota_total = ?, remaining_count = ? WHERE user_id = ?",
    req.body.nextQuota,
    remaining,
    req.params.userId
  );
  execute(
    "INSERT INTO logs (id, user_id, before_quota, after_quota, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
    req.body.logId,
    req.params.userId,
    row.quota_total,
    req.body.nextQuota,
    req.body.changedBy,
    req.body.changedAt
  );
  res.json({ ok: true });
});

app.post("/api/holidays/sync", async (req, res) => {
  const count = await syncHolidays(req.body.serviceKey, req.body.year, req.body.month);
  res.json({ ok: true, count });
});

app.get("/api/admin/backup-sql", (_, res) => {
  const sql = generateBackupSql();
  res.setHeader("Content-Type", "application/sql; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sql"`
  );
  res.send(sql);
});

app.post("/api/admin/restore-sql", (req, res) => {
  const sql = String(req.body.sql ?? "");
  if (!sql.trim()) return res.status(400).json({ error: "sql is required" });
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s};`);
  for (const stmt of statements) execute(stmt);
  res.json({ ok: true, restoredStatements: statements.length });
});

cron.schedule("0 3 * * *", async () => {
  const key = process.env.KASI_SERVICE_KEY;
  if (!key) return;
  const now = new Date();
  await syncHolidays(key, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
});

async function syncHolidays(serviceKey, year, month) {
  if (!serviceKey) return 0;
  const url = new URL("https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo");
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("solYear", year);
  url.searchParams.set("solMonth", month);
  url.searchParams.set("_type", "json");

  const response = await fetch(url.toString());
  if (!response.ok) return 0;
  const json = await response.json();
  const items = json?.response?.body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];

  for (const it of list) {
    execute(
      "INSERT INTO holidays (holiday_date, holiday_name, is_holiday, synced_at) VALUES (?, ?, ?, ?) ON CONFLICT(holiday_date) DO UPDATE SET holiday_name=excluded.holiday_name, is_holiday=excluded.is_holiday, synced_at=excluded.synced_at",
      toIsoDate(it.locdate),
      String(it.dateName ?? "공휴일"),
      String(it.isHoliday) === "Y" ? 1 : 0,
      new Date().toISOString()
    );
  }
  return list.length;
}

function toIsoDate(locdate) {
  const s = String(locdate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT} (SQLite)`);
});

function generateBackupSql() {
  const tables = ["users", "goldkeys", "requests", "notes", "cancellations", "selections", "logs", "holidays"];
  let out = "BEGIN;\n\n";
  for (const table of tables) {
    const rows = queryAll(`SELECT * FROM ${table}`);
    out += `DELETE FROM ${table};\n`;
    for (const row of rows) {
      const cols = Object.keys(row);
      const values = cols.map((c) => toSqlValue(row[c])).join(", ");
      out += `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${values});\n`;
    }
    out += "\n";
  }
  out += "COMMIT;\n";
  return out;
}

function toSqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replaceAll("'", "''")}'`;
}
