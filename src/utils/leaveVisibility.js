/** 수술실·마취과·주임 휴가 표시·관리 권한 */

import { isLeaveDateBeforeTodayKst } from "./rules.clean.js";

export const CHIEF_LEAVE_TYPE = "CHIEF_LEAVE";

export function userById(users, userId) {
  return (Array.isArray(users) ? users : []).find((u) => String(u.id) === String(userId));
}

export function isAnesthesiaStaffUserId(userId, users) {
  return userById(users, userId)?.role === "ANESTHESIA";
}

export function isChiefStaffUserId(userId, users) {
  return userById(users, userId)?.role === "CHIEF";
}

export function isOrNurseUserId(userId, users) {
  return userById(users, userId)?.role === "NURSE";
}

/** 주간 번표: 수술실·마취·주임 전원의 확정 휴가·대체 반영용 */
export function filterRequestsForWeeklyRoster(requests, users) {
  return (Array.isArray(requests) ? requests : []).filter((r) => {
    const role = userById(users, r.userId)?.role;
    return role === "NURSE" || role === "ANESTHESIA" || role === "CHIEF";
  });
}

export function isStaffLeaveRole(role) {
  return role === "NURSE" || role === "ANESTHESIA" || role === "CHIEF";
}

/** v2 서버 APPROVED·레거시 SELECTED */
export function isConfirmedLeaveStatus(status) {
  const st = String(status ?? "").trim();
  return st === "SELECTED" || st === "APPROVED";
}

/** 로그인 역할이 담당하는 휴가 신청·확정 부서 (관리자는 수술실·마취·주임에 대응) */
function viewerOwnDepartmentRoles(viewerRole) {
  if (viewerRole === "ANESTHESIA" || viewerRole === "ADMIN2") return new Set(["ANESTHESIA"]);
  if (viewerRole === "CHIEF") return new Set(["CHIEF"]);
  if (viewerRole === "NURSE" || viewerRole === "ADMIN") return new Set(["NURSE"]);
  return null;
}

/** 캘린더·상세 표시 순: 수술실 → 마취과 → 주임 */
export const STAFF_LEAVE_ROLES_ORDER = ["NURSE", "ANESTHESIA", "CHIEF"];

export function splitRequestsByStaffRole(requests, users) {
  const buckets = { NURSE: [], ANESTHESIA: [], CHIEF: [] };
  for (const r of Array.isArray(requests) ? requests : []) {
    const role = userById(users, r.userId)?.role;
    if (role && buckets[role]) buckets[role].push(r);
  }
  return buckets;
}

/** 소속 부서·해당일 기준 월간 칩에 넣을 신청 행 */
function ownDeptRowsVisibleOnCalendarGrid(dayRows, leaveDateYmd) {
  if (!Array.isArray(dayRows) || dayRows.length === 0) return [];

  const ld = String(leaveDateYmd ?? dayRows[0]?.leaveDate ?? "").slice(0, 10);
  const confirmed = dayRows.filter((r) => isConfirmedLeaveStatus(r.status));
  if (confirmed.length > 0) return confirmed;

  if (isLeaveDateBeforeTodayKst(ld)) return [];

  const hasApplied = dayRows.some((r) => String(r.status ?? "").trim() === "APPLIED");
  if (!hasApplied) return [];

  return dayRows.filter((r) => {
    const st = String(r.status ?? "").trim();
    return st === "APPLIED" || st === "CANCELLED" || st === "REJECTED";
  });
}

/**
 * 월간 달력 칩:
 * - 타 부서: 확정(휴가자)만
 * - 소속 부서·해당일 확정 있음: 확정만
 * - 소속 부서·오늘 이후·미확정·신청(APPLIED) 있음: 신청·취소·반려 표시
 * - 소속 부서·과거일: 확정만(없으면 칩 없음)
 */
export function filterRequestsForCalendarGrid(requests, users, viewerRole) {
  const rows = Array.isArray(requests) ? requests : [];
  const ownDepts = viewerOwnDepartmentRoles(viewerRole);

  const ownDeptVisibleIds = new Set();
  if (ownDepts) {
    const byDayRole = new Map();
    for (const r of rows) {
      const subjectRole = userById(users, r.userId)?.role;
      if (!ownDepts.has(subjectRole)) continue;
      const key = `${String(r.leaveDate ?? "").slice(0, 10)}|${subjectRole}`;
      if (!byDayRole.has(key)) byDayRole.set(key, []);
      byDayRole.get(key).push(r);
    }
    for (const [key, dayRows] of byDayRole) {
      const leaveDateYmd = key.split("|")[0];
      for (const r of ownDeptRowsVisibleOnCalendarGrid(dayRows, leaveDateYmd)) {
        ownDeptVisibleIds.add(String(r.id ?? ""));
      }
    }
  }

  return rows.filter((r) => {
    const subjectRole = userById(users, r.userId)?.role;
    if (!isStaffLeaveRole(subjectRole)) return false;
    if (!ownDepts?.has(subjectRole)) {
      return isConfirmedLeaveStatus(r.status);
    }
    return ownDeptVisibleIds.has(String(r.id ?? ""));
  });
}

