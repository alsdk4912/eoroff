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
  const res = await fetch(`${API_ROOT}${path}`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
    },
    ...rest,
  });

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
  cancelRequest: (id, payload) =>
    requestJson(`/requests/${id}/cancel`, { method: "POST", body: JSON.stringify(payload) }),
  selectRequest: (id, payload) =>
    requestJson(`/requests/${id}/select`, { method: "POST", body: JSON.stringify(payload) }),
  rejectRequest: (id) => requestJson(`/requests/${id}/reject`, { method: "POST" }),
  addNote: (payload) => requestJson("/notes", { method: "POST", body: JSON.stringify(payload) }),
  updateGoldkey: (userId, payload) =>
    requestJson(`/goldkeys/${userId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  syncHolidays: (payload) =>
    requestJson("/holidays/sync", { method: "POST", body: JSON.stringify(payload) }),
  changePassword: (payload) =>
    requestJson("/change-password", { method: "POST", body: JSON.stringify(payload) }),
  listUsers: () => requestJson("/admin/users"),
  resetUserPassword: (targetUserId, payload) =>
    requestJson(`/admin/users/${targetUserId}/reset-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resetLeaveData: (payload) =>
    requestJson("/admin/reset-leave-data", { method: "POST", body: JSON.stringify(payload) }),
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
};

