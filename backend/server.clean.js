import "dotenv/config";
import express from "express";
import cors from "cors";
import { execute, initDb, queryAll, queryOne, runTransaction } from "./db.clean.js";

const app = express();
app.use(cors());
app.use(express.json());

initDb();
// v1과 동시 실행 시 포트 분리(로컬 4015). Render 등은 PORT 환경변수 사용.
const PORT = Number(process.env.PORT) || 4015;
const HOST = process.env.HOST || "0.0.0.0";

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
  const { loginName, password } = req.body ?? {};
  const name = String(loginName ?? "").trim();
  if (!name) return res.status(400).json({ error: "이름을 입력해주세요." });

  if (/^[A-Za-z]?\d+$/.test(name)) {
    return res.status(400).json({ error: "사번 로그인은 비활성화되었습니다. 이름으로 로그인해주세요." });
  }

  const rows = queryAll(
    "SELECT id, name, employee_no, role FROM users WHERE REPLACE(name, ' ', '') = REPLACE(?, ' ', '') AND password = ?",
    name,
    password
  );
  if (rows.length === 0) return res.status(401).json({ error: "이름 또는 비밀번호가 올바르지 않습니다." });
  if (rows.length > 1) return res.status(409).json({ error: "동명이인이 있어 로그인할 수 없습니다." });
  return res.json({ ok: true, user: rows[0] });
});

app.post("/api/change-password", (req, res) => {
  const { userId, currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: "새 비밀번호는 4자 이상이어야 합니다." });
  }
  const user = queryOne("SELECT id FROM users WHERE id = ? AND password = ?", userId, currentPassword);
  if (!user) return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다." });
  execute("UPDATE users SET password = ? WHERE id = ?", newPassword, userId);
  return res.json({ ok: true });
});

app.get("/api/admin/users", (_, res) => {
  res.json({ users: queryAll("SELECT id, name, employee_no, role FROM users ORDER BY role DESC, name ASC") });
});

app.post("/api/admin/users/:id/reset-password", (req, res) => {
  const { adminUserId, nextPassword } = req.body ?? {};
  const admin = queryOne("SELECT id FROM users WHERE id = ? AND role = 'ADMIN'", adminUserId);
  if (!admin) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  execute("UPDATE users SET password = ? WHERE id = ?", nextPassword || "1234", req.params.id);
  res.json({ ok: true });
});

app.post("/api/requests", (req, res) => {
  try {
    const {
      id,
      userId,
      leaveDate,
      leaveType,
      status,
      requestedAt,
      memo = "",
    } = req.body ?? {};

    if (leaveType === "GOLDKEY") {
      const g = queryOne("SELECT remaining_count FROM goldkeys WHERE user_id = ?", userId);
      if (!g || Number(g.remaining_count) <= 0) {
        return res.status(400).json({ error: "잔여 골드키가 없습니다." });
      }
    }

    runTransaction(() => {
      execute(
        "INSERT INTO requests (id, user_id, leave_date, leave_type, status, requested_at, memo) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        userId,
        leaveDate,
        leaveType,
        status,
        requestedAt,
        memo
      );
      if (leaveType === "GOLDKEY") {
        const r = execute(
          "UPDATE goldkeys SET used_count = used_count + 1, remaining_count = remaining_count - 1 WHERE user_id = ? AND remaining_count > 0",
          userId
        );
        if (!r.changes) {
          throw new Error("골드키 잔여 차감에 실패했습니다.");
        }
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/requests", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/requests/:id/cancel", (req, res) => {
  try {
    const row = queryOne("SELECT id FROM requests WHERE id = ?", req.params.id);
    if (!row) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });

    runTransaction(() => {
      /* 골드키: 취소해도 잔여/사용 카운트는 되돌리지 않음(신청·사용은 누적) */
      execute("UPDATE requests SET status = 'CANCELLED' WHERE id = ?", req.params.id);
      execute(
        "INSERT INTO cancellations (id, leave_request_id, cancelled_by, cancel_reason, cancelled_at) VALUES (?, ?, ?, ?, ?)",
        req.body.cancellationId,
        req.params.id,
        req.body.cancelledBy,
        req.body.cancelReason,
        req.body.cancelledAt
      );
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/requests/:id/cancel", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/requests/:id/select", (req, res) => {
  execute("UPDATE requests SET status = 'APPROVED' WHERE id = ?", req.params.id);
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
  const nextQuota = Number(req.body.nextQuota);
  const remaining = Math.max(0, nextQuota - Number(row.used_count));
  execute("UPDATE goldkeys SET quota_total = ?, remaining_count = ? WHERE user_id = ?", nextQuota, remaining, req.params.userId);
  execute(
    "INSERT INTO logs (id, user_id, before_quota, after_quota, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
    req.body.logId,
    req.params.userId,
    Number(row.quota_total),
    nextQuota,
    req.body.changedBy,
    req.body.changedAt
  );
  res.json({ ok: true });
});

app.post("/api/holidays/sync", (_, res) => {
  res.json({ ok: true, count: 0 });
});

app.get("/api/admin/backup-sql", (_, res) => {
  res.setHeader("Content-Type", "application/sql; charset=utf-8");
  res.send("BEGIN;\nCOMMIT;\n");
});

app.post("/api/admin/restore-sql", (req, res) => {
  const sql = String(req.body?.sql ?? "");
  if (!sql.trim()) return res.status(400).json({ error: "sql is required" });
  res.json({ ok: true, restoredStatements: 0 });
});

app.listen(PORT, HOST, () => {
  console.log(`API server listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT} (clean)`);
  if (HOST === "0.0.0.0") {
    console.log("(LAN: http://<이 PC의 IP>:" + PORT + ")");
  }
});

