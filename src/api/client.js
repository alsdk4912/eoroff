export { api } from "./client.clean.js";
/*
const BASE_URL = `${import.meta.env.VITE_API_BASE_URL || "http://localhost:4010"}/api`;

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

const BASE_URL = `${import.meta.env.VITE_API_BASE_URL || "http://localhost:4010"}/api`;

async function request(path, options = {}) {
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
      const text = await res.text().catch(() => "");
      message = text || message;
    }
    throw new Error(message);
  }

  // text endpoints (backup sql) will be handled separately
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

export const api = {
  login: (payload) => request("/login", { method: "POST", body: JSON.stringify(payload) }),
  bootstrap: () => request("/bootstrap"),

  createRequest: (payload) =>
    request("/requests", { method: "POST", body: JSON.stringify(payload) }),
  cancelRequest: (id, payload) =>
    request(`/requests/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  selectRequest: (id, payload) =>
    request(`/requests/${id}/select`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  rejectRequest: (id) => request(`/requests/${id}/reject`, { method: "POST" }),

  addNote: (payload) => request("/notes", { method: "POST", body: JSON.stringify(payload) }),

  updateGoldkey: (userId, payload) =>
    request(`/goldkeys/${userId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  syncHolidays: (payload) =>
    request("/holidays/sync", { method: "POST", body: JSON.stringify(payload) }),

  changePassword: (payload) =>
    request("/change-password", { method: "POST", body: JSON.stringify(payload) }),

  listUsers: () => request("/admin/users"),

  resetUserPassword: (targetUserId, payload) =>
    request(`/admin/users/${targetUserId}/reset-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  downloadBackupSql: async () => {
    const res = await fetch(`${BASE_URL}/admin/backup-sql`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },

  restoreSql: (sql) =>
    request("/admin/restore-sql", { method: "POST", body: JSON.stringify({ sql }) }),
};
* /

const BASE_URL = `${import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"}/api`;

async function request(path, options = {}) {
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
      const text = await res.text();
      message = text || message;
    }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  login: (payload) => request("/login", { method: "POST", body: JSON.stringify(payload) }),
  changePassword: (payload) =>
    request("/change-password", { method: "POST", body: JSON.stringify(payload) }),
  listUsers: () => request("/admin/users"),
  resetUserPassword: (userId, payload) =>
    request(`/admin/users/${userId}/reset-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  bootstrap: () => request("/bootstrap"),
  createRequest: (payload) =>
    request("/requests", { method: "POST", body: JSON.stringify(payload) }),
  cancelRequest: (id, payload) =>
    request(`/requests/${id}/cancel`, { method: "POST", body: JSON.stringify(payload) }),
  selectRequest: (id, payload) =>
    request(`/requests/${id}/select`, { method: "POST", body: JSON.stringify(payload) }),
  rejectRequest: (id) => request(`/requests/${id}/reject`, { method: "POST" }),
  addNote: (payload) => request("/notes", { method: "POST", body: JSON.stringify(payload) }),
  updateGoldkey: (userId, payload) =>
    request(`/goldkeys/${userId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  syncHolidays: (payload) =>
    request("/holidays/sync", { method: "POST", body: JSON.stringify(payload) }),
  downloadBackupSql: async () => {
    const res = await fetch(`${BASE_URL}/admin/backup-sql`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  restoreSql: (sql) =>
    request("/admin/restore-sql", { method: "POST", body: JSON.stringify({ sql }) }),
};
*/
