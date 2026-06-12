/**
 * 수술실 휴일 당직 자동 배정
 * - 명절당직(설·추석·연휴 + 붙은 주말): 일자별 2인, 명절 순번
 * - 공휴·대체공휴당직(평일): 일자별 2인, 공휴 순번
 * - 주말당직(토·일): 주말 블록당 2인 동일, 주말 순번
 * - 순번: 가나다순, 최유리↔최종선 위치 교환, 허정숙 다음 김해림
 */

/** 로컬 달력 기준 YYYY-MM-DD */
function toLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseLocalDateYmd(ymd) {
  const s = String(ymd ?? "").trim();
  const p = s.split("-");
  if (p.length !== 3) return new Date(NaN);
  const y = Number(p[0]);
  const m = Number(p[1]);
  const d = Number(p[2]);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function addDaysYmd(ymd, days) {
  const d = parseLocalDateYmd(ymd);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return toLocalYMD(d);
}

function daysBetweenYmd(a, b) {
  const da = parseLocalDateYmd(a);
  const db = parseLocalDateYmd(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return Infinity;
  return Math.round((db - da) / 86400000);
}

/** 규칙 재적용 기준일(이전 DB 기록 유지) */
export const OR_DUTY_RULES_EFFECTIVE_FROM = "2026-06-12";

export const OR_DUTY_PUBLIC_ANCHORS = [
  { date: "2026-07-17", nurse1: "유진", nurse2: "오민아" },
  { date: "2026-08-17", nurse1: "이양희", nurse2: "이현숙" },
  { date: "2026-10-05", nurse1: "이지선", nurse2: "임희종" },
  { date: "2026-10-09", nurse1: "장성필", nurse2: "장지은" },
];

export const OR_DUTY_WEEKEND_ANCHORS = [
  { saturday: "2026-06-06", nurse1: "오민아", nurse2: "유진" },
  { saturday: "2026-06-20", nurse1: "임희종", nurse2: "장성필" },
  { saturday: "2026-06-27", nurse1: "최유경", nurse2: "최종선" },
  { saturday: "2026-08-22", nurse1: "최유리", nurse2: "허정숙" },
];

/** 명절 일자별 고정 배정 (추석·설날 등) */
export const OR_DUTY_FESTIVAL_ANCHORS = [
  { date: "2026-09-24", nurse1: "김해림", nurse2: "손다솜" },
  { date: "2026-09-25", nurse1: "양현아", nurse2: "오민아" },
  { date: "2026-09-26", nurse1: "유진", nurse2: "이양희" },
  { date: "2026-09-27", nurse1: "이지선", nurse2: "이현숙" },
];

function isDutyBlockedByRule(name, ymd) {
  const nm = String(name ?? "").trim();
  if (nm === "장지은") return ymd <= "2026-08-05";
  if (nm === "정수영") return ymd < "2026-08-01";
  if (nm === "이지선") return ymd <= "2026-09-06";
  return false;
}

/** 가나다순 + 최유리·최종선 자리 교환 */
export function buildBaseDutyOrder(nurseUsers) {
  const sorted = [...nurseUsers].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const iJong = sorted.findIndex((u) => u.name === "최종선");
  const iRi = sorted.findIndex((u) => u.name === "최유리");
  if (iJong >= 0 && iRi >= 0) {
    const next = [...sorted];
    next[iJong] = sorted[iRi];
    next[iRi] = sorted[iJong];
    return next;
  }
  return sorted;
}

/** 설·추석 명절·연휴 */
export function isMajorTraditionalFestivalHolidayName(holidayName) {
  const n = String(holidayName ?? "").trim();
  if (!n) return false;
  if (n.includes("추석")) return true;
  if (n.includes("설날") || n.includes("구정")) return true;
  if (n.includes("설 연휴")) return true;
  return false;
}

function dutyIds(duty) {
  if (!duty) return { n1: "", n2: "" };
  const n1 = duty.nurse1UserId ?? duty.nurse1_user_id ?? "";
  const n2 = duty.nurse2UserId ?? duty.nurse2_user_id ?? "";
  return { n1: String(n1).trim(), n2: String(n2).trim() };
}

export function hasDutyPair(duty) {
  const { n1, n2 } = dutyIds(duty);
  return Boolean(n1 && n2 && n1 !== n2);
}

function userIdByName(order, name) {
  return order.find((u) => u.name === name)?.id ?? "";
}

function pointerAfterPairNames(order, n1Name, n2Name) {
  const i1 = order.findIndex((u) => u.name === n1Name);
  const i2 = order.findIndex((u) => u.name === n2Name);
  if (i1 < 0 || i2 < 0) return 0;
  return (Math.max(i1, i2) + 1) % order.length;
}

export function pickSequentialDutyPair(baseOrder, ymd, pointer) {
  if (!Array.isArray(baseOrder) || baseOrder.length < 2) return null;
  const n = baseOrder.length;
  const start = ((pointer % n) + n) % n;

  let firstIdx = -1;
  for (let i = 0; i < n; i += 1) {
    const idx = (start + i) % n;
    if (!isDutyBlockedByRule(baseOrder[idx].name, ymd)) {
      firstIdx = idx;
      break;
    }
  }
  if (firstIdx < 0) return null;

  let secondIdx = -1;
  for (let i = 1; i < n; i += 1) {
    const idx = (firstIdx + i) % n;
    if (!isDutyBlockedByRule(baseOrder[idx].name, ymd)) {
      secondIdx = idx;
      break;
    }
  }
  if (secondIdx < 0) return null;

  return {
    nurse1UserId: baseOrder[firstIdx].id,
    nurse2UserId: baseOrder[secondIdx].id,
    nurse1Name: baseOrder[firstIdx].name,
    nurse2Name: baseOrder[secondIdx].name,
    nextPointer: (secondIdx + 1) % n,
  };
}

function pairFromAnchor(order, anchor) {
  const n1 = userIdByName(order, anchor.nurse1);
  const n2 = userIdByName(order, anchor.nurse2);
  if (!n1 || !n2) return null;
  return {
    nurse1UserId: n1,
    nurse2UserId: n2,
    nurse1Name: anchor.nurse1,
    nurse2Name: anchor.nurse2,
    nextPointer: pointerAfterPairNames(order, anchor.nurse1, anchor.nurse2),
  };
}

function syncPointerFromExisting(order, duty) {
  const { n1, n2 } = dutyIds(duty);
  if (!n1 || !n2) return null;
  const u1 = order.find((u) => u.id === n1);
  const u2 = order.find((u) => u.id === n2);
  if (!u1 || !u2) return null;
  return pointerAfterPairNames(order, u1.name, u2.name);
}

export function buildWeekendBlocks(year) {
  const blocks = [];
  const first = new Date(year, 0, 1);
  const last = new Date(year, 11, 31);
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 6) continue;
    const sat = toLocalYMD(d);
    const sunDate = new Date(d);
    sunDate.setDate(sunDate.getDate() + 1);
    const dates = [sat];
    if (sunDate.getFullYear() === year) dates.push(toLocalYMD(sunDate));
    blocks.push({ key: sat, dates });
  }
  return blocks;
}

