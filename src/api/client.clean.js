// 로컬: 폰으로 LAN IP로 접속 시 API도 같은 IP:4000
// github.io + VITE_API_BASE_URL 없음 → /api POST 시 405 방지 (null)
const DEV_API_PORT = 4015;

function getResolvedApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return String(raw).trim().replace(/\/$/, "");
  }
  if (import.meta.env.PROD) {
    return null;
  }
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h && h !== "localhost" && h !== "127.0.0.1") {
      return `http://${h}:${DEV_API_PORT}`;
    }
  }
  return `http://localhost:${DEV_API_PORT}`;
}

const API_ROOT = (() => {
  const b = getResolvedApiBase();
  return b === null ? null : `${b}/api`;
})();

async function requestJson(path, options = {}) {
  if (API_ROOT === null) {
    throw new TypeError("Failed to fetch");
  }
  const { headers: extraHeaders, ...rest } = options;
  const ctrl = new AbortController();
  const timeoutMs = 10000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
      },
      signal: ctrl.signal,
      ...rest,
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      message = data?.error || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return res.json();
}

export const api = {
  login: (payload) => requestJson("/login", { method: "POST", body: JSON.stringify(payload) }),
  bootstrap: () => requestJson("/bootstrap"),
  createRequest: (payload) =>
    requestJson("/requests", { method: "POST", body: JSON.stringify(payload) }),
  /** POST: 일부 호스팅에서 PATCH가 404로 떨어지는 경우 대비(cancel 등과 동일 메서드 패턴) */
  patchNegotiationOrder: (id, payload) =>
    requestJson(`/requests/${encodeURIComponent(id)}/negotiation-order`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** 확정 휴가: 일정 표시(개인/공가/필수교육) — 본인만 */
  patchLeaveNature: (id, payload) =>
    requestJson(`/requests/${encodeURIComponent(id)}/leave-nature`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  cancelRequest: (id, payload) =>
    requestJson(`/requests/${id}/cancel`, { method: "POST", body: JSON.stringify(payload) }),
  uncancelRequest: (id, payload) =>
    requestJson(`/requests/${id}/uncancel`, { method: "POST", body: JSON.stringify(payload) }),
  selectRequest: (id, payload) =>
    requestJson(`/requests/${id}/select`, { method: "POST", body: JSON.stringify(payload) }),
  unselectRequest: (id, payload) =>
    requestJson(`/requests/${id}/unselect`, { method: "POST", body: JSON.stringify(payload) }),
  rejectRequest: (id, payload = {}) =>
    requestJson(`/requests/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify(payload) }),
  addNote: (payload) => requestJson("/notes", { method: "POST", body: JSON.stringify(payload) }),
  updateGoldkey: (userId, payload) =>
    requestJson(`/goldkeys/${userId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  syncHolidays: (payload) =>
    requestJson("/holidays/sync", { method: "POST", body: JSON.stringify(payload) }),
  changePassword: (payload) =>
    requestJson("/change-password", { method: "POST", body: JSON.stringify(payload) }),
  resetPasswordByIdentity: (payload) =>
    requestJson("/password-reset", { method: "POST", body: JSON.stringify(payload) }),
  listUsers: () => requestJson("/admin/users"),
  resetUserPassword: (targetUserId, payload) =>
    requestJson(`/admin/users/${targetUserId}/reset-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resetLeaveData: (payload) =>
    requestJson("/admin/reset-leave-data", { method: "POST", body: JSON.stringify(payload) }),
  upsertHolidayDuty: (payload) =>
    requestJson("/admin/holiday-duties", { method: "POST", body: JSON.stringify(payload) }),
  upsertSubstituteAssignments: (requestId, payload) =>
    requestJson(`/substitute-assignments/${encodeURIComponent(String(requestId ?? ""))}/upsert`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** 주간 번표 수동 셀 전체 동기화(서버 저장 → bootstrap으로 전 사용자 반영) */
  syncWeeklyCellOverrides: (payload) =>
    requestJson("/weekly-cell-overrides/sync", { method: "POST", body: JSON.stringify(payload) }),
  createLadderResult: (payload) =>
    requestJson("/ladder-results", { method: "POST", body: JSON.stringify(payload) }),
  upsertAdminDayMemo: (payload) =>
    requestJson("/admin/day-memos", { method: "POST", body: JSON.stringify(payload) }),
  createDayComment: (payload) =>
    requestJson("/day-comments", { method: "POST", body: JSON.stringify(payload) }),
  updateDayComment: (id, payload) =>
    requestJson(`/day-comments/${encodeURIComponent(id)}/update`, { method: "POST", body: JSON.stringify(payload) }),
  deleteDayComment: (id, payload) =>
    requestJson(`/day-comments/${encodeURIComponent(id)}/delete`, { method: "POST", body: JSON.stringify(payload) }),
  listNotifications: (userId) =>
    requestJson(`/notifications?userId=${encodeURIComponent(String(userId ?? ""))}`),
  markAllNotificationsRead: (payload) =>
    requestJson("/notifications/read-all", { method: "POST", body: JSON.stringify(payload) }),
  markNotificationRead: (notificationId, payload) =>
    requestJson(`/notifications/${encodeURIComponent(String(notificationId ?? ""))}/read`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getPushVapidPublicKey: () => requestJson("/push/vapid-public-key"),
  savePushSubscription: (payload) =>
    requestJson("/push-subscriptions", { method: "POST", body: JSON.stringify(payload) }),
  removePushSubscription: (payload) =>
    requestJson("/push-subscriptions/remove", { method: "POST", body: JSON.stringify(payload) }),
  sendPushTestToSelf: (payload) =>
    requestJson("/push/test-self", { method: "POST", body: JSON.stringify(payload) }),
  bulkSetGoldkeyUsage: (payload) =>
    requestJson("/admin/goldkeys/usage-bulk", { method: "POST", body: JSON.stringify(payload) }),
  downloadBackupSql: async () => {
    if (API_ROOT === null) throw new TypeError("Failed to fetch");
    const res = await fetch(`${API_ROOT}/admin/backup-sql`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  restoreSql: (sql) =>
    requestJson("/admin/restore-sql", {
      method: "POST",
      body: JSON.stringify({ sql }),
    }),
  /** 관리자: 휴가일(leave_date) 구간별 신청·상태 CSV */
  downloadLeaveExportCsv: async ({ actorUserId, from, to }) => {
    if (API_ROOT === null) throw new TypeError("Failed to fetch");
    const q = new URLSearchParams({ actorUserId, from, to });
    const res = await fetch(`${API_ROOT}/admin/leave-export.csv?${q}`, { cache: "no-store" });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `HTTP ${res.status}`);
    }
    return res.text();
  },
  /** 관리자: 감사 이력(상태 변경) CSV — created_at 구간 */
  downloadLeaveAuditExportCsv: async ({ actorUserId, from, to }) => {
    if (API_ROOT === null) throw new TypeError("Failed to fetch");
    const q = new URLSearchParams({ actorUserId, from, to });
    const res = await fetch(`${API_ROOT}/admin/leave-audit-export.csv?${q}`, { cache: "no-store" });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `HTTP ${res.status}`);
    }
    return res.text();
  },
};

