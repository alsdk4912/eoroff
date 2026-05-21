/** 수술실·마취과·주임 휴가 표시·관리 권한 */

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

/** 역할별 캔린더·목록에 쓸 신청 */
export function filterRequestsForViewerRole(requests, users, viewerRole) {
  const rows = Array.isArray(requests) ? requests : [];
  if (viewerRole === "ANESTHESIA" || viewerRole === "ADMIN2") {
    return rows.filter((r) => isAnesthesiaStaffUserId(r.userId, users));
  }
  if (viewerRole === "CHIEF" || viewerRole === "ADMIN3") {
    return rows.filter((r) => isChiefStaffUserId(r.userId, users));
  }
  if (viewerRole === "NURSE" || viewerRole === "ADMIN") {
    return rows.filter((r) => isOrNurseUserId(r.userId, users));
  }
  return rows;
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
  if (isChiefStaffUserId(requestUserId, users)) return viewerRole === "ADMIN3";
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
  return role === "ADMIN3";
}

export function isLeaveManagerRole(role) {
  return isOrLeaveAdminRole(role) || isAnesthesiaLeaveAdminRole(role) || isChiefLeaveAdminRole(role);
}

/** 수술실·관리자: 타 부서 확정 휴가 하단 표시 */
export function showDepartmentPublishedOverlay(viewerRole) {
  return viewerRole === "NURSE" || viewerRole === "ADMIN";
}

/** @deprecated use showDepartmentPublishedOverlay */
export function showAnesthesiaPublishedOverlay(viewerRole) {
  return showDepartmentPublishedOverlay(viewerRole);
}

/** 현황: 월간·주간만 (골드키·사다리 등 제외) */
export function isScheduleOnlyDashboardRole(role) {
  return role === "ANESTHESIA" || role === "ADMIN2" || role === "CHIEF" || role === "ADMIN3";
}

export function canApplyLeaveRole(role) {
  return role === "NURSE" || role === "ANESTHESIA" || role === "CHIEF";
}

export function showHolidayDutyEditorRole(role) {
  return role === "NURSE" || role === "ADMIN" || role === "ANESTHESIA";
}