/** 명절 공휴일 날짜를 기준으로 연휴 구간(사이 주말·평일 포함) 확장 */
export function buildFestivalDutyDateSet(year, holidays) {
  const festNamed = (holidays ?? [])
    .filter((h) => h?.isHoliday && typeof h.holidayDate === "string")
    .filter((h) => String(h.holidayDate).startsWith(`${year}-`))
    .filter((h) => isMajorTraditionalFestivalHolidayName(h.holidayName))
    .map((h) => String(h.holidayDate).slice(0, 10))
    .sort();

  if (festNamed.length === 0) return new Set();

  const clusters = [];
  let start = festNamed[0];
  let end = festNamed[0];
  for (let i = 1; i < festNamed.length; i += 1) {
    const gap = daysBetweenYmd(end, festNamed[i]);
    if (gap <= 4) {
      end = festNamed[i];
    } else {
      clusters.push([start, end]);
      start = festNamed[i];
      end = festNamed[i];
    }
  }
  clusters.push([start, end]);

  const out = new Set();
  for (const [clusterStart, clusterEnd] of clusters) {
    let d = addDaysYmd(clusterStart, -2);
    const clusterStartDow = parseLocalDateYmd(clusterStart).getDay();
    if (clusterStartDow === 0) {
      out.add(addDaysYmd(clusterStart, -1));
    } else if (clusterStartDow === 1) {
      out.add(addDaysYmd(clusterStart, -2));
      out.add(addDaysYmd(clusterStart, -1));
    }
    d = clusterStart;
    while (d <= clusterEnd) {
      out.add(d);
      d = addDaysYmd(d, 1);
    }
    const clusterEndDow = parseLocalDateYmd(clusterEnd).getDay();
    if (clusterEndDow === 5) {
      out.add(addDaysYmd(clusterEnd, 1));
      out.add(addDaysYmd(clusterEnd, 2));
    } else if (clusterEndDow === 6) {
      out.add(addDaysYmd(clusterEnd, 1));
    }
  }
  return out;
}