/**
 * 캘린더·목록: 본인 부서는 전 상태, 타 부서는 확정(SELECTED/APPROVED)만 전 직원 열람
 */
export function filterRequestsForViewerRole(requests, users, viewerRole) {
  const rows = Array.isArray(requests) ? requests : [];
  const ownDepts = viewerOwnDepartmentRoles(viewerRole);

  return rows.filter((r) => {
    const subjectRole = userById(users, r.userId)?.role;
    if (!isStaffLeaveRole(subjectRole)) return false;
    if (isConfirmedLeaveStatus(r.status)) return true;
    if (!ownDepts) return false;
    return ownDepts.has(subjectRole);
  });
}

function filterPublishedByRole(requests, users, isWinnerStatus, staffCheck) {
  return (Array.isArray(requests) ? requests : []).filter(
    (r) => staffCheck(r.userId, users) && isWinnerStatus(r.status)
  );
}

/** 수술실 화면 하단: 마취과 확정 휴가 */
export function filterAnesthesiaPublishedForOrView(requests, users, isWinnerStatus) {
  return filterPublishedByRole(requests, users, isWinnerStatus, isAnesthesiaStaffUserId);
}

/** 수술실 화면 하단: 주임 확정 휴가 */
export function filterChiefPublishedForOrView(requests, users, isWinnerStatus) {
  return filterPublishedByRole(requests, users, isWinnerStatus, isChiefStaffUserId);
}

export function canViewerApproveRequest(viewerRole, requestUserId, users) {
  if (isAnesthesiaStaffUserId(requestUserId, users)) return viewerRole === "ADMIN2";
  if (isChiefStaffUserId(requestUserId, users)) return viewerRole === "CHIEF";
  if (isOrNurseUserId(requestUserId, users)) return viewerRole === "ADMIN";
  return false;
}

export function canViewerRejectRequest(viewerRole, requestUserId, users) {
  return canViewerApproveRequest(viewerRole, requestUserId, users);
}

export function isOrLeaveAdminRole(role) {
  return role === "ADMIN";
}

export function isAnesthesiaLeaveAdminRole(role) {
  return role === "ADMIN2";
}

export function isChiefLeaveAdminRole(role) {
  return role === "CHIEF";
}

/** 캘린더 대체 입력 UI 담당 부서 (ADMIN→수술실, ADMIN2→마취, CHIEF→주임) */
export function substituteScopeStaffRole(viewerRole) {
  if (isOrLeaveAdminRole(viewerRole)) return "NURSE";
  if (isAnesthesiaLeaveAdminRole(viewerRole)) return "ANESTHESIA";
  if (isChiefLeaveAdminRole(viewerRole)) return "CHIEF";
  return null;
}

/** 휴가 신청 없이 날짜만 대체 번표 저장 (ADMIN→수술실, ADMIN2→마취과) */
export function canUseStandaloneSubstituteForViewer(viewerRole) {
  return isOrLeaveAdminRole(viewerRole) || isAnesthesiaLeaveAdminRole(viewerRole);
}

export function standaloneSubstituteRequestId(ymd, staffRole = "NURSE") {
  const d = String(ymd ?? "").slice(0, 10);
  if (staffRole === "ANESTHESIA") return `standalone_sub_anesthesia:${d}`;
  return `standalone_sub:${d}`;
}

export function isStandaloneSubstituteRequestId(id) {
  return /^standalone_sub(?:_anesthesia)?:\d{4}-\d{2}-\d{2}$/.test(String(id ?? ""));
}

export function parseStandaloneSubstituteLeaveDate(requestId) {
  const m = /^standalone_sub(?:_anesthesia)?:(\d{4}-\d{2}-\d{2})$/.exec(String(requestId ?? ""));
  return m ? m[1] : "";
}

