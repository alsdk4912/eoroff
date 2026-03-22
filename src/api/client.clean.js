// 로컬: 폰으로 http://192.168.x.x:5175 접속 시 API는 자동으로 http://192.168.x.x:4015
// GitHub Pages: VITE_API_BASE_URL 없이 /api 로 POST 하면 정적 서버가 405를 돌려줌 → Render URL을 Actions Secret에 넣거나 null 처리
const DEV_API_PORT = 4015;

function getResolvedApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    return String(raw).trim().replace(/\/$/, "");
  }
  if (import.meta.env.PROD) {
    // API 주소를 빌드에 넣지 않으면 상대 /api 로 POST → 정적 호스팅에서 405. 오프라인 로그인만 사용.
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
  const res = await fetch(`${API_ROOT}${path}`, {
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
    if (API_ROOT === null) throw new TypeError("Failed to fetch");
    const res = await fetch(`${API_ROOT}/admin/backup-sql`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  restoreSql: (sql) =>
    requestJson("/admin/restore-sql", {
      method: "POST",
      body: JSON.stringify({ sql }),
    }),
};