function holidayNameByDate(holidays, ymd) {
  const row = (holidays ?? []).find((h) => String(h.holidayDate ?? "").slice(0, 10) === ymd);
  return String(row?.holidayName ?? "").trim();
}

function isWeekdayPublicHoliday(ymd, holidays, festivalDates) {
  if (festivalDates.has(ymd)) return false;
  const d = parseLocalDateYmd(ymd);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const row = (holidays ?? []).find((h) => String(h.holidayDate ?? "").slice(0, 10) === ymd);
  if (!row?.isHoliday) return false;
  if (isMajorTraditionalFestivalHolidayName(row.holidayName)) return false;
  return true;
}

function findPublicAnchor(ymd) {
  return OR_DUTY_PUBLIC_ANCHORS.find((a) => a.date === ymd) ?? null;
}

function findWeekendAnchor(saturdayYmd) {
  return OR_DUTY_WEEKEND_ANCHORS.find((a) => a.saturday === saturdayYmd) ?? null;
}

function findFestivalAnchor(ymd) {
  return OR_DUTY_FESTIVAL_ANCHORS.find((a) => a.date === ymd) ?? null;
}

function shouldPreserveExisting(ymd, options) {
  const preserveBefore = String(options.preserveBeforeYmd ?? OR_DUTY_RULES_EFFECTIVE_FROM).slice(0, 10);
  return ymd < preserveBefore;
}

function shouldOverwrite(ymd, options) {
  if (shouldPreserveExisting(ymd, options)) return false;
  return Boolean(options.overwriteExisting);
}

/**
 * @param {{ year: number, users: any[], holidays: any[], holidayDuties: Record<string, any>, options?: { preserveBeforeYmd?: string, overwriteExisting?: boolean } }} p
 */
