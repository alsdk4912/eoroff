/**
 * 마취과 간호사 확정 골드키 일정 — DB 시드·Turso 일괄 반영용
 * (연도는 운영 연도 2026 기준)
 */
import { defaultGoldkeyQuotaForName } from "../src/data/goldkeyQuotas.js";
import { execute, queryAll, queryOne, runTransaction } from "./db.clean.js";

const YEAR = 2026;

/** 이름 → YYYY-MM-DD[] */
export const ANESTHESIA_GOLDKEY_DATES_BY_NAME = {
  윤지민: ["05-26", "05-27", "05-28", "05-29"],
  김인자: ["06-11", "06-12", "06-15", "06-16", "06-17", "06-18", "06-19", "06-22"],
  이지현: ["05-04", "08-18"],
  박현정: ["06-23", "07-14", "08-07", "08-11", "09-08", "10-20", "11-12", "11-13"],
};

function toFullDates(mmDdList) {
  return mmDdList.map((md) => `${YEAR}-${md}`);
}

function requestIdFor(userId, leaveDate) {
  return `req_agk_${userId}_${leaveDate}`;
}

/** 확정 골드키 기준 used_count·remaining_count 갱신 (서버 기동 reconcile과 동일한 단순 집계) */
export async function reconcileGoldkeyUsageForApproved() {
  const reqRows = await queryAll(
    `SELECT id, user_id, leave_date, status FROM requests
     WHERE leave_type = 'GOLDKEY' AND deleted_at IS NULL`
  );
  const cancelRows = await queryAll(
    `SELECT c.leave_request_id, IFNULL(c.deduction_exempt, 0) AS deduction_exempt
     FROM cancellations c
     JOIN requests r ON r.id = c.leave_request_id
     WHERE r.leave_type = 'GOLDKEY' AND r.deleted_at IS NULL AND c.revoked_at IS NULL`
  );
  const exemptCancelled = new Set(
    cancelRows.filter((c) => Number(c.deduction_exempt) === 1).map((c) => String(c.leave_request_id))
  );

  const usedDatesByUser = new Map();
  for (const r of reqRows) {
    const st = String(r.status ?? "").trim();
    if (st === "REJECTED") continue;
    if (st === "CANCELLED") {
      if (!exemptCancelled.has(String(r.id))) {
        const userId = String(r.user_id ?? "");
        const ld = String(r.leave_date ?? "").trim().slice(0, 10);
        if (userId && ld) {
          if (!usedDatesByUser.has(userId)) usedDatesByUser.set(userId, new Set());
          usedDatesByUser.get(userId).add(ld);
        }
      }
      continue;
    }
    if (st === "APPLIED" || st === "SELECTED" || st === "APPROVED") {
      const userId = String(r.user_id ?? "");
      const ld = String(r.leave_date ?? "").trim().slice(0, 10);
      if (userId && ld) {
        if (!usedDatesByUser.has(userId)) usedDatesByUser.set(userId, new Set());
        usedDatesByUser.get(userId).add(ld);
      }
    }
  }

  const goldkeyRows = await queryAll("SELECT user_id, quota_total FROM goldkeys");
  const summary = [];
  for (const g of goldkeyRows) {
    const userId = String(g.user_id ?? "");
    const quota = Number(g.quota_total || 0);
    const used = Math.max(0, usedDatesByUser.get(userId)?.size ?? 0);
    const remaining = Math.max(0, quota - used);
    await execute(
      "UPDATE goldkeys SET used_count = ?, remaining_count = ? WHERE user_id = ?",
      used,
      remaining,
      userId
    );
    summary.push({ userId, quota, used, remaining });
  }
  return summary;
}

/**
 * 마취과 골드키 일정 반영: 기존 해당일 신청은 GOLDKEY·APPROVED로, 없으면 삽입
 */
export async function applyAnesthesiaGoldkeyLeaves() {
  const seededAt = new Date().toISOString();
  const report = { updated: [], inserted: [], skipped: [], errors: [] };

  await runTransaction(async (tx) => {
    for (const [name, mmDdList] of Object.entries(ANESTHESIA_GOLDKEY_DATES_BY_NAME)) {
      const user = await tx.queryOne(
        "SELECT id FROM users WHERE name = ? AND role = 'ANESTHESIA' LIMIT 1",
        name
      );
      const userId = String(user?.id ?? "").trim();
      if (!userId) {
        report.errors.push({ name, error: "ANESTHESIA user not found" });
        continue;
      }

      const quota = defaultGoldkeyQuotaForName(name);
      const gk = await tx.queryOne("SELECT user_id FROM goldkeys WHERE user_id = ?", userId);
      if (!gk) {
        await tx.execute(
          "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, 0, ?)",
          userId,
          quota,
          quota
        );
      }

      for (const leaveDate of toFullDates(mmDdList)) {
        const row = await tx.queryOne(
          `SELECT id, leave_type, status FROM requests
           WHERE user_id = ? AND leave_date = ? AND deleted_at IS NULL
           ORDER BY requested_at DESC LIMIT 1`,
          userId,
          leaveDate
        );
        const reqId = row ? String(row.id ?? "") : requestIdFor(userId, leaveDate);

        if (row) {
          await tx.execute(
            `UPDATE requests SET leave_type = 'GOLDKEY', status = 'APPROVED', leave_nature = 'PERSONAL'
             WHERE id = ?`,
            reqId
          );
          report.updated.push({ name, leaveDate, id: reqId, wasType: row.leave_type });
        } else {
          await tx.execute(
            `INSERT INTO requests (id, user_id, leave_date, leave_type, leave_nature, status, requested_at, memo)
             VALUES (?, ?, ?, 'GOLDKEY', 'PERSONAL', 'APPROVED', ?, ?)`,
            reqId,
            userId,
            leaveDate,
            seededAt,
            "마취과 골드키 일정 반영"
          );
          report.inserted.push({ name, leaveDate, id: reqId });
        }
      }
    }
  });

  const goldkeys = await reconcileGoldkeyUsageForApproved();
  const byName = [];
  for (const [name] of Object.entries(ANESTHESIA_GOLDKEY_DATES_BY_NAME)) {
    const u = await queryOne("SELECT id FROM users WHERE name = ? AND role = 'ANESTHESIA'", name);
    if (!u) continue;
    const g = await queryOne(
      "SELECT quota_total, used_count, remaining_count FROM goldkeys WHERE user_id = ?",
      u.id
    );
    byName.push({ name, userId: u.id, ...g });
  }

  return { report, goldkeys: byName };
}
