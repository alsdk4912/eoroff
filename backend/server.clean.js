import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  execute,
  initDb,
  isLikelyEphemeralDeployRisk,
  isUsingRemoteDb,
  queryAll,
  queryOne,
  resetLeaveDataToDefaults,
  runTransaction,
} from "./db.clean.js";

const app = express();
app.use(cors());
app.use(express.json());

// v1과 동시 실행 시 포트 분리(로컬 4015). Render 등은 PORT 환경변수 사용.
const PORT = Number(process.env.PORT) || 4015;
const HOST = process.env.HOST || "0.0.0.0";

async function upsertKoreanHolidaysFromPublicApi(year, monthOpt) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error("year 범위가 올바르지 않습니다.");

  const url = `https://date.nager.at/api/v3/PublicHolidays/${y}/KR`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`공휴일 API 오류: HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return 0;

  const m = monthOpt == null ? null : Number(monthOpt);
  const nowIso = new Date().toISOString();
  let count = 0;
  for (const h of rows) {
    const date = String(h?.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (m != null) {
      const mm = Number(date.slice(5, 7));
      if (mm !== m) continue;
    }
    const name = String(h?.localName ?? h?.name ?? "공휴일").trim() || "공휴일";
    await execute(
      "INSERT INTO holidays (holiday_date, holiday_name, is_holiday, synced_at) VALUES (?, ?, 1, ?) ON CONFLICT(holiday_date) DO UPDATE SET holiday_name = excluded.holiday_name, is_holiday = 1, synced_at = excluded.synced_at",
      date,
      name,
      nowIso
    );
    count += 1;
  }
  return count;
}

app.get("/api/health", (_, res) => {
  const ephemeral = isLikelyEphemeralDeployRisk();
  const remote = isUsingRemoteDb();
  res.json({
    ok: true,
    storage: remote ? "libsql-remote" : "sqlite-file",
    /** true면 코드 업데이트·재배포 시 로컬 DB 파일이 날아갈 수 있음 (신청 내역 유실) */
    dataLossRiskOnDeploy: ephemeral,
    remoteDb: remote,
    sqlitePathSet: Boolean(process.env.SQLITE_PATH),
    ...(ephemeral
      ? {
          hint: "무료 유지: Turso 무료 DB + Render에 TURSO_DATABASE_URL·TURSO_AUTH_TOKEN 설정. 또는 유료 Disk + SQLITE_PATH.",
        }
      : {}),
  });
});

app.get("/api/bootstrap", async (_, res) => {
  try {
    res.json({
      users: await queryAll("SELECT id, name, employee_no, role FROM users"),
      goldkeys: await queryAll("SELECT * FROM goldkeys"),
      requests: await queryAll("SELECT * FROM requests"),
      notes: await queryAll("SELECT * FROM notes"),
      cancellations: await queryAll("SELECT * FROM cancellations"),
      selections: await queryAll("SELECT * FROM selections"),
      logs: await queryAll("SELECT * FROM logs"),
      ladderResults: await queryAll("SELECT * FROM ladder_results ORDER BY created_at DESC"),
      holidayDuties: await queryAll("SELECT * FROM holiday_duties"),
      holidays: await queryAll("SELECT * FROM holidays"),
    });
  } catch (err) {
    console.error("GET /api/bootstrap", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/login", async (req, res) => {
  const { loginName, password } = req.body ?? {};
  const name = String(loginName ?? "").trim();
  if (!name) return res.status(400).json({ error: "이름을 입력해주세요." });

  if (/^[A-Za-z]?\d+$/.test(name)) {
    return res.status(400).json({ error: "사번 로그인은 비활성화되었습니다. 이름으로 로그인해주세요." });
  }

  const rows = await queryAll(
    "SELECT id, name, employee_no, role FROM users WHERE REPLACE(name, ' ', '') = REPLACE(?, ' ', '') AND password = ?",
    name,
    password
  );
  if (rows.length === 0) return res.status(401).json({ error: "이름 또는 비밀번호가 올바르지 않습니다." });
  if (rows.length > 1) return res.status(409).json({ error: "동명이인이 있어 로그인할 수 없습니다." });
  return res.json({ ok: true, user: rows[0] });
});

app.post("/api/change-password", async (req, res) => {
  const { userId, currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: "새 비밀번호는 4자 이상이어야 합니다." });
  }
  const user = await queryOne("SELECT id FROM users WHERE id = ? AND password = ?", userId, currentPassword);
  if (!user) return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다." });
  await execute("UPDATE users SET password = ? WHERE id = ?", newPassword, userId);
  return res.json({ ok: true });
});

app.get("/api/admin/users", async (_, res) => {
  res.json({
    users: await queryAll("SELECT id, name, employee_no, role FROM users ORDER BY role DESC, name ASC"),
  });
});

app.post("/api/admin/users/:id/reset-password", async (req, res) => {
  const { adminUserId, nextPassword } = req.body ?? {};
  const admin = await queryOne("SELECT id FROM users WHERE id = ? AND role = 'ADMIN'", adminUserId);
  if (!admin) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  await execute("UPDATE users SET password = ? WHERE id = ?", nextPassword || "1234", req.params.id);
  res.json({ ok: true });
});

app.post("/api/admin/reset-leave-data", async (req, res) => {
  const { adminUserId } = req.body ?? {};
  const admin = await queryOne("SELECT id FROM users WHERE id = ? AND role = 'ADMIN'", adminUserId);
  if (!admin) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  try {
    await resetLeaveDataToDefaults();
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/reset-leave-data", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * DB 모드 일괄 초기화(관리자 로그인 불필요).
 * Render 등에 DATA_RESET_SECRET(8자 이상) 설정 후:
 * curl -sS -X POST "$API/api/admin/reset-leave-data-by-secret" -H "Authorization: Bearer $DATA_RESET_SECRET"
 */
app.post("/api/admin/reset-leave-data-by-secret", async (req, res) => {
  const secret = String(process.env.DATA_RESET_SECRET ?? "").trim();
  if (!secret || secret.length < 8) {
    return res.status(503).json({ error: "DATA_RESET_SECRET이 서버에 설정되지 않았습니다." });
  }
  const auth = String(req.headers.authorization ?? "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (token !== secret) {
    return res.status(403).json({ error: "인증에 실패했습니다." });
  }
  try {
    await resetLeaveDataToDefaults();
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/reset-leave-data-by-secret", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** 공휴일 당직자(수술실 간호사 2명 + 마취과 간호사 1명) 저장/수정 */
app.post("/api/admin/holiday-duties", async (req, res) => {
  try {
    const { actorUserId, holidayDate, nurse1UserId, nurse2UserId, anesthesiaUserId } = req.body ?? {};

    const actor = await queryOne(
      "SELECT id, role FROM users WHERE id = ? AND role IN ('ADMIN', 'NURSE', 'ANESTHESIA')",
      actorUserId
    );
    if (!actor) return res.status(403).json({ error: "권한이 없습니다." });

    const hd = String(holidayDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hd)) return res.status(400).json({ error: "holidayDate 형식이 올바르지 않습니다." });

    const n1 = String(nurse1UserId ?? "").trim();
    const n2 = String(nurse2UserId ?? "").trim();
    const a1 = String(anesthesiaUserId ?? "").trim();
    if (!n1 || !n2 || !a1) return res.status(400).json({ error: "수술실 2명 + 마취과 1명을 선택하세요." });
    if (n1 === n2) return res.status(400).json({ error: "당직자는 서로 다른 간호사 2명을 선택해야 합니다." });
    if (a1 === n1 || a1 === n2) return res.status(400).json({ error: "마취과 당직자는 수술실 당직자와 달라야 합니다." });

    const nurses = await queryAll(
      "SELECT id FROM users WHERE id IN (?, ?) AND role = 'NURSE'",
      n1,
      n2
    );
    if (nurses.length !== 2) return res.status(400).json({ error: "선택한 당직자 값이 유효하지 않습니다." });
    const anesthesia = await queryOne("SELECT id FROM users WHERE id = ? AND role = 'ANESTHESIA'", a1);
    if (!anesthesia) return res.status(400).json({ error: "마취과 당직자 값이 유효하지 않습니다." });

    // 공휴일 또는 주말(토/일) 날짜에만 기록 가능
    const day = new Date(`${hd}T00:00:00`).getDay();
    const isWeekend = day === 0 || day === 6;
    const holidayRow = await queryOne("SELECT holiday_date FROM holidays WHERE holiday_date = ? AND is_holiday = 1", hd);
    if (!holidayRow && !isWeekend) return res.status(400).json({ error: "해당 날짜가 공휴일/주말이 아닙니다." });

    await execute(
      "INSERT INTO holiday_duties (holiday_date, nurse1_user_id, nurse2_user_id, anesthesia_user_id) VALUES (?, ?, ?, ?) ON CONFLICT(holiday_date) DO UPDATE SET nurse1_user_id = excluded.nurse1_user_id, nurse2_user_id = excluded.nurse2_user_id, anesthesia_user_id = excluded.anesthesia_user_id",
      hd,
      n1,
      n2,
      a1
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/holiday-duties", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/ladder-results", async (req, res) => {
  try {
    const {
      id,
      leaveDate,
      leaveType,
      participants,
      order,
      createdBy,
      createdAt,
    } = req.body ?? {};

    const actor = await queryOne("SELECT id FROM users WHERE id = ?", createdBy);
    if (!actor) return res.status(403).json({ error: "사용자 정보가 올바르지 않습니다." });

    const ld = String(leaveDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ld)) return res.status(400).json({ error: "leaveDate 형식이 올바르지 않습니다." });

    const lt = String(leaveType ?? "").trim();
    if (!lt) return res.status(400).json({ error: "leaveType이 필요합니다." });

    const pArr = Array.isArray(participants) ? participants : [];
    const oArr = Array.isArray(order) ? order : [];
    if (pArr.length < 2 || oArr.length < 2) {
      return res.status(400).json({ error: "참여자/결과는 2명 이상이어야 합니다." });
    }

    await execute(
      "INSERT INTO ladder_results (id, leave_date, leave_type, participants_json, order_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      String(id ?? `lrg_${Date.now()}`),
      ld,
      lt,
      JSON.stringify(pArr),
      JSON.stringify(oArr),
      String(createdBy),
      String(createdAt ?? new Date().toISOString())
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/ladder-results", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

const ALLOWED_LEAVE_TYPES = new Set(["GOLDKEY", "GENERAL_PRIORITY", "GENERAL_NORMAL", "HALF_DAY"]);
const ALLOWED_LEAVE_NATURE = new Set(["PERSONAL", "PAID_TRAINING", "REQUIRED_TRAINING"]);

app.post("/api/requests", async (req, res) => {
  try {
    const {
      id,
      userId,
      leaveDate,
      leaveType,
      status,
      requestedAt,
      memo = "",
      leaveNature: leaveNatureRaw,
      leave_nature,
    } = req.body ?? {};

    const leaveNature = String(leaveNatureRaw ?? leave_nature ?? "PERSONAL").trim();
    const user = await queryOne("SELECT id, role FROM users WHERE id = ?", userId);
    if (!user) return res.status(400).json({ error: "사용자 정보가 올바르지 않습니다." });
    if (user.role !== "NURSE") {
      return res.status(403).json({ error: "마취과 간호사는 휴가 신청을 할 수 없습니다." });
    }
    if (!ALLOWED_LEAVE_TYPES.has(leaveType)) {
      return res.status(400).json({ error: "지원하지 않는 휴가 종류입니다." });
    }
    if (!ALLOWED_LEAVE_NATURE.has(leaveNature)) {
      return res.status(400).json({ error: "휴가 성격을 선택하세요." });
    }

    const duplicate = await queryOne(
      `SELECT id FROM requests
       WHERE user_id = ? AND leave_date = ?
         AND status NOT IN ('CANCELLED', 'REJECTED')
       LIMIT 1`,
      userId,
      leaveDate
    );
    if (duplicate) {
      return res.status(400).json({ error: "같은 날짜에는 휴가를 중복 신청할 수 없습니다." });
    }

    if (leaveType === "GOLDKEY") {
      const g = await queryOne("SELECT remaining_count FROM goldkeys WHERE user_id = ?", userId);
      if (!g || Number(g.remaining_count) <= 0) {
        return res.status(400).json({ error: "잔여 골드키가 없습니다." });
      }
    }

    await runTransaction(async (tx) => {
      await tx.execute(
        "INSERT INTO requests (id, user_id, leave_date, leave_type, leave_nature, status, requested_at, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        userId,
        leaveDate,
        leaveType,
        leaveNature,
        status,
        requestedAt,
        memo
      );
      if (leaveType === "GOLDKEY") {
        const r = await tx.execute(
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

/** 같은 날·같은 유형 다인 협의 후 순번(1~999), 비우면 NULL — POST·PATCH 둘 다 지원(Render·프록시에서 PATCH 미전달 대비) */
async function handleNegotiationOrder(req, res) {
  try {
    const requestId = decodeURIComponent(String(req.params.id ?? ""));
    const row = await queryOne("SELECT id FROM requests WHERE id = ?", requestId);
    if (!row) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });

    const raw = req.body?.negotiationOrder ?? req.body?.negotiation_order;
    if (raw === null || raw === undefined || raw === "") {
      await execute("UPDATE requests SET negotiation_order = NULL WHERE id = ?", requestId);
      return res.json({ ok: true, negotiationOrder: null });
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      return res.status(400).json({ error: "협의 순번은 1~999 정수이거나 비워야 합니다." });
    }
    await execute("UPDATE requests SET negotiation_order = ? WHERE id = ?", n, requestId);
    return res.json({ ok: true, negotiationOrder: n });
  } catch (err) {
    console.error("negotiation-order", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
}
app.patch("/api/requests/:id/negotiation-order", handleNegotiationOrder);
app.post("/api/requests/:id/negotiation-order", handleNegotiationOrder);

app.post("/api/requests/:id/cancel", async (req, res) => {
  try {
    const row = await queryOne("SELECT id FROM requests WHERE id = ?", req.params.id);
    if (!row) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });

    await runTransaction(async (tx) => {
      /* 골드키: 취소해도 잔여/사용 카운트는 되돌리지 않음(신청·사용은 누적) */
      await tx.execute("UPDATE requests SET status = 'CANCELLED' WHERE id = ?", req.params.id);
      await tx.execute(
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

app.post("/api/requests/:id/select", async (req, res) => {
  await execute("UPDATE requests SET status = 'APPROVED' WHERE id = ?", req.params.id);
  await execute(
    "INSERT INTO selections (id, leave_request_id, selected_by, selected_at) VALUES (?, ?, ?, ?)",
    req.body.selectionId,
    req.params.id,
    req.body.selectedBy,
    req.body.selectedAt
  );
  res.json({ ok: true });
});

app.post("/api/requests/:id/reject", async (req, res) => {
  await execute("UPDATE requests SET status = 'REJECTED' WHERE id = ?", req.params.id);
  res.json({ ok: true });
});

app.post("/api/notes", async (req, res) => {
  await execute(
    "INSERT INTO notes (id, leave_request_id, content, agreed_order) VALUES (?, ?, ?, ?)",
    req.body.id,
    req.body.leaveRequestId,
    req.body.content,
    req.body.agreedOrder
  );
  res.json({ ok: true });
});

app.patch("/api/goldkeys/:userId", async (req, res) => {
  const row = await queryOne("SELECT * FROM goldkeys WHERE user_id = ?", req.params.userId);
  if (!row) return res.status(404).json({ error: "not found" });
  const nextQuota = Number(req.body.nextQuota);
  const remaining = Math.max(0, nextQuota - Number(row.used_count));
  await execute("UPDATE goldkeys SET quota_total = ?, remaining_count = ? WHERE user_id = ?", nextQuota, remaining, req.params.userId);
  await execute(
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

/** 관리자/간호사: 골드키 사용수(used_count) 수동 보정 */
app.post("/api/admin/goldkeys/usage-bulk", async (req, res) => {
  try {
    const { actorUserId, usages } = req.body ?? {};
    const actor = await queryOne(
      "SELECT id FROM users WHERE id = ? AND role IN ('ADMIN', 'NURSE')",
      actorUserId
    );
    if (!actor) return res.status(403).json({ error: "권한이 없습니다." });

    const rows = Array.isArray(usages) ? usages : [];
    let count = 0;
    for (const it of rows) {
      const userId = String(it?.userId ?? "").trim();
      const used = Number(it?.usedCount);
      if (!userId || !Number.isInteger(used) || used < 0) continue;
      const g = await queryOne("SELECT quota_total FROM goldkeys WHERE user_id = ?", userId);
      if (!g) continue;
      const quota = Number(g.quota_total || 0);
      const remaining = Math.max(0, quota - used);
      await execute(
        "UPDATE goldkeys SET used_count = ?, remaining_count = ? WHERE user_id = ?",
        used,
        remaining,
        userId
      );
      count += 1;
    }
    return res.json({ ok: true, count });
  } catch (err) {
    console.error("POST /api/admin/goldkeys/usage-bulk", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/holidays/sync", async (req, res) => {
  try {
    const year = Number(req.body?.year || new Date().getFullYear());
    const monthRaw = String(req.body?.month ?? "").trim();
    const month = monthRaw ? Number(monthRaw) : null;
    const count = await upsertKoreanHolidaysFromPublicApi(year, month);
    res.json({ ok: true, count, source: "nager-public-holidays" });
  } catch (err) {
    console.error("POST /api/holidays/sync", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** 공휴일/대체공휴일 수동 반영 (ADMIN/NURSE) */
app.post("/api/admin/holidays/upsert", async (req, res) => {
  try {
    const { actorUserId, holidays } = req.body ?? {};
    const actor = await queryOne(
      "SELECT id FROM users WHERE id = ? AND role IN ('ADMIN', 'NURSE')",
      actorUserId
    );
    if (!actor) return res.status(403).json({ error: "권한이 없습니다." });

    const list = Array.isArray(holidays) ? holidays : [];
    let count = 0;
    const nowIso = new Date().toISOString();
    for (const h of list) {
      const date = String(h?.holidayDate ?? "").trim();
      const name = String(h?.holidayName ?? "공휴일").trim() || "공휴일";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      await execute(
        "INSERT INTO holidays (holiday_date, holiday_name, is_holiday, synced_at) VALUES (?, ?, 1, ?) ON CONFLICT(holiday_date) DO UPDATE SET holiday_name = excluded.holiday_name, is_holiday = 1, synced_at = excluded.synced_at",
        date,
        name,
        nowIso
      );
      count += 1;
    }
    return res.json({ ok: true, count });
  } catch (err) {
    console.error("POST /api/admin/holidays/upsert", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
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

async function main() {
  await initDb();
  app.listen(PORT, HOST, () => {
    console.log(`API server listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT} (clean)`);
    if (HOST === "0.0.0.0") {
      console.log("(LAN: http://<이 PC의 IP>:" + PORT + ")");
    }
  });
}

main().catch((err) => {
  console.error("[server] init failed", err);
  process.exit(1);
});