export function buildAutoHolidayDutyPlan({ year, users, holidays, holidayDuties, options = {} }) {
  const nurseUsers = (users ?? []).filter((u) => u.role === "NURSE" || !u.role);
  const baseOrder = buildBaseDutyOrder(nurseUsers);
  if (baseOrder.length < 2) return [];

  const dutyByDate = { ...(holidayDuties ?? {}) };
  const plan = [];
  const userById = new Map(nurseUsers.map((u) => [u.id, u]));
  const festivalDates = buildFestivalDutyDateSet(year, holidays);

  let weekendPointer = 0;
  let publicPointer = 0;
  let festivalPointer = 0;

  const festivalDays = [...festivalDates].filter((d) => d.startsWith(`${year}-`)).sort();
  for (const ymd of festivalDays) {
    const existing = dutyByDate[ymd];
    if (hasDutyPair(existing) && shouldPreserveExisting(ymd, options)) {
      const synced = syncPointerFromExisting(baseOrder, existing);
      if (synced != null) festivalPointer = synced;
      continue;
    }
    if (hasDutyPair(existing) && !shouldOverwrite(ymd, options)) {
      const synced = syncPointerFromExisting(baseOrder, existing);
      if (synced != null) festivalPointer = synced;
      continue;
    }
    const festAnchor = findFestivalAnchor(ymd);
    const picked = festAnchor
      ? pairFromAnchor(baseOrder, festAnchor)
      : pickSequentialDutyPair(baseOrder, ymd, festivalPointer);
    if (!picked) continue;
    festivalPointer = picked.nextPointer;
    plan.push({ holidayDate: ymd, nurse1UserId: picked.nurse1UserId, nurse2UserId: picked.nurse2UserId });
    dutyByDate[ymd] = { ...(dutyByDate[ymd] ?? {}), nurse1UserId: picked.nurse1UserId, nurse2UserId: picked.nurse2UserId };
  }

  const weekendBlocks = buildWeekendBlocks(year);
  for (const block of weekendBlocks) {
    const inFestival = block.dates.every((dt) => festivalDates.has(dt));
    if (inFestival) continue;

    const anchor = findWeekendAnchor(block.key);
    let existingPair = null;
    for (const dt of block.dates) {
      const d = dutyByDate[dt];
      if (hasDutyPair(d)) {
        existingPair = d;
        break;
      }
    }

    if (existingPair && block.dates.every((dt) => shouldPreserveExisting(dt, options) || !shouldOverwrite(dt, options))) {
      const synced = syncPointerFromExisting(baseOrder, existingPair);
      if (synced != null) weekendPointer = synced;
      continue;
    }

    let picked = null;
    if (anchor) {
      picked = pairFromAnchor(baseOrder, anchor);
    } else if (existingPair && block.dates.some((dt) => shouldPreserveExisting(dt, options))) {
      const synced = syncPointerFromExisting(baseOrder, existingPair);
      if (synced != null) weekendPointer = synced;
      picked = {
        nurse1UserId: dutyIds(existingPair).n1,
        nurse2UserId: dutyIds(existingPair).n2,
        nextPointer: synced ?? weekendPointer,
      };
    } else {
      picked = pickSequentialDutyPair(baseOrder, block.key, weekendPointer);
    }
    if (!picked) continue;
    weekendPointer = picked.nextPointer;

    for (const dt of block.dates) {
      if (festivalDates.has(dt)) continue;
      if (hasDutyPair(dutyByDate[dt]) && shouldPreserveExisting(dt, options)) continue;
      if (hasDutyPair(dutyByDate[dt]) && !shouldOverwrite(dt, options)) continue;
      plan.push({
        holidayDate: dt,
        nurse1UserId: picked.nurse1UserId,
        nurse2UserId: picked.nurse2UserId,
      });
      dutyByDate[dt] = {
        ...(dutyByDate[dt] ?? {}),
        nurse1UserId: picked.nurse1UserId,
        nurse2UserId: picked.nurse2UserId,
      };
    }
  }

  const publicDays = (holidays ?? [])
    .filter((h) => h?.isHoliday && typeof h.holidayDate === "string")
    .map((h) => String(h.holidayDate).slice(0, 10))
    .filter((ymd) => ymd.startsWith(`${year}-`))
    .filter((ymd) => isWeekdayPublicHoliday(ymd, holidays, festivalDates))
    .sort();

  for (const ymd of publicDays) {
    const existing = dutyByDate[ymd];
    if (hasDutyPair(existing) && shouldPreserveExisting(ymd, options)) {
      const synced = syncPointerFromExisting(baseOrder, existing);
      if (synced != null) publicPointer = synced;
      continue;
    }
    if (hasDutyPair(existing) && !shouldOverwrite(ymd, options)) {
      const synced = syncPointerFromExisting(baseOrder, existing);
      if (synced != null) publicPointer = synced;
      continue;
    }

    const anchor = findPublicAnchor(ymd);
    let picked = anchor ? pairFromAnchor(baseOrder, anchor) : pickSequentialDutyPair(baseOrder, ymd, publicPointer);
    if (!picked) continue;
    publicPointer = picked.nextPointer;
    plan.push({ holidayDate: ymd, nurse1UserId: picked.nurse1UserId, nurse2UserId: picked.nurse2UserId });
    dutyByDate[ymd] = { ...(dutyByDate[ymd] ?? {}), nurse1UserId: picked.nurse1UserId, nurse2UserId: picked.nurse2UserId };
  }

  const dedup = new Map();
  for (const row of plan) {
    const n1 = userById.get(row.nurse1UserId)?.name ?? "";
    const n2 = userById.get(row.nurse2UserId)?.name ?? "";
    if (isDutyBlockedByRule(n1, row.holidayDate) || isDutyBlockedByRule(n2, row.holidayDate)) continue;
    dedup.set(row.holidayDate, row);
  }
  return [...dedup.values()].sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
}

/** 마취과 휴일 당직 순환 (주말 단위) */
export const ANESTHESIA_DUTY_ROTATION_NAMES = ["김인자", "이지현", "박현정", "윤지민"];

export const ANESTHESIA_DUTY_ANCHOR_WEEKEND_SAT = "2026-10-31";
export const ANESTHESIA_DUTY_ANCHOR_NAME = "김인자";

export function buildAnesthesiaDutyOrder(users) {
  const anesthesiaUsers = (users ?? []).filter((u) => u.role === "ANESTHESIA");
  const byName = new Map(anesthesiaUsers.map((u) => [u.name, u]));
  return ANESTHESIA_DUTY_ROTATION_NAMES.map((name) => byName.get(name)).filter(Boolean);
}

function anesthesiaUserId(duty) {
  return String(duty?.anesthesiaUserId ?? duty?.anesthesia_user_id ?? "").trim();
}

export function hasAnesthesiaDuty(duty) {
  return Boolean(anesthesiaUserId(duty));
}

