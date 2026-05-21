/** 수술실·마취과·주임 주간/대체 번표 코드 (역할별 상이) */

/** 수술실 간호사 */
export const NURSE_SHIFT_OPTIONS = [
  "",
  "안E",
  "안D0",
  "수E",
  "9-5",
  "5D2",
  "3",
  "3D1",
  "7D2",
  "6D2",
  "6D1",
  "3D2",
  "1D2",
  "7D1",
  "1D1",
  "5D1",
  "PRN",
  "휴가",
  "공가",
  "반차",
  "필수교육",
];

/** 마취과 간호사 */
export const ANESTHESIA_SHIFT_OPTIONS = ["", "D0", "R1", "R3"];

/** 주임 */
export const CHIEF_SHIFT_OPTIONS = ["", "D0", "D1", "9-5", "E"];

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
export const CHIEF_MONTHLY_NAMES = ["방현석", "최무영", "김보람", "이찬주", "오세연"];

export function emptyScheduleMonthValues(monthCount) {
  const n = Math.max(0, Number(monthCount) || 0);
  return Array.from({ length: n }, () => "");
}

export function monthlyRowSection(name) {
  const n = String(name ?? "").trim();
  if (ANESTHESIA_MONTHLY_NAMES.includes(n)) return "anesthesia";
  if (CHIEF_MONTHLY_NAMES.includes(n)) return "chief";
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
  const map = new Map((Array.isArray(saved) ? saved : []).map((r) => [String(r?.name ?? ""), r]));
  return template.map((t) => {
    const len = (t.values || []).length;
    const hit = map.get(t.name);
    if (!hit) return { name: t.name, values: emptyScheduleMonthValues(len) };
    const vals = Array.isArray(hit.values) ? hit.values : [];
    const values = Array.from({ length: len }, (_, i) => String(vals[i] ?? ""));
    return { name: t.name, values };
  });
}

export function canEditMonthlyScheduleCell(viewerRole, rowName) {
  const role = String(viewerRole ?? "").trim();
  const sec = monthlyRowSection(rowName);
  if (role === "ADMIN") return true;
  if (sec === "anesthesia") return role === "ANESTHESIA" || role === "ADMIN2";
  if (sec === "chief") return role === "CHIEF" || role === "ADMIN3";
  return role === "ADMIN" || role === "NURSE";
}

export function canSaveMonthlyWorkSchedule(viewerRole) {
  const role = String(viewerRole ?? "").trim();
  return ["ADMIN", "NURSE", "ANESTHESIA", "ADMIN2", "CHIEF", "ADMIN3"].includes(role);
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

/** 주간 번표에 표시할 인원(보는 사람 역할 기준) */
export function weeklyStaffForViewer(users, viewerRole) {
  const list = Array.isArray(users) ? users : [];
  const role = String(viewerRole ?? "").trim();
  if (role === "ANESTHESIA" || role === "ADMIN2") {
    return list.filter((u) => u.role === "ANESTHESIA").sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  if (role === "CHIEF" || role === "ADMIN3") {
    return list.filter((u) => u.role === "CHIEF").sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  return list.filter((u) => u.role === "NURSE").sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
