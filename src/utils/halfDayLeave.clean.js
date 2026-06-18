/** 반차2 권장 사용 기한: 반차1 휴가일 기준 3개월 (자동 지정과 무관, 알림·안내용) */
export const HALF_DAY2_DEADLINE_MONTHS = 3;

/** 반차2 기한 푸시 알림 시작: 기한 30일 전부터 */
export const HALF_DAY2_REMINDER_DAYS_BEFORE = 30;

export const HALF_DAY_SLOT_VALUES = new Set(["1", "2"]);

export function halfDaySlotLabel(slot) {
  const s = String(slot ?? "").trim();
  if (s === "1") return "반차1";
  if (s === "2") return "반차2";
  return "";
}

function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim().slice(0, 10));
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function toYmd({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** YYYY-MM-DD에 n개월 더함 (말일 보정) */
export function addMonthsToYmd(ymd, months) {
  const p = parseYmd(ymd);
  if (!p) return "";
  const d = new Date(p.year, p.month - 1 + months, p.day);
  return toYmd({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

export function halfDay2DeadlineYmd(halfDay1LeaveDate) {
  return addMonthsToYmd(halfDay1LeaveDate, HALF_DAY2_DEADLINE_MONTHS);
}

function compareYmd(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function isApprovedHalfDayRow(row) {
  return (
    String(row?.leaveType ?? row?.leave_type ?? "").trim() === "HALF_DAY" &&
    String(row?.status ?? "").trim() === "APPROVED"
  );
}

function rowLeaveDate(row) {
  return String(row?.leaveDate ?? row?.leave_date ?? "").trim().slice(0, 10);
}

function rowHalfDaySlot(row) {
  return String(row?.halfDaySlot ?? row?.half_day_slot ?? "").trim();
}

function rowUserId(row) {
  return String(row?.userId ?? row?.user_id ?? "").trim();
}

function rowId(row) {
  return String(row?.id ?? "").trim();
}

/** 반차1에 대응하는 반차2가 있는지 (그 사이에 다른 반차1 없음) */
export function hasMatchingHalfDay2(halfDay1Row, allRows) {
  const hd1Date = rowLeaveDate(halfDay1Row);
  const hd1Id = rowId(halfDay1Row);
  const userId = rowUserId(halfDay1Row);
  const sorted = [...allRows]
    .filter((r) => rowUserId(r) === userId && isApprovedHalfDayRow(r))
    .sort((a, b) => compareYmd(rowLeaveDate(a), rowLeaveDate(b)));

  const nextHd1 = sorted.find(
    (r) => rowHalfDaySlot(r) === "1" && compareYmd(rowLeaveDate(r), hd1Date) > 0 && rowId(r) !== hd1Id
  );
  const nextHd1Date = nextHd1 ? rowLeaveDate(nextHd1) : null;

  return sorted.some((r) => {
    if (rowHalfDaySlot(r) !== "2") return false;
    const d2 = rowLeaveDate(r);
    if (compareYmd(d2, hd1Date) < 0) return false;
    if (nextHd1Date && compareYmd(d2, nextHd1Date) >= 0) return false;
    return true;
  });
}

/** 미사용 반차2가 있는 열린 사이클의 반차1 (가장 최근, 기한 경과 여부 무관) */
export function findOpenHalfDay1Cycle(halfDayRows, userId) {
  const userRows = [...halfDayRows]
    .filter((r) => rowUserId(r) === userId && isApprovedHalfDayRow(r))
    .sort((a, b) => compareYmd(rowLeaveDate(a), rowLeaveDate(b)));

  const hd1List = userRows.filter((r) => rowHalfDaySlot(r) === "1");
  for (let i = hd1List.length - 1; i >= 0; i -= 1) {
    const hd1 = hd1List[i];
    if (!hasMatchingHalfDay2(hd1, userRows)) {
      return { halfDay1: hd1, deadlineYmd: halfDay2DeadlineYmd(rowLeaveDate(hd1)) };
    }
  }
  return null;
}

function toYmdFromDate(d) {
  return toYmd({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

/** 신규 확정 반차에 자동 부여할 슬롯 ('1' | '2') — 반차1 다음은 기한과 관계없이 반차2 */
export function computeAutoHalfDaySlot(existingApprovedRows, userId, _newLeaveDate = null, excludeRequestId = null) {
  const userRows = existingApprovedRows.filter(
    (r) =>
      rowUserId(r) === userId &&
      isApprovedHalfDayRow(r) &&
      (!excludeRequestId || rowId(r) !== excludeRequestId)
  );
  const open = findOpenHalfDay1Cycle(userRows, userId);
  if (open) return "2";
  return "1";
}

/** 사용자별 반차 현황 요약 */
export function buildHalfDayStatusForUser(halfDayRows, userId, nowYmd = null) {
  const today = nowYmd ?? toYmdFromDate(new Date());
  const userRows = [...halfDayRows]
    .filter((r) => rowUserId(r) === userId && isApprovedHalfDayRow(r))
    .sort((a, b) => compareYmd(rowLeaveDate(a), rowLeaveDate(b)));

  const records = userRows.map((r) => ({
    requestId: rowId(r),
    leaveDate: rowLeaveDate(r),
    slot: rowHalfDaySlot(r),
    slotLabel: halfDaySlotLabel(rowHalfDaySlot(r)),
    requestedAt: r.requestedAt ?? r.requested_at ?? "",
  }));

  const open = findOpenHalfDay1Cycle(userRows, userId);
  let reminder = null;
  if (open) {
    const daysLeft = daysBetweenYmd(today, open.deadlineYmd);
    reminder = {
      halfDay1LeaveDate: rowLeaveDate(open.halfDay1),
      deadlineYmd: open.deadlineYmd,
      daysLeft,
      isOverdue: daysLeft <= 0,
      needsReminder: daysLeft <= HALF_DAY2_REMINDER_DAYS_BEFORE,
    };
  }

  return { records, openCycle: open, reminder };
}

export function daysBetweenYmd(fromYmd, toYmd) {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) return NaN;
  const t0 = Date.UTC(a.year, a.month - 1, a.day);
  const t1 = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
}

/** 반차2 기한 알림 문구 (daysLeft ≤ 0 이면 기한 경과 안내) */
export function halfDay2ReminderMessage(deadlineYmd, daysLeft = null) {
  const p = parseYmd(deadlineYmd);
  const label = p ? `${p.month}월 ${p.day}일` : "";
  const dl =
    daysLeft != null && Number.isFinite(daysLeft)
      ? daysLeft
      : daysBetweenYmd(toYmdFromDate(new Date()), deadlineYmd);
  if (dl <= 0) {
    return label
      ? `반차2 사용 권고기한이 지났습니다. (${label} 권장) 빠른 시일 내 반차2를 사용해 주세요.`
      : "반차2 사용 권고기한이 지났습니다. 빠른 시일 내 반차2를 사용해 주세요.";
  }
  return label
    ? `반차2의 사용기한이 1개월남았습니다. (${label}까지 사용하세요)`
    : "반차2의 사용기한이 1개월남았습니다.";
}

/** 슬롯 수동 변경 유효성 */
export function validateHalfDaySlotChange(_allRows, _requestId, _userId, _leaveDate, nextSlot) {
  const slot = String(nextSlot ?? "").trim();
  if (!HALF_DAY_SLOT_VALUES.has(slot)) return "반차1 또는 반차2만 선택할 수 있습니다.";
  return "";
}
