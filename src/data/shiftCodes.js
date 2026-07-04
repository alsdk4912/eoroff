/** 수술실·마취과·주임 주간/대체 번표 코드 (역할별 상이) */

export function isUserActive(u) {
  if (!u) return false;
  return Number(u.isActive ?? u.is_active ?? 1) === 1;
}

/** 재직자만 — 대체·번표·당직 선택 등 */
export function staffUsersByRole(users, role) {
  return (Array.isArray(users) ? users : [])
    .filter((u) => String(u.role ?? "") === String(role) && isUserActive(u))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export function staffUsersByRoles(users, roles) {
  const roleSet = new Set((Array.isArray(roles) ? roles : []).map(String));
  return (Array.isArray(users) ? users : [])
    .filter((u) => roleSet.has(String(u.role ?? "")) && isUserActive(u))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 수술실 간호사 (대체·월간·주간 번표 드롭다운 순서) */
export const NURSE_SHIFT_OPTIONS = [
  "",
  "1D1",
  "1D2",
  "3D1",
  "3D2",
  "5D1",
  "5D2",
  "6D1",
  "6D2",
  "7D1",
  "7D2",
  "안D0",
  "안E",
  "수E",
  "9-5",
  "휴가",
  "병가",
  "공가",
  "반차",
  "교육",
];

/** 마취과 간호사 */
export const ANESTHESIA_SHIFT_OPTIONS = ["", "opd", "R1", "R3", "10시", "병가"];

/** 마취과 번표 표기 통일 (레거시 r1/r3/D0 호환) */
export function normalizeAnesthesiaShiftCode(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.startsWith("__CUSTOM_SHIFT__:")) return s;
  if (s === "r1" || s === "R1") return "R1";
  if (s === "r3" || s === "R3") return "R3";
  if (s === "D0") return "opd";
  return s;
}

export function normalizeWorkScheduleRowsForAnesthesia(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (monthlyRowSection(row?.name) !== "anesthesia") return row;
    const vals = Array.isArray(row?.values) ? row.values : [];
    return {
      name: row.name,
      values: vals.map((v) => normalizeAnesthesiaShiftCode(v)),
    };
  });
}

/** 주임 */
export const CHIEF_SHIFT_OPTIONS = ["", "D0", "D1", "9-5", "10-2", "E"];
const FIXED_CHIEF_SHIFT_BY_NAME = {
  오세연: "10-2",
};

export function normalizeChiefShiftCode(value) {
  const s = String(value ?? "").trim();
  if (s === "10-2시") return "10-2";
  return s;
}

export function fixedChiefShiftCodeForName(name) {
  const raw = FIXED_CHIEF_SHIFT_BY_NAME[String(name ?? "").trim()] ?? "";
  return normalizeChiefShiftCode(raw);
}

export function shiftOptionsForRole(role) {
  const r = String(role ?? "").trim();
  if (r === "ANESTHESIA") return ANESTHESIA_SHIFT_OPTIONS;
  if (r === "CHIEF") return CHIEF_SHIFT_OPTIONS;
  return NURSE_SHIFT_OPTIONS;
}

export function shiftOptionSetForRole(role) {
  return new Set(shiftOptionsForRole(role).filter(Boolean));
}

export function shiftOptionsForUserId(userId, users) {
  const u = (Array.isArray(users) ? users : []).find((x) => String(x.id) === String(userId));
  return shiftOptionsForRole(u?.role);
}

/** 월간 근무표 — 정수영 아래 마취과, 윤지민 아래 주임 */
export const ANESTHESIA_MONTHLY_NAMES = ["김인자", "이지현", "박현정", "윤지민"];
export const CHIEF_MONTHLY_NAMES = ["방현석", "최무영", "김보람", "오문환", "오세연", "강명호"];
const LEGACY_CHIEF_MONTHLY_NAMES = ["이찬주"];
const CHIEF_REPLACEMENT_CUTOFF_YMD = "2026-07-01";
const CHIEF_REPLACEMENT_NAMES = new Set(["이찬주", "오문환"]);
const CHIEF_FUTURE_START_NAMES = new Set(["강명호"]);

function chiefNamesForYmd(ymd) {
  const base = ["방현석", "최무영", "김보람"];
  const tail = String(ymd ?? "").slice(0, 10) >= "2026-06-25" ? ["오세연", "강명호"] : ["오세연"];
  if (String(ymd ?? "").slice(0, 10) < CHIEF_REPLACEMENT_CUTOFF_YMD) {
    return [...base, "이찬주", ...tail];
  }
  return [...base, "오문환", ...tail];
}

