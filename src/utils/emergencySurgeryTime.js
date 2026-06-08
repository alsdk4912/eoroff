/** 수술 시작: 현재 시각 기준 최소 2시간 30분 이후 */
export const MIN_SURGERY_LEAD_MS = 2.5 * 60 * 60 * 1000;

export const SURGERY_START_TOO_SOON_MSG = "현재시간으로부터 2시간 30분이후의 수술만 설정가능합니다";

export function parseDatetimeLocalValue(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
}

export function localTodayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

export function minSurgeryStartDatetimeLocal() {
  const d = new Date(Date.now() + MIN_SURGERY_LEAD_MS);
  d.setSeconds(0, 0);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${min}`;
}

/** 당직일 + HH:mm → datetime-local 형식 */
export function combineSurgeryStartDatetime(ymd, timeHHmm) {
  const ld = String(ymd ?? "").slice(0, 10);
  const t = String(timeHHmm ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ld)) return "";
  if (!/^\d{2}:\d{2}$/.test(t)) return "";
  return `${ld}T${t}`;
}

/** 당직일이 오늘이면 time 입력 min (HH:mm) */
export function minSurgeryStartTimeForYmd(ymd) {
  const ld = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ld)) return "";
  if (ld !== localTodayYmd()) return "";
  const d = new Date(Date.now() + MIN_SURGERY_LEAD_MS);
  d.setSeconds(0, 0);
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

export function isSurgeryStartTimeAllowed(value) {
  const picked = parseDatetimeLocalValue(value);
  if (!picked) return false;
  return picked.getTime() >= Date.now() + MIN_SURGERY_LEAD_MS;
}

export function isSurgeryStartTimeAllowedForDate(ymd, timeHHmm) {
  return isSurgeryStartTimeAllowed(combineSurgeryStartDatetime(ymd, timeHHmm));
}
