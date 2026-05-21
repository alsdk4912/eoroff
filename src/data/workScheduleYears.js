import { emptyScheduleMonthValues, mergeWorkScheduleRows } from "./shiftCodes.js";

export const WORK_SCHEDULE_MONTH_LABELS = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];

export const SCHEDULE_MONTH_COUNT = WORK_SCHEDULE_MONTH_LABELS.length;

export function padScheduleRowValues(row, monthCount = SCHEDULE_MONTH_COUNT) {
  const vals = Array.isArray(row?.values) ? row.values : [];
  return {
    name: String(row?.name ?? ""),
    values: Array.from({ length: monthCount }, (_, i) => String(vals[i] ?? "")),
  };
}

export function workScheduleMonthYmds(calendarYear) {
  const y = Number(calendarYear);
  return WORK_SCHEDULE_MONTH_LABELS.map((label, i) => ({
    ymd: `${y}-${String(i + 1).padStart(2, "0")}`,
    label,
    index: i,
  }));
}

export function parseBaseSchedulePlanKey(planKey) {
  const m = /^base_(\d{4})$/.exec(String(planKey ?? ""));
  return m ? Number(m[1]) : null;
}

/** 2026·2027 시드 외 연도는 2026 명단·빈 칸 12개월 */
export function getWorkScheduleTemplateForYear(year, templates) {
  const y = Number(year);
  const { rows2026, rows2027 } = templates;
  if (y === 2026) return rows2026;
  if (y === 2027) return rows2027;
  if (y >= 2028) {
    return (Array.isArray(rows2026) ? rows2026 : []).map((r) => ({
      name: r.name,
      values: emptyScheduleMonthValues(SCHEDULE_MONTH_COUNT),
    }));
  }
  return rows2026;
}

export function normalizeWorkScheduleByYear(byYear, templates) {
  const src = byYear && typeof byYear === "object" ? byYear : {};
  const out = {};
  for (const key of Object.keys(src)) {
    const y = Number(key);
    if (!Number.isFinite(y) || y < 2026) continue;
    const template = getWorkScheduleTemplateForYear(y, templates);
    out[String(y)] = mergeWorkScheduleRows(src[key], template);
  }
  if (!out["2026"]) out["2026"] = mergeWorkScheduleRows(null, templates.rows2026);
  if (!out["2027"]) out["2027"] = mergeWorkScheduleRows(null, templates.rows2027);
  return out;
}

export function loadWorkScheduleByYearFromStorage(storageKeys, templates) {
  try {
    const raw = localStorage.getItem(storageKeys.byYear);
    if (raw) {
      return normalizeWorkScheduleByYear(JSON.parse(raw), templates);
    }
  } catch {
    /* migrate below */
  }
  const by = {};
  try {
    const raw26 = localStorage.getItem(storageKeys.y2026);
    if (raw26) by["2026"] = JSON.parse(raw26);
  } catch {
    /* ignore */
  }
  try {
    const raw27 = localStorage.getItem(storageKeys.y2027);
    if (raw27) by["2027"] = JSON.parse(raw27);
  } catch {
    /* ignore */
  }
  return normalizeWorkScheduleByYear(by, templates);
}

/** 번표 묶음·연도 선택 목록 (2026부터 상한 없이 확장) */
export function listBaseScheduleYears(byYear, minYear = 2026, includeYear = null) {
  const now = new Date().getFullYear();
  const stored = Object.keys(byYear || {})
    .map((k) => Number(k))
    .filter((y) => Number.isFinite(y) && y >= minYear);
  const extra = Number(includeYear);
  const maxY = Math.max(now + 10, minYear, ...stored, Number.isFinite(extra) && extra >= minYear ? extra : minYear);
  const years = [];
  for (let y = minYear; y <= maxY; y += 1) years.push(y);
  return years;
}

export function generatorYearOptions(minYear = 2025, paddingYears = 15) {
  const now = new Date().getFullYear();
  const maxY = now + paddingYears;
  const years = [];
  for (let y = minYear; y <= maxY; y += 1) years.push(y);
  return years;
}
