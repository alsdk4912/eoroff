/**
 * 대한민국 공휴일: Nager API + 연도별 공식 교정(설·추석·대체공휴일·제헌절 등)
 */

/** 연도별 공식 공휴일 (전체 연도 동기화 시 이 목록이 우선) */
export const OFFICIAL_KR_HOLIDAYS_BY_YEAR = {
  2026: [
    ["2026-01-01", "신정"],
    ["2026-02-16", "설날 연휴"],
    ["2026-02-17", "설날"],
    ["2026-02-18", "설날 연휴"],
    ["2026-03-01", "삼일절"],
    ["2026-03-02", "대체공휴일"],
    ["2026-05-05", "어린이날"],
    ["2026-05-25", "부처님 오신 날"],
    ["2026-06-03", "지방선거일"],
    ["2026-06-06", "현충일"],
    ["2026-07-17", "제헌절"],
    ["2026-08-15", "광복절"],
    ["2026-08-17", "대체공휴일"],
    ["2026-09-24", "추석 연휴"],
    ["2026-09-25", "추석"],
    ["2026-09-26", "추석 연휴"],
    ["2026-10-03", "개천절"],
    ["2026-10-05", "대체공휴일"],
    ["2026-10-09", "한글날"],
    ["2026-12-25", "크리스마스"],
  ],
  2027: [
    ["2027-01-01", "신정"],
    ["2027-02-06", "설날 연휴"],
    ["2027-02-07", "설날"],
    ["2027-02-08", "설날 연휴"],
    ["2027-02-09", "대체공휴일"],
    ["2027-03-01", "삼일절"],
    ["2027-05-03", "대체공휴일"],
    ["2027-05-05", "어린이날"],
    ["2027-05-13", "부처님 오신 날"],
    ["2027-06-06", "현충일"],
    ["2027-07-17", "제헌절"],
    ["2027-08-15", "광복절"],
    ["2027-08-16", "대체공휴일"],
    ["2027-09-14", "추석 연휴"],
    ["2027-09-15", "추석"],
    ["2027-09-16", "추석 연휴"],
    ["2027-10-03", "개천절"],
    ["2027-10-04", "대체공휴일"],
    ["2027-10-09", "한글날"],
    ["2027-10-11", "대체공휴일"],
    ["2027-12-25", "크리스마스"],
    ["2027-12-27", "대체공휴일"],
  ],
  2028: [
    ["2028-01-01", "신정"],
    ["2028-01-26", "설날 연휴"],
    ["2028-01-27", "설날"],
    ["2028-01-28", "설날 연휴"],
    ["2028-03-01", "삼일절"],
    ["2028-05-02", "부처님 오신 날"],
    ["2028-05-05", "어린이날"],
    ["2028-06-06", "현충일"],
    ["2028-07-17", "제헌절"],
    ["2028-08-15", "광복절"],
    ["2028-10-02", "추석 연휴"],
    ["2028-10-03", "추석·개천절"],
    ["2028-10-04", "추석 연휴"],
    ["2028-10-09", "한글날"],
    ["2028-12-25", "크리스마스"],
  ],
  2029: [
    ["2029-01-01", "신정"],
    ["2029-02-12", "설날 연휴"],
    ["2029-02-13", "설날"],
    ["2029-02-14", "설날 연휴"],
    ["2029-03-01", "삼일절"],
    ["2029-05-05", "어린이날"],
    ["2029-05-07", "대체공휴일"],
    ["2029-05-21", "부처님 오신 날"],
    ["2029-06-06", "현충일"],
    ["2029-07-17", "제헌절"],
    ["2029-08-15", "광복절"],
    ["2029-09-21", "추석 연휴"],
    ["2029-09-22", "추석"],
    ["2029-09-23", "추석 연휴"],
    ["2029-09-24", "대체공휴일"],
    ["2029-10-03", "개천절"],
    ["2029-10-09", "한글날"],
    ["2029-12-25", "크리스마스"],
  ],
  2030: [
    ["2030-01-01", "신정"],
    ["2030-02-02", "설날 연휴"],
    ["2030-02-03", "설날"],
    ["2030-02-04", "설날 연휴"],
    ["2030-02-05", "대체공휴일"],
    ["2030-03-01", "삼일절"],
    ["2030-05-05", "어린이날"],
    ["2030-05-06", "대체공휴일"],
    ["2030-05-09", "부처님 오신 날"],
    ["2030-06-06", "현충일"],
    ["2030-07-17", "제헌절"],
    ["2030-08-15", "광복절"],
    ["2030-09-11", "추석 연휴"],
    ["2030-09-12", "추석"],
    ["2030-09-13", "추석 연휴"],
    ["2030-10-03", "개천절"],
    ["2030-10-09", "한글날"],
    ["2030-12-25", "크리스마스"],
  ],
};

/** Nager API만 쓸 때 연도별 제거(오표기·비공식) */
const NAGER_REMOVE_DATES_BY_YEAR = {
  2026: ["2026-05-01", "2026-09-28"],
  2027: ["2027-05-03", "2027-07-19", "2027-08-16", "2027-10-04", "2027-10-11"],
  2028: ["2028-05-01", "2028-10-03"],
  2029: ["2029-05-01", "2029-09-24"],
};

