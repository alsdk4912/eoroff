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
