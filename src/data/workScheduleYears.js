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

/**
 * 저장 칸이 비어 있으면 코드 시드로 채움(직접 입력·수정한 칸은 유지).
 */
export function rehydrateScheduleFromSeed(saved, seedTemplate) {
  const template = Array.isArray(seedTemplate) ? seedTemplate : [];
  const savedMap = new Map((Array.isArray(saved) ? saved : []).map((r) => [String(r?.name ?? ""), r]));
  return template.map((t) => {
    const hit = savedMap.get(t.name);
    const seedVals = Array.isArray(t.values) ? t.values : [];
    const savedVals = Array.isArray(hit?.values) ? hit.values : [];
    const len = Math.max(seedVals.length, savedVals.length, SCHEDULE_MONTH_COUNT);
    const values = Array.from({ length: len }, (_, i) => {
      const s = String(savedVals[i] ?? "").trim();
      const sd = String(seedVals[i] ?? "").trim();
      return s || sd || "";
    });
    return { name: t.name, values };
  });
}

function tryParseLocalStorageJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function normalizeWorkScheduleByYear(byYear, templates) {
  const src = byYear && typeof byYear === "object" ? byYear : {};
  const out = {};
  for (const key of Object.keys(src)) {
    const y = Number(key);
    if (!Number.isFinite(y) || y < 2026) continue;
    if (y === 2026) {
      out["2026"] = rehydrateScheduleFromSeed(src[key], templates.rows2026);
    } else if (y === 2027) {
      out["2027"] = rehydrateScheduleFromSeed(src[key], templates.rows2027);
    } else {
      out[String(y)] = mergeWorkScheduleRows(src[key], getWorkScheduleTemplateForYear(y, templates));
    }
  }
  if (!out["2026"]) out["2026"] = rehydrateScheduleFromSeed(null, templates.rows2026);
  if (!out["2027"]) out["2027"] = rehydrateScheduleFromSeed(null, templates.rows2027);
  return out;
}

export function loadWorkScheduleByYearFromStorage(storageKeys, templates) {
  const legacy26 = tryParseLocalStorageJson(storageKeys.y2026);
  const legacy27 = tryParseLocalStorageJson(storageKeys.y2027);
  const fromByYear =
    tryParseLocalStorageJson(storageKeys.byYear) ?? tryParseLocalStorageJson(storageKeys.byYearLegacy);

  const by = {};
  by["2026"] = rehydrateScheduleFromSeed(legacy26 ?? fromByYear?.["2026"], templates.rows2026);
  by["2027"] = rehydrateScheduleFromSeed(legacy27 ?? fromByYear?.["2027"], templates.rows2027);

  if (fromByYear && typeof fromByYear === "object") {
    for (const key of Object.keys(fromByYear)) {
      if (key === "2026" || key === "2027") continue;
      const y = Number(key);
      if (!Number.isFinite(y) || y < 2028) continue;
      by[String(y)] = mergeWorkScheduleRows(fromByYear[key], getWorkScheduleTemplateForYear(y, templates));
    }
  }
  return by;
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
