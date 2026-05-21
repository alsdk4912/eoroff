/** 수술실·마취과 휴가 표시·관리 권한 */

export function userById(users, userId) {
  return (Array.isArray(users) ? users : []).find((u) => String(u.id) === String(userId));
}

export function isAnesthesiaStaffUserId(userId, users) {
  return userById(users, userId)?.role === "ANESTHESIA";
}

export function isOrNurseUserId(userId, users) {
  return userById(users, userId)?.role === "NURSE";
}

/** 역할별 캘린더·목록에 쓸 신청 (마취/관리자2 → 마취과만, 수술실·관리자 → 수술실만) */
export function filterRequestsForViewerRole(requests, users, viewerRole) {
  const rows = Array.isArray(requests) ? requests : [];
  if (viewerRole === "ANESTHESIA" || viewerRole === "ADMIN2") {
    return rows.filter((r) => isAnesthesiaStaffUserId(r.userId, users));
  }
  if (viewerRole === "NURSE" || viewerRole === "ADMIN") {
    return rows.filter((r) => isOrNurseUserId(r.userId, users));
  }
  return rows;
}

/** 수술실 간호사 화면 하단: 마취과 확정 휴가만 */
export function filterAnesthesiaPublishedForOrView(requests, users, isWinnerStatus) {
  return (Array.isArray(requests) ? requests : []).filter(
    (r) => isAnesthesiaStaffUserId(r.userId, users) && isWinnerStatus(r.status)
  );
}

export function canViewerApproveRequest(viewerRole, requestUserId, users) {
  if (isAnesthesiaStaffUserId(requestUserId, users)) return viewerRole === "ADMIN2";
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

export function isLeaveManagerRole(role) {
  return isOrLeaveAdminRole(role) || isAnesthesiaLeaveAdminRole(role);
}

/** 수술실 간호사·관리자가 마취과 확정분을 함께 볼지 */
export function showAnesthesiaPublishedOverlay(viewerRole) {
  return viewerRole === "NURSE" || viewerRole === "ADMIN";
}