const NAME_NORMALIZE = new Map([
  ["새해", "신정"],
  ["새해 첫날", "신정"],
  ["1월1일", "신정"],
  ["3·1절", "삼일절"],
  ["기독탄신일", "크리스마스"],
]);

function normalizeHolidayName(name) {
  const n = String(name ?? "").trim() || "공휴일";
  return NAME_NORMALIZE.get(n) ?? n;
}

export async function fetchNagerHolidayMap(year) {
  const y = Number(year);
  const url = `https://date.nager.at/api/v3/PublicHolidays/${y}/KR`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`공휴일 API 오류: HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return new Map();

  const map = new Map();
  for (const h of rows) {
    const date = String(h?.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rawName = String(h?.localName ?? h?.name ?? "공휴일").trim() || "공휴일";
    map.set(date, normalizeHolidayName(rawName));
  }
  return map;
}

/** API 맵에 공통·연도별 교정 (공식 목록 없는 연도) */
export function applyNagerHolidayCorrections(year, holidayMap) {
  const y = Number(year);
  const remove = NAGER_REMOVE_DATES_BY_YEAR[y] ?? [];
  for (const d of remove) holidayMap.delete(d);

  // 제헌절: 항상 7/17
  for (const [date, name] of [...holidayMap.entries()]) {
    if (name.includes("제헌")) holidayMap.delete(date);
  }
  holidayMap.set(`${y}-07-17`, "제헌절");

  // 노동절(5/1)은 법정 공휴일 아님 — 대체일만 공식 목록에 둠
  holidayMap.delete(`${y}-05-01`);

  return holidayMap;
}

export function officialEntriesForYear(year, monthOpt = null) {
  const list = OFFICIAL_KR_HOLIDAYS_BY_YEAR[Number(year)];
  if (!list) return null;
  const m = monthOpt == null ? null : Number(monthOpt);
  return list.filter(([date]) => (m == null ? true : Number(date.slice(5, 7)) === m));
}

/**
 * @param {{ execute: Function, queryAll: Function }} db
 */
export async function upsertKoreanHolidaysForYear(year, monthOpt, db) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error("year 범위가 올바르지 않습니다.");

  const m = monthOpt == null ? null : Number(monthOpt);
  const nowIso = new Date().toISOString();

  let entries;
  const official = officialEntriesForYear(y, m);
  if (official) {
    entries = official;
  } else {
    const map = await fetchNagerHolidayMap(y);
    applyNagerHolidayCorrections(y, map);
    entries = [...map.entries()];
    if (m != null) entries = entries.filter(([date]) => Number(date.slice(5, 7)) === m);
  }

  // 월 단위 동기화: 해당 월 공식 집합에 없는 기존 공휴일 제거
  if (m != null) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = `${y}-${String(m).padStart(2, "0")}-31`;
    const keep = new Set(entries.map(([date]) => date));
    const existing = await db.queryAll(
      "SELECT holiday_date FROM holidays WHERE holiday_date >= ? AND holiday_date <= ? AND is_holiday = 1",
      first,
      last
    );
    for (const row of existing) {
      const date = String(row.holiday_date ?? "");
      if (!keep.has(date)) {
        await db.execute("DELETE FROM holidays WHERE holiday_date = ?", date);
        await db.execute("DELETE FROM holiday_duties WHERE holiday_date = ?", date);
      }
    }
  }

  // 연도 전체 공식 목록이 있으면: 해당 연도 API 잔여 오표기 정리(월 미지정 시)
  if (official && m == null) {
    const keep = new Set(entries.map(([date]) => date));
    const existing = await db.queryAll(
      "SELECT holiday_date FROM holidays WHERE holiday_date >= ? AND holiday_date <= ? AND is_holiday = 1",
      `${y}-01-01`,
      `${y}-12-31`
    );
    for (const row of existing) {
      const date = String(row.holiday_date ?? "");
      if (!keep.has(date)) {
        await db.execute("DELETE FROM holidays WHERE holiday_date = ?", date);
        await db.execute("DELETE FROM holiday_duties WHERE holiday_date = ?", date);
      }
    }
  }

  let count = 0;
  for (const [date, name] of entries) {
    await db.execute(
      "INSERT INTO holidays (holiday_date, holiday_name, is_holiday, synced_at) VALUES (?, ?, 1, ?) ON CONFLICT(holiday_date) DO UPDATE SET holiday_name = excluded.holiday_name, is_holiday = 1, synced_at = excluded.synced_at",
      date,
      name,
      nowIso
    );
    count += 1;
  }
  return count;
}

/** 2026년부터 endYear까지 공휴일 DB 반영 (기동·마이그레이션) */
export async function ensureKoreanHolidaysThroughYear(endYear, db) {
  const nowY = new Date().getFullYear();
  const last = Math.max(Number(endYear) || nowY + 3, nowY + 3);
  const start = 2026;
  let total = 0;
  for (let y = start; y <= last; y += 1) {
    total += await upsertKoreanHolidaysForYear(y, null, db);
  }
  return { years: last - start + 1, upserted: total };
}
