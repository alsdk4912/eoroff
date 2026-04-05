import fs from "fs";
import path from "path";
import { createClient } from "@libsql/client";
import { defaultGoldkeyQuotaForName } from "../src/data/goldkeyQuotas.js";

const EMPLOYEE_NO_BY_NAME = {
  양현아: "0534411",
  오민아: "0550117",
  유진: "0530199",
  윤지민: "0548397",
  이양희: "0512513",
  이지선: "0572657",
  이지현: "0511968",
  임희종: "0511936",
  장성필: "0559871",
  장지은: "0539515",
  정수영: "0592526",
  진기숙: "0516980",
  최유경: "0561359",
  최유리: "0554136",
  최종선: "0552153",
  김인자: "0071876",
  김해림: "0530914",
  박현정: "0516973",
  손다솜: "0548090",
  허정숙: "0511929",
};

function resolveEmployeeNo(name, fallback) {
  return EMPLOYEE_NO_BY_NAME[name] || fallback;
}

function toYmdPartsLoose(dateLike) {
  const raw = String(dateLike ?? "").trim();
  const korean = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./.exec(raw);
  if (korean) {
    return { year: Number(korean[1]), month: Number(korean[2]), day: Number(korean[3]) };
  }
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (ymd) {
    return { year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]) };
  }
  const d = new Date(raw);
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
  return { year, month, day };
}

function isKstAprilFirstToTenth(dateLike) {
  const p = toYmdPartsLoose(dateLike);
  return Boolean(p && p.month === 4 && p.day >= 1 && p.day <= 10);
}

function parseLeaveYmd(ymd) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd ?? "").trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

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
  negotiation_order INTEGER,
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
  cancelled_at TEXT NOT NULL,
  deduction_exempt INTEGER NOT NULL DEFAULT 0,
  deduction_note TEXT
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

-- 공휴일 당직자(수술실 간호사 2명 + 마취과 간호사 1명) 기록
-- key: holiday_date (YYYY-MM-DD)
CREATE TABLE IF NOT EXISTS holiday_duties (
  holiday_date TEXT PRIMARY KEY,
  nurse1_user_id TEXT,
  nurse2_user_id TEXT,
  anesthesia_user_id TEXT
);

