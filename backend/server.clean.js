import "dotenv/config";
import express from "express";
import cors from "cors";
import webpush from "web-push";
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

const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:admin@example.com").trim();
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("[push] VAPID 키가 없어 Web Push 발송은 비활성화됩니다.");
}

function toKstParts(dateLike) {
  const raw = String(dateLike ?? "").trim();
  const korean = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (korean) {
    return {
      year: Number(korean[1]),
      month: Number(korean[2]),
      day: Number(korean[3]),
    };
  }
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  if (!year || !month || !day) return null;
  return {
    year,
    month,
    day,
  };
}

function toYmdPartsLoose(dateLike) {
  const direct = toKstParts(dateLike);
  if (direct) return direct;
  const raw = String(dateLike ?? "").trim();
  const m = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(raw);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function isKstAprilFirstToTenth(dateLike) {
  const p = toYmdPartsLoose(dateLike);
  return Boolean(p && p.month === 4 && p.day >= 1 && p.day <= 10);
}

function parseYmdParts(ymd) {
  const s = String(ymd ?? "").trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function isLongTermGoldkeyDeductionExempt(row, cancelledAt) {
  if (String(row?.leave_type ?? "") !== "GOLDKEY") return false;
  const leave = parseYmdParts(row?.leave_date);
  const requested = toYmdPartsLoose(row?.requested_at);
  const cancelled = toYmdPartsLoose(cancelledAt);
  if (!leave || !requested || !cancelled) return false;
  if (leave.year !== cancelled.year) return false;
  if (leave.month < 7 || leave.month > 12) return false;
  return isKstAprilFirstToTenth(row.requested_at) && isKstAprilFirstToTenth(cancelledAt);
}

function isSpecialLongTermGoldkeyRequest(row) {
  if (String(row?.leave_type ?? "") !== "GOLDKEY") return false;
  const leave = parseYmdParts(row?.leave_date);
  const requested = toYmdPartsLoose(row?.requested_at);
  if (!leave || !requested) return false;
  if (leave.year !== requested.year) return false;
  if (leave.month < 7 || leave.month > 12) return false;
  return requested.month === 4 && requested.day >= 1 && requested.day <= 10;
}

function isAfterRecruitWindowKst(nowLike, year) {
  const now = toYmdPartsLoose(nowLike);
  if (!now) return false;
  if (now.year > year) return true;
  if (now.year < year) return false;
  if (now.month > 4) return true;
  if (now.month < 4) return false;
  return now.day >= 11;
}

function leaveTypeLabel(leaveType) {
  if (leaveType === "GOLDKEY") return "골드키";
  if (leaveType === "GENERAL_PRIORITY") return "일반휴가-우선순위";
  if (leaveType === "GENERAL_NORMAL") return "일반휴가-후순위";
  if (leaveType === "HALF_DAY") return "반차";
  return String(leaveType ?? "");
}

/** 소프트 삭제되지 않은 휴가 요청만 대상으로 하는 SQL 조각 (쿼리 문자열에 직접 삽입) */
const SQL_REQ_ACTIVE = "deleted_at IS NULL";

function getIdempotencyKey(req) {
  const h = String(req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"] ?? "").trim();
  if (h) return h;
  return String(req.body?.idempotencyKey ?? "").trim();
}

async function auditRowByIdempotencyKey(key) {
  if (!key) return null;
  return await queryOne("SELECT id, leave_request_id, action FROM leave_request_audit WHERE idempotency_key = ?", key);
}

function newAuditId() {
  return `lra_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function csvEscapeCell(v) {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 상태 변경과 같은 트랜잭션에서 호출. idempotency_key UNIQUE로 재시도 시 선행 완료 행만 조회해 재생 응답.
 */
async function insertLeaveRequestAuditRow(tx, row) {
  const id = row.id || newAuditId();
  const nowIso = row.createdAt || new Date().toISOString();
  await tx.execute(
    `INSERT INTO leave_request_audit (id, leave_request_id, action, from_status, to_status, actor_user_id, reason, idempotency_key, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    row.leaveRequestId,
    row.action,
    row.fromStatus ?? null,
    row.toStatus,
    row.actorUserId,
    row.reason ?? null,
    row.idempotencyKey ?? null,
    row.metadataJson != null ? JSON.stringify(row.metadataJson) : null,
    nowIso
  );
  return id;
}

async function requireAdminUser(actorUserId) {
  const uid = String(actorUserId ?? "").trim();
  if (!uid) return null;
  return await queryOne("SELECT id FROM users WHERE id = ? AND role = 'ADMIN'", uid);
}

async function createNotificationsForAllNurses({ type, message, targetDate = "", leaveRequestId = "" }) {
  const msg = String(message ?? "").trim();
  if (!msg) return;
  const nurses = await queryAll("SELECT id FROM users WHERE role = 'NURSE'");
  if (!Array.isArray(nurses) || nurses.length === 0) return;
  const nowIso = new Date().toISOString();
  let i = 0;
  for (const n of nurses) {
    const uid = String(n.id ?? "").trim();
    if (!uid) continue;
    await execute(
      "INSERT INTO notifications (id, user_id, type, message, target_date, leave_request_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
      `ntf_${Date.now()}_${i++}_${Math.random().toString(36).slice(2, 7)}`,
      uid,
      String(type ?? "INFO"),
      msg,
      String(targetDate ?? ""),
      String(leaveRequestId ?? ""),
      nowIso
    );
  }
}

async function sendPushToAllNurses({ title, body, url = "#/calendar" }) {
  if (!PUSH_ENABLED) return;
  const rows = await queryAll(
    `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE u.role = 'NURSE'`
  );
  const payload = JSON.stringify({
    title: String(title || "EOR 알림"),
    body: String(body || ""),
    url: String(url || "#/calendar"),
  });
  for (const r of rows) {
    const sub = {
      endpoint: String(r.endpoint || ""),
      keys: {
        p256dh: String(r.p256dh || ""),
        auth: String(r.auth || ""),
      },
    };
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      const statusCode = Number(err?.statusCode || 0);
      console.error("[push] send failure", statusCode || "-", String(err?.message || err));
      if (statusCode === 404 || statusCode === 410) {
        await execute("DELETE FROM push_subscriptions WHERE id = ?", r.id);
      }
    }
  }
}

async function reconcileGoldkeyUsageByPolicy(nowLike = new Date().toISOString()) {
  const reqRows = await queryAll(
    `SELECT user_id, leave_type, leave_date, requested_at, status FROM requests WHERE leave_type = 'GOLDKEY' AND ${SQL_REQ_ACTIVE}`
  );
  const goldkeyRows = await queryAll("SELECT user_id, quota_total FROM goldkeys");
  const usedByUser = new Map();
  for (const r of reqRows) {
    const userId = String(r.user_id ?? "");
    if (!userId) continue;
    let shouldCount = true;
    if (isSpecialLongTermGoldkeyRequest(r)) {
      const leave = parseYmdParts(r.leave_date);
      const opened = leave ? isAfterRecruitWindowKst(nowLike, leave.year) : false;
      // 4/11 이후에는 상태(활성/비활성)와 무관하게 신청 건수 기준으로 일괄 반영
      shouldCount = opened;
    }
    if (!shouldCount) continue;
    usedByUser.set(userId, (usedByUser.get(userId) || 0) + 1);
  }

  for (const g of goldkeyRows) {
    const userId = String(g.user_id ?? "");
    const quota = Number(g.quota_total || 0);
    const used = Math.max(0, Number(usedByUser.get(userId) || 0));
    const remaining = Math.max(0, quota - used);
    await execute("UPDATE goldkeys SET used_count = ?, remaining_count = ? WHERE user_id = ?", used, remaining, userId);
  }
}

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
  const holidayMap = new Map();

  for (const h of rows) {
    const date = String(h?.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    holidayMap.set(date, String(h?.localName ?? h?.name ?? "공휴일").trim() || "공휴일");
  }

  // 2026년 국내 공식 기준 교정(제헌절 복귀/추석 연휴 날짜 보정)
  if (y === 2026) {
    holidayMap.set("2026-07-17", "제헌절");
    holidayMap.set("2026-09-24", "추석 연휴");
    holidayMap.set("2026-09-25", "추석");
    holidayMap.set("2026-09-26", "추석 연휴");
    holidayMap.delete("2026-09-28");
  }

  const entries = [...holidayMap.entries()].filter(([date]) => {
    if (m == null) return true;
    return Number(date.slice(5, 7)) === m;
  });

  // 월 단위 동기화 시 공식 집합에 없는 날짜는 제거 (잘못 반영된 날짜 정정)
  if (m != null) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = `${y}-${String(m).padStart(2, "0")}-31`;
    const keep = new Set(entries.map(([date]) => date));
    const existing = await queryAll(
      "SELECT holiday_date FROM holidays WHERE holiday_date >= ? AND holiday_date <= ? AND is_holiday = 1",
      first,
      last
    );
    for (const row of existing) {
      const date = String(row.holiday_date ?? "");
      if (!keep.has(date)) {
        await execute("DELETE FROM holidays WHERE holiday_date = ?", date);
        // 평일 잘못 지정이었던 경우 당직 데이터도 같이 제거
        await execute("DELETE FROM holiday_duties WHERE holiday_date = ?", date);
      }
    }
  }

  let count = 0;
  for (const [date, name] of entries) {
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

app.get("/api/health", async (_, res) => {
  const ephemeral = isLikelyEphemeralDeployRisk();
  const remote = isUsingRemoteDb();
  let leaveAuditCount = 0;
  try {
    const row = await queryOne("SELECT COUNT(*) AS c FROM leave_request_audit");
    leaveAuditCount = Number(row?.c ?? 0);
  } catch {
    /* 초기 기동 직전 등 */
  }
  res.json({
    ok: true,
    storage: remote ? "libsql-remote" : "sqlite-file",
    /** true면 코드 업데이트·재배포 시 로컬 DB 파일이 날아갈 수 있음 (신청 내역 유실) */
    dataLossRiskOnDeploy: ephemeral,
    remoteDb: remote,
    sqlitePathSet: Boolean(process.env.SQLITE_PATH),
    leaveRequestAuditRows: leaveAuditCount,
    ...(ephemeral
      ? {
          hint: "무료 유지: Turso 무료 DB + Render에 TURSO_DATABASE_URL·TURSO_AUTH_TOKEN 설정. 또는 유료 Disk + SQLITE_PATH.",
        }
      : {}),
  });
});

app.get("/api/bootstrap", async (_, res) => {
  try {
    await reconcileGoldkeyUsageByPolicy(new Date().toISOString());
    const auditCountRow = await queryOne("SELECT COUNT(*) AS c FROM leave_request_audit");
    res.json({
      users: await queryAll("SELECT id, name, employee_no, role FROM users"),
      goldkeys: await queryAll("SELECT * FROM goldkeys"),
      requests: await queryAll(`SELECT * FROM requests WHERE ${SQL_REQ_ACTIVE}`),
      notes: await queryAll("SELECT * FROM notes"),
      cancellations: await queryAll("SELECT * FROM cancellations WHERE revoked_at IS NULL"),
      selections: await queryAll("SELECT * FROM selections"),
      logs: await queryAll("SELECT * FROM logs"),
      ladderResults: await queryAll("SELECT * FROM ladder_results ORDER BY created_at DESC"),
      holidayDuties: await queryAll("SELECT * FROM holiday_duties"),
      adminDayMemos: await queryAll("SELECT * FROM admin_day_memos"),
      dayComments: await queryAll("SELECT * FROM day_comments ORDER BY created_at ASC"),
      holidays: await queryAll("SELECT * FROM holidays"),
      leaveRequestAuditCount: Number(auditCountRow?.c ?? 0),
    });
  } catch (err) {
    console.error("GET /api/bootstrap", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/push/vapid-public-key", async (_, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: "VAPID 키가 설정되지 않았습니다." });
  return res.json({ ok: true, publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push-subscriptions", async (req, res) => {
  try {
    const { userId, subscription } = req.body ?? {};
    const uid = String(userId ?? "").trim();
    if (!uid) return res.status(400).json({ error: "userId가 필요합니다." });
    const user = await queryOne("SELECT id, role FROM users WHERE id = ?", uid);
    if (!user || user.role !== "NURSE") return res.status(403).json({ error: "간호사만 푸시 구독할 수 있습니다." });
    const endpoint = String(subscription?.endpoint ?? "").trim();
    const p256dh = String(subscription?.keys?.p256dh ?? "").trim();
    const auth = String(subscription?.keys?.auth ?? "").trim();
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: "subscription 형식이 올바르지 않습니다." });
    const nowIso = new Date().toISOString();
    const existing = await queryOne("SELECT id FROM push_subscriptions WHERE endpoint = ?", endpoint);
    if (existing?.id) {
      await execute(
        "UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, updated_at = ? WHERE id = ?",
        uid,
        p256dh,
        auth,
        nowIso,
        existing.id
      );
      return res.json({ ok: true });
    }
    await execute(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      uid,
      endpoint,
      p256dh,
      auth,
      nowIso,
      nowIso
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push-subscriptions", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/push-subscriptions/remove", async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint ?? "").trim();
    if (!endpoint) return res.status(400).json({ error: "endpoint가 필요합니다." });
    await execute("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint);
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push-subscriptions/remove", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/push/test-self", async (req, res) => {
  try {
    if (!PUSH_ENABLED) return res.status(503).json({ error: "VAPID 키가 설정되지 않았습니다." });
    const userId = String(req.body?.userId ?? "").trim();
    if (!userId) return res.status(400).json({ error: "userId가 필요합니다." });
    const actor = await queryOne("SELECT id, role FROM users WHERE id = ?", userId);
    if (!actor || actor.role !== "NURSE") return res.status(403).json({ error: "간호사만 테스트할 수 있습니다." });

    const rows = await queryAll("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", userId);
    if (!rows.length) return res.status(404).json({ error: "저장된 푸시 구독이 없습니다." });

    const payload = JSON.stringify({
      title: "푸시 테스트",
      body: "푸시 알림 설정이 완료되었습니다.",
      url: "#/calendar",
    });
    let sent = 0;
    for (const r of rows) {
      const sub = {
        endpoint: String(r.endpoint || ""),
        keys: {
          p256dh: String(r.p256dh || ""),
          auth: String(r.auth || ""),
        },
      };
      try {
        await webpush.sendNotification(sub, payload);
        sent += 1;
      } catch (err) {
        const statusCode = Number(err?.statusCode || 0);
        console.error("[push] test-self failure", statusCode || "-", String(err?.message || err));
        if (statusCode === 404 || statusCode === 410) {
          await execute("DELETE FROM push_subscriptions WHERE id = ?", r.id);
        }
      }
    }
    if (sent === 0) return res.status(502).json({ error: "푸시 전송에 실패했습니다. 구독을 다시 설정해 주세요." });
    return res.json({ ok: true, sent });
  } catch (err) {
    console.error("POST /api/push/test-self", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/notifications", async (req, res) => {
  try {
    const userId = String(req.query.userId ?? "").trim();
    if (!userId) return res.status(400).json({ error: "userId가 필요합니다." });
    const actor = await queryOne("SELECT id, role FROM users WHERE id = ?", userId);
    if (!actor) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    const rows = await queryAll(
      "SELECT id, user_id, type, message, target_date, leave_request_id, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 200",
      userId
    );
    return res.json({ ok: true, notifications: rows });
  } catch (err) {
    console.error("GET /api/notifications", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/notifications/read-all", async (req, res) => {
  try {
    const userId = String(req.body?.userId ?? "").trim();
    if (!userId) return res.status(400).json({ error: "userId가 필요합니다." });
    const actor = await queryOne("SELECT id, role FROM users WHERE id = ?", userId);
    if (!actor) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    await execute(
      "UPDATE notifications SET read_at = ? WHERE user_id = ? AND (read_at IS NULL OR read_at = '')",
      new Date().toISOString(),
      userId
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/notifications/read-all", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/notifications/:id/read", async (req, res) => {
  try {
    const userId = String(req.body?.userId ?? "").trim();
    const notificationId = String(req.params?.id ?? "").trim();
    if (!userId) return res.status(400).json({ error: "userId가 필요합니다." });
    if (!notificationId) return res.status(400).json({ error: "notification id가 필요합니다." });
    const actor = await queryOne("SELECT id FROM users WHERE id = ?", userId);
    if (!actor) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });

    await execute(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND (read_at IS NULL OR read_at = '')",
      new Date().toISOString(),
      notificationId,
      userId
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/notifications/:id/read", err);
    return res.status(500).json({ error: String(err?.message || err) });
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

app.post("/api/password-reset", async (req, res) => {
  const { loginName, employeeNo } = req.body ?? {};
  const name = String(loginName ?? "").trim();
  const empNo = String(employeeNo ?? "").trim();
  if (!name) return res.status(400).json({ error: "이름을 입력해주세요." });
  if (!empNo) return res.status(400).json({ error: "사번을 입력해주세요." });

  const rows = await queryAll(
    "SELECT id FROM users WHERE REPLACE(name, ' ', '') = REPLACE(?, ' ', '') AND UPPER(REPLACE(employee_no, ' ', '')) = UPPER(REPLACE(?, ' ', ''))",
    name,
    empNo
  );
  if (rows.length === 0) return res.status(404).json({ error: "일치하는 사용자를 찾을 수 없습니다. 이름과 사번을 확인해주세요." });
  if (rows.length > 1) return res.status(409).json({ error: "동일 정보 사용자가 2명 이상입니다. 관리자에게 문의해주세요." });

  await execute("UPDATE users SET password = ? WHERE id = ?", "1234", rows[0].id);
  return res.json({ ok: true, temporaryPassword: "1234" });
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

app.post("/api/admin/day-memos", async (req, res) => {
  try {
    const { actorUserId, targetDate, content } = req.body ?? {};
    const admin = await queryOne("SELECT id FROM users WHERE id = ? AND role = 'ADMIN'", actorUserId);
    if (!admin) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
    const ymd = String(targetDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return res.status(400).json({ error: "targetDate 형식이 올바르지 않습니다." });
    const txt = String(content ?? "");
    await execute(
      "INSERT INTO admin_day_memos (target_date, content, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(target_date) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      ymd,
      txt,
      actorUserId,
      new Date().toISOString()
    );
    await createNotificationsForAllNurses({
      type: "ADMIN_MEMO",
      message: `새 메모 등록: ${ymd}`,
      targetDate: ymd,
    });
    await sendPushToAllNurses({
      title: "새 메모 등록",
      body: `새 메모 등록: ${ymd}`,
      url: `#/calendar?ymd=${encodeURIComponent(ymd)}`,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/day-memos", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/day-comments", async (req, res) => {
  try {
    const { actorUserId, targetDate, content } = req.body ?? {};
    const actor = await queryOne(
      "SELECT id, role FROM users WHERE id = ? AND role IN ('ADMIN', 'NURSE', 'ANESTHESIA')",
      actorUserId
    );
    if (!actor) return res.status(403).json({ error: "권한이 없습니다." });
    const ymd = String(targetDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return res.status(400).json({ error: "targetDate 형식이 올바르지 않습니다." });
    const txt = String(content ?? "").trim();
    if (!txt) return res.status(400).json({ error: "메모 내용을 입력하세요." });
    if (txt.length > 500) return res.status(400).json({ error: "메모는 500자 이내로 입력하세요." });
    const id = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await execute(
      "INSERT INTO day_comments (id, target_date, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      ymd,
      actorUserId,
      txt,
      new Date().toISOString()
    );
    await createNotificationsForAllNurses({
      type: "DAY_COMMENT",
      message: `새 댓글 등록: ${ymd}`,
      targetDate: ymd,
    });
    await sendPushToAllNurses({
      title: "새 댓글 등록",
      body: `새 댓글 등록: ${ymd}`,
      url: `#/calendar?ymd=${encodeURIComponent(ymd)}`,
    });
    return res.json({ ok: true, id });
  } catch (err) {
    console.error("POST /api/day-comments", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/day-comments/:id/update", async (req, res) => {
  try {
    const { actorUserId, content } = req.body ?? {};
    const commentId = String(req.params.id ?? "").trim();
    if (!commentId) return res.status(400).json({ error: "comment id가 필요합니다." });
    const txt = String(content ?? "").trim();
    if (!txt) return res.status(400).json({ error: "메모 내용을 입력하세요." });
    if (txt.length > 500) return res.status(400).json({ error: "메모는 500자 이내로 입력하세요." });

    const actor = await queryOne("SELECT id, role FROM users WHERE id = ?", actorUserId);
    if (!actor) return res.status(403).json({ error: "권한이 없습니다." });
    const row = await queryOne("SELECT id, user_id FROM day_comments WHERE id = ?", commentId);
    if (!row) return res.status(404).json({ error: "댓글을 찾을 수 없습니다." });

    const canManage = actor.role === "ADMIN" || row.user_id === actorUserId;
    if (!canManage) return res.status(403).json({ error: "작성자 또는 관리자만 수정할 수 있습니다." });

    await execute("UPDATE day_comments SET content = ? WHERE id = ?", txt, commentId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/day-comments/:id/update", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/day-comments/:id/delete", async (req, res) => {
  try {
    const { actorUserId } = req.body ?? {};
    const commentId = String(req.params.id ?? "").trim();
    if (!commentId) return res.status(400).json({ error: "comment id가 필요합니다." });

    const actor = await queryOne("SELECT id, role FROM users WHERE id = ?", actorUserId);
    if (!actor) return res.status(403).json({ error: "권한이 없습니다." });
    const row = await queryOne("SELECT id, user_id FROM day_comments WHERE id = ?", commentId);
    if (!row) return res.status(404).json({ error: "댓글을 찾을 수 없습니다." });

    const canManage = actor.role === "ADMIN" || row.user_id === actorUserId;
    if (!canManage) return res.status(403).json({ error: "작성자 또는 관리자만 삭제할 수 있습니다." });

    await execute("DELETE FROM day_comments WHERE id = ?", commentId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/day-comments/:id/delete", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
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

    const idem = getIdempotencyKey(req);
    if (idem) {
      const prev = await auditRowByIdempotencyKey(idem);
      if (prev?.leave_request_id) {
        return res.json({ ok: true, idempotentReplay: true, requestId: prev.leave_request_id });
      }
    }

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
         AND ${SQL_REQ_ACTIVE}
         AND status NOT IN ('CANCELLED', 'REJECTED')
       LIMIT 1`,
      userId,
      leaveDate
    );
    if (duplicate) {
      return res.status(400).json({ error: "같은 날짜에는 휴가를 중복 신청할 수 없습니다." });
    }

    if (leaveType === "GENERAL_PRIORITY") {
      const month = String(leaveDate ?? "").slice(0, 7);
      const row = await queryOne(
        `SELECT COUNT(*) AS c
         FROM requests
         WHERE user_id = ?
           AND leave_type = 'GENERAL_PRIORITY'
           AND SUBSTR(leave_date, 1, 7) = ?
           AND ${SQL_REQ_ACTIVE}
           AND status NOT IN ('CANCELLED', 'REJECTED')`,
        userId,
        month
      );
      if (Number(row?.c || 0) >= 4) {
        return res.status(400).json({ error: "해당월에 일반휴가-우선순위는 4개까지 가능합니다." });
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
      await insertLeaveRequestAuditRow(tx, {
        leaveRequestId: id,
        action: "APPLY",
        fromStatus: null,
        toStatus: String(status ?? "APPLIED"),
        actorUserId: String(userId),
        reason: null,
        idempotencyKey: idem || null,
        metadataJson: { memo: memo || "" },
      });
    });
    if (leaveType === "GOLDKEY") {
      await reconcileGoldkeyUsageByPolicy(requestedAt || new Date().toISOString());
    }

    res.json({ ok: true, requestId: id });
  } catch (err) {
    console.error("POST /api/requests", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** 같은 날·같은 유형 다인 협의 후 순번(1~999), 비우면 NULL — POST·PATCH 둘 다 지원(Render·프록시에서 PATCH 미전달 대비) */
async function handleNegotiationOrder(req, res) {
  try {
    const requestId = decodeURIComponent(String(req.params.id ?? ""));
    const idem = getIdempotencyKey(req);
    if (idem) {
      const prev = await auditRowByIdempotencyKey(idem);
      if (prev) return res.json({ ok: true, idempotentReplay: true });
    }

    const actorUserId = String(req.body?.actorUserId ?? "system").trim() || "system";
    const row = await queryOne(`SELECT id, status, negotiation_order FROM requests WHERE id = ? AND ${SQL_REQ_ACTIVE}`, requestId);
    if (!row) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });

    const raw = req.body?.negotiationOrder ?? req.body?.negotiation_order;
    const prevOrder = row.negotiation_order;

    if (raw === null || raw === undefined || raw === "") {
      await runTransaction(async (tx) => {
        await tx.execute("UPDATE requests SET negotiation_order = NULL WHERE id = ?", requestId);
        await insertLeaveRequestAuditRow(tx, {
          leaveRequestId: requestId,
          action: "NEGOTIATION_ORDER_CLEAR",
          fromStatus: String(row.status),
          toStatus: String(row.status),
          actorUserId,
          reason: null,
          idempotencyKey: idem || null,
          metadataJson: { previousNegotiationOrder: prevOrder ?? null, negotiationOrder: null },
        });
      });
      return res.json({ ok: true, negotiationOrder: null });
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      return res.status(400).json({ error: "협의 순번은 1~999 정수이거나 비워야 합니다." });
    }
    await runTransaction(async (tx) => {
      await tx.execute("UPDATE requests SET negotiation_order = ? WHERE id = ?", n, requestId);
      await insertLeaveRequestAuditRow(tx, {
        leaveRequestId: requestId,
        action: "NEGOTIATION_ORDER_SET",
        fromStatus: String(row.status),
        toStatus: String(row.status),
        actorUserId,
        reason: null,
        idempotencyKey: idem || null,
        metadataJson: { previousNegotiationOrder: prevOrder ?? null, negotiationOrder: n },
      });
    });
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
    const requestId = String(req.params.id ?? "");
    const idem = getIdempotencyKey(req);
    if (idem) {
      const prev = await auditRowByIdempotencyKey(idem);
      if (prev) {
        return res.json({ ok: true, idempotentReplay: true, deductionExempt: false, deductionNote: null });
      }
    }

    const row = await queryOne(
      `SELECT id, user_id, leave_type, leave_date, requested_at, status FROM requests WHERE id = ? AND ${SQL_REQ_ACTIVE}`,
      requestId
    );
    if (!row) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });
    if (String(row.status) === "CANCELLED") return res.json({ ok: true, alreadyCancelled: true });

    const cancelledAt = new Date().toISOString();
    const deductionExempt = isLongTermGoldkeyDeductionExempt(row, cancelledAt);
    const deductionNote = deductionExempt ? "차감 제외 처리됨(장기휴가 모집기간)" : null;
    const cancelReason = String(req.body?.cancelReason ?? "").trim();

    await runTransaction(async (tx) => {
      await tx.execute("UPDATE requests SET status = 'CANCELLED' WHERE id = ?", requestId);
      await tx.execute(
        "INSERT INTO cancellations (id, leave_request_id, cancelled_by, cancel_reason, cancelled_at, deduction_exempt, deduction_note, revoked_at, revoked_by) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
        req.body.cancellationId,
        requestId,
        req.body.cancelledBy,
        cancelReason || "사용자 취소",
        cancelledAt,
        deductionExempt ? 1 : 0,
        deductionNote
      );
      await insertLeaveRequestAuditRow(tx, {
        leaveRequestId: requestId,
        action: "CANCEL",
        fromStatus: String(row.status),
        toStatus: "CANCELLED",
        actorUserId: String(req.body?.cancelledBy ?? ""),
        reason: cancelReason || null,
        idempotencyKey: idem || null,
        metadataJson: { cancellationId: req.body.cancellationId, deductionExempt },
      });
    });
    await reconcileGoldkeyUsageByPolicy(cancelledAt);
    res.json({ ok: true, deductionExempt, deductionNote });
  } catch (err) {
    console.error("POST /api/requests/:id/cancel", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/requests/:id/uncancel", async (req, res) => {
  try {
    const actorUserId = String(req.body?.actorUserId ?? "").trim();
    if (!actorUserId) return res.status(400).json({ error: "actorUserId가 필요합니다." });
    const actor = await queryOne("SELECT id, role FROM users WHERE id = ?", actorUserId);
    if (!actor || actor.role !== "ADMIN") {
      return res.status(403).json({ error: "관리자만 복원할 수 있습니다." });
    }

    const requestId = String(req.params.id ?? "");
    const idem = getIdempotencyKey(req);
    if (idem) {
      const prev = await auditRowByIdempotencyKey(idem);
      if (prev) return res.json({ ok: true, idempotentReplay: true });
    }

    const row = await queryOne(
      `SELECT id, leave_type, leave_date, requested_at, status FROM requests WHERE id = ? AND ${SQL_REQ_ACTIVE}`,
      requestId
    );
    if (!row) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });
    if (String(row.status) !== "CANCELLED") {
      return res.status(400).json({ error: "취소 상태인 신청만 복원할 수 있습니다." });
    }

    const nowIso = new Date().toISOString();
    await runTransaction(async (tx) => {
      await tx.execute("UPDATE requests SET status = 'APPLIED' WHERE id = ?", requestId);
      await tx.execute(
        "UPDATE cancellations SET revoked_at = ?, revoked_by = ? WHERE leave_request_id = ? AND revoked_at IS NULL",
        nowIso,
        actorUserId,
        requestId
      );
      await insertLeaveRequestAuditRow(tx, {
        leaveRequestId: requestId,
        action: "UNCANCEL",
        fromStatus: "CANCELLED",
        toStatus: "APPLIED",
        actorUserId,
        reason: String(req.body?.reason ?? "").trim() || null,
        idempotencyKey: idem || null,
        metadataJson: null,
      });
    });
    await reconcileGoldkeyUsageByPolicy(new Date().toISOString());
    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/requests/:id/uncancel", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/requests/:id/select", async (req, res) => {
  try {
    const requestId = decodeURIComponent(String(req.params.id ?? ""));
    const idem = getIdempotencyKey(req);
    if (idem) {
      const prev = await auditRowByIdempotencyKey(idem);
      if (prev) return res.json({ ok: true, idempotentReplay: true, leaveRequestId: prev.leave_request_id });
    }

    const row = await queryOne(
      `SELECT id, leave_date, leave_type, status FROM requests WHERE id = ? AND ${SQL_REQ_ACTIVE}`,
      requestId
    );
    if (!row) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });
    if (String(row.status) === "APPROVED") {
      return res.json({ ok: true, alreadyApproved: true });
    }
    if (String(row.status) !== "APPLIED") {
      return res.status(409).json({ error: "승인할 수 있는 상태가 아닙니다.", status: row.status });
    }

    const selectedBy = String(req.body?.selectedBy ?? "").trim();
    if (!selectedBy) return res.status(400).json({ error: "selectedBy가 필요합니다." });
    const selectionId = String(req.body?.selectionId ?? "").trim();
    const selectedAt = String(req.body?.selectedAt ?? "").trim();
    if (!selectionId || !selectedAt) return res.status(400).json({ error: "selectionId, selectedAt가 필요합니다." });

    await runTransaction(async (tx) => {
      const cur = await tx.queryOne(
        `SELECT status FROM requests WHERE id = ? AND ${SQL_REQ_ACTIVE}`,
        requestId
      );
      if (!cur || String(cur.status) !== "APPLIED") {
        throw Object.assign(new Error("상태 충돌"), { code: "STATUS_CONFLICT" });
      }
      await tx.execute("UPDATE requests SET status = 'APPROVED' WHERE id = ?", requestId);
      await tx.execute(
        "INSERT INTO selections (id, leave_request_id, selected_by, selected_at) VALUES (?, ?, ?, ?)",
        selectionId,
        requestId,
        selectedBy,
        selectedAt
      );
      await insertLeaveRequestAuditRow(tx, {
        leaveRequestId: requestId,
        action: "APPROVE",
        fromStatus: "APPLIED",
        toStatus: "APPROVED",
        actorUserId: selectedBy,
        reason: null,
        idempotencyKey: idem || null,
        metadataJson: { selectionId },
      });
    });

    await createNotificationsForAllNurses({
      type: "REQUEST_APPROVED",
      message: `휴가 처리 결과 안내: 승인 ${row.leave_date} · ${leaveTypeLabel(row.leave_type)}`,
      targetDate: row.leave_date,
      leaveRequestId: row.id,
    });
    await sendPushToAllNurses({
      title: "휴가 처리 결과 안내",
      body: `휴가 처리 결과 안내: 승인 ${row.leave_date} · ${leaveTypeLabel(row.leave_type)}`,
      url: `#/calendar?ymd=${encodeURIComponent(row.leave_date)}`,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === "STATUS_CONFLICT") {
      return res.status(409).json({ error: "다른 요청에 의해 상태가 바뀌었습니다. 목록을 새로고침 후 다시 시도하세요." });
    }
    console.error("POST /api/requests/:id/select", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/requests/:id/reject", async (req, res) => {
  try {
    const requestId = decodeURIComponent(String(req.params.id ?? ""));
    const idem = getIdempotencyKey(req);
    if (idem) {
      const prev = await auditRowByIdempotencyKey(idem);
      if (prev) return res.json({ ok: true, idempotentReplay: true, leaveRequestId: prev.leave_request_id });
    }

    const row = await queryOne(
      `SELECT id, leave_date, leave_type, status FROM requests WHERE id = ? AND ${SQL_REQ_ACTIVE}`,
      requestId
    );
    if (!row) return res.status(404).json({ error: "요청을 찾을 수 없습니다." });
    if (String(row.status) === "REJECTED") {
      return res.json({ ok: true, alreadyRejected: true });
    }
    if (String(row.status) !== "APPLIED") {
      return res.status(409).json({ error: "거절할 수 있는 상태가 아닙니다.", status: row.status });
    }

    const actorUserId = String(req.body?.actorUserId ?? "").trim();
    if (!actorUserId) return res.status(400).json({ error: "actorUserId가 필요합니다." });
    const reason = String(req.body?.reason ?? req.body?.rejectReason ?? "").trim();

    await runTransaction(async (tx) => {
      const cur = await tx.queryOne(
        `SELECT status FROM requests WHERE id = ? AND ${SQL_REQ_ACTIVE}`,
        requestId
      );
      if (!cur || String(cur.status) !== "APPLIED") {
        throw Object.assign(new Error("상태 충돌"), { code: "STATUS_CONFLICT" });
      }
      await tx.execute("UPDATE requests SET status = 'REJECTED' WHERE id = ?", requestId);
      await insertLeaveRequestAuditRow(tx, {
        leaveRequestId: requestId,
        action: "REJECT",
        fromStatus: "APPLIED",
        toStatus: "REJECTED",
        actorUserId,
        reason: reason || null,
        idempotencyKey: idem || null,
        metadataJson: null,
      });
    });

    await createNotificationsForAllNurses({
      type: "REQUEST_REJECTED",
      message: `휴가 처리 결과 안내: 거절 ${row.leave_date} · ${leaveTypeLabel(row.leave_type)}`,
      targetDate: row.leave_date,
      leaveRequestId: row.id,
    });
    await sendPushToAllNurses({
      title: "휴가 처리 결과 안내",
      body: `휴가 처리 결과 안내: 거절 ${row.leave_date} · ${leaveTypeLabel(row.leave_type)}`,
      url: `#/calendar?ymd=${encodeURIComponent(row.leave_date)}`,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === "STATUS_CONFLICT") {
      return res.status(409).json({ error: "다른 요청에 의해 상태가 바뀌었습니다. 목록을 새로고침 후 다시 시도하세요." });
    }
    console.error("POST /api/requests/:id/reject", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
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

/**
 * 기간별 휴가 신청 스냅샷 CSV (관리자). 복구 기준은 원본 DB·Turso 백업이며, CSV는 보조 증빙·감사용.
 * query: actorUserId (ADMIN), from, to = YYYY-MM-DD (leave_date 기준)
 */
app.get("/api/admin/leave-export.csv", async (req, res) => {
  try {
    const actorUserId = String(req.query.actorUserId ?? "").trim();
    if (!(await requireAdminUser(actorUserId))) return res.status(403).send("forbidden");

    const from = String(req.query.from ?? "").trim();
    const to = String(req.query.to ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).send("from, to (YYYY-MM-DD) are required");
    }

    const rows = await queryAll(
      `SELECT r.id, r.user_id, r.leave_date, r.leave_type, r.leave_nature, r.status, r.requested_at, r.negotiation_order, u.name AS user_name
       FROM requests r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.deleted_at IS NULL AND r.leave_date >= ? AND r.leave_date <= ?
       ORDER BY r.leave_date ASC, r.requested_at ASC`,
      from,
      to
    );

    const header = ["request_id", "user_name", "user_id", "leave_date", "leave_type", "leave_nature", "status", "negotiation_order", "requested_at"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          csvEscapeCell(r.id),
          csvEscapeCell(r.user_name),
          csvEscapeCell(r.user_id),
          csvEscapeCell(r.leave_date),
          csvEscapeCell(r.leave_type),
          csvEscapeCell(r.leave_nature),
          csvEscapeCell(r.status),
          csvEscapeCell(r.negotiation_order),
          csvEscapeCell(r.requested_at),
        ].join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leave-requests-${from}_${to}.csv"`);
    res.send(`\uFEFF${lines.join("\n")}`);
  } catch (err) {
    console.error("GET /api/admin/leave-export.csv", err);
    res.status(500).send(String(err?.message || err));
  }
});

/**
 * 상태 변경 감사 이력 CSV (관리자). created_at(UTC ISO) 구간 필터.
 * query: actorUserId, from, to = YYYY-MM-DD
 */
app.get("/api/admin/leave-audit-export.csv", async (req, res) => {
  try {
    const actorUserId = String(req.query.actorUserId ?? "").trim();
    if (!(await requireAdminUser(actorUserId))) return res.status(403).send("forbidden");

    const from = String(req.query.from ?? "").trim();
    const to = String(req.query.to ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).send("from, to (YYYY-MM-DD) are required");
    }

    const fromIso = `${from}T00:00:00.000Z`;
    const toIso = `${to}T23:59:59.999Z`;

    const rows = await queryAll(
      `SELECT a.id, a.leave_request_id, a.action, a.from_status, a.to_status, a.actor_user_id, a.reason, a.created_at,
              ua.name AS actor_name, r.leave_date
       FROM leave_request_audit a
       LEFT JOIN users ua ON ua.id = a.actor_user_id
       LEFT JOIN requests r ON r.id = a.leave_request_id
       WHERE a.created_at >= ? AND a.created_at <= ?
       ORDER BY a.created_at ASC`,
      fromIso,
      toIso
    );

    const header = [
      "audit_id",
      "leave_request_id",
      "leave_date",
      "action",
      "from_status",
      "to_status",
      "actor_user_id",
      "actor_name",
      "reason",
      "created_at",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          csvEscapeCell(r.id),
          csvEscapeCell(r.leave_request_id),
          csvEscapeCell(r.leave_date),
          csvEscapeCell(r.action),
          csvEscapeCell(r.from_status),
          csvEscapeCell(r.to_status),
          csvEscapeCell(r.actor_user_id),
          csvEscapeCell(r.actor_name),
          csvEscapeCell(r.reason),
          csvEscapeCell(r.created_at),
        ].join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leave-audit-${from}_${to}.csv"`);
    res.send(`\uFEFF${lines.join("\n")}`);
  } catch (err) {
    console.error("GET /api/admin/leave-audit-export.csv", err);
    res.status(500).send(String(err?.message || err));
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