export function chiefScheduleRowCandidateNames(name, ymd) {
  const n = String(name ?? "").trim();
  const base = String(ymd ?? "").slice(0, 10);
  if (n === "이찬주") return base >= CHIEF_REPLACEMENT_CUTOFF_YMD ? ["오문환", "이찬주"] : ["이찬주", "오문환"];
  if (n === "오문환") return base < CHIEF_REPLACEMENT_CUTOFF_YMD ? ["이찬주", "오문환"] : ["오문환", "이찬주"];
  return [n];
}

export function emptyScheduleMonthValues(monthCount) {
  const n = Math.max(0, Number(monthCount) || 0);
  return Array.from({ length: n }, () => "");
}

export function monthlyRowSection(name) {
  const n = String(name ?? "").trim();
  if (ANESTHESIA_MONTHLY_NAMES.includes(n)) return "anesthesia";
  if (CHIEF_MONTHLY_NAMES.includes(n) || LEGACY_CHIEF_MONTHLY_NAMES.includes(n)) return "chief";
  return "or";
}

/** 섹션 경계 직전에 두꺼운 구분선 행 삽입 */
export function separatorBeforeMonthlyRow(name, previousName) {
  const sec = monthlyRowSection(name);
  const prevSec = previousName ? monthlyRowSection(previousName) : null;
  if (sec === "anesthesia" && prevSec !== "anesthesia") return "anesthesia";
  if (sec === "chief" && prevSec !== "chief") return "chief";
  return null;
}

export function mergeWorkScheduleRows(saved, templateRows) {
  const template = Array.isArray(templateRows) ? templateRows : [];
  const map = new Map(
    normalizeWorkScheduleRowsForAnesthesia(Array.isArray(saved) ? saved : []).map((r) => [String(r?.name ?? ""), r])
  );
  return template.map((t) => {
    const len = (t.values || []).length;
    const hit = map.get(t.name);
    const fixedChief = fixedChiefShiftCodeForName(t.name);
    if (!hit) {
      return {
        name: t.name,
        values: fixedChief ? Array.from({ length: len }, () => fixedChief) : emptyScheduleMonthValues(len),
      };
    }
    const vals = Array.isArray(hit.values) ? hit.values : [];
    const values = Array.from({ length: len }, (_, i) => {
      if (fixedChief) return fixedChief;
      return String(vals[i] ?? "");
    });
    return { name: t.name, values };
  });
}

export function canEditMonthlyScheduleCell(viewerRole, rowName) {
  if (fixedChiefShiftCodeForName(rowName)) return false;
  const role = String(viewerRole ?? "").trim();
  const sec = monthlyRowSection(rowName);
  if (role === "ADMIN" || role === "DEPT_HEAD") return true;
  if (sec === "anesthesia") return role === "ANESTHESIA" || role === "ADMIN2";
  if (sec === "chief") return role === "CHIEF";
  return role === "ADMIN" || role === "DEPT_HEAD";
}

export function canSaveMonthlyWorkSchedule(viewerRole) {
  const role = String(viewerRole ?? "").trim();
  return ["ADMIN", "DEPT_HEAD", "ANESTHESIA", "ADMIN2", "CHIEF"].includes(role);
}

/** 주간 번표 오버라이드 비교·병합용 정규화 */
export function normalizeWeeklyOverrideForCompare(raw) {
  const entry = raw && typeof raw === "object" ? raw : null;
  if (!entry || String(entry.mode ?? "") !== "manual") return null;
  const kind = String(entry.kind ?? "base");
  const main =
    kind === "leave"
      ? String(entry.main ?? "").trim()
      : kind === "base"
        ? String(entry.main ?? "").startsWith("__CUSTOM_SHIFT__:")
          ? entry.main
          : normalizeChiefShiftCode(entry.main ?? "")
        : String(entry.main ?? "").trim();
  return { mode: "manual", kind, main, sub: entry.sub ?? "" };
}

/** 역할별로 편집 가능한 셀만 draft를 서버 맵에 병합 */
export function mergeWeeklyCellOverridesForViewer(saved, draft, viewerRole, users, viewerUserId) {
  const out = { ...(saved && typeof saved === "object" ? saved : {}) };
  const d = draft && typeof draft === "object" ? draft : {};
  const keys = new Set([...Object.keys(out), ...Object.keys(d)]);
  for (const key of keys) {
    const uid = String(key.split("|")[0] ?? "");
    const u = (Array.isArray(users) ? users : []).find((x) => String(x.id) === uid);
    if (!u || !canEditWeeklyScheduleCell(viewerRole, u, viewerUserId)) continue;
    const val = d[key];
    if (val && String(val.mode ?? "") === "manual") out[key] = val;
    else delete out[key];
  }
  return out;
}

