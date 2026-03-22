// 로컬: 폰으로 http://192.168.x.x:5175 접속 시 API는 자동으로 http://192.168.x.x:4015
const DEV_API_PORT = 4015;

function getResolvedApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return String(raw).trim().replace(/\/$/, "");
  }
  if (import.meta.env.PROD) return "";
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h && h !== "localhost" && h !== "127.0.0.1") {
      return `http://${h}:${DEV_API_PORT}`;
    }
  }
  return `http://localhost:${DEV_API_PORT}`;
}

const BASE_URL = `${getResolvedApiBase()}/api`;

async function requestJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
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
  downloadBackupSql: async () => {
    const res = await fetch(`${BASE_URL}/admin/backup-sql`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  restoreSql: (sql) =>
    requestJson("/admin/restore-sql", {
      method: "POST",
      body: JSON.stringify({ sql }),
    }),
};