/** 동일 requestId·대체자·번표 중복 제거 */
export function getSubstituteRecordsForRequest(substituteAssignments, requestId) {
  const rows = (Array.isArray(substituteAssignments) ? substituteAssignments : []).filter(
    (x) => x.requestId === requestId
  );
  const seen = new Set();
  return rows.filter((x) => {
    const key = `${String(x?.requestId ?? "")}|${String(x?.substituteUserId ?? "")}|${String(x?.shiftCode ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 캘린더 대체 입력란 행 구성.
 * standalone(날짜 버킷)에 저장된 대체가 있으면 해당 scope는 버킷만 표시하고
 * 휴가 신청별 빈 칸·per-request 복원은 생략한다(수술실 6명→6칸 중복 방지).
 */
export function buildCalendarSubstituteEditorRows({
  selectedYmd,
  substituteScope,
  targets,
  substituteAssignments,
  users,
  allowStandaloneSubstitute,
  resolveShiftCode,
}) {
  if (!selectedYmd || !substituteScope) return [];
  const targetList = Array.isArray(targets) ? targets : [];
  const sid = standaloneSubstituteRequestId(selectedYmd, substituteScope);
  const orphanRecs = allowStandaloneSubstitute
    ? getSubstituteRecordsForRequest(substituteAssignments, sid)
    : [];
  const useStandaloneOnly = orphanRecs.length > 0;
  const defaultSubRole = substituteScope;
  const shiftCell = (s, requestId) => {
    let role = defaultSubRole;
    if (requestId && requestId !== sid) {
      const req = targetList.find((t) => t.id === requestId);
      role = userById(users, req?.userId)?.role ?? defaultSubRole;
    }
    const raw = s?.shiftCode;
    if (typeof resolveShiftCode === "function") return resolveShiftCode(raw, role);
    return String(raw ?? "").trim();
  };

  const restored = [];
  if (!useStandaloneOnly) {
    for (const t of targetList) {
      const recs = getSubstituteRecordsForRequest(substituteAssignments, t.id);
      if (!Array.isArray(recs) || recs.length === 0) continue;
      for (let idx = 0; idx < recs.length; idx += 1) {
        const s = recs[idx];
        restored.push({
          rowId: `cal_sub_${t.id}_${idx}`,
          requestId: t.id,
          substituteUserId: String(s?.substituteUserId ?? ""),
          shiftCode: shiftCell(s, t.id),
        });
      }
    }
  }
  for (let idx = 0; idx < orphanRecs.length; idx += 1) {
    const s = orphanRecs[idx];
    restored.push({
      rowId: `cal_standalone_${sid}_${idx}`,
      requestId: sid,
      substituteUserId: String(s?.substituteUserId ?? ""),
      shiftCode: shiftCell(s, sid),
    });
  }
  if (!useStandaloneOnly) {
    const pendingTargets = targetList.filter(
      (t) => getSubstituteRecordsForRequest(substituteAssignments, t.id).length === 0
    );
    for (const t of pendingTargets) {
      restored.push({
        rowId: `cal_sub_${t.id}_pending`,
        requestId: t.id,
        substituteUserId: "",
        shiftCode: "",
      });
    }
  }

  if (targetList.length === 0) {
    if (orphanRecs.length > 0) return restored;
    if (allowStandaloneSubstitute) {
      return [{ rowId: `cal_sub_empty_${selectedYmd}`, requestId: sid, substituteUserId: "", shiftCode: "" }];
    }
    return [];
  }

  return restored;
}

export function requestSubjectStaffRole(requestRow, users) {
  return userById(users, requestRow?.userId)?.role ?? "";
}

export function isLeaveManagerRole(role) {
  return isOrLeaveAdminRole(role) || isAnesthesiaLeaveAdminRole(role) || isChiefLeaveAdminRole(role);
}

/** @deprecated 확정 휴가는 filterRequestsForViewerRole에 통합 — 중복 칩 방지 */
export function showDepartmentPublishedOverlay(_viewerRole) {
  return false;
}

/** @deprecated use showDepartmentPublishedOverlay */
export function showAnesthesiaPublishedOverlay(viewerRole) {
  return showDepartmentPublishedOverlay(viewerRole);
}

/** 현황: 월간·주간만 (골드키·사다리 등 제외) */
export function isScheduleOnlyDashboardRole(role) {
  return role === "ANESTHESIA" || role === "ADMIN2" || role === "CHIEF";
}

export function canApplyLeaveRole(role) {
  return role === "NURSE" || role === "ANESTHESIA" || role === "CHIEF";
}

export function showHolidayDutyEditorRole(role) {
  return role === "NURSE" || role === "ADMIN" || role === "ANESTHESIA";
}