/** 역할별 편집 가능 셀만 비교해 dirty 여부 판단 */
export function weeklyCellOverridesDirtyForViewer(saved, draft, viewerRole, users, viewerUserId) {
  const keys = new Set([...Object.keys(saved || {}), ...Object.keys(draft || {})]);
  for (const key of keys) {
    const uid = String(key.split("|")[0] ?? "");
    const u = (Array.isArray(users) ? users : []).find((x) => String(x.id) === uid);
    if (!u || !canEditWeeklyScheduleCell(viewerRole, u, viewerUserId)) continue;
    const a = normalizeWeeklyOverrideForCompare(saved?.[key]);
    const b = normalizeWeeklyOverrideForCompare(draft?.[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  }
  return false;
}

/** 주간 번표 셀 선택박스 편집 (역할·본인 행 기준) */
export function canEditWeeklyScheduleCell(viewerRole, staffUser, viewerUserId) {
  const vr = String(viewerRole ?? "").trim();
  const tr = String(staffUser?.role ?? "").trim();
  const sid = String(staffUser?.id ?? "");
  const vid = String(viewerUserId ?? "");
  if (vr === "ADMIN" || vr === "DEPT_HEAD") return true;
  if (sid && vid && sid === vid) return true;
  if (tr === "ANESTHESIA") return vr === "ANESTHESIA" || vr === "ADMIN2";
  if (tr === "CHIEF") return vr === "CHIEF";
  if (tr === "NURSE") return vr === "NURSE" || vr === "ADMIN" || vr === "DEPT_HEAD";
  return false;
}

export function isFixedChiefShiftStaff(name) {
  return Boolean(fixedChiefShiftCodeForName(name));
}

export function canUseWeeklyScheduleEditor(viewerRole) {
  const role = String(viewerRole ?? "").trim();
  return ["ADMIN", "DEPT_HEAD", "NURSE", "ANESTHESIA", "ADMIN2", "CHIEF"].includes(role);
}

/** 역할별 저장 시 다른 섹션 행은 기존 값 유지 */
export function mergeMonthlySaveDraft(saved, draft, templateRows, viewerRole) {
  const base = mergeWorkScheduleRows(saved, templateRows);
  const draftMap = new Map((Array.isArray(draft) ? draft : []).map((r) => [r.name, r]));
  return base.map((row) => {
    const next = draftMap.get(row.name);
    if (!next || !canEditMonthlyScheduleCell(viewerRole, row.name)) return row;
    return { name: row.name, values: Array.isArray(next.values) ? [...next.values] : row.values };
  });
}

/** 주간 번표에 표시할 인원(보는 사람 역할 기준) — 구역별만 볼 때 */
export function weeklyStaffForViewer(users, viewerRole, anchorYmd = "") {
  const list = Array.isArray(users) ? users : [];
  const role = String(viewerRole ?? "").trim();
  if (role === "ANESTHESIA" || role === "ADMIN2") {
    return staffUsersByRole(list, "ANESTHESIA");
  }
  if (role === "CHIEF") {
    return chiefNamesForYmd(anchorYmd)
      .map((n) => list.find((u) => u.role === "CHIEF" && u.name === n && isUserActive(u)))
      .filter(Boolean);
  }
  return staffUsersByRole(list, "NURSE");
}

/** 주간 번표: 수술실 → 마취과 → 주임 (월간근무표와 동일 순서) */
export function weeklyRosterAllSections(users, anchorYmd = "") {
  const list = Array.isArray(users) ? users : [];
  const byName = (a, b) => a.name.localeCompare(b.name, "ko");
  const pickInOrder = (names, role) =>
    names
      .map((n) => list.find((u) => u.role === role && u.name === n && isUserActive(u)))
      .filter(Boolean)
      .concat(
        list.filter((u) => u.role === role && isUserActive(u) && !names.includes(u.name)).sort(byName)
      );
  const or = staffUsersByRole(list, "NURSE");
  const anesthesia = pickInOrder(ANESTHESIA_MONTHLY_NAMES, "ANESTHESIA");
  const chiefNames = chiefNamesForYmd(anchorYmd);
  const chief = chiefNames
    .map((n) => list.find((u) => u.role === "CHIEF" && u.name === n && isUserActive(u)))
    .filter(Boolean)
    .concat(
      list
        .filter(
          (u) =>
            u.role === "CHIEF" &&
            isUserActive(u) &&
            !chiefNames.includes(u.name) &&
            !CHIEF_REPLACEMENT_NAMES.has(u.name) &&
            !CHIEF_FUTURE_START_NAMES.has(u.name)
        )
        .sort(byName)
    );
  return [...or, ...anesthesia, ...chief];
}