export function buildOffDaySlotsForYear(year, holidays) {
  const festivalDates = buildFestivalDutyDateSet(year, holidays);
  const slots = [];
  for (const block of buildWeekendBlocks(year)) {
    if (!block.dates.every((dt) => festivalDates.has(dt))) {
      slots.push({ key: block.key, dates: block.dates, stream: "weekend" });
    }
  }

  const publicDays = (holidays ?? [])
    .filter((h) => h?.isHoliday && typeof h.holidayDate === "string")
    .map((h) => String(h.holidayDate).slice(0, 10))
    .filter((ymd) => ymd.startsWith(`${year}-`))
    .filter((ymd) => isWeekdayPublicHoliday(ymd, holidays, festivalDates));

  for (const ymd of publicDays) {
    slots.push({ key: ymd, dates: [ymd], stream: "public" });
  }
  for (const ymd of [...festivalDates].filter((d) => d.startsWith(`${year}-`))) {
    slots.push({ key: ymd, dates: [ymd], stream: "festival" });
  }

  return slots.sort((a, b) => a.key.localeCompare(b.key));
}

export function buildAutoAnesthesiaDutyPlan({
  startYear,
  endYear,
  users,
  holidays,
  holidayDuties,
  anchorWeekendSat = ANESTHESIA_DUTY_ANCHOR_WEEKEND_SAT,
  anchorName = ANESTHESIA_DUTY_ANCHOR_NAME,
  assignFromYmd = null,
  overwriteExisting = false,
}) {
  const order = buildAnesthesiaDutyOrder(users);
  if (order.length === 0) return [];

  const anchorRotIdx = ANESTHESIA_DUTY_ROTATION_NAMES.indexOf(anchorName);
  if (anchorRotIdx < 0) return [];

  const allSlots = [];
  for (let y = startYear; y <= endYear; y += 1) {
    allSlots.push(...buildOffDaySlotsForYear(y, holidays));
  }
  allSlots.sort((a, b) => a.key.localeCompare(b.key));

  const anchorSlotIdx = allSlots.findIndex((s) => s.key === anchorWeekendSat);
  if (anchorSlotIdx < 0) return [];

  const dutyByDate = holidayDuties ?? {};
  const plan = [];
  const assignFrom = String(assignFromYmd ?? "").slice(0, 10);

  for (let i = 0; i < allSlots.length; i += 1) {
    const slot = allSlots[i];
    if (slot.key < `${startYear}-01-01`) continue;
    if (assignFrom && slot.dates.every((dt) => dt < assignFrom)) continue;

    if (!overwriteExisting) {
      let existingId = "";
      for (const dt of slot.dates) {
        const id = anesthesiaUserId(dutyByDate[dt]);
        if (id) existingId = id;
      }
      if (existingId) continue;
    }

    const rotIdx = (anchorRotIdx + (i - anchorSlotIdx) + order.length * 100) % order.length;
    const picked = order[rotIdx];
    if (!picked) continue;

    for (const dt of slot.dates) {
      if (assignFrom && dt < assignFrom) continue;
      if (!overwriteExisting && hasAnesthesiaDuty(dutyByDate[dt])) continue;
      plan.push({ holidayDate: dt, anesthesiaUserId: picked.id });
    }
  }

  return plan.sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
}

/**
 * @param {{ startYear: number, endYear: number, users: any[], holidays: any[], holidayDuties: Record<string, any>, preserveBeforeYmd?: string, overwriteOrFromYmd?: string, overwriteExisting?: boolean }} p
 */
export function buildFullAutoHolidayDutyPlansForYears({
  startYear,
  endYear,
  users,
  holidays,
  holidayDuties,
  preserveBeforeYmd = OR_DUTY_RULES_EFFECTIVE_FROM,
  overwriteOrFromYmd = OR_DUTY_RULES_EFFECTIVE_FROM,
  overwriteExisting = false,
}) {
  const dutyByDate = { ...(holidayDuties ?? {}) };
  const merged = new Map();
  const planOptions = {
    preserveBeforeYmd,
    overwriteExisting,
  };

  for (let year = startYear; year <= endYear; year += 1) {
    const orPlan = buildAutoHolidayDutyPlan({
      year,
      users,
      holidays,
      holidayDuties: dutyByDate,
      options: planOptions,
    });
    for (const row of orPlan) {
      const hd = row.holidayDate;
      if (hd < overwriteOrFromYmd) continue;
      const prev = dutyByDate[row.holidayDate] ?? {};
      dutyByDate[row.holidayDate] = {
        ...prev,
        nurse1UserId: row.nurse1UserId,
        nurse2UserId: row.nurse2UserId,
      };
      merged.set(row.holidayDate, { ...(merged.get(row.holidayDate) ?? {}), ...row });
    }
  }

  const anesPlan = buildAutoAnesthesiaDutyPlan({
    startYear,
    endYear,
    users,
    holidays,
    holidayDuties: dutyByDate,
  });
  for (const row of anesPlan) {
    merged.set(row.holidayDate, { ...(merged.get(row.holidayDate) ?? {}), ...row });
  }

  return [...merged.values()].sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
}