-- 협의 순번 사다리 결과
CREATE TABLE IF NOT EXISTS ladder_results (
  id TEXT PRIMARY KEY,
  leave_date TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  order_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 날짜별 관리자 메모
CREATE TABLE IF NOT EXISTS admin_day_memos (
  target_date TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 날짜별 간호사 추가 메모(댓글)
CREATE TABLE IF NOT EXISTS day_comments (
  id TEXT PRIMARY KEY,
  target_date TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 앱 내 알림 (2단계: 서버 동기화 + 추후 푸시 확장 기반)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  target_date TEXT,
  leave_request_id TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- 휴가 신청 상태 변경 감사(승인/거절/취소/순번 변경 등). 메인 requests와 분리해 이력 누적·복구·분석에 사용.
CREATE TABLE IF NOT EXISTS leave_request_audit (
  id TEXT PRIMARY KEY,
  leave_request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  idempotency_key TEXT UNIQUE,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_request_audit_req
  ON leave_request_audit(leave_request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_leave_request_audit_created
  ON leave_request_audit(created_at);

-- Web Push 구독(간호사 디바이스)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_migrations (
  id TEXT PRIMARY KEY
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
  await ensureRequestsNegotiationOrderColumn();
  await ensureHolidayDutiesAnesthesiaColumn();
  await ensureCancellationsDeductionColumns();
  await ensureCancellationsRevokedColumns();
  await ensureRequestsSoftDeleteColumns();

  await seedDefaultsIfEmpty();
  await ensureAnesthesiaUsers();
  await ensureKnownEmployeeNos();
  await ensureOfficialHolidayCorrections();
  await ensureHolidayDutyBackfill2026();
  await backfillLongTermGoldkeyCancellationExemptions();
  await ensureGoldkeyDefaults();
  await backfillGeneralNormalNegotiationOrderFromAppliedOrder();
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

async function ensureRequestsNegotiationOrderColumn() {
  const cols = await queryAll("PRAGMA table_info(requests)");
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("negotiation_order")) {
    await execute("ALTER TABLE requests ADD COLUMN negotiation_order INTEGER");
  }
}

async function ensureHolidayDutiesAnesthesiaColumn() {
  const cols = await queryAll("PRAGMA table_info(holiday_duties)");
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("anesthesia_user_id")) {
    await execute("ALTER TABLE holiday_duties ADD COLUMN anesthesia_user_id TEXT");
  }
}

async function ensureCancellationsDeductionColumns() {
  const cols = await queryAll("PRAGMA table_info(cancellations)");
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("deduction_exempt")) {
    await execute("ALTER TABLE cancellations ADD COLUMN deduction_exempt INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.has("deduction_note")) {
    await execute("ALTER TABLE cancellations ADD COLUMN deduction_note TEXT");
  }
}

/** 관리자 복원(uncancel) 시 물리 DELETE 대신 취소 행에 해제 시각을 남김 — 취소·복원 이력 보존 */
async function ensureCancellationsRevokedColumns() {
  const cols = await queryAll("PRAGMA table_info(cancellations)");
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("revoked_at")) {
    await execute("ALTER TABLE cancellations ADD COLUMN revoked_at TEXT");
  }
  if (!names.has("revoked_by")) {
    await execute("ALTER TABLE cancellations ADD COLUMN revoked_by TEXT");
  }
}

/** 요청 행 물리 삭제 대신 숨김(운영 삭제·오입력 대응). 일반 API는 deleted_at IS NULL만 조회 */
async function ensureRequestsSoftDeleteColumns() {
  const cols = await queryAll("PRAGMA table_info(requests)");
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("deleted_at")) {
    await execute("ALTER TABLE requests ADD COLUMN deleted_at TEXT");
  }
  if (!names.has("deleted_yn")) {
    await execute("ALTER TABLE requests ADD COLUMN deleted_yn INTEGER NOT NULL DEFAULT 0");
  }
}

/**
 * 일반휴가-후순위를 전부 협의제로 전환하면서, 기존에 DB에 순번이 없던 동일일·다인 건에는
 * 신청 시각 순(기존 화면의 신청순)을 negotiation_order에 한 번만 백필한다.
 */
async function backfillGeneralNormalNegotiationOrderFromAppliedOrder() {
  const done = await queryOne("SELECT id FROM app_migrations WHERE id = ?", "general_normal_all_negotiate_v1");
  if (done) return;

  const all = await queryAll(
    "SELECT id, leave_date, requested_at, negotiation_order, status, leave_type FROM requests WHERE leave_type = ? AND deleted_at IS NULL",
    "GENERAL_NORMAL"
  );
  const active = (all || []).filter((r) => {
    const st = String(r.status ?? "");
    return st !== "CANCELLED" && st !== "REJECTED";
  });
  const byDate = new Map();
  for (const r of active) {
    const ld = String(r.leave_date ?? "").trim();
    if (!ld) continue;
    if (!byDate.has(ld)) byDate.set(ld, []);
    byDate.get(ld).push(r);
  }

  await runTransaction(async (tx) => {
    for (const [, list] of byDate) {
      if (list.length < 2) continue;
      const allNull = list.every((r) => r.negotiation_order == null || r.negotiation_order === "");
      if (!allNull) continue;
      const sorted = [...list].sort((a, b) => String(a.requested_at ?? "").localeCompare(String(b.requested_at ?? "")));
      let i = 1;
      for (const r of sorted) {
        await tx.execute("UPDATE requests SET negotiation_order = ? WHERE id = ?", i, r.id);
        i += 1;
      }
    }
    await tx.execute("INSERT INTO app_migrations (id) VALUES (?)", "general_normal_all_negotiate_v1");
  });
  console.log("[db] migration general_normal_all_negotiate_v1 applied (일반-후순위 협의 순번 백필)");
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
  const anesthesiaNames = ["김인자", "박현정", "이지현", "윤지민"];

  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    await execute(
      "INSERT INTO users (id, name, employee_no, role, password) VALUES (?, ?, ?, ?, ?)",
      `u_nurse_${idx + 1}`,
      name,
      resolveEmployeeNo(name, `N${String(idx + 1).padStart(4, "0")}`),
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

  for (let idx = 0; idx < anesthesiaNames.length; idx++) {
    const name = anesthesiaNames[idx];
    await execute(
      "INSERT INTO users (id, name, employee_no, role, password) VALUES (?, ?, ?, ?, ?)",
      `u_anesthesia_${idx + 1}`,
      name,
      resolveEmployeeNo(name, `A${String(idx + 1).padStart(4, "0")}`),
      "ANESTHESIA",
      "1234"
    );
  }

  for (let idx = 0; idx < names.length; idx++) {
    const q = defaultGoldkeyQuotaForName(names[idx]);
    await execute(
      "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, ?, ?)",
      `u_nurse_${idx + 1}`,
      q,
      0,
      q
    );
  }
}

async function ensureGoldkeyDefaults() {
  const nurses = await queryAll("SELECT id, name FROM users WHERE role = 'NURSE'");

  for (const nurse of nurses) {
    const target = defaultGoldkeyQuotaForName(nurse.name);
    const row = await queryOne(
      "SELECT quota_total, used_count, remaining_count FROM goldkeys WHERE user_id = ?",
      nurse.id
    );
    if (!row) {
      await execute(
        "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, ?, ?)",
        nurse.id,
        target,
        0,
        target
      );
      continue;
    }

    const used = Number(row.used_count || 0);
    const quota = Number(row.quota_total || 0);
    if (quota !== target) {
      const remaining = Math.max(0, target - used);
      await execute(
        "UPDATE goldkeys SET quota_total = ?, remaining_count = ? WHERE user_id = ?",
        target,
        remaining,
        nurse.id
      );
    }
  }
}

async function ensureAnesthesiaUsers() {
  const names = ["김인자", "박현정", "이지현", "윤지민"];
  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    const row = await queryOne("SELECT id FROM users WHERE name = ? AND role = 'ANESTHESIA'", name);
    if (row?.id) continue;
    await execute(
      "INSERT INTO users (id, name, employee_no, role, password) VALUES (?, ?, ?, ?, ?)",
      `u_anesthesia_${idx + 1}`,
      name,
      resolveEmployeeNo(name, `A${String(idx + 1).padStart(4, "0")}`),
      "ANESTHESIA",
      "1234"
    );
  }
}

async function ensureKnownEmployeeNos() {
  for (const [name, employeeNo] of Object.entries(EMPLOYEE_NO_BY_NAME)) {
    await execute("UPDATE users SET employee_no = ? WHERE name = ?", employeeNo, name);
  }
}

async function ensureOfficialHolidayCorrections() {
  const nowIso = new Date().toISOString();
  const official2026 = [
    ["2026-07-17", "제헌절"],
    ["2026-09-24", "추석 연휴"],
    ["2026-09-25", "추석"],
    ["2026-09-26", "추석 연휴"],
  ];

  for (const [holidayDate, holidayName] of official2026) {
    await execute(
      "INSERT INTO holidays (holiday_date, holiday_name, is_holiday, synced_at) VALUES (?, ?, 1, ?) ON CONFLICT(holiday_date) DO UPDATE SET holiday_name = excluded.holiday_name, is_holiday = 1, synced_at = excluded.synced_at",
      holidayDate,
      holidayName,
      nowIso
    );
  }

  // 2026 추석 대체공휴일 오표기 정정
  await execute("DELETE FROM holidays WHERE holiday_date = ?", "2026-09-28");
  await execute("DELETE FROM holiday_duties WHERE holiday_date = ?", "2026-09-28");
}

function isDutyBlockedByRule(name, ymd) {
  const nm = String(name ?? "").trim();
  if (nm === "장지은") return ymd <= "2026-08-05";
  if (nm === "이지선") return ymd <= "2026-09-06";
  return false;
}

function buildBaseDutyOrder(nurseUsers) {
  const sorted = [...nurseUsers].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const special = ["장성필", "장지은", "정수영", "최유경", "최종선", "최유리"];
  const specialSet = new Set(special);
  const picked = [];
  const rest = [];
  for (const u of sorted) {
    if (specialSet.has(u.name)) picked.push(u);
    else rest.push(u);
  }
  if (picked.length === 0) return sorted;
  const pickedByName = new Map(picked.map((u) => [u.name, u]));
  const orderedPicked = special.map((name) => pickedByName.get(name)).filter(Boolean);
  const firstIdx = sorted.findIndex((u) => specialSet.has(u.name));
  const insertAt = firstIdx < 0 ? rest.length : firstIdx;
  return [...rest.slice(0, insertAt), ...orderedPicked, ...rest.slice(insertAt)];
}

function pickSequentialDutyPair(baseOrder, ymd, pointer) {
  if (!Array.isArray(baseOrder) || baseOrder.length < 2) return null;
  const n = baseOrder.length;
  const start = ((pointer % n) + n) % n;

  let firstIdx = -1;
  for (let i = 0; i < n; i += 1) {
    const idx = (start + i) % n;
    if (!isDutyBlockedByRule(baseOrder[idx].name, ymd)) {
      firstIdx = idx;
      break;
    }
  }
  if (firstIdx < 0) return null;

  let secondIdx = -1;
  for (let i = 1; i < n; i += 1) {
    const idx = (firstIdx + i) % n;
    if (idx === firstIdx) continue;
    if (!isDutyBlockedByRule(baseOrder[idx].name, ymd)) {
      secondIdx = idx;
      break;
    }
  }
  if (secondIdx < 0) return null;

  return {
    nurse1UserId: baseOrder[firstIdx].id,
    nurse2UserId: baseOrder[secondIdx].id,
    nextPointer: (secondIdx + 1) % n,
  };
}

async function ensureHolidayDutyBackfill2026() {
  const targetDates = ["2026-07-17", "2026-09-24", "2026-09-25"];

  const nurseUsers = await queryAll("SELECT id, name FROM users WHERE role = 'NURSE'");
  const baseOrder = buildBaseDutyOrder(nurseUsers);
  if (baseOrder.length < 2) return;

  const dutyRows = await queryAll(
    "SELECT holiday_date, nurse1_user_id, nurse2_user_id, anesthesia_user_id FROM holiday_duties ORDER BY holiday_date ASC"
  );
  const dutyByDate = new Map(dutyRows.map((r) => [String(r.holiday_date), r]));

  const anesthesiaRows = await queryAll("SELECT id, name FROM users WHERE role = 'ANESTHESIA' ORDER BY name ASC");
  const anesthesiaFallback = String(anesthesiaRows[0]?.id ?? "");

  const lastAssignedBefore = await queryOne(
    `SELECT holiday_date, nurse1_user_id, nurse2_user_id, anesthesia_user_id
     FROM holiday_duties
     WHERE holiday_date < ? AND nurse1_user_id IS NOT NULL AND nurse2_user_id IS NOT NULL
       AND TRIM(nurse1_user_id) <> '' AND TRIM(nurse2_user_id) <> ''
     ORDER BY holiday_date DESC
     LIMIT 1`,
    targetDates[0]
  );

  let pointer = 0;
  if (lastAssignedBefore?.nurse2_user_id) {
    const idx2 = baseOrder.findIndex((u) => u.id === String(lastAssignedBefore.nurse2_user_id));
    if (idx2 >= 0) pointer = (idx2 + 1) % baseOrder.length;
  }

  let anesthesiaPointer = String(lastAssignedBefore?.anesthesia_user_id ?? "") || anesthesiaFallback;

  for (const ymd of targetDates) {
    const existing = dutyByDate.get(ymd);
    const hasNursePair = Boolean(
      existing?.nurse1_user_id &&
        existing?.nurse2_user_id &&
        String(existing.nurse1_user_id).trim() &&
        String(existing.nurse2_user_id).trim()
    );
    const existingAnes = String(existing?.anesthesia_user_id ?? "").trim();

    if (hasNursePair && existingAnes) {
      const idx2 = baseOrder.findIndex((u) => u.id === String(existing.nurse2_user_id));
      if (idx2 >= 0) pointer = (idx2 + 1) % baseOrder.length;
      anesthesiaPointer = existingAnes;
      continue;
    }

    const picked = pickSequentialDutyPair(baseOrder, ymd, pointer);
    if (!picked) continue;
    pointer = picked.nextPointer;

    const anesthesiaUserId = existingAnes || anesthesiaPointer || anesthesiaFallback;
    await execute(
      "INSERT INTO holiday_duties (holiday_date, nurse1_user_id, nurse2_user_id, anesthesia_user_id) VALUES (?, ?, ?, ?) ON CONFLICT(holiday_date) DO UPDATE SET nurse1_user_id = excluded.nurse1_user_id, nurse2_user_id = excluded.nurse2_user_id, anesthesia_user_id = CASE WHEN holiday_duties.anesthesia_user_id IS NULL OR TRIM(holiday_duties.anesthesia_user_id) = '' THEN excluded.anesthesia_user_id ELSE holiday_duties.anesthesia_user_id END",
      ymd,
      picked.nurse1UserId,
      picked.nurse2UserId,
      anesthesiaUserId
    );
    anesthesiaPointer = anesthesiaUserId;
  }
}

async function backfillLongTermGoldkeyCancellationExemptions() {
  const cancellationRows = await queryAll(
    `SELECT
       c.id AS cancellation_id,
       c.cancelled_at,
       r.id AS request_id,
       r.user_id,
       r.leave_type,
       r.leave_date,
       r.requested_at
     FROM cancellations c
     JOIN requests r ON r.id = c.leave_request_id
     WHERE c.revoked_at IS NULL`
  );

  for (const row of cancellationRows) {
    if (String(row.leave_type || "") !== "GOLDKEY") continue;
    const leave = parseLeaveYmd(row.leave_date);
    if (!leave || leave.month < 7 || leave.month > 12) continue;
    if (!isKstAprilFirstToTenth(row.requested_at)) continue;
    if (!isKstAprilFirstToTenth(row.cancelled_at)) continue;

    await execute(
      "UPDATE cancellations SET deduction_exempt = 1, deduction_note = ? WHERE id = ?",
      "차감 제외 처리됨(장기휴가 모집기간)",
      row.cancellation_id
    );
  }

  await execute("UPDATE cancellations SET deduction_exempt = 0, deduction_note = NULL WHERE deduction_exempt IS NULL");

  const allGoldkeyByUser = await queryAll(
    `SELECT user_id, COUNT(*) AS c
     FROM requests
     WHERE leave_type = 'GOLDKEY' AND deleted_at IS NULL
     GROUP BY user_id`
  );
  const exemptGoldkeyByUser = await queryAll(
    `SELECT r.user_id, COUNT(*) AS c
     FROM cancellations c
     JOIN requests r ON r.id = c.leave_request_id
     WHERE r.leave_type = 'GOLDKEY' AND c.deduction_exempt = 1 AND c.revoked_at IS NULL AND r.deleted_at IS NULL
     GROUP BY r.user_id`
  );

  const totalMap = new Map(allGoldkeyByUser.map((r) => [String(r.user_id), Number(r.c || 0)]));
  const exemptMap = new Map(exemptGoldkeyByUser.map((r) => [String(r.user_id), Number(r.c || 0)]));
  const goldkeyRows = await queryAll("SELECT user_id, quota_total FROM goldkeys");
  for (const g of goldkeyRows) {
    const userId = String(g.user_id);
    const total = totalMap.get(userId) || 0;
    const exempt = exemptMap.get(userId) || 0;
    const expectedUsed = Math.max(0, total - exempt);
    const quota = Number(g.quota_total || 0);
    const expectedRemaining = Math.max(0, quota - expectedUsed);
    await execute(
      "UPDATE goldkeys SET used_count = ?, remaining_count = ? WHERE user_id = ?",
      expectedUsed,
      expectedRemaining,
      userId
    );
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
 * tx: execute, queryAll, queryOne (동일 트랜잭션에서 읽기 일관성)
 * @param {(tx: { execute: Function, queryAll: Function, queryOne: Function }) => Promise<void>} fn
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
      queryAll: async (sql, ...args) => {
        const r = await tx.execute({ sql, args });
        return r.rows || [];
      },
    };
    wrap.queryOne = async (sql, ...args) => {
      const rows = await wrap.queryAll(sql, ...args);
      return rows[0];
    };
    await fn(wrap);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/** 휴가 신청·부가 테이블 전부 삭제 후 간호사 골드키를 이름별 기본 총량·미사용으로 되돌림 */
export async function resetLeaveDataToDefaults() {
  const nurses = await queryAll("SELECT id, name FROM users WHERE role = 'NURSE'");
  await runTransaction(async (tx) => {
    await tx.execute("DELETE FROM leave_request_audit");
    await tx.execute("DELETE FROM notes");
    await tx.execute("DELETE FROM cancellations");
    await tx.execute("DELETE FROM selections");
    await tx.execute("DELETE FROM logs");
    await tx.execute("DELETE FROM ladder_results");
    await tx.execute("DELETE FROM requests");
    for (const n of nurses) {
      const q = defaultGoldkeyQuotaForName(n.name);
      const up = await tx.execute(
        "UPDATE goldkeys SET quota_total = ?, used_count = 0, remaining_count = ? WHERE user_id = ?",
        q,
        q,
        n.id
      );
      if (!Number(up.changes || 0)) {
        await tx.execute(
          "INSERT INTO goldkeys (user_id, quota_total, used_count, remaining_count) VALUES (?, ?, 0, ?)",
          n.id,
          q,
          q
        );
      }
    }
  });
}
