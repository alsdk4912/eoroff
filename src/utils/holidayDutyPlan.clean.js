/**
 * 휴일 당직 자동 배정: 주말(토·일) / 공휴·대체공휴일 / 설·추석 명절(평일) 세 순번이 각각 독립적으로 순환.
 * 명절 연휴가 토·일과 겹치면 해당 일자는 주말 당직 규칙을 따른다.
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

function isDutyBlockedByRule(name, ymd) {
  const nm = String(name ?? "").trim();
  if (nm === "장지은") return ymd <= "2026-08-05";
  if (nm === "이지선") return ymd <= "2026-09-06";
  return false;
}

export function buildBaseDutyOrder(nurseUsers) {
  const sorted = [...nurseUsers].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const special = ["장성필", "장지은", "정수영", "최유경", "최종선", "최유리"];
  const specialSet = new Set(special);
  const picked = [];
  const rest = [];
  for (const u of sorted) {
    if (specialSet.has(u.name)) picked.push(u);
    else rest.push(u);
  }
  if (picked.length === 0) return sorted;
  const pickedByName = new Map(picked.map((u) => [u.name, u]));
  const orderedPicked = special.map((name) => pickedByName.get(name)).filter(Boolean);
  const firstIdx = sorted.findIndex((u) => specialSet.has(u.name));
  const insertAt = firstIdx < 0 ? rest.length : firstIdx;
  return [...rest.slice(0, insertAt), ...orderedPicked, ...rest.slice(insertAt)];
}

/** 설·추석 명절 및 그 연휴(평일). 토·일은 주말 당직으로 처리. */
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
    if (idx === firstIdx) continue;
    if (!isDutyBlockedByRule(baseOrder[idx].name, ymd)) {
      secondIdx = idx;
      break;
    }
  }
  if (secondIdx < 0) return null;

  return {
    nurse1UserId: baseOrder[firstIdx].id,
    nurse2UserId: baseOrder[secondIdx].id,
    nextPointer: (secondIdx + 1) % n,
  };
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

/**
 * @param {{ year: number, users: Array<{id: string, name: string, role?: string}>, holidays: Array<{holidayDate?: string, holidayName?: string, isHoliday?: boolean}>, holidayDuties: Record<string, any> }} p
 */
export function buildAutoHolidayDutyPlan({ year, users, holidays, holidayDuties }) {
  const nurseUsers = (users ?? []).filter((u) => u.role === "NURSE" || !u.role);
  const baseOrder = buildBaseDutyOrder(nurseUsers);
  if (baseOrder.length < 2) return [];

  const dutyByDate = holidayDuties ?? {};
  const plan = [];
  const userById = new Map(nurseUsers.map((u) => [u.id, u]));

  const weekendBlocks = buildWeekendBlocks(year);
  let weekendPointer = 0;
  for (const block of weekendBlocks) {
    let existingPair = null;
    for (const dt of block.dates) {
      const d = dutyByDate[dt];
      if (hasDutyPair(d)) {
        existingPair = d;
        break;
      }
    }
    if (existingPair) {
      const { n2 } = dutyIds(existingPair);
      const idx2 = baseOrder.findIndex((u) => u.id === n2);
      if (idx2 >= 0) weekendPointer = (idx2 + 1) % baseOrder.length;
      for (const dt of block.dates) {
        if (!hasDutyPair(dutyByDate[dt])) {
          plan.push({
            holidayDate: dt,
            nurse1UserId: dutyIds(existingPair).n1,
            nurse2UserId: dutyIds(existingPair).n2,
          });
        }
      }
      continue;
    }
    const picked = pickSequentialDutyPair(baseOrder, block.key, weekendPointer);
    if (!picked) continue;
    weekendPointer = picked.nextPointer;
    for (const dt of block.dates) {
      if (!hasDutyPair(dutyByDate[dt])) {
        plan.push({
          holidayDate: dt,
          nurse1UserId: picked.nurse1UserId,
          nurse2UserId: picked.nurse2UserId,
        });
      }
    }
  }

  const weekdayHolidayStreams = (holidays ?? [])
    .filter((h) => h?.isHoliday && typeof h.holidayDate === "string")
    .map((h) => {
      const ymd = h.holidayDate;
      const name = String(h.holidayName ?? "").trim();
      const stream = isMajorTraditionalFestivalHolidayName(name) ? "festival" : "public";
      return { ymd, stream };
    })
    .filter(({ ymd }) => String(ymd).startsWith(`${year}-`))
    .filter(({ ymd }) => {
      const d = parseLocalDateYmd(ymd);
      if (Number.isNaN(d.getTime())) return false;
      const day = d.getDay();
      return day !== 0 && day !== 6;
    })
    .sort((a, b) => a.ymd.localeCompare(b.ymd));

  const seenWeekday = new Set();
  const uniqueWeekdayStreams = weekdayHolidayStreams.filter(({ ymd }) => {
    if (seenWeekday.has(ymd)) return false;
    seenWeekday.add(ymd);
    return true;
  });

  let publicPointer = 0;
  let festivalPointer = 0;

  for (const { ymd, stream } of uniqueWeekdayStreams) {
    const existing = dutyByDate[ymd];
    if (hasDutyPair(existing)) {
      const { n2 } = dutyIds(existing);
      const idx2 = baseOrder.findIndex((u) => u.id === n2);
      if (idx2 >= 0) {
        const next = (idx2 + 1) % baseOrder.length;
        if (stream === "public") publicPointer = next;
        else festivalPointer = next;
      }
      continue;
    }
    const pointer = stream === "public" ? publicPointer : festivalPointer;
    const picked = pickSequentialDutyPair(baseOrder, ymd, pointer);
    if (!picked) continue;
    if (stream === "public") publicPointer = picked.nextPointer;
    else festivalPointer = picked.nextPointer;
    plan.push({
      holidayDate: ymd,
      nurse1UserId: picked.nurse1UserId,
      nurse2UserId: picked.nurse2UserId,
    });
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
