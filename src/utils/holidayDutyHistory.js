/** 휴일 당직자 변경 이력 — 슬롯·표시·로컬 누적 */

export const HOLIDAY_DUTY_SLOTS = ["nurse1", "nurse2", "anesthesia"];

const SLOT_LABEL = {
  nurse1: "당직자1",
  nurse2: "당직자2",
  anesthesia: "마취과 당직자",
};

export function holidayDutySlotLabel(slot) {
  return SLOT_LABEL[String(slot ?? "").trim()] ?? String(slot ?? "");
}

export function userNameFromId(users, userId) {
  const id = String(userId ?? "").trim();
  if (!id) return "—";
  const u = (Array.isArray(users) ? users : []).find((row) => String(row.id) === id);
  return u?.name ?? id;
}

/** API·로컬 혼용 행 → 정규 객체 */
export function normalizeHolidayDutyHistoryRow(row) {
  if (!row) return null;
  const holidayDate = String(row.holiday_date ?? row.holidayDate ?? "").slice(0, 10);
  const slot = String(row.slot ?? "").trim();
  if (!holidayDate || !slot) return null;
  return {
    id: String(row.id ?? `${holidayDate}|${slot}|${row.changed_at ?? row.changedAt ?? Date.now()}`),
    holidayDate,
    slot,
    fromUserId: String(row.from_user_id ?? row.fromUserId ?? "").trim() || null,
    toUserId: String(row.to_user_id ?? row.toUserId ?? "").trim(),
    changedBy: String(row.changed_by ?? row.changedBy ?? "").trim(),
    changedAt: String(row.changed_at ?? row.changedAt ?? "").trim(),
  };
}

/** 날짜별 이력 배열 맵 */
export function groupHolidayDutyHistoryByDate(rows) {
  const map = {};
  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = normalizeHolidayDutyHistoryRow(raw);
    if (!row?.holidayDate) continue;
    if (!map[row.holidayDate]) map[row.holidayDate] = [];
    map[row.holidayDate].push(row);
  }
  for (const hd of Object.keys(map)) {
    map[hd].sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt)));
  }
  return map;
}

/** 저장 시 변경된 슬롯만 추출 */
export function diffHolidayDutyAssignments(prev, next) {
  const p = prev ?? {};
  const n = next ?? {};
  const pairs = [
    ["nurse1", "nurse1UserId"],
    ["nurse2", "nurse2UserId"],
    ["anesthesia", "anesthesiaUserId"],
  ];
  const changes = [];
  for (const [slot, key] of pairs) {
    const fromId = String(p[key] ?? "").trim() || null;
    const toId = String(n[key] ?? "").trim();
    if (!toId || fromId === toId) continue;
    changes.push({ slot, fromUserId: fromId, toUserId: toId });
  }
  return changes;
}

export function appendHolidayDutyHistoryEntries(prevByDate, holidayDate, changes, actorUserId, nowIso = new Date().toISOString()) {
  const hd = String(holidayDate ?? "").slice(0, 10);
  if (!hd || !Array.isArray(changes) || changes.length === 0) return prevByDate ?? {};
  const next = { ...(prevByDate ?? {}) };
  const list = [...(next[hd] ?? [])];
  for (const c of changes) {
    list.push({
      id: `hdh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      holidayDate: hd,
      slot: c.slot,
      fromUserId: c.fromUserId ?? null,
      toUserId: c.toUserId,
      changedBy: String(actorUserId ?? "").trim(),
      changedAt: nowIso,
    });
  }
  list.sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt)));
  next[hd] = list;
  return next;
}

/** `당직자1: 최종선 → 오민아` */
export function formatHolidayDutyHistoryLine(entry, users) {
  const slot = holidayDutySlotLabel(entry?.slot);
  const fromName = userNameFromId(users, entry?.fromUserId);
  const toName = userNameFromId(users, entry?.toUserId);
  return `${slot}: ${fromName} → ${toName}`;
}
