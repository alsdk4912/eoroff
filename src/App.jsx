import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  holidaysCache as seedHolidays,
  initialAdjustmentLogs,
  initialCancellations,
  initialGoldkeys,
  initialPriorityNotes,
  initialRequests,
  initialSelections,
  initialHolidayDuties,
  initialLadderResults,
  users as seedUsers,
} from "./data/sampleData";
import {
  compareAppliedRequests,
  compareSameLeaveDateRequests,
  isFirstHalfGoldkeyOctoberConsultationRequest,
  isSecondHalfGoldkeyAprilConsultationRequest,
  shouldHideAprilRecruitHalfGoldkeyCancelledRow,
  isLeaveDateBeforeTodayKst,
  leaveNatureLabel,
  leaveTypeLabel,
  statusLabel,
  validateRequest,
} from "./utils/rules";
import { api } from "./api/client";
import { defaultGoldkeyQuotaForName } from "./data/goldkeyQuotas.js";
import { consumeManualVersionReloadToast, restoreHashAfterReload, useAppUpdate } from "./useAppUpdate.js";
import { buildAutoHolidayDutyPlan } from "./utils/holidayDutyPlan.clean.js";

/** 오프라인 저장소 버전 — 배포 시 키 올리면 예전 휴가·골드키 캐시 무시(빈 신청·기본 골드키로 로드) */
const LS_REQUESTS = "or.requests.v5";
const LS_NOTES = "or.notes.v3";
const LS_CANCELLATIONS = "or.cancellations.v3";
const LS_SELECTIONS = "or.selections.v3";
const LS_GOLDKEYS = "or.goldkeys.v4";
const LS_ADJUSTMENT_LOGS = "or.adjustmentLogs.v3";
const LS_HOLIDAY_DUTIES = "or.holidayDuties.v1";
const LS_LADDER_RESULTS = "or.ladderResults.v1";
const LS_ADMIN_DAY_MEMOS = "or.adminDayMemos.v1";
const LS_DAY_COMMENTS = "or.dayComments.v1";
const LS_WORK_SCHEDULE_2026 = "or.workSchedule2026.v1";
const LS_GENERATED_MONTHLY_SCHEDULES = "or.generatedMonthlySchedules.v1";
/** 승인 시 지정하는 대체 근무(서버 동기화 + 로컬 캐시) */
const LS_SUBSTITUTE_ASSIGNMENTS = "or.substituteAssignments.v1";
const LS_WEEKLY_CELL_OVERRIDES = "or.weeklyCellOverrides.v1";
const LS_NOTIFICATIONS = "or.notifications.v1";

/** 운영 예외: 해당 날짜/인원 골드키는 수동 협의로 처리 */
const FORCE_GOLDKEY_NEGOTIATION_KEYS = new Set([
  "2026-05-22|u_nurse_2", // 이양희
  "2026-05-22|u_nurse_8", // 임희종
  "2026-05-22|u_nurse_16", // 이현숙
]);

/** 같은 날·같은 유형 APPLIED 신청으로부터 사다리 협의 대상자 userId 목록 (사다리 페이지와 동일 규칙) */
function getLadderParticipantUserIdsForRequests(requests, leaveDate, leaveType) {
  const rows = (Array.isArray(requests) ? requests : []).filter(
    (r) => r.leaveDate === leaveDate && r.leaveType === leaveType && r.status === "APPLIED"
  );
  if (leaveType !== "GOLDKEY") return [...new Set(rows.map((r) => r.userId))];
  const forcedRows = rows.filter((r) =>
    FORCE_GOLDKEY_NEGOTIATION_KEYS.has(`${String(r.leaveDate ?? "")}|${String(r.userId ?? "")}`)
  );
  if (forcedRows.length >= 2) return [...new Set(forcedRows.map((r) => r.userId))];
  const peers = filterGoldkeyRowsForNegotiationPeers(rows);
  if (peers.length < 2) return [];
  return [...new Set(peers.map((r) => r.userId))];
}

function hasSavedLadderResultForKey(ladderResults, leaveDate, leaveType) {
  const key = `${String(leaveDate ?? "").trim()}|${String(leaveType ?? "").trim()}`;
  return (Array.isArray(ladderResults) ? ladderResults : []).some((row) => {
    const k = `${String(row?.leaveDate ?? "").trim()}|${String(row?.leaveType ?? "").trim()}`;
    return k === key;
  });
}

/** 사다리 결과 저장 전, 협의 대상자 중 누구라도 수기로 순번을 넣었으면 사다리 실행 불가 */
function manualNegotiationOrderBlocksLadder(requests, leaveDate, leaveType, ladderResults) {
  if (hasSavedLadderResultForKey(ladderResults, leaveDate, leaveType)) return false;
  const participantUserIds = getLadderParticipantUserIdsForRequests(requests, leaveDate, leaveType);
  if (participantUserIds.length < 2) return false;
  const rows = (Array.isArray(requests) ? requests : []).filter(
    (r) => r.leaveDate === leaveDate && r.leaveType === leaveType && r.status === "APPLIED"
  );
  for (const uid of participantUserIds) {
    const row = rows.find((r) => r.userId === uid);
    if (!row) continue;
    const o = row.negotiationOrder ?? row.negotiation_order;
    if (o == null || o === "") continue;
    const n = Number(o);
    if (Number.isInteger(n) && n >= 1 && n <= 999) return true;
  }
  return false;
}

function isNegotiationOrderInputLocked(requestRow, ladderDoneKeySet) {
  if (!requestRow) return false;
  if (requestRow.negotiationOrderLocked) return true;
  const key = `${String(requestRow.leaveDate ?? "").trim()}|${String(requestRow.leaveType ?? "").trim()}`;
  return Boolean(ladderDoneKeySet?.has?.(key));
}

/** 이전 버전 키는 남아 있으면 혼동만 되므로 제거(현재 키는 유지) */
function dropStaleOfflineLeaveKeys() {
  try {
    [
      "or.requests",
      "or.requests.v2",
      "or.requests.v3",
      "or.requests.v4",
      "or.notes",
      "or.notes.v2",
      "or.cancellations",
      "or.cancellations.v2",
      "or.selections",
      "or.selections.v2",
      "or.goldkeys",
      "or.goldkeys.v2",
      "or.goldkeys.v3",
      "or.adjustmentLogs",
      "or.adjustmentLogs.v2",
    ].forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** DB·표시용 날짜 문자열 정규화 (UTC/시간대 깨짐 방지 — `T` 포함 ISO는 slice만 하면 -1일 됨) */
function normalizeLeaveDateStr(s) {
  const raw = String(s ?? "").trim().replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) || /Z|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return toLocalYMD(d);
  }
  const head = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : raw;
}

/** 로컬 달력 기준 YYYY-MM-DD (Date UTC 변환 금지) */
function toLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toKstParts(dateLike) {
  const raw = String(dateLike ?? "").trim();
  const korean = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (korean) {
    return {
      year: Number(korean[1]),
      month: Number(korean[2]),
      day: Number(korean[3]),
    };
  }
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  if (!year || !month || !day) return null;
  return {
    year,
    month,
    day,
  };
}

function parseYmdParts(ymd) {
  const s = String(ymd ?? "").trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * 일반휴가 우선순위 모집기간(KST):
 * - 4/1 00:00 ~ 4/2 09:00
 *
 * 이 구간에는 GENERAL_NORMAL(후순위) 중에서도 "다음달(5월) 후순위"는 신청이 막혀야 합니다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function isKstAprilGeneralPriorityWindow(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return false;

  // "KST clock"의 UTC 컴포넌트를 기준으로 비교
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1; // 1~12
  if (month !== 4) return false;

  const startKstMs = Date.UTC(year, 3, 1, 0, 0, 0); // 4/1 00:00 KST
  const endKstMs = Date.UTC(year, 3, 2, 9, 0, 0); // 4/2 09:00 KST
  return kst.getTime() >= startKstMs && kst.getTime() <= endKstMs;
}

function isKstAprilFirstToTenth(dateLike) {
  const p = toKstParts(dateLike);
  return Boolean(p && p.month === 4 && p.day >= 1 && p.day <= 10);
}

function notifyDone(message) {
  const msg = String(message ?? "").trim();
  if (!msg) return;
  window.alert?.(msg);
}

/** 일반휴가-우선순위 신청 가능 구간(rules.clean.js validateRequest와 동일): 매월 1일 00:00 ~ 2일 09:00 로컬 */
function isLocalGeneralPriorityBannerWindow(d) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 2, 9, 0, 0, 0);
  return d >= start && d <= end;
}

/** 장기 골드키: 4/1~4/10 (당해 7~12월) */
function isLongTermGoldkeyAprilBannerWindow(d) {
  return d.getMonth() + 1 === 4 && d.getDate() >= 1 && d.getDate() <= 10;
}

/** 장기 골드키: 10/1~10/10 (익년 1~6월) */
function isLongTermGoldkeyOctoberBannerWindow(d) {
  return d.getMonth() + 1 === 10 && d.getDate() >= 1 && d.getDate() <= 10;
}

/** 같은 휴가일 골드키: 최초 신청 시각으로부터 24시간 이내 제출분끼리 협의(그 이후는 신청순 자동) */
const GOLDKEY_NEGOTIATION_WINDOW_MS = 24 * 60 * 60 * 1000;

function goldkeyAnchorRequestedAtMs(requestRows) {
  const sorted = [...requestRows].sort((a, b) =>
    String(a.requestedAt ?? "").localeCompare(String(b.requestedAt ?? ""))
  );
  const t = new Date(sorted[0]?.requestedAt ?? "").getTime();
  return Number.isFinite(t) ? t : NaN;
}

function isGoldkeyWithin24HoursAfterAnchor(anchorMs, requestedAtIso) {
  if (!Number.isFinite(anchorMs)) return false;
  const t = new Date(requestedAtIso ?? "").getTime();
  if (!Number.isFinite(t)) return false;
  return t - anchorMs <= GOLDKEY_NEGOTIATION_WINDOW_MS;
}

/** 사다리 협의 대상 행(2명 이상일 때만 사다리 가능). 4·10월 장기 모집 다인이 있으면 그 부분만 우선. */
function filterGoldkeyRowsForNegotiationPeers(rows) {
  const sorted = [...rows].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  if (sorted.length === 0) return [];
  const month = Number(String(sorted[0]?.leaveDate ?? "").slice(5, 7));

  if (month >= 1 && month <= 6) {
    const octConsult = sorted.filter((r) => isFirstHalfGoldkeyOctoberConsultationRequest(r));
    if (octConsult.length >= 2) return octConsult;
    const anchorMs = goldkeyAnchorRequestedAtMs(sorted);
    return sorted.filter((r) => isGoldkeyWithin24HoursAfterAnchor(anchorMs, r.requestedAt));
  }
  if (month >= 7 && month <= 12) {
    const aprConsult = sorted.filter((r) => isSecondHalfGoldkeyAprilConsultationRequest(r));
    if (aprConsult.length >= 2) return aprConsult;
    const anchorMs = goldkeyAnchorRequestedAtMs(sorted);
    return sorted.filter((r) => isGoldkeyWithin24HoursAfterAnchor(anchorMs, r.requestedAt));
  }

  const anchorMs = goldkeyAnchorRequestedAtMs(sorted);
  return sorted.filter((r) => isGoldkeyWithin24HoursAfterAnchor(anchorMs, r.requestedAt));
}

/** iOS Safari: 로그인 화면에서의 자동·수동 확대가 캘린더에 그대로 남는 현상 완화(뷰포트 재적용 + 스크롤 원점) */
function resetViewportScaleToDefault() {
  try {
    const ae = document.activeElement;
    if (ae && typeof ae.blur === "function") ae.blur();

    const scrollAllToTop = () => {
      window.scrollTo(0, 0);
      try {
        document.documentElement.scrollLeft = 0;
        document.documentElement.scrollTop = 0;
        document.body.scrollLeft = 0;
        document.body.scrollTop = 0;
      } catch {
        /* ignore */
      }
    };

    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content") || "width=device-width, initial-scale=1.0";
    const locked =
      "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, viewport-fit=cover";

    meta.setAttribute("content", locked);
    scrollAllToTop();

    window.setTimeout(() => {
      meta.setAttribute("content", original);
      scrollAllToTop();
    }, 110);
  } catch {
    /* ignore */
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function isKstOctoberFirstToTenth(dateLike) {
  const p = toKstParts(dateLike);
  return Boolean(p && p.month === 10 && p.day >= 1 && p.day <= 10);
}

function isLongTermGoldkeyDeductionExempt(requestRow, cancelledAt) {
  if (!requestRow || requestRow.leaveType !== "GOLDKEY") return false;
  const leave = parseYmdParts(requestRow.leaveDate);
  const requested = toKstParts(requestRow.requestedAt);
  const cancelled = toKstParts(cancelledAt);
  if (!leave || !requested || !cancelled) return false;
  if (leave.month >= 7 && leave.month <= 12) {
    if (leave.year !== cancelled.year) return false;
    return isKstAprilFirstToTenth(requestRow.requestedAt) && isKstAprilFirstToTenth(cancelledAt);
  }
  if (leave.month >= 1 && leave.month <= 6) {
    if (leave.year !== requested.year + 1 || cancelled.year !== requested.year) return false;
    return isKstOctoberFirstToTenth(requestRow.requestedAt) && isKstOctoberFirstToTenth(cancelledAt);
  }
  return false;
}

function leaveTypeCssClass(leaveType) {
  return `type-${String(leaveType || "").toLowerCase()}`;
}

/** v2 서버는 승인 시 APPROVED, 레거시 데이터는 SELECTED */
function isWinnerStatus(status) {
  return status === "SELECTED" || status === "APPROVED";
}

/**
 * 유형별 색상은 항상 표시 (골드키=빨강 등). 취소 건만 취소선.
 * (이전: 같은 날 다른 사람 승인 시 전부 회색 처리 → 골드키만 신청해도 회색으로 보이는 오해 유발)
 */
function buildLeaveChipClass(leaveType, status) {
  const parts = ["selected-item", leaveTypeCssClass(leaveType)];
  if (status === "CANCELLED") parts.push("request-cancelled");
  else if (status === "REJECTED") parts.push("request-rejected");
  else if (isWinnerStatus(status)) parts.push("request-approved");
  return parts.join(" ");
}

/** iOS/Safari type=date -1일 버그 회피: 연·월·일 분리 */
function YmdSplitInput({ value, onChange, disabled }) {
  const parsed = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (m) return { y: m[1], mo: m[2], d: m[3] };
    const t = toLocalYMD(new Date()).split("-");
    return { y: t[0], mo: t[1], d: t[2] };
  }, [value]);

  const maxDay = new Date(Number(parsed.y), Number(parsed.mo), 0).getDate();
  const safeD = String(Math.min(Math.max(1, Number(parsed.d)), maxDay)).padStart(2, "0");

  const years = useMemo(() => {
    const cy = new Date().getFullYear();
    return Array.from({ length: 9 }, (_, i) => String(cy - 3 + i));
  }, []);

  const update = (ny, nmo, nd) => {
    const max = new Date(Number(ny), Number(nmo), 0).getDate();
    const dn = Math.min(Math.max(1, Number(nd)), max);
    onChange(`${ny}-${String(nmo).padStart(2, "0")}-${String(dn).padStart(2, "0")}`);
  };

  return (
    <div className="ymd-split row wrap">
      <select disabled={disabled} className="ymd-select" aria-label="연도" value={parsed.y} onChange={(e) => update(e.target.value, parsed.mo, safeD)}>
        {years.map((yy) => (
          <option key={yy} value={yy}>
            {yy}년
          </option>
        ))}
      </select>
      <select disabled={disabled} className="ymd-select" aria-label="월" value={parsed.mo} onChange={(e) => update(parsed.y, e.target.value, safeD)}>
        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((mo) => (
          <option key={mo} value={mo}>
            {Number(mo)}월
          </option>
        ))}
      </select>
      <select disabled={disabled} className="ymd-select" aria-label="일" value={safeD} onChange={(e) => update(parsed.y, parsed.mo, e.target.value)}>
        {Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, "0")).map((dd) => (
          <option key={dd} value={dd}>
            {Number(dd)}일
          </option>
        ))}
      </select>
    </div>
  );
}

function App() {
  const { updateAvailable, applyUpdate } = useAppUpdate();

  useEffect(() => {
    restoreHashAfterReload();
  }, []);

  const [auth, setAuth] = useLocalStorage("or.auth", null);
  const [users, setUsers] = useState(seedUsers);
  const [requests, setRequests] = useLocalStorage(LS_REQUESTS, initialRequests);
  const [notes, setNotes] = useLocalStorage(LS_NOTES, initialPriorityNotes);
  const [cancellations, setCancellations] = useLocalStorage(LS_CANCELLATIONS, initialCancellations);
  const [selections, setSelections] = useLocalStorage(LS_SELECTIONS, initialSelections);
  const [goldkeys, setGoldkeys] = useLocalStorage(LS_GOLDKEYS, initialGoldkeys);
  const [adjustmentLogs, setAdjustmentLogs] = useLocalStorage(LS_ADJUSTMENT_LOGS, initialAdjustmentLogs);
  const [holidays, setHolidays] = useLocalStorage("or.holidays", seedHolidays);
  const [holidayDuties, setHolidayDuties] = useLocalStorage(LS_HOLIDAY_DUTIES, initialHolidayDuties);
  const [ladderResults, setLadderResults] = useLocalStorage(LS_LADDER_RESULTS, initialLadderResults);
  const [adminDayMemos, setAdminDayMemos] = useLocalStorage(LS_ADMIN_DAY_MEMOS, {});
  const [dayComments, setDayComments] = useLocalStorage(LS_DAY_COMMENTS, []);
  const [workScheduleRows, setWorkScheduleRows] = useLocalStorage(LS_WORK_SCHEDULE_2026, WORK_SCHEDULE_2026_ROWS);
  const [generatedMonthlySchedules, setGeneratedMonthlySchedules] = useLocalStorage(LS_GENERATED_MONTHLY_SCHEDULES, {});
  const [substituteAssignments, setSubstituteAssignments] = useLocalStorage(LS_SUBSTITUTE_ASSIGNMENTS, []);
  /** 주간 번표 셀 수동 표시(기기 로컬) */
  const [weeklyCellOverrides, setWeeklyCellOverrides] = useLocalStorage(LS_WEEKLY_CELL_OVERRIDES, {});
  const [notifications, setNotifications] = useLocalStorage(LS_NOTIFICATIONS, []);
  const [serverNotifications, setServerNotifications] = useState([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushEnabledByUser, setPushEnabledByUser] = useLocalStorage("or.pushEnabledByUser.v1", {});
  const [pushBusy, setPushBusy] = useState(false);
  const refreshBusyRef = useRef(false);

  useEffect(() => {
    dropStaleOfflineLeaveKeys();
  }, []);

  const [leaveType, setLeaveType] = useState("GOLDKEY");
  const [leaveNature, setLeaveNature] = useState("PERSONAL");
  const [leaveDate, setLeaveDate] = useState(() => toLocalYMD(new Date()));
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");
  const [apiMessage, setApiMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [resetDataMessage, setResetDataMessage] = useState("");
  const [restoreSqlText, setRestoreSqlText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [serverMode, setServerMode] = useState(false);
  /** 첫 bootstrap 완료 전에 서버 저장·덮어쓰기 레이스 방지 */
  const [dataHydrated, setDataHydrated] = useState(false);
  const now = new Date();
  const [syncYear, setSyncYear] = useState(String(now.getFullYear()));
  const [syncMonth, setSyncMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [calendarMonth, setCalendarMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [managedUsers, setManagedUsers] = useState([]);
  /** 달력에서 선택한 날짜(YYYY-MM-DD) — 상세 패널·신청 탭에 사용 */
  const [calendarSelectedYmd, setCalendarSelectedYmd] = useState(null);

  // 탭 이동(라우트 전환) 후 다시 "/calendar"로 돌아올 때는
  // "오늘"이 속한 월을 보여주도록 강제합니다.
  const location = useLocation();
  useEffect(() => {
    if (location?.pathname !== "/calendar") return;
    const sp = new URLSearchParams(location?.search ?? "");
    const ymdFromQuery = String(sp.get("ymd") ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymdFromQuery)) {
      setCalendarSelectedYmd(ymdFromQuery);
      setCalendarMonth(ymdFromQuery.slice(0, 7));
      setLeaveDate(ymdFromQuery);
      return;
    }

    const n = new Date();
    const nextMonth = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    setCalendarMonth(nextMonth);
    setCalendarSelectedYmd(null);
    setLeaveDate(toLocalYMD(n));
  }, [location?.pathname, location?.search]);

  const currentUser = users.find((u) => u.id === auth?.userId);
  const isAdmin = currentUser?.role === "ADMIN";
  const canEditHolidayDuty = currentUser?.role === "NURSE" || currentUser?.role === "ADMIN" || currentUser?.role === "ANESTHESIA";
  const myGoldkey = goldkeys.find((g) => g.userId === auth?.userId);
  const isLoggedIn = Boolean(auth?.userId);
  const prevIsLoggedInRef = useRef(false);
  const rememberedPushEnabled = Boolean(auth?.userId && pushEnabledByUser?.[auth.userId]);
  const notificationsSource = serverMode ? serverNotifications : notifications;
  const myNotifications = useMemo(
    () =>
      (Array.isArray(notificationsSource) ? notificationsSource : [])
        .filter((n) => n.userId === auth?.userId)
        .filter((n) => !n.readAt)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    [notificationsSource, auth?.userId]
  );
  const unreadNotificationCount = myNotifications.length;

  /** 로그인 직후 첫 화면(캘린더)이 그려진 뒤에 실행 — 동기 handleLogin만으로는 iOS에서 배율이 남는 경우가 있음 */
  useLayoutEffect(() => {
    if (isLoggedIn && !prevIsLoggedInRef.current) {
      prevIsLoggedInRef.current = true;
      resetViewportScaleToDefault();
      const t1 = window.setTimeout(() => resetViewportScaleToDefault(), 220);
      const t2 = window.setTimeout(() => resetViewportScaleToDefault(), 520);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    if (!isLoggedIn) prevIsLoggedInRef.current = false;
  }, [isLoggedIn]);

  useEffect(() => {
    let cancelled = false;
    const checkPush = async () => {
      if (!isLoggedIn || currentUser?.role !== "NURSE") {
        if (!cancelled) setPushEnabled(false);
        return;
      }
      // 서버 연결 감지 전/일시 불안정 시에도 사용자가 켠 상태를 유지
      if (!serverMode || !dataHydrated) {
        if (!cancelled) setPushEnabled(rememberedPushEnabled);
        return;
      }
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          if (!cancelled) setPushEnabled(false);
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) {
          const enabledNow = Boolean(sub) || rememberedPushEnabled;
          setPushEnabled(enabledNow);
          if (Boolean(sub) && auth?.userId) {
            setPushEnabledByUser((prev) => ({ ...(prev ?? {}), [auth.userId]: true }));
          }
        }
      } catch {
        if (!cancelled) setPushEnabled(rememberedPushEnabled);
      }
    };
    void checkPush();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, currentUser?.role, serverMode, dataHydrated, rememberedPushEnabled, auth?.userId, setPushEnabledByUser]);

  function createNotificationForNurses(message, payload = {}) {
    // 2단계: 서버 모드에서는 백엔드가 알림을 생성/동기화하므로
    // 프런트 로컬 알림을 추가로 만들지 않음(중복 방지)
    if (serverMode) return;
    const nurseIds = users.filter((u) => u.role === "NURSE").map((u) => u.id);
    if (nurseIds.length === 0) return;
    const nowIso = new Date().toISOString();
    const msg = String(message ?? "").trim();
    if (!msg) return;
    const rows = nurseIds.map((uid, idx) => ({
      id: `ntf_${Date.now()}_${idx}`,
      userId: uid,
      message: msg,
      type: String(payload.type ?? "INFO"),
      targetDate: payload.targetDate ? String(payload.targetDate) : "",
      leaveRequestId: payload.leaveRequestId ? String(payload.leaveRequestId) : "",
      createdAt: nowIso,
      readAt: "",
    }));
    setNotifications((prev) => [...rows, ...(Array.isArray(prev) ? prev : [])].slice(0, 800));
  }

  async function markAllNotificationsRead() {
    if (!auth?.userId) return;
    if (serverMode) {
      try {
        await api.markAllNotificationsRead({ userId: auth.userId });
        const result = await api.listNotifications(auth.userId);
        const rows = Array.isArray(result?.notifications) ? result.notifications : [];
        setServerNotifications(
          rows.map((n) => ({
            id: n.id,
            userId: n.user_id ?? n.userId,
            message: String(n.message ?? ""),
            type: String(n.type ?? "INFO"),
            targetDate: String(n.target_date ?? n.targetDate ?? ""),
            leaveRequestId: String(n.leave_request_id ?? n.leaveRequestId ?? ""),
            createdAt: String(n.created_at ?? n.createdAt ?? ""),
            readAt: String(n.read_at ?? n.readAt ?? ""),
          }))
        );
      } catch {
        // ignore
      }
      return;
    }
    const nowIso = new Date().toISOString();
    setNotifications((prev) =>
      (Array.isArray(prev) ? prev : []).map((n) =>
        n.userId === auth.userId && !n.readAt ? { ...n, readAt: nowIso } : n
      )
    );
  }

  async function markNotificationRead(notificationId) {
    const id = String(notificationId ?? "").trim();
    if (!id || !auth?.userId) return;
    if (serverMode) {
      try {
        await api.markNotificationRead(id, { userId: auth.userId });
        setServerNotifications((prev) =>
          (Array.isArray(prev) ? prev : []).map((n) =>
            n.id === id ? { ...n, readAt: new Date().toISOString() } : n
          )
        );
      } catch {
        // ignore
      }
      return;
    }
    setNotifications((prev) =>
      (Array.isArray(prev) ? prev : []).map((n) =>
        n.id === id && n.userId === auth.userId ? { ...n, readAt: new Date().toISOString() } : n
      )
    );
  }

  async function enablePushNotifications() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (!isLoggedIn || currentUser?.role !== "NURSE") {
        window.alert?.("간호사 계정에서만 푸시 알림을 사용할 수 있습니다.");
        return;
      }
      if (!serverMode) {
        window.alert?.("서버 연결 모드에서만 푸시 알림을 설정할 수 있습니다.");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        window.alert?.("이 기기/브라우저는 Web Push를 지원하지 않습니다.");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        window.alert?.("알림 권한이 허용되지 않았습니다.");
        return;
      }
      const scope = import.meta.env.BASE_URL || "/";
      let reg = await navigator.serviceWorker.getRegistration(scope);
      if (!reg) {
        reg = await withTimeout(
          navigator.serviceWorker.register(`${scope}sw.js`, { scope, updateViaCache: "none" }),
          8000,
          "서비스 워커 등록 시간이 초과되었습니다."
        );
      }
      const readyReg = await withTimeout(
        navigator.serviceWorker.ready,
        8000,
        "서비스 워커 준비 시간이 초과되었습니다."
      );
      const keyResp = await api.getPushVapidPublicKey();
      const publicKey = String(keyResp?.publicKey ?? "");
      if (!publicKey) {
        window.alert?.("서버 VAPID 설정이 없어 푸시를 사용할 수 없습니다.");
        return;
      }
      let sub = await readyReg.pushManager.getSubscription();
      if (!sub) {
        sub = await withTimeout(
          readyReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          }),
          12000,
          "푸시 구독 시간이 초과되었습니다. 다시 시도해 주세요."
        );
      }
      await api.savePushSubscription({
        userId: auth?.userId,
        subscription: sub.toJSON(),
      });
      await api.sendPushTestToSelf({ userId: auth?.userId });
      if (auth?.userId) {
        setPushEnabledByUser((prev) => ({ ...(prev ?? {}), [auth.userId]: true }));
      }
      setPushEnabled(true);
      notifyDone("푸시 알림이 활성화되었습니다. 테스트 알림을 확인해 주세요.");
    } catch (e) {
      window.alert?.(`푸시 설정 실패: ${e?.message || e}`);
    } finally {
      setPushBusy(false);
    }
  }

  function applyBootstrapPayload(data) {
    setUsers(data.users.map((u) => ({ id: u.id, name: u.name, role: u.role, employeeNo: u.employee_no })));
    const mappedReqs = (data.requests ?? []).map(mapRequestRow);
    const uniqById = new Map();
    for (const r of mappedReqs) {
      if (r?.id && !uniqById.has(r.id)) uniqById.set(r.id, r);
    }
    setRequests([...uniqById.values()]);
    setNotes(data.notes.map((n) => ({ id: n.id, leaveRequestId: n.leave_request_id, content: n.content, agreedOrder: n.agreed_order })));
    setCancellations(
      data.cancellations.map((c) => ({
        id: c.id,
        leaveRequestId: c.leave_request_id,
        cancelledBy: c.cancelled_by,
        cancelReason: c.cancel_reason,
        cancelledAt: c.cancelled_at,
        deductionExempt: Boolean(c.deduction_exempt ?? c.deductionExempt),
        deductionNote: String(c.deduction_note ?? c.deductionNote ?? ""),
      }))
    );
    setSelections(data.selections.map((s) => ({ id: s.id, leaveRequestId: s.leave_request_id, selectedBy: s.selected_by, selectedAt: s.selected_at })));
    setGoldkeys(
      data.goldkeys.map((g) => ({
        userId: g.user_id ?? g.userId,
        quotaTotal: Number(g.quota_total ?? g.quotaTotal ?? 0),
        usedCount: Number(g.used_count ?? g.usedCount ?? 0),
        remainingCount: Number(g.remaining_count ?? g.remainingCount ?? 0),
      }))
    );
    setAdjustmentLogs(data.logs.map((l) => ({ id: l.id, userId: l.user_id, beforeQuota: l.before_quota, afterQuota: l.after_quota, changedBy: l.changed_by, changedAt: l.changed_at })));
    setHolidays(data.holidays.map((h) => ({ holidayDate: h.holiday_date, holidayName: h.holiday_name, isHoliday: Boolean(h.is_holiday) })));

    const dutyRows = Array.isArray(data.holidayDuties) ? data.holidayDuties : [];
    const dutyByDate = dutyRows.reduce((acc, d) => {
      const hd = d.holiday_date ?? d.holidayDate;
      if (!hd) return acc;
      acc[hd] = {
        nurse1UserId: d.nurse1_user_id ?? d.nurse1UserId ?? "",
        nurse2UserId: d.nurse2_user_id ?? d.nurse2UserId ?? "",
        anesthesiaUserId: d.anesthesia_user_id ?? d.anesthesiaUserId ?? "",
      };
      return acc;
    }, {});
    setHolidayDuties(dutyByDate);
    const subRows = Array.isArray(data.substituteAssignments) ? data.substituteAssignments : [];
    const normalizedSubs = subRows
      .map((s) => ({
        id: s.id,
        requestId: s.request_id ?? s.requestId,
        leaveDate: s.leave_date ?? s.leaveDate,
        leaveUserId: s.leave_user_id ?? s.leaveUserId,
        substituteUserId: s.substitute_user_id ?? s.substituteUserId,
        shiftCode: s.shift_code ?? s.shiftCode,
      }))
      .filter((s) => s.id && s.requestId && s.leaveDate && s.substituteUserId && s.shiftCode);
    const seenSub = new Set();
    setSubstituteAssignments(
      normalizedSubs.filter((s) => {
        const key = `${String(s.requestId)}|${String(s.leaveDate).slice(0, 10)}|${String(s.substituteUserId)}|${String(s.shiftCode)}`;
        if (seenSub.has(key)) return false;
        seenSub.add(key);
        return true;
      })
    );
    const memoRows = Array.isArray(data.adminDayMemos) ? data.adminDayMemos : [];
    const memoByDate = memoRows.reduce((acc, m) => {
      const ymd = m.target_date ?? m.targetDate;
      if (!ymd) return acc;
      acc[ymd] = String(m.content ?? "");
      return acc;
    }, {});
    setAdminDayMemos(memoByDate);
    const dayCommentRows = Array.isArray(data.dayComments) ? data.dayComments : [];
    setDayComments(
      dayCommentRows
        .map((row) => ({
          id: row.id,
          targetDate: row.target_date ?? row.targetDate,
          content: String(row.content ?? ""),
          userId: row.user_id ?? row.userId,
          createdAt: row.created_at ?? row.createdAt,
        }))
        .filter((row) => row.id && row.targetDate && row.userId)
    );

    const rows = Array.isArray(data.ladderResults) ? data.ladderResults : [];
    setLadderResults(
      rows.map((r) => ({
        id: r.id,
        leaveDate: r.leave_date ?? r.leaveDate,
        leaveType: r.leave_type ?? r.leaveType,
        participants: safeParseJsonArray(r.participants_json ?? r.participantsJson),
        order: safeParseJsonArray(r.order_json ?? r.orderJson),
        createdBy: r.created_by ?? r.createdBy,
        createdAt: r.created_at ?? r.createdAt,
      }))
    );
    if (data.weeklyCellOverrides != null) {
      setWeeklyCellOverrides(mapWeeklyOverrideRowsToClient(Array.isArray(data.weeklyCellOverrides) ? data.weeklyCellOverrides : []));
    }
  }

  async function persistWeeklyCellOverridesToServer(snapshot) {
    if (!serverMode || !auth?.userId) return;
    await api.syncWeeklyCellOverrides({ overrides: snapshot, actorUserId: auth.userId });
    const data = await api.bootstrap();
    applyBootstrapPayload(data);
  }

  useEffect(() => {
    if (!isLoggedIn) {
      setDataHydrated(true);
      return;
    }
    let cancelled = false;
    setDataHydrated(false);
    void (async () => {
      try {
        const data = await api.bootstrap();
        if (cancelled) return;
        applyBootstrapPayload(data);
        setServerMode(true);
      } catch {
        if (!cancelled) setServerMode(false);
      } finally {
        if (!cancelled) setDataHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, auth?.userId]);

  useEffect(() => {
    if (!isLoggedIn || !isAdmin) return;
    (async () => {
      try {
        const userList = await api.listUsers();
        setManagedUsers(
          userList.users.map((u) => ({
            id: u.id,
            name: u.name,
            employeeNo: u.employee_no,
            role: u.role,
          }))
        );
      } catch {
        setManagedUsers([]);
      }
    })();
  }, [isLoggedIn, isAdmin]);

  useEffect(() => {
    if (!isLoggedIn || currentUser?.role !== "NURSE" || !serverMode) {
      setServerNotifications([]);
      return;
    }
    let cancelled = false;
    let timerId;
    const load = async () => {
      try {
        const result = await api.listNotifications(auth?.userId);
        if (cancelled) return;
        const rows = Array.isArray(result?.notifications) ? result.notifications : [];
        setServerNotifications(
          rows.map((n) => ({
            id: n.id,
            userId: n.user_id ?? n.userId,
            message: String(n.message ?? ""),
            type: String(n.type ?? "INFO"),
            targetDate: String(n.target_date ?? n.targetDate ?? ""),
            leaveRequestId: String(n.leave_request_id ?? n.leaveRequestId ?? ""),
            createdAt: String(n.created_at ?? n.createdAt ?? ""),
            readAt: String(n.read_at ?? n.readAt ?? ""),
          }))
        );
      } catch {
        // ignore polling failure
      } finally {
        if (!cancelled) timerId = window.setTimeout(load, 20000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [isLoggedIn, serverMode, currentUser?.role, auth?.userId]);

  async function bootstrap() {
    try {
      const data = await api.bootstrap();
      applyBootstrapPayload(data);
      setServerMode(true);
    } catch {
      setServerMode(false);
    }
  }

  async function refreshServerData() {
    if (!isLoggedIn || refreshBusyRef.current) return false;
    refreshBusyRef.current = true;
    try {
      const data = await api.bootstrap();
      applyBootstrapPayload(data);
      setServerMode(true);
      return true;
    } catch {
      return false;
    } finally {
      refreshBusyRef.current = false;
    }
  }

  /** 상단 새로고침(업데이트) 버튼으로만 안내 — 당겨서 갱신·주기 bootstrap 은 알림 없음 */
  useEffect(() => {
    if (!isLoggedIn) return;
    if (consumeManualVersionReloadToast()) {
      window.setTimeout(() => notifyDone("최신 버전으로 갱신되었습니다."), 0);
    }
  }, [isLoggedIn]);

  /** 간호사: 일반-우선·장기 골드키 신청 기간 팝업(유형별 하루 1회, localStorage 키 분리) */
  useEffect(() => {
    if (!dataHydrated || !auth?.userId || currentUser?.role !== "NURSE") return;

    const now = new Date();
    const dayKey = toLocalYMD(now);
    const popups = [];

    if (isLocalGeneralPriorityBannerWindow(now)) {
      const k = `or.periodBanner.gp.${dayKey}`;
      if (!localStorage.getItem(k)) {
        localStorage.setItem(k, "1");
        popups.push("일반휴가-우선순위 신청가능기간입니다");
      }
    }
    if (isLongTermGoldkeyAprilBannerWindow(now)) {
      const k = `or.periodBanner.ltApr.${dayKey}`;
      if (!localStorage.getItem(k)) {
        localStorage.setItem(k, "1");
        popups.push(`${now.getFullYear()}년 7월 ~ 12월 장기휴가 신청가능기간입니다`);
      }
    }
    if (isLongTermGoldkeyOctoberBannerWindow(now)) {
      const k = `or.periodBanner.ltOct.${dayKey}`;
      if (!localStorage.getItem(k)) {
        localStorage.setItem(k, "1");
        popups.push(`${now.getFullYear() + 1}년 1월 ~ 6월 장기휴가 신청가능기간입니다`);
      }
    }

    if (popups.length === 0) return;
    const t = window.setTimeout(() => {
      for (const msg of popups) {
        window.alert(msg);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [dataHydrated, auth?.userId, currentUser?.role]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const onResumeRefresh = () => {
      if (document.visibilityState === "visible") {
        void refreshServerData();
      }
    };
    const timerId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshServerData();
      }
    }, 45000);
    window.addEventListener("focus", onResumeRefresh);
    document.addEventListener("visibilitychange", onResumeRefresh);
    return () => {
      window.clearInterval(timerId);
      window.removeEventListener("focus", onResumeRefresh);
      document.removeEventListener("visibilitychange", onResumeRefresh);
    };
  }, [isLoggedIn, auth?.userId]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let pulling = false;
    let startY = 0;
    let maxDelta = 0;
    const threshold = 95;

    const onTouchStart = (e) => {
      if (window.scrollY > 0) {
        pulling = false;
        return;
      }
      startY = Number(e.touches?.[0]?.clientY ?? 0);
      maxDelta = 0;
      pulling = true;
    };
    const onTouchMove = (e) => {
      if (!pulling) return;
      const y = Number(e.touches?.[0]?.clientY ?? 0);
      maxDelta = Math.max(maxDelta, y - startY);
    };
    const onTouchEnd = () => {
      if (!pulling) return;
      pulling = false;
      if (window.scrollY === 0 && maxDelta >= threshold) {
        void refreshServerData();
      }
      maxDelta = 0;
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isLoggedIn, auth?.userId]);

  async function handleResetLeaveData() {
    if (
      !window.confirm(
        "모든 휴가 신청·협의 메모·선정·취소 기록을 삭제하고, 간호사 골드키를 이름별 기본 총량·잔여로 되돌립니다. 계속할까요?"
      )
    ) {
      return;
    }
    setResetDataMessage("");
    if (serverMode) {
      try {
        await api.resetLeaveData({ adminUserId: auth.userId });
        await bootstrap();
        setResetDataMessage("서버 데이터를 초기화했습니다.");
      } catch (e) {
        setResetDataMessage(`초기화 실패: ${e?.message || e}`);
      }
      return;
    }
    setRequests([...initialRequests]);
    setNotes([...initialPriorityNotes]);
    setCancellations([...initialCancellations]);
    setSelections([...initialSelections]);
    setGoldkeys(initialGoldkeys.map((g) => ({ ...g })));
    setAdjustmentLogs([...initialAdjustmentLogs]);
    setResetDataMessage("브라우저에 저장된 휴가·골드키 데이터를 기본값으로 되돌렸습니다.");
  }

  async function saveHolidayDuty(holidayDate, nurse1UserId, nurse2UserId, anesthesiaUserId) {
    const hd = String(holidayDate ?? "").trim();
    if (!hd) return;
    const a1 = String(anesthesiaUserId ?? "").trim();
    if (!nurse1UserId || !nurse2UserId || !a1) return;

    if (serverMode) {
      try {
        await api.upsertHolidayDuty({
          actorUserId: auth.userId,
          holidayDate: hd,
          nurse1UserId,
          nurse2UserId,
          anesthesiaUserId: a1,
        });
        await bootstrap();
      } catch (e) {
        window.alert?.(`당직자 저장 실패: ${e?.message || e}`);
      }
      return;
    }

    // 오프라인: 브라우저 로컬에만 저장
    setHolidayDuties((prev) => ({
      ...(prev ?? {}),
      [hd]: { nurse1UserId, nurse2UserId, anesthesiaUserId: a1 },
    }));
  }

  async function autoAssignUnsetHolidayDutiesByYear(year) {
    const y = Number(year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      window.alert?.("자동지정 연도가 올바르지 않습니다.");
      return;
    }
    const plan = buildAutoHolidayDutyPlan({
      year: y,
      users,
      holidays,
      holidayDuties,
    });
    if (plan.length === 0) {
      window.alert?.("자동지정할 미정 당직이 없습니다.");
      return;
    }

    if (serverMode) {
      try {
        for (const row of plan) {
          await api.upsertHolidayDuty({
            actorUserId: auth.userId,
            holidayDate: row.holidayDate,
            nurse1UserId: row.nurse1UserId,
            nurse2UserId: row.nurse2UserId,
          });
        }
        await bootstrap();
        window.alert?.(`미정 당직 ${plan.length}건 자동지정 완료`);
      } catch (e) {
        window.alert?.(`당직 자동지정 실패: ${e?.message || e}`);
      }
      return;
    }

    setHolidayDuties((prev) => {
      const next = { ...(prev ?? {}) };
      for (const row of plan) {
        next[row.holidayDate] = {
          nurse1UserId: row.nurse1UserId,
          nurse2UserId: row.nurse2UserId,
        };
      }
      return next;
    });
    window.alert?.(`미정 당직 ${plan.length}건 자동지정 완료`);
  }

  async function createLadderResult(payload) {
    if (serverMode) {
      try {
        await api.createLadderResult(payload);
        await bootstrap();
      } catch (e) {
        window.alert?.(`사다리 결과 저장 실패: ${e?.message || e}`);
      }
      return;
    }
    setLadderResults((prev) => [payload, ...(Array.isArray(prev) ? prev : [])]);
  }

  async function applyLadderResultToNegotiationOrder({ leaveDate, leaveType, orderUserIds }) {
    const target = requests
      .filter((r) => r.leaveDate === leaveDate && r.leaveType === leaveType && r.status === "APPLIED")
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    if (target.length === 0) return;

    const byUser = new Map();
    for (const r of target) {
      if (!byUser.has(r.userId)) byUser.set(r.userId, []);
      byUser.get(r.userId).push(r);
    }

    const updates = [];
    for (let i = 0; i < orderUserIds.length; i += 1) {
      const userId = orderUserIds[i];
      const list = byUser.get(userId) ?? [];
      const row = list.shift();
      if (!row) continue;
      updates.push({ requestId: row.id, negotiationOrder: i + 1 });
    }

    if (updates.length === 0) return;
    if (serverMode) {
      try {
        for (const u of updates) {
          await api.patchNegotiationOrder(u.requestId, { negotiationOrder: u.negotiationOrder, actorUserId: auth.userId });
        }
        await bootstrap();
      } catch (e) {
        window.alert?.(`사다리 결과 순번 반영 실패: ${e?.message || e}`);
      }
      return;
    }
    setRequests((prev) =>
      prev.map((r) => {
        const u = updates.find((x) => x.requestId === r.id);
        return u ? { ...r, negotiationOrder: u.negotiationOrder, negotiationOrderLocked: true } : r;
      })
    );
  }

  async function saveNegotiationOrder(requestId, rawString) {
    const target = requests.find((r) => r.id === requestId);
    if (target?.negotiationOrderLocked) {
      window.alert?.("협의 순번이 확정되어 수정할 수 없습니다.");
      return;
    }
    if (target && hasSavedLadderResultForKey(ladderResults, target.leaveDate, target.leaveType)) {
      window.alert?.("사다리로 순번이 확정되어 수정할 수 없습니다.");
      return;
    }
    const trimmed = String(rawString ?? "").trim();
    const negotiationOrder = trimmed === "" ? null : Number(trimmed);
    if (negotiationOrder !== null && (!Number.isInteger(negotiationOrder) || negotiationOrder < 1 || negotiationOrder > 999)) {
      window.alert?.("협의 순번은 1~999 사이 정수이거나 비워야 합니다.");
      return;
    }
    if (serverMode) {
      try {
        await api.patchNegotiationOrder(requestId, { negotiationOrder, actorUserId: auth.userId });
        await bootstrap();
        notifyDone("저장되었습니다.");
      } catch (e) {
        const msg = String(e?.message || e || "");
        if (msg.includes("409") || msg.includes("확정")) {
          window.alert?.("협의 순번이 확정되어 수정할 수 없습니다.");
        } else {
          window.alert?.(`저장 실패: ${msg}`);
        }
      }
    } else {
      setRequests((prev) => {
        const next = prev.map((r) => {
          if (r.id !== requestId) return r;
          const nextLocked =
            negotiationOrder != null && Number.isInteger(negotiationOrder) && negotiationOrder >= 1 && negotiationOrder <= 999
              ? true
              : Boolean(r.negotiationOrderLocked);
          return { ...r, negotiationOrder, negotiationOrderLocked: nextLocked };
        });
        try {
          localStorage.setItem(LS_REQUESTS, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      notifyDone("저장되었습니다.");
    }
  }

  function normalizeLoginName(s) {
    return String(s ?? "").replace(/\s/g, "");
  }

  async function handleLogin(loginName, password) {
    const trimmed = String(loginName ?? "").trim();
    if (!trimmed) throw new Error("이름을 입력해주세요.");
    if (/^[A-Za-z]?\d+$/.test(trimmed)) {
      throw new Error("사번 로그인은 비활성화되었습니다. 이름으로 로그인해주세요.");
    }

    try {
      const data = await api.login({ loginName: trimmed, password });
      try {
        document.activeElement?.blur?.();
      } catch {
        /* ignore */
      }
      setAuth({ userId: data.user.id });
      return;
    } catch (e) {
      const msg = String(e?.message || "");
      const allowOfflineLogin =
        e?.name === "TypeError" ||
        e?.name === "AbortError" ||
        msg.includes("Failed to fetch") ||
        msg.includes("Load failed") ||
        msg.includes("NetworkError") ||
        msg.includes("요청 시간이 초과되었습니다") ||
        /^HTTP 404\b/.test(msg) ||
        /^HTTP 405\b/.test(msg);

      if (!allowOfflineLogin) {
        throw new Error(msg || "로그인에 실패했습니다. 이름/비밀번호를 확인하세요.");
      }

      const n = normalizeLoginName(trimmed);
      const matches = users.filter((u) => normalizeLoginName(u.name) === n);
      if (matches.length === 0) {
        throw new Error(
          "지금은 API에 연결되지 않아 오프라인 로그인만 됩니다. 이름은 DB 시드와 동일해야 합니다(김해림·이양희 등, 비번 1234). 전원이 같은 DB를 쓰려면 GitHub Secret VITE_API_BASE_URL을 넣고 Pages를 다시 빌드하세요."
        );
      }
      if (matches.length > 1) throw new Error("동명이인이 있어 로그인할 수 없습니다.");
      if (String(password) !== "1234") {
        throw new Error("이름 또는 비밀번호가 올바르지 않습니다.");
      }
      try {
        document.activeElement?.blur?.();
      } catch {
        /* ignore */
      }
      setAuth({ userId: matches[0].id });
    }
  }

  function handleLogout() {
    setAuth(null);
  }

  const requestsVisibleInUi = useMemo(
    () => (Array.isArray(requests) ? requests : []).filter((r) => !shouldHideAprilRecruitHalfGoldkeyCancelledRow(r)),
    [requests]
  );
  const myRequests = useMemo(
    () => requestsVisibleInUi.filter((r) => r.userId === auth?.userId),
    [requestsVisibleInUi, auth?.userId]
  );
  const appliedRequests = useMemo(
    () =>
      [...requestsVisibleInUi]
        .filter((r) => r.status === "APPLIED")
        .sort((a, b) => compareAppliedRequests(a, b, users)),
    [requestsVisibleInUi, users]
  );
  const dashboard = useMemo(
    () => ({
      total: requestsVisibleInUi.length,
      applied: requestsVisibleInUi.filter((r) => r.status === "APPLIED").length,
      selected: requestsVisibleInUi.filter((r) => isWinnerStatus(r.status)).length,
      cancelled: requestsVisibleInUi.filter((r) => r.status === "CANCELLED").length,
    }),
    [requestsVisibleInUi]
  );
  const calendarData = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    return buildMonthMatrix(year, month, requestsVisibleInUi, users, holidays);
  }, [calendarMonth, requestsVisibleInUi, users, holidays]);

  const calendarDayRequests = useMemo(() => {
    if (!calendarSelectedYmd) return [];
    const sorted = [...requestsVisibleInUi]
      .filter((r) => r.leaveDate === calendarSelectedYmd)
      .sort((a, b) => compareSameLeaveDateRequests(a, b, users));
    return dedupeRequestsForCalendarChips(sorted);
  }, [requestsVisibleInUi, calendarSelectedYmd, users]);

  async function submitRequest(e) {
    e.preventDefault();
    if (!dataHydrated) {
      setMessage("데이터를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    // 우선순위 모집기간(4/1~4/2 09:00 KST)에는 '다음달(5월) 후순위'가 들어가지 않게 막기
    // (4/1 신청 → 4/13(당월) 후순위는 허용)
    const nowForValidation = new Date();
    const targetParts = parseYmdParts(leaveDate);
    if (leaveType === "GENERAL_NORMAL" && isKstAprilGeneralPriorityWindow(nowForValidation) && targetParts?.month === 5) {
      return setMessage("4월 일반-후순위(다음달)는 4/2 09:00 ~ 4/30에만 신청 가능합니다.");
    }

    const error = validateRequest({
      leaveType,
      leaveDate,
      leaveNature,
      now: nowForValidation,
      remainingGoldkey: myGoldkey?.remainingCount ?? 0,
      holidaysCache: holidays,
      userId: auth.userId,
      requests,
    });
    if (error) return setMessage(error);
    if (currentUser?.role !== "NURSE") {
      setMessage("마취과 간호사는 휴가 신청을 할 수 없습니다.");
      return;
    }
    const payload = {
      id: `lr_${Date.now()}`,
      userId: auth.userId,
      leaveDate,
      leaveType,
      leaveNature,
      status: "APPLIED",
      requestedAt: new Date().toISOString(),
      memo,
      cancelLocked: false,
    };
    setMessage("");
    let doneNote = "휴가 신청이 등록되었습니다.";

    if (serverMode) {
      try {
        await api.createRequest(payload);
      } catch (err) {
        setMessage(`서버에 저장하지 못했습니다: ${err?.message || err}. 네트워크·API 주소를 확인하세요.`);
        return;
      }
      try {
        await bootstrap();
      } catch {
        doneNote += " (목록 갱신에 실패했습니다. 새로고침 해 보세요.)";
      }
      /* 골드키 차감은 서버 INSERT 시 DB 반영 → bootstrap으로 잔여 동기화 */
    } else {
      setRequests((prev) => {
        const next = [...prev, payload];
        try {
          localStorage.setItem(LS_REQUESTS, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      if (leaveType === "GOLDKEY" && myGoldkey) {
        setGoldkeys((prev) => {
          const next = prev.map((g) =>
            g.userId === auth.userId
              ? { ...g, usedCount: g.usedCount + 1, remainingCount: Math.max(0, g.remainingCount - 1) }
              : g
          );
          try {
            localStorage.setItem(LS_GOLDKEYS, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      }
    }

    setMessage(doneNote);
    notifyDone(doneNote);
    setLeaveDate(calendarSelectedYmd ?? toLocalYMD(new Date()));
    setMemo("");
  }

  async function cancelRequest(requestId) {
    const target = requests.find((r) => r.id === requestId);
    if (target?.cancelLocked) return;
    const leaveYmd = normalizeLeaveDateStr(target?.leaveDate);
    if (target && isLeaveDateBeforeTodayKst(leaveYmd)) {
      window.alert?.("휴가일이 지난 신청은 취소할 수 없습니다.");
      return;
    }
    const ok = window.confirm("정말 취소하시겠습니까?");
    if (!ok) return;
    const payload = {
      cancellationId: `lc_${Date.now()}`,
      cancelledBy: auth.userId,
      cancelReason: "사용자 취소",
      cancelledAt: new Date().toISOString(),
    };
    const deductionExempt = isLongTermGoldkeyDeductionExempt(target, payload.cancelledAt);
    const deductionNote = deductionExempt ? "차감 제외 처리됨(장기휴가 모집기간)" : "";
    const prevSnapshot = requests;
    const prevCancellations = cancellations;
    const prevGoldkeys = goldkeys;
    setRequests((prev) => {
      const next = prev.map((r) => (r.id === requestId ? { ...r, status: "CANCELLED", cancelLocked: true } : r));
      if (!serverMode) {
        try {
          localStorage.setItem(LS_REQUESTS, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
    setCancellations((prev) => [...prev, { id: payload.cancellationId, leaveRequestId: requestId, ...payload, deductionExempt, deductionNote }]);
    if (!serverMode && deductionExempt && target?.leaveType === "GOLDKEY" && target?.userId) {
      setGoldkeys((prev) =>
        prev.map((g) =>
          g.userId === target.userId
            ? {
                ...g,
                usedCount: Math.max(0, Number(g.usedCount || 0) - 1),
                remainingCount: Math.min(Number(g.quotaTotal || 0), Number(g.remainingCount || 0) + 1),
              }
            : g
        )
      );
    }
    if (serverMode) {
      try {
        const result = await api.cancelRequest(requestId, payload);
        await bootstrap();
        if (result?.deductionExempt) {
          window.alert?.(result?.deductionNote || "차감 제외 처리됨(장기휴가 모집기간)");
        }
      } catch (e) {
        window.alert?.(`취소 반영 실패: ${e?.message || e}`);
        setRequests(prevSnapshot);
        setCancellations(prevCancellations);
        setGoldkeys(prevGoldkeys);
        try {
          localStorage.setItem(LS_REQUESTS, JSON.stringify(prevSnapshot));
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function uncancelRequest(requestId) {
    if (!isAdmin) {
      window.alert?.("취소 복원은 관리자만 할 수 있습니다.");
      return;
    }
    const target = requests.find((r) => r.id === requestId);
    if (!target || target.status !== "CANCELLED") return;
    if (!window.confirm("정말 복원하시겠습니까?")) return;
    const prevSnapshot = requests;
    const prevCancellations = cancellations;
    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "APPLIED", cancelLocked: false } : r)));
    setCancellations((prev) => (Array.isArray(prev) ? prev.filter((c) => c.leaveRequestId !== requestId) : []));
    if (serverMode) {
      try {
        await api.uncancelRequest(requestId, { actorUserId: auth.userId });
        await bootstrap();
      } catch (e) {
        window.alert?.(`취소 복원 실패: ${e?.message || e}`);
        setRequests(prevSnapshot);
        setCancellations(prevCancellations);
      }
    }
  }

  async function selectRequest(requestId, substituteOpts = null) {
    const target = requests.find((r) => r.id === requestId);
    if (!target) return;
    const rawItems = Array.isArray(substituteOpts?.substituteItems)
      ? substituteOpts.substituteItems
      : [{ substituteUserId: substituteOpts?.substituteUserId ?? "", shiftCode: substituteOpts?.shiftCode ?? "" }];
    const normalizedItems = rawItems
      .map((it, idx) => ({
        id: String(it?.id ?? `sub_${Date.now()}_${idx}`).trim(),
        requestId,
        leaveDate: target.leaveDate,
        leaveUserId: target.userId,
        substituteUserId: String(it?.substituteUserId ?? "").trim(),
        shiftCode: normalizeShiftCodeForSave(it?.shiftCode),
      }))
      .filter((it) => it.substituteUserId || it.shiftCode);
    const subItems = [];
    for (const it of normalizedItems) {
      const err = validateSubstitutePayload({
        leaveDate: target.leaveDate,
        leaveUserId: target.userId,
        substituteUserId: it.substituteUserId,
        shiftCode: it.shiftCode,
        requests,
        substituteAssignments: [...(Array.isArray(substituteAssignments) ? substituteAssignments : []), ...subItems],
        excludeRequestId: requestId,
      });
      if (err) {
        window.alert?.(err);
        return;
      }
      subItems.push(it);
    }
    if (subItems.length > 0 && !serverMode) {
      window.alert?.("서버 연결 상태에서만 대체 근무를 함께 저장할 수 있습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const payload = {
      selectionId: `ls_${Date.now()}`,
      selectedBy: auth.userId,
      selectedAt: new Date().toISOString(),
    };
    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "APPROVED" } : r)));
    setSelections((prev) => [...prev, { id: payload.selectionId, leaveRequestId: requestId, ...payload }]);
    setSubstituteAssignments((prev) => {
      const rest = (Array.isArray(prev) ? prev : []).filter((x) => x.requestId !== requestId);
      if (subItems.length === 0) return rest;
      return [...rest, ...subItems];
    });
    if (serverMode) {
      try {
        await api.selectRequest(requestId, payload);
        await api.upsertSubstituteAssignments(requestId, {
          actorUserId: auth.userId,
          items: subItems.map((it) => ({
            id: it.id,
            substituteUserId: it.substituteUserId,
            shiftCode: it.shiftCode,
          })),
        });
        await bootstrap();
        if (target) {
          createNotificationForNurses(`${target.leaveDate} 휴가자 발표`, {
            type: "REQUEST_APPROVED",
            targetDate: target.leaveDate,
            leaveRequestId: target.id,
          });
        }
      } catch (e) {
        window.alert?.(`선정 반영 실패: ${e?.message || e}`);
      }
    } else if (target) {
      createNotificationForNurses(`${target.leaveDate} 휴가자 발표`, {
        type: "REQUEST_APPROVED",
        targetDate: target.leaveDate,
        leaveRequestId: target.id,
      });
    }
  }

  async function unselectRequest(requestId) {
    if (!isAdmin) {
      window.alert?.("휴가 확정 취소는 관리자만 할 수 있습니다.");
      return;
    }
    const target = requests.find((r) => r.id === requestId);
    if (!target || !isWinnerStatus(target.status)) return;
    if (!window.confirm("휴가 확정을 취소하고 신청 상태로 되돌리시겠습니까?")) return;
    const prevRequests = requests;
    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "APPLIED" } : r)));
    if (serverMode) {
      try {
        await api.unselectRequest(requestId, { actorUserId: auth.userId });
        await bootstrap();
      } catch (e) {
        window.alert?.(`휴가 확정 취소 실패: ${e?.message || e}`);
        setRequests(prevRequests);
      }
    }
  }

  async function saveSubstituteForApprovedRequest(requestId, { substituteItems = [], substituteUserId, shiftCode }) {
    const target = requests.find((r) => r.id === requestId);
    if (!target || !isWinnerStatus(target.status)) {
      window.alert?.("확정된 신청만 대체 근무를 저장할 수 있습니다.");
      return;
    }
    if (!serverMode) {
      window.alert?.("서버 연결 상태에서만 대체 근무를 저장할 수 있습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const rawItems = Array.isArray(substituteItems)
      ? substituteItems
      : [{ substituteUserId: substituteUserId ?? "", shiftCode: shiftCode ?? "" }];
    const normalizedItems = rawItems
      .map((it, idx) => ({
        id: String(it?.id ?? `sub_${Date.now()}_${idx}`).trim(),
        requestId,
        leaveDate: target.leaveDate,
        leaveUserId: target.userId,
        substituteUserId: String(it?.substituteUserId ?? "").trim(),
        shiftCode: normalizeShiftCodeForSave(it?.shiftCode),
      }))
      .filter((it) => it.substituteUserId || it.shiftCode);
    if (normalizedItems.length === 0) {
      const prevSnapshot = Array.isArray(substituteAssignments) ? substituteAssignments : [];
      setSubstituteAssignments((prev) => (Array.isArray(prev) ? prev : []).filter((x) => x.requestId !== requestId));
      try {
        await api.upsertSubstituteAssignments(requestId, { actorUserId: auth?.userId, items: [] });
        await bootstrap();
        notifyDone("대체 근무 지정을 삭제했습니다.");
      } catch (e) {
        setSubstituteAssignments(prevSnapshot);
        window.alert?.(`대체 근무 삭제 실패: ${e?.message || e}`);
      }
      return;
    }
    const subItems = [];
    for (const it of normalizedItems) {
      const err = validateSubstitutePayload({
        leaveDate: target.leaveDate,
        leaveUserId: target.userId,
        substituteUserId: it.substituteUserId,
        shiftCode: it.shiftCode,
        requests,
        substituteAssignments: [...(Array.isArray(substituteAssignments) ? substituteAssignments : []), ...subItems],
        excludeRequestId: requestId,
      });
      if (err) {
        window.alert?.(err);
        return;
      }
      subItems.push(it);
    }
    const prevSnapshot = Array.isArray(substituteAssignments) ? substituteAssignments : [];
    setSubstituteAssignments((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const rest = list.filter((x) => x.requestId !== requestId);
      return [...rest, ...subItems];
    });
    try {
      await api.upsertSubstituteAssignments(requestId, {
        actorUserId: auth?.userId,
        items: subItems.map((it) => ({
          id: it.id,
          substituteUserId: it.substituteUserId,
          shiftCode: it.shiftCode,
        })),
      });
      await bootstrap();
      notifyDone("대체 근무가 저장되었습니다.");
    } catch (e) {
      setSubstituteAssignments(prevSnapshot);
      window.alert?.(`대체 근무 저장 실패: ${e?.message || e}`);
    }
  }

  async function rejectRequest(requestId) {
    const target = requests.find((r) => r.id === requestId);
    setSubstituteAssignments((prev) => (Array.isArray(prev) ? prev : []).filter((x) => x.requestId !== requestId));
    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "REJECTED" } : r)));
    if (serverMode) {
      try {
        await api.rejectRequest(requestId, { actorUserId: auth.userId });
        await bootstrap();
        if (target) {
          createNotificationForNurses(`${target.leaveDate} 휴가 반려`, {
            type: "REQUEST_REJECTED",
            targetDate: target.leaveDate,
            leaveRequestId: target.id,
          });
        }
      } catch (e) {
        window.alert?.(`휴가 반려 반영 실패: ${e?.message || e}`);
      }
    } else if (target) {
      createNotificationForNurses(`${target.leaveDate} 휴가 반려`, {
        type: "REQUEST_REJECTED",
        targetDate: target.leaveDate,
        leaveRequestId: target.id,
      });
    }
  }

  async function addPriorityNote(requestId) {
    const content = window.prompt("협의 메모를 입력하세요");
    if (!content) return;
    const agreedOrder = Number(window.prompt("협의 순번(숫자)") || "0");
    const payload = { id: `ln_${Date.now()}`, leaveRequestId: requestId, content, agreedOrder };
    setNotes((prev) => [...prev, payload]);
    if (serverMode) await api.addNote(payload);
  }

  async function saveAdminDayMemo(targetDate, content) {
    const ymd = String(targetDate ?? "").trim();
    if (!ymd) return;
    const txt = String(content ?? "");

    // serverMode가 일시적으로 false여도, 서버가 살아 있으면 서버 저장/푸시를 우선 시도
    if (auth?.userId) {
      try {
        await api.upsertAdminDayMemo({
          actorUserId: auth.userId,
          targetDate: ymd,
          content: txt,
        });
        // 저장 성공 후 목록 재조회가 실패해도 "저장 실패"로 오인하지 않도록 분리 처리
        try {
          await bootstrap();
        } catch {
          setAdminDayMemos((prev) => ({
            ...(prev ?? {}),
            [ymd]: txt,
          }));
        }
        notifyDone("저장되었습니다.");
        if (currentUser?.role === "ADMIN") {
          createNotificationForNurses(`${ymd} 메모 등록`, { type: "ADMIN_MEMO", targetDate: ymd });
        }
        return;
      } catch (e) {
        if (serverMode) {
          window.alert?.(`관리자 메모 저장 실패: ${e?.message || e}`);
          return;
        }
        window.alert?.("서버 저장에 실패해 현재 기기에만 저장합니다. (이 경우 푸시 알림은 전송되지 않습니다.)");
      }
    }

    setAdminDayMemos((prev) => ({
      ...(prev ?? {}),
      [ymd]: txt,
    }));
    notifyDone("저장되었습니다.");
    if (currentUser?.role === "ADMIN") {
      createNotificationForNurses(`${ymd} 메모 등록`, { type: "ADMIN_MEMO", targetDate: ymd });
    }
  }

  async function createDayComment(targetDate, content) {
    const ymd = String(targetDate ?? "").trim();
    const txt = String(content ?? "").trim();
    if (!ymd || !txt || !auth?.userId) return;
    if (serverMode) {
      try {
        await api.createDayComment({
          actorUserId: auth.userId,
          targetDate: ymd,
          content: txt,
        });
        await bootstrap();
        notifyDone("댓글이 등록되었습니다.");
      } catch (e) {
        window.alert?.(`추가 메모 저장 실패: ${e?.message || e}`);
      }
      return;
    }
    const newRow = {
      id: `dc_${Date.now()}`,
      targetDate: ymd,
      content: txt,
      userId: auth.userId,
      createdAt: new Date().toISOString(),
    };
    setDayComments((prev) => [newRow, ...(Array.isArray(prev) ? prev : [])]);
    if (currentUser?.role === "ADMIN") {
      createNotificationForNurses(`${ymd} 새 댓글 등록`, { type: "DAY_COMMENT", targetDate: ymd });
    }
    notifyDone("댓글이 등록되었습니다.");
  }

  async function updateDayComment(commentId, content) {
    const id = String(commentId ?? "").trim();
    const txt = String(content ?? "").trim();
    if (!id || !txt || !auth?.userId) return;
    if (serverMode) {
      try {
        await api.updateDayComment(id, {
          actorUserId: auth.userId,
          content: txt,
        });
        await bootstrap();
        notifyDone("댓글이 수정되었습니다.");
      } catch (e) {
        window.alert?.(`댓글 수정 실패: ${e?.message || e}`);
      }
      return;
    }
    setDayComments((prev) =>
      (Array.isArray(prev) ? prev : []).map((row) => (row.id === id && row.userId === auth.userId ? { ...row, content: txt } : row))
    );
    notifyDone("댓글이 수정되었습니다.");
  }

  async function deleteDayComment(commentId) {
    const id = String(commentId ?? "").trim();
    if (!id || !auth?.userId) return;
    if (serverMode) {
      try {
        await api.deleteDayComment(id, {
          actorUserId: auth.userId,
        });
        await bootstrap();
        notifyDone("댓글이 삭제되었습니다.");
      } catch (e) {
        window.alert?.(`댓글 삭제 실패: ${e?.message || e}`);
      }
      return;
    }
    setDayComments((prev) => (Array.isArray(prev) ? prev : []).filter((row) => !(row.id === id && row.userId === auth.userId)));
    notifyDone("댓글이 삭제되었습니다.");
  }

  async function syncHolidays() {
    try {
      if (serverMode) {
        const result = await api.syncHolidays({ year: syncYear, month: syncMonth });
        return setApiMessage(`동기화 완료: ${result.count}건 반영`);
      }
      setApiMessage("서버 모드에서만 API 동기화가 가능합니다.");
    } catch (e) {
      setApiMessage(`동기화 오류: ${e.message}`);
    }
  }

  async function handleBackupSql() {
    try {
      const sql = await api.downloadBackupSql();
      downloadTextFile(sql, `backup-${new Date().toISOString().slice(0, 19)}.sql`);
      setBackupMessage("백업 SQL 다운로드 완료");
    } catch (e) {
      setBackupMessage(`백업 실패: ${e.message}`);
    }
  }

  async function handleRestoreSql() {
    try {
      if (!restoreSqlText.trim()) return setBackupMessage("복구할 SQL 내용을 입력하세요.");
      const result = await api.restoreSql(restoreSqlText);
      setBackupMessage(`복구 완료: ${result.restoredStatements}개 구문 적용`);
      await bootstrap();
    } catch (e) {
      setBackupMessage(`복구 실패: ${e.message}`);
    }
  }

  async function handleChangePassword(currentPassword, newPassword) {
    await api.changePassword({ userId: auth.userId, currentPassword, newPassword });
    setAccountMessage("비밀번호가 변경되었습니다.");
  }

  async function handleSelfPasswordReset(loginName, employeeNo) {
    await api.resetPasswordByIdentity({ loginName, employeeNo });
  }

  async function handleResetPassword(targetUserId) {
    await api.resetUserPassword(targetUserId, { adminUserId: auth.userId, nextPassword: "1234" });
    setAccountMessage("선택한 사용자의 비밀번호를 1234로 초기화했습니다.");
  }

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} onResetPassword={handleSelfPasswordReset} />;
  }

  return (
    <div className="app app-shell">
      <header className="app-header app-header--shell">
        <div className="app-header-row">
          <div className="app-header-brand">
            <h1 className="app-header-title">EOROFF</h1>
            <p className="app-header-userline" aria-hidden={false}>
              {currentUser?.name}
              {currentUser?.role === "ADMIN"
                ? " · 관리자"
                : currentUser?.role === "NURSE"
                  ? " · 간호사"
                  : currentUser?.role === "ANESTHESIA"
                    ? " · 마취"
                    : ""}
            </p>
          </div>
          <div className="app-header-actions app-header-actions--inline">
            <button
              type="button"
              className="app-header-update-btn"
              onClick={applyUpdate}
              disabled={!updateAvailable}
              aria-label="최신 버전으로 새로고침"
              title={updateAvailable ? "새 버전이 있습니다. 탭하면 최신 화면으로 불러옵니다." : "현재 최신 버전입니다."}
            >
              <span className="app-header-update-btn__icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
            <Link
              to="/notifications"
              className="app-header-bell"
              aria-label={unreadNotificationCount > 0 ? `알림 ${unreadNotificationCount}건` : "알림"}
            >
              <span className="app-header-bell__icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              {unreadNotificationCount > 0 ? (
                <span className="app-header-bell__badge">{unreadNotificationCount > 99 ? "99+" : String(unreadNotificationCount)}</span>
              ) : null}
            </Link>
            <Link to="/account" className="btn-ghost-header btn-ghost-header--compact app-header-account-btn">
              계정
            </Link>
            <button type="button" className="btn-ghost-header btn-ghost-header--compact" onClick={handleLogout}>
              나가기
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
      <Routes>
        <Route
          path="/request"
          element={
            <RequestPage
              leaveType={leaveType}
              setLeaveType={setLeaveType}
              leaveNature={leaveNature}
              setLeaveNature={setLeaveNature}
              leaveDate={leaveDate}
              setLeaveDate={setLeaveDate}
              memo={memo}
              setMemo={setMemo}
              submitRequest={submitRequest}
              myGoldkey={myGoldkey}
              message={message}
            />
          }
        />
        <Route
          path="/my"
          element={
            <MyRequestsPage myRequests={myRequests} cancelRequest={cancelRequest} uncancelRequest={uncancelRequest} canUncancel={isAdmin} />
          }
        />
        <Route
          path="/dashboard"
          element={
            <DashboardPage
              dashboard={dashboard}
              goldkeys={goldkeys}
              requests={requestsVisibleInUi}
              cancellations={cancellations}
              users={users}
              serverMode={serverMode}
              currentRole={currentUser?.role}
              workScheduleRows={workScheduleRows}
              onSaveWorkScheduleRows={setWorkScheduleRows}
              generatedMonthlySchedules={generatedMonthlySchedules}
              onSaveGeneratedMonthlySchedule={(key, payload) =>
                setGeneratedMonthlySchedules((prev) => ({ ...(prev && typeof prev === "object" ? prev : {}), [key]: payload }))
              }
              isAdmin={isAdmin}
              substituteAssignments={substituteAssignments}
              holidays={holidays}
              holidayDuties={holidayDuties}
              weeklyCellOverrides={weeklyCellOverrides}
              setWeeklyCellOverrides={setWeeklyCellOverrides}
              persistWeeklyCellOverridesToServer={serverMode && auth?.userId ? persistWeeklyCellOverridesToServer : null}
              selectRequest={selectRequest}
              unselectRequest={unselectRequest}
              rejectRequest={rejectRequest}
              saveSubstituteForApprovedRequest={saveSubstituteForApprovedRequest}
            />
          }
        />
        <Route
          path="/ladder"
          element={
            <LadderGamePage
              users={users}
              requests={requestsVisibleInUi}
              ladderResults={ladderResults}
              createLadderResult={createLadderResult}
              applyLadderResultToNegotiationOrder={applyLadderResultToNegotiationOrder}
              currentUserId={auth?.userId}
            />
          }
        />
        <Route
          path="/calendar"
          element={
            <CalendarPage
              calendarMonth={calendarMonth}
              setCalendarMonth={setCalendarMonth}
              calendarData={calendarData}
              selectedYmd={calendarSelectedYmd}
              setSelectedYmd={setCalendarSelectedYmd}
              dayRequests={calendarDayRequests}
              users={users}
              leaveType={leaveType}
              setLeaveType={setLeaveType}
              leaveNature={leaveNature}
              setLeaveNature={setLeaveNature}
              leaveDate={leaveDate}
              setLeaveDate={setLeaveDate}
              memo={memo}
              setMemo={setMemo}
              submitRequest={submitRequest}
              myGoldkey={myGoldkey}
              message={message}
              isAdmin={isAdmin}
              canEditHolidayDuty={canEditHolidayDuty}
              currentUserId={auth?.userId}
              saveNegotiationOrder={saveNegotiationOrder}
              holidayDuties={holidayDuties}
              saveHolidayDuty={saveHolidayDuty}
              selectRequest={selectRequest}
              unselectRequest={unselectRequest}
              rejectRequest={rejectRequest}
              substituteAssignments={substituteAssignments}
              saveSubstituteForApprovedRequest={saveSubstituteForApprovedRequest}
              adminDayMemos={adminDayMemos}
              saveAdminDayMemo={saveAdminDayMemo}
              dayComments={dayComments}
              createDayComment={createDayComment}
              updateDayComment={updateDayComment}
              deleteDayComment={deleteDayComment}
              ladderResults={ladderResults}
              cancelRequest={cancelRequest}
            />
          }
        />
        <Route path="/account" element={<AccountPage onChangePassword={handleChangePassword} message={accountMessage} />} />
        <Route
          path="/admin"
          element={
            isAdmin ? (
              <AdminPage
                allRequests={requestsVisibleInUi}
                users={users}
                notes={notes}
                goldkeys={goldkeys}
                cancellations={cancellations}
                serverMode={serverMode}
                adminUserId={auth?.userId ?? ""}
              />
            ) : (
              <Navigate to="/calendar" />
            )
          }
        />
        <Route
          path="/settings"
          element={
            isAdmin ? (
              <SettingsPage
                apiKey={apiKey}
                setApiKey={setApiKey}
                syncYear={syncYear}
                setSyncYear={setSyncYear}
                syncMonth={syncMonth}
                setSyncMonth={setSyncMonth}
                syncHolidays={syncHolidays}
                holidays={holidays}
                apiMessage={apiMessage}
                backupMessage={backupMessage}
                restoreSqlText={restoreSqlText}
                setRestoreSqlText={setRestoreSqlText}
                onBackup={handleBackupSql}
                onRestore={handleRestoreSql}
                managedUsers={managedUsers}
                onResetPassword={handleResetPassword}
                accountMessage={accountMessage}
                onResetLeaveData={handleResetLeaveData}
                resetDataMessage={resetDataMessage}
              />
            ) : (
              <Navigate to="/calendar" />
            )
          }
        />
        <Route
          path="/notifications"
          element={
            <NotificationsPage
              currentUser={currentUser}
              serverMode={serverMode}
              myNotifications={myNotifications}
              markAllNotificationsRead={markAllNotificationsRead}
              markNotificationRead={markNotificationRead}
              enablePushNotifications={enablePushNotifications}
              pushBusy={pushBusy}
              pushEnabled={pushEnabled}
            />
          }
        />
        <Route path="/more" element={isAdmin ? <Navigate to="/settings" replace /> : <Navigate to="/calendar" replace />} />
        <Route path="*" element={<Navigate to="/calendar" />} />
      </Routes>
      </main>

      <AppBottomNav isAdmin={isAdmin} role={currentUser?.role} />
    </div>
  );
}

function LoginPage({ onLogin, onResetPassword }) {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [resetName, setResetName] = useState("");
  const [resetEmployeeNo, setResetEmployeeNo] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await onLogin(loginName, password);
    } catch (e2) {
      setError(e2.message);
    }
  }
  async function submitReset(e) {
    e.preventDefault();
    setResetMsg("");
    try {
      await onResetPassword(resetName, resetEmployeeNo);
      setResetMsg("비밀번호가 기본값 1234로 초기화되었습니다. 다시 로그인해 주세요.");
      setShowReset(false);
      setLoginName(resetName);
      setPassword("1234");
    } catch (e2) {
      setResetMsg(e2.message || "비밀번호 재설정에 실패했습니다.");
    }
  }
  return (
    <div className="app login-wrap">
      <section className="card login-card">
        <h2>로그인</h2>
        <form className="login-form" onSubmit={submit}>
          <input placeholder="이름만 입력 (예: 김간호)" value={loginName} onChange={(e) => setLoginName(e.target.value)} />
          <input type="password" placeholder="비밀번호 (기본: 1234)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit">로그인</button>
        </form>
        <div style={{ marginTop: 8 }}>
          <button type="button" className="login-secondary-button" onClick={() => setShowReset((v) => !v)}>
            {showReset ? "초기화 닫기" : "비밀번호 초기화"}
          </button>
        </div>
        {showReset ? (
          <form className="login-form" style={{ marginTop: 10 }} onSubmit={submitReset}>
            <input placeholder="이름" value={resetName} onChange={(e) => setResetName(e.target.value)} />
            <input placeholder="관리자는 A0001" value={resetEmployeeNo} onChange={(e) => setResetEmployeeNo(e.target.value)} />
            <button type="submit">초기화 실행</button>
          </form>
        ) : null}
        {error ? <p className="msg">{error}</p> : null}
        {resetMsg ? <p className="help">{resetMsg}</p> : null}
      </section>
    </div>
  );
}

function RequestPage({
  leaveType,
  setLeaveType,
  leaveNature,
  setLeaveNature,
  leaveDate,
  setLeaveDate,
  memo,
  setMemo,
  submitRequest,
  myGoldkey,
  message,
}) {
  return (
    <section className="card">
      <h2 className="screen-title">휴가 신청</h2>
      <p className="help page-lead">날짜와 종류를 고른 뒤 제출합니다. 캘린더에서도 같은 신청을 할 수 있습니다.</p>
      <form className="grid" onSubmit={submitRequest}>
        <label className="field-label">휴가 종류</label>
        <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} aria-label="휴가 종류">
          <option value="GOLDKEY">골드키</option>
          <option value="GENERAL_PRIORITY">일반휴가-우선순위</option>
          <option value="GENERAL_NORMAL">일반휴가-후순위</option>
          <option value="HALF_DAY">반차</option>
        </select>
        <label className="field-label">휴가 성격</label>
        <select value={leaveNature} onChange={(e) => setLeaveNature(e.target.value)} aria-label="휴가 성격">
          <option value="PERSONAL">개인휴가</option>
          <option value="PAID_TRAINING">보수교육공가</option>
          <option value="REQUIRED_TRAINING">필수교육</option>
        </select>
        <label className="ymd-label">휴가일 (연·월·일)</label>
        <YmdSplitInput value={leaveDate} onChange={setLeaveDate} />
        <input type="text" placeholder="신청 메모" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <button type="submit">신청</button>
      </form>
      <p className="help">내 골드키 잔여: {myGoldkey?.remainingCount ?? 0} / {myGoldkey?.quotaTotal ?? 0}</p>
      {message ? <p className="msg">{message}</p> : null}
    </section>
  );
}

/** 내 신청내역: 연도 포함 표기(사용자 혼동 방지) */
function formatLeaveDateShort(ymd) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd ?? "").trim());
  if (!m) return String(ymd ?? "");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return `${y}년${mo}월${d}일`;
}

function buildLeaveDateSearchTokens(ymd) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd ?? "").trim());
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return [`${y}`, `${y}년`, `${mo}월`, `${d}일`, `${mo}월 ${d}일`, `${y}년 ${mo}월 ${d}일`];
}

function formatRequestedAtCompact(iso) {
  try {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return String(iso ?? "");
    const y = t.getFullYear();
    const mo = t.getMonth() + 1;
    const d = t.getDate();
    const h = String(t.getHours()).padStart(2, "0");
    const min = String(t.getMinutes()).padStart(2, "0");
    return `${y}년 ${mo}월 ${d}일 ${h}:${min}`;
  } catch {
    return String(iso ?? "");
  }
}

function compareMyRequestsRows(a, b, sortOrder) {
  const desc = sortOrder.endsWith("Desc");
  let cmp = 0;
  if (sortOrder.startsWith("leaveDate")) {
    cmp = a.leaveDate.localeCompare(b.leaveDate);
    if (cmp === 0) cmp = a.requestedAt.localeCompare(b.requestedAt);
  } else {
    cmp = a.requestedAt.localeCompare(b.requestedAt);
    if (cmp === 0) cmp = a.leaveDate.localeCompare(b.leaveDate);
  }
  if (desc) cmp = -cmp;
  return cmp;
}

function MyRequestsPage({ myRequests, cancelRequest, uncancelRequest, canUncancel }) {
  const [yearFilter, setYearFilter] = useState("ALL");
  const [leaveTypeFilter, setLeaveTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("leaveDateAsc");
  const yearOptions = useMemo(() => {
    const years = Array.from(
      new Set(
        (Array.isArray(myRequests) ? myRequests : [])
          .map((r) => String(r.leaveDate ?? "").slice(0, 4))
          .filter((v) => /^\d{4}$/.test(v))
      )
    ).sort((a, b) => b.localeCompare(a));
    return years;
  }, [myRequests]);
  function matchesYearFilter(r) {
    if (yearFilter === "ALL") return true;
    return String(r.leaveDate ?? "").slice(0, 4) === yearFilter;
  }
  function matchesLeaveTypeFilter(r) {
    if (leaveTypeFilter === "ALL") return true;
    return String(r.leaveType ?? "") === leaveTypeFilter;
  }
  function matchesStatusFilter(r) {
    if (statusFilter === "ALL") return true;
    if (statusFilter === "SELECTED") return isWinnerStatus(r.status);
    return r.status === statusFilter;
  }
  const rows = myRequests
    .filter(
      (r) =>
        matchesYearFilter(r) &&
        matchesLeaveTypeFilter(r) &&
        matchesStatusFilter(r) &&
        `${r.leaveDate} ${formatLeaveDateShort(r.leaveDate)} ${buildLeaveDateSearchTokens(r.leaveDate).join(" ")} ${leaveTypeLabel(r.leaveType)} ${leaveNatureLabel(r.leaveNature)} ${statusLabel(r.status)}`
          .toLowerCase()
          .includes(search.toLowerCase())
    )
    .sort((a, b) => compareMyRequestsRows(a, b, sortOrder));
  return (
    <section className="card my-requests-card">
      <h2 id="my-requests-heading" className="screen-title">
        신청내역
      </h2>
      <div className="my-requests-year-row">
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="신청내역 연도 필터">
          <option value="ALL">연도</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </div>
      <div className="row wrap my-requests-toolbar">
        <div className="my-requests-filter-row">
          <select value={leaveTypeFilter} onChange={(e) => setLeaveTypeFilter(e.target.value)} aria-label="휴가성격 필터">
            <option value="ALL">휴가성격</option>
            <option value="GOLDKEY">골드키</option>
            <option value="GENERAL_PRIORITY">일반휴가-우선순위</option>
            <option value="GENERAL_NORMAL">일반휴가-후순위</option>
            <option value="HALF_DAY">반차</option>
            <option value="PAID_TRAINING">공가</option>
            <option value="REQUIRED_TRAINING">필수교육</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="휴가상태 필터">
            <option value="ALL">휴가상태</option>
            <option value="APPLIED">휴가신청</option>
            <option value="SELECTED">휴가 확정</option>
            <option value="CANCELLED">휴가취소</option>
            <option value="REJECTED">휴가 반려</option>
          </select>
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} aria-label="신청내역 정렬">
            <option value="leaveDateAsc">오름차순</option>
            <option value="leaveDateDesc">내림차순</option>
          </select>
        </div>
        <input placeholder="날짜/유형/상태 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="table-wrap my-requests-wrap">
        <table className="my-requests-table" aria-labelledby="my-requests-heading">
          <thead>
            <tr>
              <th>휴가일</th>
              <th>유형</th>
              <th>성격</th>
              <th>상태</th>
              <th>신청시각</th>
              <th>액션</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isCancelled = r.status === "CANCELLED";
              const isLocked = Boolean(r.cancelLocked);
              const isPastLeaveDay = isLeaveDateBeforeTodayKst(normalizeLeaveDateStr(r.leaveDate));
              const actionCell = (() => {
                if (r.status === "CANCELLED") {
                  if (!canUncancel) return "-";
                  return (
                    <button type="button" onClick={() => void uncancelRequest(r.id)}>
                      복원
                    </button>
                  );
                }
                if (r.status === "APPLIED" || isLocked) {
                  return (
                    <button
                      type="button"
                      disabled={isLocked || r.status !== "APPLIED" || isPastLeaveDay}
                      title={isPastLeaveDay ? "휴가일이 지난 신청은 취소할 수 없습니다." : undefined}
                      onClick={() => void cancelRequest(r.id)}
                    >
                      {isLocked ? "취소 처리됨" : "취소"}
                    </button>
                  );
                }
                return "-";
              })();
              return (
                <tr key={r.id} className={isCancelled ? "request-cancelled-row" : ""}>
                  <td className="my-requests-col my-requests-col--date">{formatLeaveDateShort(r.leaveDate)}</td>
                  <td className="my-requests-col my-requests-col--type">
                    <span className={`leave-type-pill ${buildLeaveChipClass(r.leaveType, r.status)}`}>{leaveTypeLabel(r.leaveType)}</span>
                  </td>
                  <td className="my-requests-col my-requests-col--nature">{leaveNatureLabel(r.leaveNature)}</td>
                  <td className="my-requests-col my-requests-col--status">{statusLabel(r.status)}</td>
                  <td className="my-requests-col my-requests-col--time">{formatRequestedAtCompact(r.requestedAt)}</td>
                  <td className="my-requests-col my-requests-col--action">{actionCell}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function parseYmdLoose(ymd) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd ?? "").trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function isAfterApril10(nowLike, leaveYear) {
  const p = toKstParts(nowLike);
  if (!p) return false;
  if (p.year > leaveYear) return true;
  if (p.year < leaveYear) return false;
  if (p.month > 4) return true;
  if (p.month < 4) return false;
  return p.day >= 11;
}

/** 10월 장기 모집(익년 1~6월): 신청 연도의 10/11 이후에만 잔여 반영 */
function isAfterOctober10ForRequestYear(nowLike, requestYear) {
  const p = toKstParts(nowLike);
  if (!p) return false;
  if (p.year > requestYear) return true;
  if (p.year < requestYear) return false;
  if (p.month > 10) return true;
  if (p.month < 10) return false;
  return p.day >= 11;
}

function isSpecialLongTermGoldkeyRequestForDashboardApril(r) {
  if (r.leaveType !== "GOLDKEY") return false;
  const leave = parseYmdLoose(r.leaveDate);
  const req = toKstParts(r.requestedAt);
  if (!leave || !req) return false;
  if (leave.year !== req.year) return false;
  if (leave.month < 7 || leave.month > 12) return false;
  return req.month === 4 && req.day >= 1 && req.day <= 10;
}

function isSpecialLongTermGoldkeyRequestForDashboardOctober(r) {
  if (r.leaveType !== "GOLDKEY") return false;
  const leave = parseYmdLoose(r.leaveDate);
  const req = toKstParts(r.requestedAt);
  if (!leave || !req) return false;
  if (leave.year !== req.year + 1) return false;
  if (leave.month < 1 || leave.month > 6) return false;
  return req.month === 10 && req.day >= 1 && req.day <= 10;
}

/** 종합현황 표시용 신청 집계 (장기 모집 특수건은 각 11일 이후에만 잔여에 반영) */
function countGoldkeyApplyUse(requests, userId, nowLike = new Date().toISOString()) {
  return requests.filter((r) => {
    if (r.userId !== userId || r.leaveType !== "GOLDKEY") return false;
    const st = r.status;
    if (st === "CANCELLED" || st === "REJECTED") return false;
    if (isSpecialLongTermGoldkeyRequestForDashboardApril(r)) {
      const leave = parseYmdLoose(r.leaveDate);
      if (!leave) return true;
      return isAfterApril10(nowLike, leave.year);
    }
    if (isSpecialLongTermGoldkeyRequestForDashboardOctober(r)) {
      const req = toKstParts(r.requestedAt);
      if (!req) return true;
      return isAfterOctober10ForRequestYear(nowLike, req.year);
    }
    return true;
  }).length;
}

/** 종합현황·관리자: 서버 연결 시 API 총량 우선, 오프라인·누락 시 이름별 정책(간호사별 10~15) */
function goldkeyQuotaTotalForDisplay(user, g, serverMode) {
  const policy = defaultGoldkeyQuotaForName(user?.name);
  if (!serverMode) return policy;
  const raw = g?.quotaTotal ?? g?.quota_total;
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return policy;
}

const WORK_SCHEDULE_2026_MONTHS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월"];
const WORK_SCHEDULE_2026_ROWS = [
  { name: "임희종", values: ["안E", "수E", "안D0", "9-5", "5D2", "3D1", "7D2", "6D2", "6D1"] },
  { name: "이양희", values: ["수E", "6D2", "6D2", "3D1", "9-5", "3D2", "5D2", "5D1", "1D2"] },
  { name: "허정숙", values: ["6D2", "안E", "5D2", "5D2", "7D2", "9-5", "3D1", "3D2", "안D0"] },
  { name: "이현숙", values: ["9-5", "안D0", "3D2", "3D2", "수E", "1D2", "6D2", "5D2", "7D2"] },
  { name: "유진", values: ["안D0", "5D2", "3D1", "7D2", "7D1", "안E", "안D0", "PRN", "3D2"] },
  { name: "김해림", values: ["7D2", "PRN", "안D0", "1D2", "1D1", "7D1", "수E", "9-5", "3D1"] },
  { name: "양현아", values: ["5D2", "3D1", "안E", "PRN", "6D2", "6D2", "9-5", "안D0", "9-5"] },
  { name: "장지은", values: ["1D2", "6D1", "6D1", "6D2", "5D1", "7D2", "안D0", "안D0", "수E"] },
  { name: "손다솜", values: ["PRN", "1D2", "1D2", "1D1", "3D1", "5D2", "3D2", "7D1", "안E"] },
  { name: "오민아", values: ["안D0", "3D2", "9-5", "7D1", "PRN", "안D0", "5D1", "안E", "5D2"] },
  { name: "최종선", values: ["3D2", "9-5", "PRN", "안D0", "안D0", "수E", "1D2", "1D2", "7D1"] },
  { name: "장성필", values: ["6D1", "안D0", "수E", "안E", "3D2", "PRN", "7D1", "7D2", "5D1"] },
  { name: "이지선", values: ["7D1", "7D2", "7D2", "안D0", "1D2", "1D1", "6D1", "3D1", "안D0"] },
  { name: "최유리", values: ["3D1", "1D1", "1D1", "수E", "안E", "5D1", "PRN", "6D1", "6D2"] },
  { name: "최유경", values: ["1D1", "7D1", "7D1", "5D1", "안D0", "안D0", "안E", "수E", "PRN"] },
  { name: "정수영", values: ["", "", "6D1", "6D1", "6D1", "6D1", "1D1", "1D1", "1D1"] },
];
const WORK_SCHEDULE_OPTIONS = [
  "",
  "안E",
  "안D0",
  "수E",
  "9-5",
  "5D2",
  "3D1",
  "7D2",
  "6D2",
  "6D1",
  "3D2",
  "1D2",
  "7D1",
  "1D1",
  "5D1",
  "PRN",
  "휴가",
  "공가",
  "반차",
  "필수교육",
];
const CUSTOM_SHIFT_SENTINEL = "__CUSTOM_SHIFT__";
const WORK_SCHEDULE_OPTION_SET = new Set(WORK_SCHEDULE_OPTIONS.filter((x) => x));
const WEEKLY_LEAVE_MARK_OPTIONS = ["휴가", "공가", "반차", "필수교육", "off"];

function isCustomShiftCodeValue(value) {
  return String(value ?? "").startsWith(`${CUSTOM_SHIFT_SENTINEL}:`);
}

function toCustomShiftCode(text) {
  return `${CUSTOM_SHIFT_SENTINEL}:${String(text ?? "")}`;
}

function customShiftText(value) {
  if (!isCustomShiftCodeValue(value)) return "";
  return String(value).slice(`${CUSTOM_SHIFT_SENTINEL}:`.length);
}

function normalizeShiftCodeForSave(value) {
  if (isCustomShiftCodeValue(value)) return customShiftText(value).trim();
  return String(value ?? "").trim();
}

function parseYmdToLocalDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 해당 주의 월요일 YYYY-MM-DD (로컬) */
function mondayOfWeekContaining(ymd) {
  const d = parseYmdToLocalDate(ymd);
  if (!d || Number.isNaN(d.getTime())) return toLocalYMD(new Date());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalYMD(d);
}

function addDaysToYmd(ymd, deltaDays) {
  const d = parseYmdToLocalDate(ymd);
  if (!d || Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() + deltaDays);
  return toLocalYMD(d);
}

/** 2026 근무표 월 컬럼 인덱스 0~8 (1~9월), 범위 밖이면 -1 */
function scheduleMonthIndexFromYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? "").trim());
  if (!m) return -1;
  const month = Number(m[2]);
  if (month < 1 || month > WORK_SCHEDULE_2026_MONTHS.length) return -1;
  return month - 1;
}

function baseMonthCodeForNurseName(name, ymd, workRows) {
  const mi = scheduleMonthIndexFromYmd(ymd);
  if (mi < 0) return "—";
  const row = (Array.isArray(workRows) ? workRows : []).find((r) => r.name === name);
  const v = row?.values?.[mi];
  return v != null && String(v).trim() !== "" ? String(v).trim() : "—";
}

function getSubstituteRecordsForRequest(substituteAssignments, requestId) {
  const rows = (Array.isArray(substituteAssignments) ? substituteAssignments : []).filter((x) => x.requestId === requestId);
  const seen = new Set();
  return rows.filter((x) => {
    const key = `${String(x?.requestId ?? "")}|${String(x?.substituteUserId ?? "")}|${String(x?.shiftCode ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 대체 근무 지정 검증. substituteUserId·shiftCode 둘 다 있거나 둘 다 없어야 함.
 */
function validateSubstitutePayload({
  leaveDate,
  leaveUserId,
  substituteUserId,
  shiftCode,
  requests,
  substituteAssignments,
  excludeRequestId,
}) {
  const hasSub = Boolean(substituteUserId) || Boolean(shiftCode);
  if (!hasSub) return null;
  if (!substituteUserId || !shiftCode) return "대체 근무를 쓰려면 간호사와 번표를 모두 선택하세요.";
  if (substituteUserId === leaveUserId) return "휴가자 본인을 대체 인력으로 지정할 수 없습니다.";
  const ld = String(leaveDate ?? "").slice(0, 10);
  const others = (Array.isArray(substituteAssignments) ? substituteAssignments : []).filter((s) => s.requestId !== excludeRequestId);
  if (others.some((s) => s.leaveDate === ld && s.substituteUserId === substituteUserId)) {
    return "선택한 간호사는 같은 날 이미 다른 대체 근무가 지정되어 있습니다.";
  }
  const reqs = Array.isArray(requests) ? requests : [];
  const blocking = reqs.some(
    (r) =>
      r.userId === substituteUserId &&
      String(r.leaveDate ?? "").slice(0, 10) === ld &&
      r.status !== "CANCELLED" &&
      r.status !== "REJECTED" &&
      (r.status === "APPLIED" || isWinnerStatus(r.status))
  );
  if (blocking) return "선택한 간호사는 해당 날짜에 휴가 신청·확정이 있어 대체 근무를 맡기 어렵습니다. 다른 사람을 선택하세요.";
  return null;
}

function effectiveScheduleCell(userId, nurseName, ymd, workScheduleRows, requests, substituteAssignments) {
  const ld = String(ymd).slice(0, 10);
  const approvedLeave = (requests || []).find(
    (r) =>
      r.userId === userId &&
      String(r.leaveDate ?? "").slice(0, 10) === ld &&
      isWinnerStatus(r.status)
  );
  if (approvedLeave) {
    return { kind: "leave", main: "휴가", sub: typeFullLabel(approvedLeave.leaveType) };
  }
  const sub = (substituteAssignments || []).find((s) => s.substituteUserId === userId && String(s.leaveDate ?? "").slice(0, 10) === ld);
  if (sub) {
    return { kind: "sub", main: sub.shiftCode, sub: "대체" };
  }
  return { kind: "base", main: baseMonthCodeForNurseName(nurseName, ld, workScheduleRows), sub: "" };
}

function isWeekendYmd(ymd) {
  const s = String(ymd ?? "").slice(0, 10);
  const p = s.split("-").map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return false;
  const dt = new Date(p[0], p[1] - 1, p[2]);
  const w = dt.getDay();
  return w === 0 || w === 6;
}

function isPublicHolidayYmd(ymd, holidays) {
  const ld = String(ymd ?? "").slice(0, 10);
  return (Array.isArray(holidays) ? holidays : []).some((h) => h?.isHoliday && String(h.holidayDate ?? "").slice(0, 10) === ld);
}

function dutyNurseIdSet(ymd, holidayDuties) {
  const ld = String(ymd ?? "").slice(0, 10);
  const row = holidayDuties?.[ld];
  const s = new Set();
  if (row?.nurse1UserId) s.add(String(row.nurse1UserId));
  if (row?.nurse2UserId) s.add(String(row.nurse2UserId));
  return s;
}

function effectiveWeeklyCell(userId, nurseName, ymd, workScheduleRows, requests, substituteAssignments, holidays, holidayDuties) {
  const ld = String(ymd).slice(0, 10);
  const sub = (substituteAssignments || []).find((s) => s.substituteUserId === userId && String(s.leaveDate ?? "").slice(0, 10) === ld);
  if (sub) {
    return { kind: "sub", main: sub.shiftCode, sub: "" };
  }
  const approvedLeave = (requests || []).find(
    (r) => r.userId === userId && String(r.leaveDate ?? "").slice(0, 10) === ld && isWinnerStatus(r.status)
  );
  if (approvedLeave) {
    const leaveNature = String(approvedLeave.leaveNature ?? "");
    const leaveType = String(approvedLeave.leaveType ?? "");
    if (leaveNature === "PAID_TRAINING") return { kind: "leave", main: "공가", sub: "" };
    if (leaveNature === "REQUIRED_TRAINING") return { kind: "leave", main: "필수교육", sub: "" };
    if (leaveType === "HALF_DAY") return { kind: "leave", main: "반차", sub: "" };
    return { kind: "leave", main: "휴가", sub: "" };
  }
  const offLike = isWeekendYmd(ld) || isPublicHolidayYmd(ld, holidays);
  if (offLike) {
    const duties = dutyNurseIdSet(ld, holidayDuties);
    if (duties.has(String(userId))) {
      return { kind: "duty", main: "당직", sub: "" };
    }
    return { kind: "leave", main: "off", sub: "" };
  }
  return { kind: "base", main: baseMonthCodeForNurseName(nurseName, ld, workScheduleRows), sub: "" };
}

function weeklyCellKey(userId, ymd) {
  return `${userId}|${String(ymd).slice(0, 10)}`;
}

function parseWeeklyOverrideSelectValue(val) {
  if (!val || val === "__auto__") return null;
  if (val === "__leave__") return { mode: "manual", kind: "leave", main: "휴가", sub: "" };
  if (val.startsWith("__leave__:")) {
    const mark = val.slice(10) || "휴가";
    return { mode: "manual", kind: "leave", main: mark, sub: "" };
  }
  if (val.startsWith("__sub__:")) {
    const code = val.slice(7);
    return { mode: "manual", kind: "sub", main: code, sub: "" };
  }
  if (val.startsWith("__base__:")) {
    const code = val.slice(9);
    return { mode: "manual", kind: "base", main: code, sub: "" };
  }
  return null;
}

function weeklyOverrideSelectValue(ov) {
  if (!ov || ov.mode !== "manual") return "__auto__";
  if (ov.kind === "leave") return `__leave__:${String(ov.main || "휴가")}`;
  if (ov.kind === "sub") return `__sub__:${ov.main}`;
  if (ov.kind === "base") return `__base__:${ov.main}`;
  return "__auto__";
}

/** 주간 번표 오버라이드 맵을 키 정렬 후 직렬화 — 저장 여부(dirty) 비교용 */
function stableStringifyWeeklyOverrides(obj) {
  const o = obj && typeof obj === "object" ? obj : {};
  const keys = Object.keys(o).sort();
  const norm = {};
  for (const k of keys) norm[k] = o[k];
  return JSON.stringify(norm);
}

/** bootstrap weekly_cell_overrides 행 → 클라이언트 `userId|ymd` 맵 */
function mapWeeklyOverrideRowsToClient(rows) {
  const o = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const uid = r.user_id ?? r.userId;
    const ymd = String(r.ymd ?? r.leaveDate ?? "").slice(0, 10);
    if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    o[`${uid}|${ymd}`] = {
      mode: r.mode || "manual",
      kind: r.kind,
      main: r.main,
      sub: r.sub ?? "",
    };
  }
  return o;
}

/** 주간 번표: 번표 코드(안D0, 3D2 등)·휴가·당직만 한 줄로 표시(부가 문구 없음) */
function weeklyCellDisplayLine(cell) {
  if (!cell) return "—";
  const m = String(cell.main ?? "").trim() || "—";
  return m;
}

function escapeHtmlForWeeklyExport(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function weeklyCellTextForExport(cell) {
  return weeklyCellDisplayLine(cell);
}

/** 공적·인쇄용 단일 HTML 문서 (브라우저에서 인쇄 또는 PDF로 저장 가능) */
function buildWeeklyOfficialScheduleHtml({ weekStartYmd, weekEndYmd, dayLabels, daysYmd, nurseRows }) {
  const gen = new Date().toLocaleString("ko-KR", { hour12: false });
  const thead = `<tr><th class="c-name">간호사</th>${daysYmd
    .map(
      (d, i) =>
        `<th class="c-day">${escapeHtmlForWeeklyExport(dayLabels[i])}<br><span class="subdt">${escapeHtmlForWeeklyExport(
          d.slice(5).replace("-", "/")
        )}</span></th>`
    )
    .join("")}</tr>`;
  const tbody = nurseRows
    .map(
      (row) =>
        `<tr><th class="c-name">${escapeHtmlForWeeklyExport(row.name)}</th>${row.cells
          .map((c) => `<td>${escapeHtmlForWeeklyExport(weeklyCellTextForExport(c))}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>주간 근무표 ${escapeHtmlForWeeklyExport(weekStartYmd)} ~ ${escapeHtmlForWeeklyExport(weekEndYmd)}</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; margin: 16px; color: #111; }
h1 { font-size: 18px; margin: 0 0 4px; text-align: center; letter-spacing: -0.02em; }
.meta { text-align: center; font-size: 12px; color: #444; margin-bottom: 14px; line-height: 1.45; }
.period { font-weight: 700; }
table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
th, td { border: 1px solid #222; padding: 6px 4px; text-align: center; vertical-align: middle; word-break: keep-all; }
th { background: #eee; font-weight: 700; }
th.c-name { width: 7%; }
th .subdt { font-size: 10px; font-weight: 600; color: #333; }
tr:nth-child(even) td { background: #fafafa; }
.footer { margin-top: 16px; font-size: 10px; color: #555; border-top: 1px solid #ccc; padding-top: 8px; line-height: 1.5; }
.tools { margin: 12px 0; text-align: center; }
.tools button { padding: 8px 16px; font-size: 14px; cursor: pointer; border-radius: 6px; border: 1px solid #333; background: #fff; }
@media print { .tools { display: none !important; } body { margin: 0; } }
</style>
</head>
<body>
<h1>수술실 주간 근무표</h1>
<div class="meta"><span class="period">${escapeHtmlForWeeklyExport(weekStartYmd)} ~ ${escapeHtmlForWeeklyExport(
    weekEndYmd
  )}</span><br/>출력 시각: ${escapeHtmlForWeeklyExport(gen)}</div>
<div class="tools"><button type="button" onclick="window.print()">인쇄 / PDF로 저장</button></div>
<table>
<thead>${thead}</thead>
<tbody>${tbody}</tbody>
</table>
<div class="footer">본 문서는 EOROFF 휴가·근무 관리 시스템에서 생성되었습니다. 화면에 표시된 주간 번표 내용을 반영하며, 브라우저에서 「인쇄」로 출력하거나 「PDF로 저장」을 선택할 수 있습니다.</div>
</body>
</html>`;
}

function downloadWeeklyOfficialHtmlFile(filename, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 주간 번표: 유진·임희종·최유경 행 — 월간 근무표 강조(#ecfdf5 / #d1fae5) 톤과 조화되는 구분색 */
function WeeklyScheduleTab({
  workScheduleRows,
  requests,
  substituteAssignments,
  users,
  holidays,
  holidayDuties,
  weeklyCellOverrides,
  setWeeklyCellOverrides,
  persistWeeklyCellOverridesToServer,
  canEditWeekly,
  isAdmin,
}) {
  const [weekAnchor, setWeekAnchor] = useState(() => toLocalYMD(new Date()));
  const [draftOverrides, setDraftOverrides] = useState(() => ({ ...(weeklyCellOverrides || {}) }));
  const [weeklyMsg, setWeeklyMsg] = useState("");

  useEffect(() => {
    const w = weeklyCellOverrides || {};
    setDraftOverrides((prev) => {
      if (stableStringifyWeeklyOverrides(prev) === stableStringifyWeeklyOverrides(w)) return prev;
      return { ...w };
    });
  }, [weeklyCellOverrides]);

  const mon = mondayOfWeekContaining(weekAnchor);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToYmd(mon, i));
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
  const nurses = users.filter((u) => u.role === "NURSE").sort((a, b) => a.name.localeCompare(b.name, "ko"));

  /** 주말·공휴일(명절 등 캐시된 휴일) 열 — 일반 근무가 없는 날짜 강조 */
  function isWeeklyRestDayColumn(ymd) {
    return isWeekendYmd(ymd) || isPublicHolidayYmd(ymd, holidays);
  }

  const dirty = useMemo(
    () => stableStringifyWeeklyOverrides(draftOverrides) !== stableStringifyWeeklyOverrides(weeklyCellOverrides),
    [draftOverrides, weeklyCellOverrides]
  );

  function computedCell(u, d) {
    return effectiveWeeklyCell(u.id, u.name, d, workScheduleRows, requests, substituteAssignments, holidays, holidayDuties);
  }

  function displayCellWithOverrideMap(u, d, ovMap) {
    const key = weeklyCellKey(u.id, d);
    const o = (ovMap || {})[key];
    if (o && o.mode === "manual") {
      return { kind: o.kind || "base", main: o.main ?? "—", sub: o.sub ?? "" };
    }
    return computedCell(u, d);
  }

  function displayCell(u, d) {
    return displayCellWithOverrideMap(u, d, draftOverrides);
  }

  function onCellOverrideChange(userId, ymd, val) {
    const key = weeklyCellKey(userId, ymd);
    const parsed = parseWeeklyOverrideSelectValue(val);
    setWeeklyMsg("");
    setDraftOverrides((prev) => {
      const next = { ...(prev || {}) };
      if (!parsed) delete next[key];
      else next[key] = parsed;
      return next;
    });
  }

  function exportOfficialWeeklyDocument(overrideMapForExport) {
    const ov = overrideMapForExport ?? draftOverrides;
    const nurseRows = nurses.map((u) => ({
      name: u.name,
      cells: days.map((d) => displayCellWithOverrideMap(u, d, ov)),
    }));
    const html = buildWeeklyOfficialScheduleHtml({
      weekStartYmd: mon,
      weekEndYmd: days[6],
      dayLabels,
      daysYmd: days,
      nurseRows,
    });
    const a = mon.replace(/-/g, "");
    const b = days[6].replace(/-/g, "");
    downloadWeeklyOfficialHtmlFile(`주간근무표_${a}_${b}.html`, html);
  }

  async function saveWeeklyDraft() {
    const serverSync = typeof persistWeeklyCellOverridesToServer === "function";
    const ok = window.confirm(
      "저장하시겠습니까?\n\n" +
        (serverSync
          ? "· 서버에 저장되어 관리자·다른 간호사 화면의 주간 번표에도 동일하게 반영됩니다.\n· 해당 날짜에 확정 휴가 1건과 연결되면 대체 번표에도 반영됩니다.\n"
          : "· 수동으로 바꾼 셀만 이 브라우저에 저장됩니다.\n") +
        "· 근무 칸은 월간 근무표·휴가 확정·대체 근무·달력 당직(주말 / 공휴·대체 / 설·추석 명절)을 반영해 채워집니다."
    );
    if (!ok) return;
    const snapshot = JSON.parse(JSON.stringify(draftOverrides || {}));
    if (serverSync) {
      try {
        await persistWeeklyCellOverridesToServer(snapshot);
      } catch (e) {
        window.alert?.(`서버에 저장하지 못했습니다: ${e?.message || e}`);
        return;
      }
    } else {
      setWeeklyCellOverrides(snapshot);
    }
    setWeeklyMsg(serverSync ? "서버에 저장했습니다. 모든 계정에서 동일하게 보입니다." : "저장했습니다.");
    notifyDone("저장되었습니다.");
    if (isAdmin) {
      exportOfficialWeeklyDocument(snapshot);
    }
  }

  return (
    <section className="card weekly-schedule-card">
      <h2 className="screen-title">주간 번표</h2>
      {isAdmin ? (
        <p className="help weekly-official-hint">
          관리자: 표 하단 <strong>저장</strong> 시 현재 표와 동일한 <strong>인쇄용 HTML 파일</strong>이 함께 내려받아집니다. 저장 없이 파일만 받으려면 「인쇄용 HTML 저장」을 누르세요.
        </p>
      ) : null}
      <div className="weekly-toolbar row wrap">
        <label className="weekly-date-label">
          기준 날짜
          <input type="date" value={weekAnchor} onChange={(e) => setWeekAnchor(e.target.value)} />
        </label>
      </div>
      <div className="table-wrap weekly-table-wrap">
        <table className="weekly-schedule-table">
          <thead>
            <tr>
              <th className="weekly-th-name">간호사</th>
              {days.map((d, i) => (
                <th
                  key={d}
                  className={`weekly-th-day${isWeeklyRestDayColumn(d) ? " weekly-th-day--rest" : ""}`}
                >
                  <div>{dayLabels[i]}</div>
                  <div className="weekly-th-date">{d.slice(5).replace("-", "/")}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nurses.map((u) => (
              <tr key={u.id}>
                <td className="weekly-name">{u.name}</td>
                {days.map((d) => {
                  const cell = displayCell(u, d);
                  const key = weeklyCellKey(u.id, d);
                  const selVal = weeklyOverrideSelectValue(draftOverrides[key]);
                  const auto = computedCell(u, d);
                  const autoMain = String(auto?.main ?? "").trim();
                  const autoLabel = weeklyCellDisplayLine(auto);
                  return (
                    <td
                      key={d}
                      className={`weekly-cell weekly-cell--${cell.kind}${isWeeklyRestDayColumn(d) ? " weekly-cell--restcol" : ""}`}
                    >
                      {canEditWeekly ? (
                        <select
                          className="weekly-cell-select"
                          value={selVal}
                          onChange={(e) => onCellOverrideChange(u.id, d, e.target.value)}
                          aria-label={`${u.name} ${d} 표시`}
                        >
                          <option value="__auto__">{autoLabel || "자동"}</option>
                          {WEEKLY_LEAVE_MARK_OPTIONS.filter((mark) => mark !== autoMain).map((mark) => (
                            <option key={`leave-${mark}`} value={`__leave__:${mark}`}>
                              {mark}
                            </option>
                          ))}
                          {WORK_SCHEDULE_OPTIONS.filter((x) => x && !WEEKLY_LEAVE_MARK_OPTIONS.includes(x) && x !== autoMain).map((opt) => (
                            <option key={`base-${opt}`} value={`__base__:${opt}`}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="weekly-cell-main weekly-cell-main--one">{weeklyCellDisplayLine(cell)}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEditWeekly ? (
        <div className="weekly-table-footer">
          <div className="weekly-footer-actions">
            {weeklyMsg ? (
              <span className="help weekly-save-msg weekly-save-msg--footer" role="status">
                {weeklyMsg}
              </span>
            ) : (
              <span className="weekly-footer-spacer" aria-hidden />
            )}
            <div className="weekly-footer-buttons row wrap">
              {isAdmin ? (
                <button type="button" className="weekly-official-export-btn" onClick={exportOfficialWeeklyDocument}>
                  인쇄용 HTML 저장
                </button>
              ) : null}
              <button type="button" className="weekly-save-btn weekly-save-btn--footer" onClick={() => void saveWeeklyDraft()} disabled={!dirty}>
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AdminDayRequestCard({
  requestRow,
  nurseUsers,
  users,
  substituteRecs,
  selectRequest,
  unselectRequest,
  rejectRequest,
  saveSubstituteForApprovedRequest,
  substituteLayout = "default",
}) {
  const [subRows, setSubRows] = useState([{ rowId: `sub_row_${requestRow.id}_0`, substituteUserId: "", shiftCode: "" }]);
  useEffect(() => {
    const seeded = Array.isArray(substituteRecs) ? substituteRecs : [];
    if (seeded.length > 0) {
      setSubRows(
        seeded.map((s, idx) => ({
          rowId: String(s?.id ?? `sub_row_${requestRow.id}_${idx}`),
          substituteUserId: String(s?.substituteUserId ?? ""),
          shiftCode: (() => {
            const rawShift = String(s?.shiftCode ?? "");
            if (!rawShift) return "";
            return WORK_SCHEDULE_OPTION_SET.has(rawShift) ? rawShift : toCustomShiftCode(rawShift);
          })(),
        }))
      );
      return;
    }
    setSubRows([{ rowId: `sub_row_${requestRow.id}_0`, substituteUserId: "", shiftCode: "" }]);
  }, [requestRow.id, substituteRecs]);
  const nm = users.find((u) => u.id === requestRow.userId)?.name ?? requestRow.userId;
  const approved = isWinnerStatus(requestRow.status);
  const calendarPanel = substituteLayout === "calendarPanel";
  function updateSubRow(rowId, key, value) {
    setSubRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [key]: value } : r)));
  }
  function addSubRow() {
    setSubRows((prev) => [...prev, { rowId: `sub_row_${requestRow.id}_${Date.now()}`, substituteUserId: "", shiftCode: "" }]);
  }
  function removeSubRow(rowId) {
    setSubRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId);
      return next.length > 0 ? next : [{ rowId: `sub_row_${requestRow.id}_fallback`, substituteUserId: "", shiftCode: "" }];
    });
  }
  const saveItems = subRows
    .map((r, idx) => ({
      id: `sub_${requestRow.id}_${idx}`,
      substituteUserId: String(r.substituteUserId ?? "").trim(),
      shiftCode: normalizeShiftCodeForSave(r.shiftCode),
    }))
    .filter((r) => r.substituteUserId && r.shiftCode);
  return (
    <div className={`admin-day-request-item${calendarPanel ? " admin-day-request-item--calendar-panel" : ""}`}>
      <div className="admin-day-request-head">
        <strong>{nm}</strong>
        <span className="admin-day-meta">
          {typeFullLabel(requestRow.leaveType)} · {leaveNatureLabel(requestRow.leaveNature)} · {statusLabel(requestRow.status)}
        </span>
      </div>
      {requestRow.status === "APPLIED" ? (
        <div className="admin-day-sub-grid">
          {subRows.map((row, idx) => (
            <div key={row.rowId} className="admin-day-sub-row">
              <label className="admin-day-field">
                <span className="field-label">대체 인력 {idx + 1}</span>
                <select value={row.substituteUserId} onChange={(e) => updateSubRow(row.rowId, "substituteUserId", e.target.value)}>
                  <option value="">(선택 없이 확정 가능)</option>
                  {nurseUsers.map((u) => (
                    <option key={u.id} value={u.id} disabled={u.id === requestRow.userId}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-day-field">
                <span className="field-label">대체 근무 번표</span>
                <select
                  value={isCustomShiftCodeValue(row.shiftCode) ? CUSTOM_SHIFT_SENTINEL : row.shiftCode}
                  onChange={(e) => {
                    const next = String(e.target.value ?? "");
                    if (next === CUSTOM_SHIFT_SENTINEL) {
                      updateSubRow(row.rowId, "shiftCode", toCustomShiftCode(customShiftText(row.shiftCode)));
                      return;
                    }
                    updateSubRow(row.rowId, "shiftCode", next);
                  }}
                >
                  <option value="">—</option>
                  {WORK_SCHEDULE_OPTIONS.filter((x) => x).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value={CUSTOM_SHIFT_SENTINEL}>직접입력</option>
                </select>
                {isCustomShiftCodeValue(row.shiftCode) ? (
                  <input
                    type="text"
                    placeholder="예: 3 9-5"
                    value={customShiftText(row.shiftCode)}
                    onChange={(e) => updateSubRow(row.rowId, "shiftCode", toCustomShiftCode(e.target.value))}
                  />
                ) : null}
              </label>
              <button type="button" className="admin-day-sub-remove-btn" onClick={() => removeSubRow(row.rowId)}>
                삭제
              </button>
            </div>
          ))}
          <div className="admin-day-actions">
            <button type="button" onClick={addSubRow}>
              대체 인력 추가
            </button>
            <button type="button" className="admin-day-primary-btn" onClick={() => void selectRequest(requestRow.id, { substituteItems: saveItems })}>
              {calendarPanel ? "확정(대체 반영)" : "확정 후 저장"}
            </button>
            {calendarPanel ? null : (
              <button type="button" onClick={() => void rejectRequest(requestRow.id)}>
                반려
              </button>
            )}
          </div>
        </div>
      ) : null}
      {approved ? (
        <div className="admin-day-sub-grid admin-day-sub-grid--approved">
          <p className="help admin-day-hint">확정됨 · 대체 근무만 수정·삭제할 수 있습니다.</p>
          {subRows.map((row, idx) => (
            <div key={row.rowId} className="admin-day-sub-row">
              <label className="admin-day-field">
                <span className="field-label">대체 인력 {idx + 1}</span>
                <select value={row.substituteUserId} onChange={(e) => updateSubRow(row.rowId, "substituteUserId", e.target.value)}>
                  <option value="">—</option>
                  {nurseUsers.map((u) => (
                    <option key={u.id} value={u.id} disabled={u.id === requestRow.userId}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-day-field">
                <span className="field-label">대체 근무 번표</span>
                <select
                  value={isCustomShiftCodeValue(row.shiftCode) ? CUSTOM_SHIFT_SENTINEL : row.shiftCode}
                  onChange={(e) => {
                    const next = String(e.target.value ?? "");
                    if (next === CUSTOM_SHIFT_SENTINEL) {
                      updateSubRow(row.rowId, "shiftCode", toCustomShiftCode(customShiftText(row.shiftCode)));
                      return;
                    }
                    updateSubRow(row.rowId, "shiftCode", next);
                  }}
                >
                  <option value="">—</option>
                  {WORK_SCHEDULE_OPTIONS.filter((x) => x).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value={CUSTOM_SHIFT_SENTINEL}>직접입력</option>
                </select>
                {isCustomShiftCodeValue(row.shiftCode) ? (
                  <input
                    type="text"
                    placeholder="예: 3 9-5"
                    value={customShiftText(row.shiftCode)}
                    onChange={(e) => updateSubRow(row.rowId, "shiftCode", toCustomShiftCode(e.target.value))}
                  />
                ) : null}
              </label>
              <button type="button" className="admin-day-sub-remove-btn" onClick={() => removeSubRow(row.rowId)}>
                삭제
              </button>
            </div>
          ))}
          <div className="admin-day-actions">
            <button type="button" onClick={() => void unselectRequest(requestRow.id)}>
              휴가확정취소
            </button>
            <button type="button" onClick={addSubRow}>
              대체 인력 추가
            </button>
            <button type="button" className="admin-day-primary-btn" onClick={() => saveSubstituteForApprovedRequest(requestRow.id, { substituteItems: saveItems })}>
              대체 저장
            </button>
            <button type="button" onClick={() => saveSubstituteForApprovedRequest(requestRow.id, { substituteItems: [] })}>
              대체 삭제
            </button>
          </div>
        </div>
      ) : null}
      {requestRow.status === "REJECTED" ? (
        <p className="help">반려된 신청입니다.</p>
      ) : null}
    </div>
  );
}

function AdminDayReviewTab({ users, requests, substituteAssignments, selectRequest, unselectRequest, rejectRequest, saveSubstituteForApprovedRequest }) {
  const [dayYmd, setDayYmd] = useState(() => toLocalYMD(new Date()));
  const nurseUsers = useMemo(() => users.filter((u) => u.role === "NURSE").sort((a, b) => a.name.localeCompare(b.name, "ko")), [users]);
  const dayReqs = useMemo(() => {
    const ld = String(dayYmd).slice(0, 10);
    return (requests || [])
      .filter((r) => String(r.leaveDate ?? "").slice(0, 10) === ld && r.status !== "CANCELLED")
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }, [requests, dayYmd]);

  return (
    <section className="card admin-day-review-card">
      <h2 className="screen-title">확정 · 대체 근무</h2>
      <p className="help page-lead">날짜를 고른 뒤, 신청별로 확정·반려와 대체 번표를 한 번에 처리합니다.</p>
      <div className="weekly-toolbar row wrap">
        <label className="weekly-date-label">
          처리 날짜
          <input type="date" value={dayYmd} onChange={(e) => setDayYmd(e.target.value)} />
        </label>
      </div>
      {dayReqs.length === 0 ? (
        <p className="help">이 날짜에 조회할 신청이 없습니다.</p>
      ) : (
        <ul className="admin-day-request-list">
          {dayReqs.map((r) => (
            <li key={r.id} className="admin-day-request-li">
              <AdminDayRequestCard
                requestRow={r}
                nurseUsers={nurseUsers}
                users={users}
                substituteRecs={getSubstituteRecordsForRequest(substituteAssignments, r.id)}
                selectRequest={selectRequest}
                unselectRequest={unselectRequest}
                rejectRequest={rejectRequest}
                saveSubstituteForApprovedRequest={saveSubstituteForApprovedRequest}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const YEARLY_ROSTER_GROUPS = {
  "임희종": 1,
  "이양희": 1,
  "허정숙": 1,
  "이현숙": 1,
  "유진": 2,
  "김해림": 2,
  "양현아": 2,
  "장지은": 3,
  "손다솜": 3,
  "오민아": 3,
  "최종선": 3,
  "장성필": 3,
  "이지선": 3,
  "최유리": 4,
  "최유경": 4,
  "정수영": 4,
};

const YEARLY_ROSTER_SLOTS = ["1D1", "1D2", "3D1", "3D2", "5D1", "5D2", "6D1", "6D2", "7D1", "7D2", "안D0", "안D0", "안E", "수E", "9-5", "PRN"];
const YEARLY_ROSTER_FIXED_SPECIAL = new Set(["PRN", "안E", "수E", "9-5"]);
const YEARLY_ROSTER_LIMITED_ROOMS = new Set(["1", "3", "5", "6", "7", "안"]);

function maxRoomCountByGroup(name, room, groupMap) {
  if (room === "안") {
    const g = Number(groupMap.get(name) || 0);
    return g === 1 || g === 2 ? 1 : 2;
  }
  return 2;
}

function slotRoomKey(slot) {
  const s = String(slot ?? "").toUpperCase();
  const m = /^([13567])D[12]$/.exec(s);
  if (m) return m[1];
  if (s === "안D0") return "안";
  return s;
}

function isD1(slot) {
  return /D1$/i.test(String(slot ?? ""));
}

function isD2(slot) {
  return /D2$/i.test(String(slot ?? ""));
}

function isDPairSwitch(prevSlot, nextSlot) {
  return (isD1(prevSlot) && isD2(nextSlot)) || (isD2(prevSlot) && isD1(nextSlot));
}

function ymSequence(startYm, count = 12) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(startYm ?? "").trim());
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || mo < 1 || mo > 12) return [];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(y, mo - 1 + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function shuffleList(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildNonCollidingPrnPlan(prnCandidates, nineFivePlan, maxTry = 240) {
  for (let t = 0; t < maxTry; t += 1) {
    const plan = shuffleList(prnCandidates);
    let ok = true;
    for (let i = 0; i < plan.length; i += 1) {
      if (plan[i] === nineFivePlan[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return plan;
  }
  return null;
}

function buildYearlyRoster(startYm, nurseNames) {
  const months = ymSequence(startYm, 12);
  if (months.length !== 12) return { ok: false, error: "시작 월은 YYYY-MM 형식으로 입력해 주세요." };
  const names = [...nurseNames];
  if (names.length !== 16) return { ok: false, error: "근무표 생성은 간호사 16명 기준입니다." };

  const groupMap = new Map(names.map((n) => [n, YEARLY_ROSTER_GROUPS[n] ?? 0]));
  const prnQuota = new Map(names.map((n) => [n, 0]));
  names.forEach((n) => {
    const g = groupMap.get(n);
    if (g === 2 || g === 3) prnQuota.set(n, 1);
    if (g === 4) prnQuota.set(n, 1);
  });
  const prnPool = [];
  prnQuota.forEach((q, n) => {
    for (let i = 0; i < q; i += 1) prnPool.push(n);
  });
  if (prnPool.length !== 12) return { ok: false, error: "PRN 배정 수 계산에 실패했습니다." };

  const nineFiveSelected = new Set(shuffleList(names).slice(0, 12));
  const nineFivePlan = shuffleList([...nineFiveSelected]);
  const prnPlan = buildNonCollidingPrnPlan(prnPool, nineFivePlan);
  if (!prnPlan) return { ok: false, error: "특수번표 배정충돌로 생성에 실패했습니다." };

  const specialTarget = new Map(names.map((n) => [n, 2]));
  const g4Names = names.filter((n) => groupMap.get(n) === 4);
  names.forEach((n) => {
    const g = groupMap.get(n);
    if (g === 1) specialTarget.set(n, 1);
    else if (g === 2) specialTarget.set(n, 2);
    else if (g === 3) specialTarget.set(n, 3);
    else if (g === 4) specialTarget.set(n, 3);
  });
  if (g4Names.length > 0) specialTarget.set(g4Names[g4Names.length - 1], 2);

  const state = new Map(
    names.map((n) => [
      n,
      {
        lastRoom: "",
        roomStreak: 0,
        lastSlot: "",
        d1: 0,
        d2: 0,
        prn: 0,
        nineFive: 0,
        special: 0,
        roomCounts: {},
      },
    ])
  );
  const monthRows = [];

  function touchState(name, slot) {
    const s = state.get(name);
    const room = slotRoomKey(slot);
    s.lastSlot = slot;
    if (room === s.lastRoom) s.roomStreak += 1;
    else {
      s.lastRoom = room;
      s.roomStreak = 1;
    }
    if (isD1(slot)) s.d1 += 1;
    if (isD2(slot)) s.d2 += 1;
    if (slot === "PRN") s.prn += 1;
    if (slot === "9-5") s.nineFive += 1;
    if (slot === "PRN" || slot === "안E" || slot === "수E") s.special += 1;
    s.roomCounts[room] = Number(s.roomCounts[room] || 0) + 1;
  }

  for (let mi = 0; mi < months.length; mi += 1) {
    const assigned = new Map();
    const taken = new Set();
    const monthNineFive = nineFivePlan[mi];
    const monthPrn = prnPlan[mi];
    if (!monthNineFive || !monthPrn || monthNineFive === monthPrn) return { ok: false, error: "특수 번표 배정 충돌로 생성에 실패했습니다." };

    assigned.set(monthPrn, "PRN");
    assigned.set(monthNineFive, "9-5");
    taken.add(monthPrn);
    taken.add(monthNineFive);

    const candidatesForAE = names.filter((n) => !taken.has(n));
    const pickBySpecialDeficit = (pool) =>
      [...pool].sort((a, b) => {
        const sa = state.get(a);
        const sb = state.get(b);
        const da = Number(specialTarget.get(a) || 0) - sa.special;
        const db = Number(specialTarget.get(b) || 0) - sb.special;
        if (db !== da) return db - da;
        return sa.special - sb.special;
      })[0];
    const monthAE = pickBySpecialDeficit(candidatesForAE);
    if (!monthAE) return { ok: false, error: "안E 대상 배정 실패" };
    assigned.set(monthAE, "안E");
    taken.add(monthAE);

    const monthSE = pickBySpecialDeficit(names.filter((n) => !taken.has(n)));
    if (!monthSE) return { ok: false, error: "수E 대상 배정 실패" };
    assigned.set(monthSE, "수E");
    taken.add(monthSE);

    const freeNames = names.filter((n) => !taken.has(n));
    const freeSlots = YEARLY_ROSTER_SLOTS.filter((slot) => !YEARLY_ROSTER_FIXED_SPECIAL.has(slot));
    if (freeNames.length !== freeSlots.length) return { ok: false, error: "기본 번표 슬롯 수 불일치" };

    const restNames = new Set(freeNames);
    const restSlots = [...freeSlots];
    while (restSlots.length > 0) {
      let best = null;
      for (const n of restNames) {
        const s = state.get(n);
        for (let si = 0; si < restSlots.length; si += 1) {
          const slot = restSlots[si];
          const room = slotRoomKey(slot);
          const maxRoomCount = maxRoomCountByGroup(n, room, groupMap);
          if (YEARLY_ROSTER_LIMITED_ROOMS.has(room) && Number(s.roomCounts[room] || 0) >= maxRoomCount) {
            continue;
          }
          let score = 0;
          if (s.lastRoom === room && s.roomStreak >= 2) score += 1000;
          // 같은 방을 2개월 연속으로 붙여 연속성을 높이고, 3개월 연속은 금지한다.
          if (s.lastRoom === room && s.roomStreak === 1) score -= 22;
          if (s.lastRoom === room && s.roomStreak === 1 && isDPairSwitch(s.lastSlot, slot)) score -= 10;
          if (s.lastSlot === slot) score += 24;
          if (isD1(slot)) score += Math.max(0, s.d1 - s.d2);
          if (isD2(slot)) score += Math.max(0, s.d2 - s.d1);
          score += Number(s.roomCounts[room] || 0) * 1.5;
          if (!best || score < best.score || (score === best.score && Math.random() < 0.35)) {
            best = { n, slot, si, score };
          }
        }
      }
      if (!best) return { ok: false, error: "기본 번표 배정 탐색 실패" };
      assigned.set(best.n, best.slot);
      restNames.delete(best.n);
      restSlots.splice(best.si, 1);
    }

    const row = {};
    for (const n of names) {
      const slot = assigned.get(n) || "";
      row[n] = slot;
      touchState(n, slot);
    }
    monthRows.push(row);
  }

  const rows = names.map((name) => ({ name, values: monthRows.map((r) => r[name] || "") }));
  const stats = names.map((name) => {
    const s = state.get(name);
    return {
      name,
      group: groupMap.get(name),
      d1: s.d1,
      d2: s.d2,
      prn: s.prn,
      nineFive: s.nineFive,
      special: s.special,
    };
  });
  const noNineFive = stats.filter((s) => s.nineFive === 0).map((s) => s.name);
  const warnings = noNineFive.length !== 4 ? ["9-5 비배정 인원이 4명이 되지 않아 재확인이 필요합니다."] : [];
  return { ok: true, months, rows, stats, warnings };
}

function DashboardPage({
  dashboard,
  goldkeys,
  requests,
  cancellations,
  users,
  serverMode,
  currentRole,
  workScheduleRows,
  onSaveWorkScheduleRows,
  generatedMonthlySchedules,
  onSaveGeneratedMonthlySchedule,
  isAdmin,
  substituteAssignments,
  holidays,
  holidayDuties,
  weeklyCellOverrides,
  setWeeklyCellOverrides,
  persistWeeklyCellOverridesToServer,
  selectRequest,
  rejectRequest,
  saveSubstituteForApprovedRequest,
}) {
  const [dashTab, setDashTab] = useState(() => (currentRole === "ANESTHESIA" ? "schedule" : "summary"));
  const [draftRows, setDraftRows] = useState(Array.isArray(workScheduleRows) ? workScheduleRows : WORK_SCHEDULE_2026_ROWS);
  const [scheduleMsg, setScheduleMsg] = useState("");
  const [generatorStartYm, setGeneratorStartYm] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-03`;
  });
  const [generatorResult, setGeneratorResult] = useState(null);
  const [generatorMsg, setGeneratorMsg] = useState("");
  const [schedulePlanKey, setSchedulePlanKey] = useState("base_2026");
  const [scheduleYearFilter, setScheduleYearFilter] = useState("all");

  useEffect(() => {
    setDraftRows(Array.isArray(workScheduleRows) ? workScheduleRows : WORK_SCHEDULE_2026_ROWS);
  }, [workScheduleRows]);

  const scheduleChanges = useMemo(() => {
    const saved = Array.isArray(workScheduleRows) ? workScheduleRows : WORK_SCHEDULE_2026_ROWS;
    const savedMap = new Map(saved.map((r) => [r.name, r.values || []]));
    const changes = [];
    for (const row of draftRows) {
      const prevVals = savedMap.get(row.name) || [];
      const nextVals = row.values || [];
      for (let i = 0; i < WORK_SCHEDULE_2026_MONTHS.length; i += 1) {
        const before = String(prevVals[i] ?? "");
        const after = String(nextVals[i] ?? "");
        if (before !== after) {
          changes.push({
            monthLabel: WORK_SCHEDULE_2026_MONTHS[i],
            name: row.name,
            before: before || "-",
            after: after || "-",
          });
        }
      }
    }
    return changes;
  }, [draftRows, workScheduleRows]);

  const schedulePlanOptions = useMemo(() => {
    const generated = Object.entries(generatedMonthlySchedules && typeof generatedMonthlySchedules === "object" ? generatedMonthlySchedules : {})
      .filter(([, v]) => Array.isArray(v?.months) && Array.isArray(v?.rows))
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return [
      { key: "base_2026", label: "기본 2026 근무표", months: WORK_SCHEDULE_2026_MONTHS.map((m, i) => `2026-${String(i + 1).padStart(2, "0")}`) },
      ...generated.map(([k, v]) => ({
        key: `gen_${k}`,
        label: `${k} 시작 12개월`,
        months: v.months,
      })),
    ];
  }, [generatedMonthlySchedules]);

  useEffect(() => {
    if (!schedulePlanOptions.some((opt) => opt.key === schedulePlanKey)) {
      setSchedulePlanKey("base_2026");
    }
  }, [schedulePlanKey, schedulePlanOptions]);

  const activePlan = useMemo(() => {
    if (schedulePlanKey === "base_2026") {
      return {
        type: "base",
        months: WORK_SCHEDULE_2026_MONTHS.map((m, i) => ({
          ymd: `2026-${String(i + 1).padStart(2, "0")}`,
          label: m,
          index: i,
        })),
        rows: Array.isArray(draftRows) ? draftRows : WORK_SCHEDULE_2026_ROWS,
      };
    }
    const startKey = String(schedulePlanKey).replace(/^gen_/, "");
    const raw = generatedMonthlySchedules?.[startKey];
    const months = (Array.isArray(raw?.months) ? raw.months : []).map((ym, idx) => ({
      ymd: String(ym),
      label: String(ym).replace("-", "년 ") + "월",
      index: idx,
    }));
    return {
      type: "generated",
      months,
      rows: Array.isArray(raw?.rows) ? raw.rows : [],
    };
  }, [schedulePlanKey, generatedMonthlySchedules, draftRows]);

  const scheduleYearOptions = useMemo(() => {
    const years = [...new Set(activePlan.months.map((m) => String(m.ymd).slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))];
    years.sort();
    return years;
  }, [activePlan.months]);

  useEffect(() => {
    if (scheduleYearFilter === "all") return;
    if (!scheduleYearOptions.includes(scheduleYearFilter)) setScheduleYearFilter("all");
  }, [scheduleYearFilter, scheduleYearOptions]);

  const visibleMonths = useMemo(() => {
    if (scheduleYearFilter === "all") return activePlan.months;
    return activePlan.months.filter((m) => String(m.ymd).startsWith(`${scheduleYearFilter}-`));
  }, [activePlan.months, scheduleYearFilter]);

  function onDraftCellChange(name, monthIndex, value) {
    setScheduleMsg("");
    setDraftRows((prev) =>
      (Array.isArray(prev) ? prev : WORK_SCHEDULE_2026_ROWS).map((row) => {
        if (row.name !== name) return row;
        const vals = Array.isArray(row.values) ? [...row.values] : Array.from({ length: WORK_SCHEDULE_2026_MONTHS.length }, () => "");
        vals[monthIndex] = String(value ?? "");
        return { ...row, values: vals };
      })
    );
  }

  function saveWorkSchedule() {
    if (scheduleChanges.length === 0) {
      setScheduleMsg("변경된 항목이 없습니다.");
      return;
    }
    const lines = scheduleChanges.map((c) => `- ${c.monthLabel} ${c.name}: ${c.before} -> ${c.after}`);
    const ok = window.confirm(`아래 근무표 변경을 저장할까요?\n\n${lines.join("\n")}`);
    if (!ok) return;
    onSaveWorkScheduleRows(draftRows);
    setScheduleMsg("근무표가 저장되었습니다.");
    notifyDone("저장되었습니다.");
  }

  function generateYearlyRoster() {
    const nurseNames = users.filter((u) => u.role === "NURSE").map((u) => u.name).sort((a, b) => a.localeCompare(b, "ko"));
    const result = buildYearlyRoster(generatorStartYm, nurseNames);
    if (!result.ok) {
      setGeneratorResult(null);
      setGeneratorMsg(result.error || "생성에 실패했습니다.");
      return;
    }
    setGeneratorResult(result);
    setGeneratorMsg("월별번표를 생성했습니다.");
  }

  function saveGeneratedRosterToMonthlyView() {
    if (!generatorResult?.ok) return;
    const key = String(generatorResult.months?.[0] ?? "").slice(0, 7);
    if (!key || !Array.isArray(generatorResult.months) || !Array.isArray(generatorResult.rows)) {
      setGeneratorMsg("저장할 생성 결과가 없습니다.");
      return;
    }
    onSaveGeneratedMonthlySchedule(key, { months: generatorResult.months, rows: generatorResult.rows, savedAt: new Date().toISOString() });
    setSchedulePlanKey(`gen_${key}`);
    setDashTab("schedule");
    setGeneratorMsg("생성 결과를 월간근무표 열람 목록에 저장했습니다.");
    notifyDone("저장되었습니다.");
  }

  return (
    <>
      {currentRole === "ANESTHESIA" ? (
        <div className="segmented-wrap segmented-wrap--multi" role="tablist" aria-label="현황 구분">
          <button
            type="button"
            role="tab"
            aria-selected={dashTab === "schedule"}
            className={`segmented-btn${dashTab === "schedule" ? " segmented-btn--active" : ""}`}
            onClick={() => setDashTab("schedule")}
          >
            월간 근무표
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dashTab === "weekly"}
            className={`segmented-btn${dashTab === "weekly" ? " segmented-btn--active" : ""}`}
            onClick={() => setDashTab("weekly")}
          >
            주간 번표
          </button>
        </div>
      ) : (
        <div className="segmented-wrap segmented-wrap--multi" role="tablist" aria-label="현황 구분">
          <button
            type="button"
            role="tab"
            aria-selected={dashTab === "summary"}
            className={`segmented-btn${dashTab === "summary" ? " segmented-btn--active" : ""}`}
            onClick={() => setDashTab("summary")}
          >
            골드키
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dashTab === "schedule"}
            className={`segmented-btn${dashTab === "schedule" ? " segmented-btn--active" : ""}`}
            onClick={() => setDashTab("schedule")}
          >
            월간 근무표
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dashTab === "weekly"}
            className={`segmented-btn${dashTab === "weekly" ? " segmented-btn--active" : ""}`}
            onClick={() => setDashTab("weekly")}
          >
            주간 번표
          </button>
          {isAdmin ? (
            <button
              type="button"
              role="tab"
              aria-selected={dashTab === "monthly-generator"}
              className={`segmented-btn${dashTab === "monthly-generator" ? " segmented-btn--active" : ""}`}
              onClick={() => setDashTab("monthly-generator")}
            >
              월별번표생성
            </button>
          ) : null}
        </div>
      )}
      {currentRole !== "ANESTHESIA" && dashTab === "summary" ? (
        <section className="card">
          <h2 className="screen-title">골드키</h2>
          <p className="help page-lead goldkey-policy-note">
            <span>상반기 장기휴가 신청기간(1~6월) : 전년도 10월 1일 ~ 10일</span>
            <span>하반기 장기휴가 신청기간(7~12월) : 해당년도 4월 1일 ~ 10일</span>
            <span>모든 장기휴가는 신청기간 이후 일괄 적용되어 골드키 차감됩니다.</span>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>골드키 총개수</th>
                  <th>신청</th>
                  <th>잔여개수</th>
                </tr>
              </thead>
              <tbody>
                {users
                  .filter((u) => u.role === "NURSE")
                  .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                  .map((u) => {
                    const g = goldkeys.find((x) => x.userId === u.id);
                    const quotaTotal = goldkeyQuotaTotalForDisplay(u, g, serverMode);
                    const applyUse = countGoldkeyApplyUse(requests, u.id, new Date().toISOString());
                    const remaining = Math.max(0, quotaTotal - applyUse);
                    return (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{quotaTotal}</td>
                        <td>{applyUse}</td>
                        <td>{remaining}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {dashTab === "schedule" ? (
      <section className={`card work-schedule-card${isAdmin ? " work-schedule-card--admin" : ""}`}>
        <h2 className="screen-title">월간 근무표</h2>
        <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
          <label className="weekly-date-label">
            번표 묶음
            <select value={schedulePlanKey} onChange={(e) => setSchedulePlanKey(e.target.value)}>
              {schedulePlanOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="weekly-date-label">
            년도
            <select value={scheduleYearFilter} onChange={(e) => setScheduleYearFilter(e.target.value)}>
              <option value="all">전체</option>
              {scheduleYearOptions.map((yy) => (
                <option key={yy} value={yy}>
                  {yy}년
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap work-schedule-wrap">
          <table className="work-schedule-table">
            <thead>
              <tr>
                <th>이름</th>
                {visibleMonths.map((m) => (
                  <th key={m.ymd}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(activePlan.rows) ? activePlan.rows : []).map((row) => (
                <tr
                  key={row.name}
                  className={
                    row.name === "유진" || row.name === "오민아" || row.name === "최유경"
                      ? "work-schedule-row--highlight"
                      : ""
                  }
                >
                  <td className="work-schedule-name-cell">{row.name}</td>
                  {visibleMonths.map((m) => {
                    const idx = m.index;
                    const cellVal = row.values?.[idx] ?? "";
                    const faceLabel = String(cellVal).trim() ? cellVal : "—";
                    return (
                      <td key={`${row.name}-${m.ymd}`} className="work-schedule-month-cell">
                        <label className="work-schedule-picker">
                          <span className="work-schedule-picker-face" aria-hidden="true">
                            {faceLabel}
                          </span>
                          {activePlan.type === "base" ? (
                            <select
                              className="work-schedule-select"
                              value={cellVal}
                              onChange={(e) => onDraftCellChange(row.name, idx, e.target.value)}
                              aria-label={`${row.name} ${m.label} 근무`}
                            >
                              {WORK_SCHEDULE_OPTIONS.map((opt) => (
                                <option key={`${row.name}-${m.ymd}-${opt || "empty"}`} value={opt}>
                                  {opt || "-"}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {activePlan.type === "base" ? (
          <div className="row work-schedule-save-row" style={{ marginTop: 10 }}>
            {scheduleMsg ? <span className="help work-schedule-save-msg">{scheduleMsg}</span> : null}
            <button type="button" onClick={saveWorkSchedule}>
              근무표 저장
            </button>
          </div>
        ) : (
          <p className="help" style={{ marginTop: 10 }}>생성 저장된 번표는 열람 전용입니다.</p>
        )}
      </section>
      ) : null}
      {dashTab === "weekly" ? (
        <WeeklyScheduleTab
          workScheduleRows={workScheduleRows}
          requests={requests}
          substituteAssignments={substituteAssignments}
          users={users}
          holidays={holidays}
          holidayDuties={holidayDuties}
          weeklyCellOverrides={weeklyCellOverrides}
          setWeeklyCellOverrides={setWeeklyCellOverrides}
          persistWeeklyCellOverridesToServer={persistWeeklyCellOverridesToServer}
          canEditWeekly={currentRole === "NURSE" || currentRole === "ADMIN" || currentRole === "ANESTHESIA"}
          isAdmin={isAdmin}
        />
      ) : null}
      {isAdmin && dashTab === "monthly-generator" ? (
        <section className="card work-schedule-card work-schedule-card--admin">
          <h2 className="screen-title">월별번표생성</h2>
          <p className="help page-lead">시작 월부터 12개월(예: 2027-03 ~ 2028-02) 자동 생성합니다.</p>
          <div className="row wrap monthly-generator-controls">
            <label className="weekly-date-label">
              시작 월
              <input type="month" value={generatorStartYm} onChange={(e) => setGeneratorStartYm(e.target.value)} />
            </label>
            <button type="button" className="monthly-generator-btn" onClick={generateYearlyRoster}>
              생성
            </button>
            <button type="button" className="monthly-generator-btn" onClick={saveGeneratedRosterToMonthlyView} disabled={!generatorResult?.ok}>
              월간근무표에 저장
            </button>
          </div>
          {generatorMsg ? <p className="help" style={{ marginTop: 8 }}>{generatorMsg}</p> : null}
          {generatorResult?.warnings?.length ? (
            <div style={{ marginTop: 8 }}>
              {generatorResult.warnings.map((w) => (
                <p key={w} className="help">- {w}</p>
              ))}
            </div>
          ) : null}
          {generatorResult ? (
            <>
              <div className="table-wrap work-schedule-wrap" style={{ marginTop: 10 }}>
                <table className="work-schedule-table">
                  <thead>
                    <tr>
                      <th>이름</th>
                      {generatorResult.months.map((m) => (
                        <th key={m}>{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {generatorResult.rows.map((row) => (
                      <tr key={row.name}>
                        <td className="work-schedule-name-cell">{row.name}</td>
                        {row.values.map((v, idx) => (
                          <td key={`${row.name}_${generatorResult.months[idx]}`} className="work-schedule-month-cell">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>그룹</th>
                      <th>D1</th>
                      <th>D2</th>
                      <th>PRN</th>
                      <th>9-5</th>
                      <th>특수(PRN/안E/수E)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generatorResult.stats.map((s) => (
                      <tr key={`stat_${s.name}`}>
                        <td>{s.name}</td>
                        <td>{s.group}</td>
                        <td>{s.d1}</td>
                        <td>{s.d2}</td>
                        <td>{s.prn}</td>
                        <td>{s.nineFive}</td>
                        <td>{s.special}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function AccountPage({ onChangePassword, message }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [localMsg, setLocalMsg] = useState("");
  async function submit(e) {
    e.preventDefault();
    setLocalMsg("");
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setLocalMsg("비밀번호 변경 완료");
    } catch (e2) {
      setLocalMsg("비밀번호 변경 실패: 현재 비밀번호를 확인하세요.");
    }
  }
  return (
    <section className="card">
      <h2>계정</h2>
      <p className="help page-lead">비밀번호를 바꿀 수 있습니다.</p>
      <form className="login-form" onSubmit={submit}>
        <input type="password" placeholder="현재 비밀번호" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        <input type="password" placeholder="새 비밀번호 (4자 이상)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <button type="submit">비밀번호 저장</button>
      </form>
      {localMsg ? <p className="msg">{localMsg}</p> : null}
      {message ? <p className="help">{message}</p> : null}
    </section>
  );
}

function navLinkClass({ isActive }) {
  return `app-bottom-nav__link${isActive ? " app-bottom-nav__link--active" : ""}`;
}

/** 하단 고정 탭 — 한 손 엄지로 주요 화면 전환 */
function AppBottomNav({ isAdmin, role }) {
  const showLadder = role !== "ANESTHESIA";
  const showMy = role === "NURSE";

  if (isAdmin) {
    return (
      <nav className="app-bottom-nav" aria-label="주 메뉴">
        <NavLink to="/calendar" className={navLinkClass} end>
          캘린더
        </NavLink>
        <NavLink to="/dashboard" className={navLinkClass}>
          현황
        </NavLink>
        <NavLink to="/admin" className={navLinkClass}>
          기록
        </NavLink>
        <NavLink to="/ladder" className={navLinkClass}>
          추첨
        </NavLink>
        <NavLink to="/settings" className={navLinkClass}>
          설정
        </NavLink>
      </nav>
    );
  }

  return (
    <nav className="app-bottom-nav" aria-label="주 메뉴">
      <NavLink to="/calendar" className={navLinkClass} end>
        캘린더
      </NavLink>
      {showMy ? (
        <NavLink to="/my" className={navLinkClass}>
          내 신청
        </NavLink>
      ) : null}
      <NavLink to="/dashboard" className={navLinkClass}>
        현황
      </NavLink>
      {showLadder ? (
        <NavLink to="/ladder" className={navLinkClass}>
          추첨
        </NavLink>
      ) : null}
    </nav>
  );
}

/** 알림 목록·푸시 — 상단 종 아이콘과 연결 */
function NotificationsPage({
  currentUser,
  serverMode,
  myNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  enablePushNotifications,
  pushBusy,
  pushEnabled,
}) {
  const navigate = useNavigate();

  function openNotificationTarget(n) {
    void markNotificationRead(n.id);
    const td = String(n.targetDate ?? n.target_date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(td)) return;
    const type = String(n.type ?? "").trim();
    let focus = "";
    if (type === "DAY_COMMENT") focus = "comments";
    else if (type === "ADMIN_MEMO") focus = "memo";
    const q = new URLSearchParams();
    q.set("ymd", td);
    q.set("detail", "1");
    if (focus) q.set("focus", focus);
    navigate(`/calendar?${q.toString()}`);
  }

  return (
    <div className="notifications-page">
      <section className="card">
        <h2 className="screen-title">알림</h2>
        <p className="help page-lead">읽지 않은 알림이 상단 종 아이콘에 숫자로 표시됩니다.</p>
        {currentUser?.role === "NURSE" ? (
          <div className="notification-head notification-head--page">
            <div className="notification-head-actions">
              {serverMode ? (
                <button type="button" className="notification-readall-btn" onClick={() => void enablePushNotifications()} disabled={pushBusy || pushEnabled}>
                  {pushEnabled ? "푸시 켜짐" : pushBusy ? "설정 중..." : "푸시 켜기"}
                </button>
              ) : null}
              <button type="button" className="notification-readall-btn" onClick={markAllNotificationsRead}>
                모두 읽음
              </button>
            </div>
          </div>
        ) : null}
        {currentUser?.role !== "NURSE" ? (
          <p className="help">간호사 계정에서 수신한 알림이 여기에 표시됩니다.</p>
        ) : myNotifications.length === 0 ? (
          <p className="help">새 알림이 없습니다.</p>
        ) : (
          <ul className="notification-list">
            {myNotifications.slice(0, 24).map((n) => (
              <li
                key={n.id}
                className="notification-item notification-item--unread"
                role="button"
                tabIndex={0}
                onClick={() => openNotificationTarget(n)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  openNotificationTarget(n);
                }}
              >
                <p>{n.message}</p>
                <span>{new Date(n.createdAt).toLocaleString("ko-KR")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildRandomLadderLinks(laneCount, rowCount) {
  const links = Array.from({ length: rowCount }, () => Array.from({ length: Math.max(0, laneCount - 1) }, () => false));
  for (let r = 0; r < rowCount; r += 1) {
    for (let c = 0; c < laneCount - 1; c += 1) {
      if (c > 0 && links[r][c - 1]) continue;
      if (Math.random() < 0.35) links[r][c] = true;
    }
  }
  return links;
}

function traceLadderLane(startLane, links, laneCount) {
  let lane = startLane;
  for (let r = 0; r < links.length; r += 1) {
    if (lane > 0 && links[r][lane - 1]) lane -= 1;
    else if (lane < laneCount - 1 && links[r][lane]) lane += 1;
  }
  return lane;
}

function laneColor(index) {
  const palette = ["#2563eb", "#0ea5e9", "#14b8a6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ec4899"];
  return palette[index % palette.length];
}

function LadderGamePage({ users, requests, ladderResults, createLadderResult, applyLadderResultToNegotiationOrder, currentUserId }) {
  const location = useLocation();
  const navigate = useNavigate();
  const now = toLocalYMD(new Date());
  const [leaveDate, setLeaveDate] = useState(now);
  const [leaveType, setLeaveType] = useState("GENERAL_PRIORITY");
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [previewOrder, setPreviewOrder] = useState([]);
  const [ladderMsg, setLadderMsg] = useState("");
  const [ladderSpec, setLadderSpec] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [runnerState, setRunnerState] = useState(null);
  const [activeRunnerId, setActiveRunnerId] = useState("");
  const [activePathKeys, setActivePathKeys] = useState({});
  const [narrowUi, setNarrowUi] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false
  );
  const [ladderModalOpen, setLadderModalOpen] = useState(false);
  const autoRunDoneRef = useRef("");
  const queryFromCalendar = useMemo(() => {
    const qs = new URLSearchParams(location.search || "");
    return String(qs.get("from") ?? "").trim() === "calendar";
  }, [location.search]);

  useEffect(() => {
    if (!ladderModalOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeLadderModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ladderModalOpen, closeLadderModal]);

  useEffect(() => {
    if (!ladderModalOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [ladderModalOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setNarrowUi(mq.matches);
    /* Safari 13 등: MediaQueryList에 addEventListener 없음 → addListener 사용 */
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const nurseUsers = useMemo(
    () => users.filter((u) => u.role === "NURSE").sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [users]
  );

  const idToName = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const applicantsForTarget = useMemo(
    () =>
      (Array.isArray(requests) ? requests : [])
        .filter((r) => r.leaveDate === leaveDate && r.leaveType === leaveType && r.status === "APPLIED")
        .map((r) => r.userId),
    [requests, leaveDate, leaveType]
  );
  const applicantUserIds = useMemo(() => [...new Set(applicantsForTarget)], [applicantsForTarget]);
  const ladderParticipantUserIds = useMemo(
    () => getLadderParticipantUserIdsForRequests(requests, leaveDate, leaveType),
    [requests, leaveDate, leaveType]
  );
  const manualOrderBlocksLadder = useMemo(
    () => manualNegotiationOrderBlocksLadder(requests, leaveDate, leaveType, ladderResults),
    [requests, leaveDate, leaveType, ladderResults]
  );
  const canRunLadderForTarget = ladderParticipantUserIds.length >= 2 && !manualOrderBlocksLadder;
  const savedLadderKeySet = useMemo(() => {
    const set = new Set();
    for (const row of Array.isArray(ladderResults) ? ladderResults : []) {
      const d = String(row?.leaveDate ?? "").trim();
      const t = String(row?.leaveType ?? "").trim();
      if (!d || !t) continue;
      set.add(`${d}|${t}`);
    }
    return set;
  }, [ladderResults]);
  const hasSavedForCurrentTarget = savedLadderKeySet.has(`${leaveDate}|${leaveType}`);

  function closeLadderModal() {
    setLadderModalOpen(false);
    if (!queryFromCalendar) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(leaveDate ?? ""))) {
      navigate(`/calendar?ymd=${encodeURIComponent(String(leaveDate))}&detail=1`, { replace: true });
      return;
    }
    navigate("/calendar", { replace: true });
  }

  useEffect(() => {
    const qs = new URLSearchParams(location.search || "");
    const qDate = String(qs.get("leaveDate") ?? "").trim();
    const qType = String(qs.get("leaveType") ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(qDate)) setLeaveDate(qDate);
    if (["GENERAL_PRIORITY", "GENERAL_NORMAL", "GOLDKEY", "HALF_DAY"].includes(qType)) setLeaveType(qType);
  }, [location.search]);

  function toggleUser(userId) {
    setSelectedUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  function runLadder(participantsOverride = null) {
    setLadderMsg("");
    if (hasSavedForCurrentTarget) {
      setLadderMsg("이미 저장된 사다리 결과가 있어 다시 실행할 수 없습니다.");
      return null;
    }
    if (manualOrderBlocksLadder) {
      const msg = "협의 순번이 수기로 저장되어 사다리를 실행할 수 없습니다.";
      setLadderMsg(msg);
      window.alert?.(msg);
      return null;
    }
    if (!canRunLadderForTarget) {
      const msg =
        leaveType === "GOLDKEY"
          ? "현재 골드키는 협의 대상이 아니어서 사다리를 실행할 수 없습니다. (신청순 자동 배정)"
          : "현재 조건에서는 사다리를 실행할 수 없습니다.";
      setLadderMsg(msg);
      window.alert?.(msg);
      return null;
    }
    const participants = Array.isArray(participantsOverride) && participantsOverride.length > 0 ? participantsOverride : selectedUserIds;
    if (participants.length < 2) {
      window.alert?.("사다리 게임은 참여자 2명 이상이 필요합니다.");
      return null;
    }
    const laneCount = participants.length;
    const rowCount = narrowUi ? Math.max(4, laneCount * 2) : Math.max(5, laneCount * 3);
    const links = buildRandomLadderLinks(laneCount, rowCount);
    const byStart = participants.map((userId, startLane) => ({
      userId,
      startLane,
      endLane: traceLadderLane(startLane, links, laneCount),
    }));
    const order = byStart
      .slice()
      .sort((a, b) => a.endLane - b.endLane)
      .map((x) => x.userId);
    setLadderSpec({ laneCount, rowCount, links, byStart, laneUsers: [...participants], order });
    setPreviewOrder(order);
    setRunnerState(null);
    setAnimating(false);
    setActiveRunnerId("");
    setActivePathKeys({});
    setLadderModalOpen(true);
    return { laneCount, rowCount, links, byStart, laneUsers: [...participants], order };
  }

  async function playLadderAnimation(targetUserId, specArg) {
    const spec = specArg || ladderSpec;
    if (!spec || animating) return;
    const target = spec.byStart.find((item) => item.userId === targetUserId);
    if (!target) return;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    setAnimating(true);
    setRunnerState(null);
    setActiveRunnerId(target.userId);
    setActivePathKeys({});
    let lane = target.startLane;
    setRunnerState({ userId: target.userId, lane, row: 0 });
    await sleep(390);
    for (let r = 0; r < spec.rowCount; r += 1) {
      const beforeLane = lane;
      const nextPath = { [`v-${r}-${beforeLane}`]: true };
      if (lane > 0 && spec.links[r][lane - 1]) {
        lane -= 1;
        nextPath[`h-${r}-${lane}`] = true;
      } else if (lane < spec.laneCount - 1 && spec.links[r][lane]) {
        nextPath[`h-${r}-${lane}`] = true;
        lane += 1;
      }
      setActivePathKeys((prev) => ({ ...prev, ...nextPath }));
      setRunnerState({ userId: target.userId, lane, row: r + 1 });
      await sleep(210);
    }
    await sleep(330);
    setRunnerState(null);
    setAnimating(false);
  }

  async function saveResult({ selectedUserIdsOverride = null, previewOrderOverride = null } = {}) {
    setLadderMsg("");
    if (hasSavedForCurrentTarget) {
      setLadderMsg("이미 저장된 사다리 결과가 있어 다시 저장할 수 없습니다.");
      return;
    }
    const selected = Array.isArray(selectedUserIdsOverride) ? selectedUserIdsOverride : selectedUserIds;
    const order = Array.isArray(previewOrderOverride) ? previewOrderOverride : previewOrder;
    if (order.length < 2) {
      window.alert?.("먼저 사다리 실행을 눌러 순번을 생성하세요.");
      return;
    }
    const selectedSet = new Set(selected);
    const applicantSet = new Set(ladderParticipantUserIds);
    const isSameSize = selectedSet.size === applicantSet.size;
    const isSameMember = isSameSize && [...selectedSet].every((id) => applicantSet.has(id));
    if (!isSameMember) {
      const msg = "휴가신청자와 사다리게임의 참여자가 다릅니다. 해당일 협의 신청자와 동일한 인원으로 다시 진행해 주세요.";
      setLadderMsg(msg);
      window.alert?.(msg);
      return;
    }
    const payload = {
      id: `lrg_${Date.now()}`,
      leaveDate,
      leaveType,
      participants: selected,
      order,
      createdBy: currentUserId,
      createdAt: new Date().toISOString(),
    };
    await createLadderResult(payload);
    await applyLadderResultToNegotiationOrder({
      leaveDate,
      leaveType,
      orderUserIds: order,
    });
    setLadderMsg("사다리 결과를 저장하고 달력 협의 순번에 자동 반영했습니다.");
    notifyDone("결과가 저장되었습니다.");
  }

  const svgMinH = narrowUi ? 260 : 420;

  useEffect(() => {
    const qs = new URLSearchParams(location.search || "");
    const autoRun = String(qs.get("autoRun") ?? "").trim() === "1";
    const autoSave = String(qs.get("autoSave") ?? "").trim() === "1";
    if (!autoRun) return;
    if (hasSavedForCurrentTarget) {
      setLadderMsg("이미 저장된 사다리 결과가 있어 자동 추첨을 건너뜁니다.");
      return;
    }
    if (manualOrderBlocksLadder) {
      setLadderMsg("협의 순번이 수기로 저장되어 자동 사다리를 건너뜁니다.");
      return;
    }
    if (!canRunLadderForTarget) return;
    const runKey = `${leaveDate}|${leaveType}|${location.search}`;
    if (autoRunDoneRef.current === runKey) return;
    if (!Array.isArray(ladderParticipantUserIds) || ladderParticipantUserIds.length < 2) return;
    autoRunDoneRef.current = runKey;
    const participants = [...ladderParticipantUserIds];
    setSelectedUserIds(participants);
    window.setTimeout(async () => {
      const spec = runLadder(participants);
      if (!spec || !Array.isArray(spec.order) || spec.order.length < 1) return;
      await playLadderAnimation(spec.order[0], spec);
      if (autoSave) {
        await saveResult({ selectedUserIdsOverride: participants, previewOrderOverride: spec.order });
      }
    }, 0);
  }, [location.search, leaveDate, leaveType, ladderParticipantUserIds, hasSavedForCurrentTarget, canRunLadderForTarget, manualOrderBlocksLadder]);

  function renderLadderSvg(spec) {
    if (!spec) return null;
    return (
      <svg
        className="ladder-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${140 + (spec.laneCount - 1) * 120} ${Math.max(svgMinH, spec.rowCount * 30 + 130)}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="사다리 애니메이션"
      >
        {spec.laneUsers.map((userId, lane) => {
          const x = 70 + lane * 120;
          const isActiveName = activeRunnerId === userId;
          return (
            <g
              key={`lane-${userId}`}
              onClick={() => void playLadderAnimation(userId, spec)}
              className={`ladder-name-chip${isActiveName ? " ladder-name-chip--active" : ""}`}
              style={{ cursor: animating ? "not-allowed" : "pointer", pointerEvents: animating ? "none" : "auto" }}
            >
              <rect className="ladder-name-chip-rect" x={x - 56} y={2} rx={10} ry={10} width={112} height={24} fill={isActiveName ? "#fee2e2" : "#f8fafc"} stroke="#111827" strokeWidth="1.5" />
              <text x={x} y={18} textAnchor="middle" fontSize="13" fill="#0f172a" fontWeight="700">
                {idToName.get(userId) ?? userId}
              </text>
            </g>
          );
        })}
        {Array.from({ length: spec.rowCount }, (_, r) =>
          spec.laneUsers.map((_, lane) => {
            const x = 70 + lane * 120;
            const y1 = 32 + r * 30;
            const y2 = y1 + 30;
            const k = `v-${r}-${lane}`;
            const active = Boolean(activePathKeys[k]);
            return <line key={`v-${r}-${lane}`} x1={x} y1={y1} x2={x} y2={y2} stroke={active ? "#dc2626" : "#111827"} strokeWidth={active ? 5 : 3} />;
          })
        )}
        {spec.links.map((row, r) =>
          row.map((on, c) => {
            if (!on) return null;
            const x1 = 70 + c * 120;
            const x2 = 70 + (c + 1) * 120;
            const y = 32 + (r + 1) * 30;
            const k = `h-${r}-${c}`;
            const active = Boolean(activePathKeys[k]);
            return <line key={`link-${r}-${c}`} x1={x1} y1={y} x2={x2} y2={y} stroke={active ? "#dc2626" : "#111827"} strokeWidth={active ? 5 : 3} />;
          })
        )}
        {runnerState ? (
          <g>
            <text x={70 + runnerState.lane * 120} y={32 + runnerState.row * 30 + 8} textAnchor="middle" fontSize="30" fill="#dc2626">
              ❤
            </text>
            <text
              x={70 + runnerState.lane * 120}
              y={32 + runnerState.row * 30 - 18}
              textAnchor="middle"
              fontSize="12"
              fill="#075985"
              fontWeight="700"
            >
              {idToName.get(runnerState.userId) ?? runnerState.userId}
            </text>
          </g>
        ) : null}
        {spec.order.map((userId, rank) => {
          const x = 70 + rank * 120;
          const y = 32 + spec.rowCount * 30 + 26;
          return (
            <g key={`rank-${userId}`}>
              <rect x={x - 58} y={y - 16} rx={10} ry={10} width={116} height={22} fill="#ffffff" stroke="#111827" strokeWidth="1.5" />
              <text x={x} y={y - 1} textAnchor="middle" fontSize="12.5" fill="#0f172a" fontWeight="700">
                {rank + 1}순위 {idToName.get(userId) ?? userId}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <section className="card ladder-page">
      <p className="help ladder-applicant-line">
        해당일 협의 신청자:{" "}
        {ladderParticipantUserIds.length > 0
          ? ladderParticipantUserIds.map((id) => idToName.get(id) ?? id).join(", ")
          : "없음"}
      </p>
      {manualOrderBlocksLadder && !hasSavedForCurrentTarget ? (
        <p className="help" style={{ marginTop: 8 }}>
          협의 대상자 중 수기로 순번이 입력된 경우 사다리를 사용할 수 없습니다.
        </p>
      ) : null}
      <div className="ladder-date-type-row ladder-date-type-row--compact ladder-date-type-row--inline">
        <label className="ladder-field ladder-field--date">
          <span className="field-label ladder-field-label">휴가일</span>
          <YmdSplitInput value={leaveDate} onChange={setLeaveDate} />
        </label>
        <label className="ladder-field ladder-field--type">
          <span className="field-label ladder-field-label">휴가 유형</span>
          <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
            <option value="GENERAL_PRIORITY">일반휴가-우선순위</option>
            <option value="GENERAL_NORMAL">일반휴가-후순위</option>
            <option value="GOLDKEY">골드키</option>
            <option value="HALF_DAY">반차</option>
          </select>
        </label>
      </div>

      <div className="ladder-participant-block ladder-participant-block--compact">
        <div className="ladder-participant-grid ladder-participant-grid--three">
          {nurseUsers.map((u) => (
            <label key={u.id} className="row ladder-participant-tile ladder-participant-tile--compact">
              <input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={() => toggleUser(u.id)} />
              <span>{u.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="ladder-toolbar ladder-toolbar--split">
        <button type="button" className="ladder-btn-run" onClick={runLadder} disabled={animating || hasSavedForCurrentTarget || !canRunLadderForTarget}>
          {hasSavedForCurrentTarget ? "사다리 완료" : animating ? "사다리 진행중..." : "사다리 실행"}
        </button>
        <button type="button" className="ladder-btn-save" onClick={() => void saveResult()} disabled={previewOrder.length < 2}>
          결과 저장
        </button>
      </div>

      {ladderModalOpen && ladderSpec ? (
        <div
          className="ladder-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLadderModal();
          }}
        >
          <div
            className="ladder-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ladder-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ladder-modal-header">
              <h3 id="ladder-modal-title" className="ladder-modal-title">
                사다리 추첨
              </h3>
              <button type="button" className="ladder-modal-close" onClick={closeLadderModal} aria-label="닫기">
                닫기
              </button>
            </div>
            <div className="ladder-modal-body">
              <p className="help ladder-modal-hint">위 이름을 누르면 해당 참가자의 사다리 이동 애니메이션이 재생됩니다.</p>
              <div className="ladder-svg-wrap ladder-svg-wrap--modal">{renderLadderSvg(ladderSpec)}</div>
              {previewOrder.length > 0 ? (
                <p className="help ladder-preview-line ladder-preview-line--modal">
                  순서: {previewOrder.map((id, idx) => `${idx + 1}.${idToName.get(id) ?? id}`).join(" → ")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {ladderMsg ? <p className="msg ladder-msg-inline">{ladderMsg}</p> : null}

      <details className="ladder-saved-details">
        <summary className="ladder-saved-summary">저장된 사다리 결과 보기</summary>
        <div className="table-wrap ladder-saved-table-wrap">
          <table>
            <thead>
              <tr>
                <th>제목</th>
                <th>결과</th>
                <th>저장시각</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(ladderResults) ? ladderResults : []).map((r) => (
                <tr key={r.id}>
                  <td>{`${r.leaveDate} ${leaveTypeLabel(r.leaveType)} 사다리 게임 결과`}</td>
                  <td>{(Array.isArray(r.order) ? r.order : []).map((id, idx) => `${idx + 1}순위 ${idToName.get(id) ?? id}`).join(" / ")}</td>
                  <td>{r.createdAt ? new Date(r.createdAt).toLocaleString("ko-KR") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

const CAL_YWHEEL_ITEM_PX = 44;
const CAL_YWHEEL_PAD_PX = (220 - CAL_YWHEEL_ITEM_PX) / 2;

/** 캘린더 연·월 — 휠 피커: 전체 화면 딤/레이어 없음(뒤 달린 그대로), 흰 시트만 고정 표시 */
function CalendarYearMonthWheelModal({ yearOptions, initialYear, initialMonth, onClose, onConfirm, onToday }) {
  const yearScrollRef = useRef(null);
  const monthScrollRef = useRef(null);
  const sheetRef = useRef(null);

  useEffect(() => {
    let removeDocListener = () => {};
    const rafId = requestAnimationFrame(() => {
      function onPointerDown(e) {
        if (!sheetRef.current || sheetRef.current.contains(e.target)) return;
        onClose();
      }
      document.addEventListener("pointerdown", onPointerDown, true);
      removeDocListener = () => document.removeEventListener("pointerdown", onPointerDown, true);
    });
    return () => {
      cancelAnimationFrame(rafId);
      removeDocListener();
    };
  }, [onClose]);

  useLayoutEffect(() => {
    let yi = yearOptions.indexOf(initialYear);
    if (yi < 0) {
      const ge = yearOptions.findIndex((y) => y >= initialYear);
      yi = ge >= 0 ? ge : Math.max(0, yearOptions.length - 1);
    }
    const mi = Math.max(0, Math.min(11, initialMonth - 1));
    const ys = yearScrollRef.current;
    const ms = monthScrollRef.current;
    if (ys) ys.scrollTop = yi * CAL_YWHEEL_ITEM_PX;
    if (ms) ms.scrollTop = mi * CAL_YWHEEL_ITEM_PX;
  }, [yearOptions, initialYear, initialMonth]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleConfirm() {
    const ys = yearScrollRef.current;
    const ms = monthScrollRef.current;
    const yi = ys
      ? Math.max(0, Math.min(yearOptions.length - 1, Math.round(ys.scrollTop / CAL_YWHEEL_ITEM_PX)))
      : 0;
    const mi = ms ? Math.max(0, Math.min(11, Math.round(ms.scrollTop / CAL_YWHEEL_ITEM_PX))) : 0;
    onConfirm(yearOptions[yi], mi + 1);
  }

  return createPortal(
    <div ref={sheetRef} className="ym-wheel-modal__sheet ym-wheel-modal__sheet--solo" role="dialog" aria-label="연·월 선택">
        <div className="ym-wheel-columns">
          <div className="ym-wheel-col">
            <div className="ym-wheel-highlight" aria-hidden />
            <div className="ym-wheel-scroll" ref={yearScrollRef}>
              <div className="ym-wheel-padding" style={{ height: CAL_YWHEEL_PAD_PX }} aria-hidden />
              {yearOptions.map((yr) => (
                <div key={yr} className="ym-wheel-item">
                  {yr}년
                </div>
              ))}
              <div className="ym-wheel-padding" style={{ height: CAL_YWHEEL_PAD_PX }} aria-hidden />
            </div>
          </div>
          <div className="ym-wheel-col">
            <div className="ym-wheel-highlight" aria-hidden />
            <div className="ym-wheel-scroll" ref={monthScrollRef}>
              <div className="ym-wheel-padding" style={{ height: CAL_YWHEEL_PAD_PX }} aria-hidden />
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <div key={m} className="ym-wheel-item">
                  {m}월
                </div>
              ))}
              <div className="ym-wheel-padding" style={{ height: CAL_YWHEEL_PAD_PX }} aria-hidden />
            </div>
          </div>
        </div>
        <div className="ym-wheel-footer">
          <button type="button" className="ym-wheel-today" onClick={onToday}>
            today
          </button>
          <button type="button" className="ym-wheel-check" onClick={handleConfirm} aria-label="확인">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
    </div>,
    document.getElementById("root") ?? document.body
  );
}

/** 달력 신청 현황: 협의 후 순번 입력 (blur 시 저장) */
function NegotiationOrderInput({ request, onCommit, disabled }) {
  const v = request.negotiationOrder ?? request.negotiation_order;
  const [val, setVal] = useState(v != null ? String(v) : "");
  useEffect(() => {
    setVal(v != null ? String(v) : "");
  }, [request.id, v]);
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={3}
      className="negotiation-order-input"
      disabled={disabled}
      value={val}
      onChange={(e) => setVal(e.target.value.replace(/\D/g, "").slice(0, 3))}
      onBlur={() => onCommit(request.id, val)}
      aria-label="협의 순번"
      placeholder=""
      title="협의 후 순번(1~999). 비우면 미정입니다."
    />
  );
}

function CalendarPage({
  calendarMonth,
  setCalendarMonth,
  calendarData,
  selectedYmd,
  setSelectedYmd,
  dayRequests,
  users,
  leaveType,
  setLeaveType,
  leaveNature,
  setLeaveNature,
  leaveDate,
  setLeaveDate,
  memo,
  setMemo,
  submitRequest,
  myGoldkey,
  message,
  isAdmin,
  canEditHolidayDuty,
  currentUserId,
  saveNegotiationOrder,
  holidayDuties,
  saveHolidayDuty,
  selectRequest,
  unselectRequest,
  rejectRequest,
  substituteAssignments,
  saveSubstituteForApprovedRequest,
  adminDayMemos,
  saveAdminDayMemo,
  dayComments,
  createDayComment,
  updateDayComment,
  deleteDayComment,
  ladderResults,
  cancelRequest,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [detailTab, setDetailTab] = useState("list");
  const [ymModalOpen, setYmModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const CALENDAR_DAY_CHIP_MAX = 4;

  useEffect(() => {
    if (!selectedYmd) return;
    setLeaveDate(selectedYmd);
  }, [selectedYmd, setLeaveDate]);

  useEffect(() => {
    if (!selectedYmd) {
      setDetailModalOpen(false);
    }
  }, [selectedYmd]);

  /** 알림·푸시에서 /calendar?ymd=&detail=1 로 진입 시 해당 날짜 상세 모달을 연다 */
  useEffect(() => {
    if (location.pathname !== "/calendar") return;
    const sp = new URLSearchParams(location.search ?? "");
    if (sp.get("detail") !== "1") return;
    const ymd = String(sp.get("ymd") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    if (String(selectedYmd ?? "") !== ymd) return;

    const focus = String(sp.get("focus") ?? "").trim();
    setDetailModalOpen(true);
    setDetailTab("list");
    navigate(`/calendar?ymd=${encodeURIComponent(ymd)}`, { replace: true });

    if (focus === "comments" || focus === "memo") {
      window.setTimeout(() => {
        const body = document.querySelector(".calendar-detail-modal-body");
        const sel =
          focus === "comments" ? "[data-calendar-scroll-target=\"comments\"]" : "[data-calendar-scroll-target=\"duty-memo\"]";
        body?.querySelector(sel)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 280);
    }
  }, [location.pathname, location.search, selectedYmd, navigate]);

  const selectedCell = selectedYmd ? calendarData.find((c) => c.date === selectedYmd) : null;
  const nurseUsers = users.filter((u) => u.role === "NURSE").sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const anesthesiaUsers = users.filter((u) => u.role === "ANESTHESIA");

  const selectedHolidayDuty = selectedYmd ? holidayDuties?.[selectedYmd] : null;
  const [duty1UserId, setDuty1UserId] = useState(selectedHolidayDuty?.nurse1UserId ?? "");
  const [duty2UserId, setDuty2UserId] = useState(selectedHolidayDuty?.nurse2UserId ?? "");
  const [anesthesiaDutyUserId, setAnesthesiaDutyUserId] = useState(selectedHolidayDuty?.anesthesiaUserId ?? "");
  const [adminMemoDraft, setAdminMemoDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [editingCommentId, setEditingCommentId] = useState("");
  const [editingCommentDraft, setEditingCommentDraft] = useState("");
  const [calendarSubRows, setCalendarSubRows] = useState([]);
  const calendarSwipeRef = useRef({ startX: 0, startY: 0, tracking: false, triggered: false });
  const skipNextCalendarTapRef = useRef(false);
  const calendarTopRef = useRef(null);

  useEffect(() => {
    if (!selectedYmd || !selectedCell?.isOffDay) {
      setDuty1UserId("");
      setDuty2UserId("");
      setAnesthesiaDutyUserId("");
      return;
    }
    const d = holidayDuties?.[selectedYmd];
    setDuty1UserId(d?.nurse1UserId ?? "");
    setDuty2UserId(d?.nurse2UserId ?? "");
    setAnesthesiaDutyUserId(d?.anesthesiaUserId ?? "");
  }, [selectedYmd, selectedCell?.isOffDay, holidayDuties]);

  useEffect(() => {
    if (!selectedYmd) {
      setAdminMemoDraft("");
      return;
    }
    setAdminMemoDraft(adminDayMemos?.[selectedYmd] ?? "");
  }, [selectedYmd, adminDayMemos]);

  useEffect(() => {
    setCommentDraft("");
    setEditingCommentId("");
    setEditingCommentDraft("");
  }, [selectedYmd]);

  const calendarSubTargetRequests = useMemo(() => {
    if (!selectedYmd) return [];
    const rows = (Array.isArray(dayRequests) ? dayRequests : []).filter(
      (r) => String(r.leaveDate ?? "").slice(0, 10) === selectedYmd && r.status !== "CANCELLED"
    );
    if (rows.length === 0) return [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const targetIds = new Set(rows.filter((r) => r.status === "APPLIED" || isWinnerStatus(r.status)).map((r) => r.id));
    for (const s of Array.isArray(substituteAssignments) ? substituteAssignments : []) {
      if (String(s.leaveDate ?? "").slice(0, 10) !== selectedYmd) continue;
      const reqId = String(s.requestId ?? "");
      if (reqId && byId.has(reqId)) targetIds.add(reqId);
    }
    return rows.filter((r) => targetIds.has(r.id));
  }, [selectedYmd, dayRequests, substituteAssignments]);

  useEffect(() => {
    if (!selectedYmd) {
      setCalendarSubRows([]);
      return;
    }
    const targets = calendarSubTargetRequests;
    if (targets.length === 0) {
      // 휴가 신청 대상이 없는 날짜도 관리자가 박스를 볼 수 있게 기본 1행 표시
      setCalendarSubRows([{ rowId: `cal_sub_empty_${selectedYmd}`, requestId: "", substituteUserId: "", shiftCode: "" }]);
      return;
    }

    // 저장된 대체자가 있으면 모두 다시 보여주고,
    // 없을 때만 기본 1박스(대체인력1)만 노출한다.
    const restored = [];
    for (const t of targets) {
      const recs = getSubstituteRecordsForRequest(substituteAssignments, t.id);
      if (!Array.isArray(recs) || recs.length === 0) continue;
      for (let idx = 0; idx < recs.length; idx += 1) {
        const s = recs[idx];
        restored.push({
          rowId: `cal_sub_${t.id}_${idx}`,
          requestId: t.id,
          substituteUserId: String(s?.substituteUserId ?? ""),
          shiftCode: (() => {
            const rawShift = String(s?.shiftCode ?? "");
            if (!rawShift) return "";
            return WORK_SCHEDULE_OPTION_SET.has(rawShift) ? rawShift : toCustomShiftCode(rawShift);
          })(),
        });
      }
    }
    if (restored.length > 0) {
      setCalendarSubRows(restored);
      return;
    }

    const firstTarget = targets[0];
    setCalendarSubRows([
      {
        rowId: `cal_sub_${firstTarget.id}_0`,
        requestId: firstTarget.id,
        substituteUserId: "",
        shiftCode: "",
      },
    ]);
  }, [selectedYmd, calendarSubTargetRequests, substituteAssignments]);

  const selectedDayComments = useMemo(() => {
    if (!selectedYmd) return [];
    return (Array.isArray(dayComments) ? dayComments : [])
      .filter((row) => row.targetDate === selectedYmd)
      .slice()
      .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  }, [dayComments, selectedYmd]);

  /**
   * 같은 휴가일·같은 유형 기준 협의/신청순 판정.
   * - 일반휴가(우선/후순위): 2명 이상이면 협의.
   * - 골드키: 4·10월 장기 모집 제출분은 협의(다인 시). 그 외는 최초 신청 시각 기준 24시간 이내=협의, 이후=신청순 자동.
   */
  const negotiationMetaByRequestId = useMemo(() => {
    const map = new Map();
    if (!selectedYmd) return map;
    const todayYmd = toLocalYMD(new Date());
    const active = dayRequests.filter((r) => r.leaveDate === selectedYmd && r.status !== "CANCELLED");
    const byType = new Map();
    for (const r of active) {
      if (!byType.has(r.leaveType)) byType.set(r.leaveType, []);
      byType.get(r.leaveType).push(r);
    }
    for (const [, list] of byType) {
      if (list.length === 1) {
        const only = list[0];
        if (only.leaveType === "GENERAL_NORMAL" && String(only.leaveDate ?? "").slice(0, 10) > todayYmd) {
          map.set(only.id, { mode: "negotiate" });
          continue;
        }
        map.set(only.id, { mode: "single" });
        continue;
      }
      const sortedAll = [...list].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
      const leaveMonth = Number(String(list[0]?.leaveDate ?? "").slice(5, 7));
      const goldkeyAnchorMs = list[0]?.leaveType === "GOLDKEY" ? goldkeyAnchorRequestedAtMs(list) : NaN;
      for (const r of list) {
        if (r.leaveType === "GENERAL_PRIORITY") {
          map.set(r.id, { mode: "negotiate" });
          continue;
        }
        if (r.leaveType === "GENERAL_NORMAL") {
          map.set(r.id, { mode: "negotiate" });
          continue;
        }
        if (r.leaveType === "GOLDKEY") {
          const autoRankGlobal = sortedAll.findIndex((x) => x.id === r.id) + 1;
          const forceKey = `${String(r.leaveDate ?? "")}|${String(r.userId ?? "")}`;
          if (FORCE_GOLDKEY_NEGOTIATION_KEYS.has(forceKey)) {
            map.set(r.id, { mode: "negotiate" });
            continue;
          }
          if (leaveMonth >= 1 && leaveMonth <= 6) {
            if (isFirstHalfGoldkeyOctoberConsultationRequest(r)) {
              map.set(r.id, { mode: "negotiate" });
            } else {
              map.set(
                r.id,
                isGoldkeyWithin24HoursAfterAnchor(goldkeyAnchorMs, r.requestedAt)
                  ? { mode: "negotiate" }
                  : { mode: "auto", autoRank: autoRankGlobal }
              );
            }
            continue;
          }
          if (leaveMonth >= 7 && leaveMonth <= 12) {
            if (isSecondHalfGoldkeyAprilConsultationRequest(r)) {
              map.set(r.id, { mode: "negotiate" });
            } else {
              map.set(
                r.id,
                isGoldkeyWithin24HoursAfterAnchor(goldkeyAnchorMs, r.requestedAt)
                  ? { mode: "negotiate" }
                  : { mode: "auto", autoRank: autoRankGlobal }
              );
            }
            continue;
          }
          map.set(
            r.id,
            isGoldkeyWithin24HoursAfterAnchor(goldkeyAnchorMs, r.requestedAt)
              ? { mode: "negotiate" }
              : { mode: "auto", autoRank: autoRankGlobal }
          );
          continue;
        }
        const myDay = toLocalYMD(new Date(r.requestedAt));
        const sameSubmitDayPeers = list.filter((x) => toLocalYMD(new Date(x.requestedAt)) === myDay);
        const autoRankGlobal = sortedAll.findIndex((x) => x.id === r.id) + 1;
        if (sameSubmitDayPeers.length >= 2) {
          map.set(r.id, { mode: "negotiate" });
        } else {
          map.set(r.id, { mode: "auto", autoRank: autoRankGlobal });
        }
      }
    }
    for (const r of dayRequests) {
      if (r.leaveDate === selectedYmd && r.status === "CANCELLED") {
        map.set(r.id, { mode: "cancelled" });
      }
    }
    return map;
  }, [selectedYmd, dayRequests]);

  const quickLadderTargets = useMemo(() => {
    const byType = new Map();
    for (const r of dayRequests || []) {
      const meta = negotiationMetaByRequestId.get(r.id);
      if (!meta || meta.mode !== "negotiate" || r.status !== "APPLIED") continue;
      const k = `${r.leaveDate}|${r.leaveType}`;
      if (!byType.has(k)) byType.set(k, { leaveDate: r.leaveDate, leaveType: r.leaveType, count: 0 });
      byType.get(k).count += 1;
    }
    return [...byType.values()].filter((t) => t.count >= 2);
  }, [dayRequests, negotiationMetaByRequestId]);

  const ladderDoneKeySet = useMemo(() => {
    const set = new Set();
    for (const r of Array.isArray(ladderResults) ? ladderResults : []) {
      const d = String(r?.leaveDate ?? "").trim();
      const t = String(r?.leaveType ?? "").trim();
      if (!d || !t) continue;
      set.add(`${d}|${t}`);
    }
    return set;
  }, [ladderResults]);

  function moveCalendarMonth(offset) {
    const [yy, mm] = String(calendarMonth || "").split("-").map(Number);
    if (!Number.isInteger(yy) || !Number.isInteger(mm)) return;
    const d = new Date(yy, mm - 1, 1);
    d.setMonth(d.getMonth() + offset);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    setCalendarMonth(next);
  }

  function handleCalendarSwipeTouchStart(e) {
    const t = e.touches?.[0];
    if (!t) return;
    calendarSwipeRef.current = {
      startX: Number(t.clientX || 0),
      startY: Number(t.clientY || 0),
      tracking: true,
      triggered: false,
    };
  }

  function handleCalendarSwipeTouchMove(e) {
    const s = calendarSwipeRef.current;
    if (!s.tracking || s.triggered) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = Number(t.clientX || 0) - s.startX;
    const dy = Number(t.clientY || 0) - s.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX > absY && absX >= 12) {
      // 수평 스와이프 중 세로 흔들림(브라우저 기본 스크롤)을 막아 캘린더를 안정적으로 유지한다.
      e.preventDefault();
    }
    // 세로 스크롤과 충돌 방지: 가로 이동이 충분히 큰 경우만 월 이동
    if (absX >= 56 && absX > absY * 1.25) {
      moveCalendarMonth(dx < 0 ? 1 : -1);
      skipNextCalendarTapRef.current = true;
      calendarSwipeRef.current = { ...s, triggered: true, tracking: false };
    }
  }

  function handleCalendarSwipeTouchEnd() {
    calendarSwipeRef.current = { startX: 0, startY: 0, tracking: false, triggered: false };
  }

  function goToToday() {
    const n = new Date();
    const ym = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
    setCalendarMonth(ym);
    setSelectedYmd("");
    setDetailModalOpen(false);
  }

  function updateCalendarSubRow(rowId, key, value) {
    setCalendarSubRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [key]: value } : r)));
  }

  function removeCalendarSubRow(rowId) {
    setCalendarSubRows((prev) => {
      const next = (Array.isArray(prev) ? prev : []).filter((r) => r.rowId !== rowId);
      return next.length > 0 ? next : [{ rowId: `cal_sub_empty_${Date.now()}`, requestId: "", substituteUserId: "", shiftCode: "" }];
    });
  }

  function addCalendarSubRow() {
    const targets = calendarSubTargetRequests;
    if (!Array.isArray(calendarSubRows) || calendarSubRows.length === 0) {
      setCalendarSubRows([{ rowId: `cal_sub_empty_${Date.now()}`, requestId: "", substituteUserId: "", shiftCode: "" }]);
      return;
    }
    if (targets.length === 0) {
      setCalendarSubRows((prev) => [
        ...(Array.isArray(prev) ? prev : []),
        { rowId: `cal_sub_empty_${Date.now()}`, requestId: "", substituteUserId: "", shiftCode: "" },
      ]);
      return;
    }
    const nextTarget = targets[0];
    setCalendarSubRows((prev) => [
      ...prev,
      {
        rowId: `cal_sub_${nextTarget?.id ?? "empty"}_${Date.now()}`,
        requestId: nextTarget?.id ?? "",
        substituteUserId: "",
        shiftCode: "",
      },
    ]);
  }

  async function applyCalendarSubRow(row) {
    const requestId = String(row?.requestId ?? "");
    if (!requestId) {
      window.alert?.("해당 날짜의 휴가 신청 대상이 없어 저장할 수 없습니다.");
      return;
    }
    const target = (Array.isArray(dayRequests) ? dayRequests : []).find((r) => r.id === requestId);
    if (!target) return;
    const groupedRows = (Array.isArray(calendarSubRows) ? calendarSubRows : []).filter(
      (r) => String(r?.requestId ?? "") === requestId
    );
    const items = groupedRows
      .map((r) => ({
        substituteUserId: String(r?.substituteUserId ?? "").trim(),
        shiftCode: normalizeShiftCodeForSave(r?.shiftCode),
      }))
      .filter((it) => it.substituteUserId && it.shiftCode);
    if (target.status === "APPLIED") {
      await selectRequest(requestId, { substituteItems: items });
      return;
    }
    if (isWinnerStatus(target.status)) {
      await saveSubstituteForApprovedRequest(requestId, { substituteItems: items });
    }
  }

  const calendarYMParts = useMemo(() => {
    const [yy, mm] = String(calendarMonth || "").split("-");
    let y = parseInt(yy, 10);
    let m = parseInt(mm, 10);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      const n = new Date();
      y = n.getFullYear();
      m = n.getMonth() + 1;
    }
    return { y, mPad: String(m).padStart(2, "0") };
  }, [calendarMonth]);

  const calendarYearOptions = useMemo(() => {
    const cy = calendarYMParts.y;
    const nowY = new Date().getFullYear();
    const from = Math.min(2018, nowY - 12, cy - 4);
    const to = Math.max(2040, nowY + 10, cy + 4);
    const lo = Math.min(from, cy);
    const hi = Math.max(to, cy);
    const list = [];
    for (let yr = lo; yr <= hi; yr += 1) list.push(yr);
    return list;
  }, [calendarYMParts.y]);

  return (
    <section className="card calendar-page-card">
      <div className="calendar-page">
        <div
          ref={calendarTopRef}
          className="calendar-page__top"
          onTouchStart={handleCalendarSwipeTouchStart}
          onTouchMove={handleCalendarSwipeTouchMove}
          onTouchEnd={handleCalendarSwipeTouchEnd}
        >
      <div className="calendar-nav" role="navigation" aria-label="달력 월 이동">
        <div className="calendar-nav-month-row">
          <button type="button" className="calendar-nav-btn" onClick={() => moveCalendarMonth(-1)} aria-label="이전 달">
            ‹
          </button>
          <button
            type="button"
            className="calendar-nav-month-trigger"
            onClick={() => setYmModalOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={ymModalOpen}
            aria-label={`연·월 선택, 현재 ${calendarYMParts.y}년 ${parseInt(calendarYMParts.mPad, 10)}월`}
          >
            <span className="calendar-nav-month-trigger__label">
              {calendarYMParts.y}년 {parseInt(calendarYMParts.mPad, 10)}월
            </span>
          </button>
          <button type="button" className="calendar-nav-btn" onClick={() => moveCalendarMonth(1)} aria-label="다음 달">
            ›
          </button>
        </div>
      </div>
      {ymModalOpen ? (
        <CalendarYearMonthWheelModal
          yearOptions={calendarYearOptions}
          initialYear={calendarYMParts.y}
          initialMonth={parseInt(calendarYMParts.mPad, 10)}
          onClose={() => setYmModalOpen(false)}
          onConfirm={(y, m) => {
            setCalendarMonth(`${y}-${String(m).padStart(2, "0")}`);
            setYmModalOpen(false);
          }}
          onToday={() => {
            goToToday();
            setYmModalOpen(false);
          }}
        />
      ) : null}
      <div className="calendar">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <div key={d} className="calendar-head">
            {d}
          </div>
        ))}
        {calendarData.map((cell, idx) => {
          const isToday = cell.inMonth && cell.date === toLocalYMD(new Date());
          const isSel = cell.inMonth && selectedYmd === cell.date;
          const duty = holidayDuties?.[cell.date];
          const hasDuty = Boolean(
            cell.isOffDay &&
              duty &&
              String(duty.nurse1UserId ?? "").trim() &&
              String(duty.nurse2UserId ?? "").trim() &&
              String(duty.anesthesiaUserId ?? "").trim()
          );
          const isMyDuty =
            Boolean(currentUserId) &&
            hasDuty &&
            (duty?.nurse1UserId === currentUserId || duty?.nurse2UserId === currentUserId || duty?.anesthesiaUserId === currentUserId);
          const myDutyClass = isMyDuty ? " calendar-cell--my-duty" : "";
          return (
            <div
              key={`${cell.date}-${idx}`}
              role="button"
              tabIndex={0}
              className={`calendar-cell calendar-cell--clickable ${cell.inMonth ? "" : "muted"}${myDutyClass}${isToday ? " calendar-cell--today" : ""}${isSel ? " calendar-cell--selected" : ""}`}
              onClick={() => {
                if (skipNextCalendarTapRef.current) {
                  skipNextCalendarTapRef.current = false;
                  return;
                }
                setSelectedYmd(cell.date);
                setLeaveDate(cell.date);
                setDetailTab("list");
                setDetailModalOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedYmd(cell.date);
                  setLeaveDate(cell.date);
                  setDetailTab("list");
                  setDetailModalOpen(true);
                }
              }}
            >
              <div className={`calendar-date${cell.isOffDay ? " calendar-date--holiday" : ""}`}>{cell.day}</div>
              {cell.inMonth && Array.isArray(cell.displayApplicants) && cell.displayApplicants.length > 0 ? (
                <div className="calendar-cell-events">
                  {cell.displayApplicants.slice(0, CALENDAR_DAY_CHIP_MAX).map((a) => {
                    const nameLen = [...String(a.name ?? "")].length;
                    const name3 = nameLen === 3 ? " calendar-day-chip--name3" : "";
                    return (
                      <span
                        key={a.id}
                        className={`calendar-day-chip ${buildLeaveChipClass(a.leaveType, a.status)}${name3}`}
                        title={`${a.name} · ${typeFullLabel(a.leaveType)} · ${statusLabel(a.status)}`}
                      >
                        <span className="calendar-day-chip__text">{a.name}</span>
                      </span>
                    );
                  })}
                  {cell.displayApplicants.length > CALENDAR_DAY_CHIP_MAX ? (
                    <span className="calendar-chip-more" title={`외 ${cell.displayApplicants.length - CALENDAR_DAY_CHIP_MAX}명`}>
                      +{cell.displayApplicants.length - CALENDAR_DAY_CHIP_MAX}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
        </div>

        {detailModalOpen ? (
          <div
            className="calendar-detail-modal-backdrop"
            onClick={() => {
              setDetailModalOpen(false);
              setSelectedYmd("");
            }}
          />
        ) : null}
        <div className={`calendar-page__detail${detailModalOpen ? " calendar-page__detail--modal" : ""}`}>
      <div className={detailModalOpen ? "calendar-detail-modal-body" : undefined}>
      <div className="calendar-detail">
        {!selectedYmd ? null : (
          <>
            <h3 className="calendar-detail-title">{selectedYmd} 상세</h3>
              {canEditHolidayDuty && selectedCell?.isOffDay ? (
                <section className="holiday-duty-panel">
                  <h4 className="holiday-duty-title">휴일 당직자 기록 (주말·공휴·대체공휴일·명절)</h4>
                  <div className="row wrap holiday-duty-grid">
                    <div className="holiday-duty-field">
                      <label className="field-label">당직자 1</label>
                      <select value={duty1UserId} onChange={(e) => setDuty1UserId(e.target.value)}>
                        <option value="">선택</option>
                        {nurseUsers
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="holiday-duty-field">
                      <label className="field-label">당직자 2</label>
                      <select value={duty2UserId} onChange={(e) => setDuty2UserId(e.target.value)}>
                        <option value="">선택</option>
                        {nurseUsers
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                          .map((u) => (
                            <option key={u.id} value={u.id} disabled={u.id === duty1UserId}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="holiday-duty-action">
                      <div className="holiday-duty-field">
                        <label className="field-label">마취과 당직자</label>
                        <select value={anesthesiaDutyUserId} onChange={(e) => setAnesthesiaDutyUserId(e.target.value)}>
                          <option value="">선택</option>
                          {anesthesiaUsers
                            .slice()
                            .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                    <div className="holiday-duty-action">
                      <button
                        type="button"
                        onClick={() => void saveHolidayDuty(selectedYmd, duty1UserId, duty2UserId, anesthesiaDutyUserId)}
                        disabled={!duty1UserId || !duty2UserId || !anesthesiaDutyUserId}
                        aria-label="공휴일 당직자 저장"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                  {(!duty1UserId || !duty2UserId || !anesthesiaDutyUserId) && (
                    <p className="help">수술실 당직자 2명 + 마취과 당직자 1명을 선택한 뒤 저장해 주세요.</p>
                  )}
                </section>
              ) : null}
              {selectedCell?.isOffDay ? (
                <p className="help" style={{ marginTop: 10 }}>
                  이 날짜는 휴일(공휴일/주말)로 휴가 신청을 받지 않습니다.
                </p>
              ) : (
                <>
                  <div className="calendar-detail-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={detailTab === "list"}
                      className={detailTab === "list" ? "calendar-tab calendar-tab--active" : "calendar-tab"}
                      onClick={() => setDetailTab("list")}
                    >
                      신청 현황
                    </button>
                    {!isAdmin ? (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={detailTab === "apply"}
                        className={detailTab === "apply" ? "calendar-tab calendar-tab--active" : "calendar-tab"}
                        onClick={() => {
                          setDetailTab("apply");
                          if (selectedYmd) setLeaveDate(selectedYmd);
                        }}
                      >
                        휴가 신청
                      </button>
                    ) : null}
                  </div>
                  {detailTab === "list" || isAdmin ? (
                    <div className="calendar-detail-body" role="tabpanel">
                      {dayRequests.length === 0 ? (
                        <p className="help">이 날짜에 등록된 신청이 없습니다.</p>
                      ) : (
                        <>
                          {quickLadderTargets.length > 0 ? (
                            <div className="calendar-ladder-quick-bar">
                              {quickLadderTargets.map((t) => (
                                (() => {
                                  const key = `${String(t.leaveDate ?? "")}|${String(t.leaveType ?? "")}`;
                                  const isDone = ladderDoneKeySet.has(key);
                                  const manualBlock = manualNegotiationOrderBlocksLadder(dayRequests, t.leaveDate, t.leaveType, ladderResults);
                                  return (
                                <button
                                  key={`${t.leaveDate}-${t.leaveType}`}
                                  type="button"
                                  className="calendar-ladder-quick-btn"
                                  disabled={isDone || manualBlock}
                                  title={
                                    manualBlock
                                      ? "수기로 순번이 저장되어 사다리를 사용할 수 없습니다."
                                      : undefined
                                  }
                                  onClick={() =>
                                    navigate(
                                      `/ladder?leaveDate=${encodeURIComponent(String(t.leaveDate ?? ""))}&leaveType=${encodeURIComponent(
                                        String(t.leaveType ?? "")
                                      )}&autoRun=1&autoSave=1&from=calendar`
                                    )
                                  }
                                >
                                  {isDone
                                    ? `${typeFullLabel(t.leaveType)} 사다리 완료`
                                    : manualBlock
                                      ? `${typeFullLabel(t.leaveType)} 사다리 불가`
                                      : `${typeFullLabel(t.leaveType)} 사다리`}
                                </button>
                                  );
                                })()
                              ))}
                            </div>
                          ) : null}
                          <ul className="calendar-applicant-list">
                            {dayRequests.map((r) => {
                              const nm = users.find((u) => u.id === r.userId)?.name ?? r.userId;
                              const meta = negotiationMetaByRequestId.get(r.id) ?? { mode: "single" };
                              const ord = r.negotiationOrder ?? r.negotiation_order;
                              const isNegotiate = meta.mode === "negotiate";
                              const isAuto = meta.mode === "auto";
                              const isCancelledRow = meta.mode === "cancelled";
                              const autoRank = meta.mode === "auto" ? meta.autoRank : null;
                              const orderLocked = isNegotiationOrderInputLocked(r, ladderDoneKeySet);
                              const showModePill = isNegotiate || isAuto;
                              let prefix = "";
                              if (isAuto && autoRank != null) prefix = `${autoRank}. `;
                              else if (isNegotiate && ord != null && ord !== "") prefix = `${ord}. `;
                              else if (meta.mode === "single" && ord != null && ord !== "") prefix = `${ord}. `;

                              const adminTopText = `${prefix}${nm} · ${typeFullLabel(r.leaveType)}`;
                              const adminBottomText = `${leaveNatureLabel(r.leaveNature)} · ${statusLabel(r.status)}`;
                              const lineText = isAdmin
                                ? `${adminTopText} · ${adminBottomText}`
                                : `${prefix}${nm} · ${typeFullLabel(r.leaveType)} · ${statusLabel(r.status)}`;
                              const pastLeaveNoCancel = isLeaveDateBeforeTodayKst(normalizeLeaveDateStr(r.leaveDate));
                              return (
                                <li
                                  key={r.id}
                                  className={`calendar-applicant-item calendar-applicant-item--row${isAdmin ? " calendar-applicant-item--admin" : ""}${r.status === "REJECTED" ? " calendar-applicant-item--rejected" : ""}`}
                                >
                                  <div className="negotiation-order-cell">
                                    {isNegotiate && r.status !== "CANCELLED" ? (
                                      orderLocked ? (
                                        <span className="negotiation-order-readonly" title="협의 순번 확정(수정 불가)">
                                          {ord != null && ord !== "" ? ord : "—"}
                                        </span>
                                      ) : (
                                        <NegotiationOrderInput request={r} disabled={false} onCommit={saveNegotiationOrder} />
                                      )
                                    ) : isAuto && r.status !== "CANCELLED" && autoRank != null ? (
                                      <span className="negotiation-order-readonly" title="신청 순서(수정 불가)">
                                        {autoRank}
                                      </span>
                                    ) : isAuto ? (
                                      <span className="negotiation-order-readonly negotiation-order-readonly--muted">—</span>
                                    ) : isCancelledRow || r.status === "CANCELLED" ? (
                                      <span className="negotiation-order-readonly negotiation-order-readonly--muted">—</span>
                                    ) : (
                                      <span className="negotiation-order-placeholder" aria-hidden />
                                    )}
                                  </div>
                                  {showModePill ? (
                                    <span className={`negotiation-mode-pill ${isAuto ? "negotiation-mode-pill--auto" : ""}`}>
                                      {isNegotiate ? "협의" : "신청순"}
                                    </span>
                                  ) : null}
                                  <span
                                    className={`calendar-applicant-name ${buildLeaveChipClass(r.leaveType, r.status)}`}
                                    title={lineText}
                                  >
                                    {isAdmin ? (
                                      <>
                                        <span className="admin-applicant-line admin-applicant-line--top">{adminTopText}</span>
                                        <span className="admin-applicant-line admin-applicant-line--bottom">{adminBottomText}</span>
                                      </>
                                    ) : (
                                      lineText
                                    )}
                                  </span>
                                  {isAdmin && r.status === "APPLIED" ? (
                                    <div className="admin-calendar-applicant-actions">
                                      <button type="button" className="admin-calendar-btn admin-calendar-btn--approve" onClick={() => void selectRequest(r.id, {})}>
                                        확정
                                      </button>
                                      <button type="button" className="admin-calendar-btn admin-calendar-btn--reject" onClick={() => void rejectRequest(r.id)}>
                                        반려
                                      </button>
                                    </div>
                                  ) : null}
                                  {isAdmin && isWinnerStatus(r.status) ? (
                                    <div className="admin-calendar-applicant-actions">
                                      <button type="button" className="admin-calendar-btn admin-calendar-btn--reject" onClick={() => void unselectRequest(r.id)}>
                                        휴가확정취소
                                      </button>
                                    </div>
                                  ) : null}
                                  {!isAdmin && r.status === "APPLIED" && r.userId === currentUserId ? (
                                    <div className="admin-calendar-applicant-actions">
                                      <button
                                        type="button"
                                        className="admin-calendar-btn admin-calendar-btn--reject"
                                        disabled={Boolean(r.cancelLocked) || pastLeaveNoCancel}
                                        title={pastLeaveNoCancel ? "휴가일이 지난 신청은 취소할 수 없습니다." : undefined}
                                        onClick={() => void cancelRequest(r.id)}
                                      >
                                        {r.cancelLocked ? "취소 처리됨" : "취소"}
                                      </button>
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                      {isAdmin ? (
                        <div className="admin-calendar-substitute-section">
                          <h4 className="admin-calendar-substitute-title">대체 근무 지정</h4>
                          <p className="help admin-calendar-substitute-lead">
                            휴가자 선택 없이 대체 인력/번표만 입력 후 저장합니다.
                          </p>
                          {calendarSubTargetRequests.length === 0 ? (
                            <p className="help admin-calendar-substitute-lead">해당 날짜에 연결할 휴가 신청 대상이 없어 저장은 불가합니다.</p>
                          ) : null}
                          <div className="admin-calendar-substitute-stack">
                            {calendarSubRows.map((row, idx) => (
                              <div key={row.rowId} className="admin-calendar-sub-bulk-row">
                                <span className="admin-calendar-sub-bulk-label">대체 인력 {idx + 1}</span>
                                <select
                                  value={row.substituteUserId}
                                  onChange={(e) => updateCalendarSubRow(row.rowId, "substituteUserId", e.target.value)}
                                >
                                  <option value="">대체자 선택</option>
                                  {nurseUsers.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.name}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={isCustomShiftCodeValue(row.shiftCode) ? CUSTOM_SHIFT_SENTINEL : row.shiftCode}
                                  onChange={(e) => {
                                    const next = String(e.target.value ?? "");
                                    if (next === CUSTOM_SHIFT_SENTINEL) {
                                      updateCalendarSubRow(row.rowId, "shiftCode", toCustomShiftCode(customShiftText(row.shiftCode)));
                                      return;
                                    }
                                    updateCalendarSubRow(row.rowId, "shiftCode", next);
                                  }}
                                >
                                  <option value="">대체 근무 번표</option>
                                  {WORK_SCHEDULE_OPTIONS.filter((x) => x).map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                  <option value={CUSTOM_SHIFT_SENTINEL}>직접입력</option>
                                </select>
                                {isCustomShiftCodeValue(row.shiftCode) ? (
                                  <input
                                    type="text"
                                    placeholder="예: 3 9-5"
                                    value={customShiftText(row.shiftCode)}
                                    onChange={(e) => updateCalendarSubRow(row.rowId, "shiftCode", toCustomShiftCode(e.target.value))}
                                  />
                                ) : null}
                                <button type="button" onClick={() => void applyCalendarSubRow(row)}>
                                  저장
                                </button>
                                <button type="button" onClick={() => removeCalendarSubRow(row.rowId)}>
                                  삭제
                                </button>
                              </div>
                            ))}
                            <button type="button" onClick={addCalendarSubRow}>
                              대체 인력 추가
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="calendar-detail-body calendar-detail-body--apply" role="tabpanel">
                      <p className="help">선택한 날짜: {selectedYmd} (아래에서 연·월·일을 바꿀 수 있습니다)</p>
                      <form className="grid calendar-apply-form" onSubmit={submitRequest}>
                        <label className="field-label">휴가 종류</label>
                        <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} aria-label="휴가 종류">
                          <option value="GOLDKEY">골드키</option>
                          <option value="GENERAL_PRIORITY">일반휴가-우선순위</option>
                          <option value="GENERAL_NORMAL">일반휴가-후순위</option>
                          <option value="HALF_DAY">반차</option>
                        </select>
                        <label className="field-label">휴가 성격</label>
                        <select value={leaveNature} onChange={(e) => setLeaveNature(e.target.value)} aria-label="휴가 성격">
                          <option value="PERSONAL">개인휴가</option>
                          <option value="PAID_TRAINING">보수교육공가</option>
                          <option value="REQUIRED_TRAINING">필수교육</option>
                        </select>
                        <div className="calendar-apply-ymd">
                          <span className="help">휴가일</span>
                          <YmdSplitInput value={leaveDate} onChange={setLeaveDate} />
                        </div>
                        <input type="text" placeholder="신청 메모" value={memo} onChange={(e) => setMemo(e.target.value)} />
                        <button type="submit">신청</button>
                      </form>
                      <p className="help">내 골드키 잔여: {myGoldkey?.remainingCount ?? 0} / {myGoldkey?.quotaTotal ?? 0}</p>
                      {message ? <p className="msg">{message}</p> : null}
                    </div>
                  )}
                </>
              )}
          </>
        )}
      </div>

      {selectedYmd && selectedCell?.inMonth && (isAdmin || !selectedCell?.isOffDay) && (!detailModalOpen || detailTab === "list") ? (
        <section className="admin-day-panel">
          <h3>{selectedYmd} 휴가자</h3>
          <ul>
            {selectedCell.approvedApplicants.length === 0 ? (
              <li className="help admin-day-empty">없음</li>
            ) : (
              selectedCell.approvedApplicants.map((item) => (
                <li key={item.id}>
                  {item.name} ({typeFullLabel(item.leaveType)})
                </li>
              ))
            )}
          </ul>
          <div className="admin-day-substitute-grid-wrap">
            <h4>{selectedYmd} 대체자</h4>
            <div className="admin-day-substitute-grid">
              <div className="admin-day-substitute-grid__head">대체자</div>
              <div className="admin-day-substitute-grid__head">번표</div>
              {selectedCell.approvedApplicants.length === 0 ? (
                <div className="help" style={{ gridColumn: "1 / -1" }}>없음</div>
              ) : (
                selectedCell.approvedApplicants.flatMap((item) => {
                  const subs = getSubstituteRecordsForRequest(substituteAssignments, item.id);
                  if (!subs.length) {
                    return [
                      <span key={`${item.id}_sub`} className="admin-day-substitute-grid__cell">-</span>,
                      <span key={`${item.id}_code`} className="admin-day-substitute-grid__cell">-</span>,
                    ];
                  }
                  return subs.flatMap((s, i) => {
                    const subName = users.find((u) => u.id === s.substituteUserId)?.name ?? s.substituteUserId;
                    const code = String(s.shiftCode ?? "").trim() || "-";
                    return [
                      <span key={`${item.id}_${i}_sub`} className="admin-day-substitute-grid__cell">{subName}</span>,
                      <span key={`${item.id}_${i}_code`} className="admin-day-substitute-grid__cell">{code}</span>,
                    ];
                  });
                })
              )}
            </div>
          </div>
          <div style={{ marginTop: 10 }} data-calendar-scroll-target="duty-memo">
            <h4>듀티 메모</h4>
            {isAdmin ? (
              <>
                <textarea
                  className="duty-memo-text"
                  rows={3}
                  placeholder="해당 날짜 메모를 입력하세요"
                  value={adminMemoDraft}
                  onChange={(e) => setAdminMemoDraft(e.target.value)}
                />
                <div style={{ marginTop: 8 }}>
                  <button type="button" onClick={() => void saveAdminDayMemo(selectedYmd, adminMemoDraft)}>
                    메모 저장
                  </button>
                </div>
              </>
            ) : (
              <p className="help duty-memo-text" style={{ whiteSpace: "pre-wrap" }}>
                {adminDayMemos?.[selectedYmd] || "등록된 메모가 없습니다."}
              </p>
            )}
          </div>
          <div className="day-comment-section" style={{ marginTop: 12 }} data-calendar-scroll-target="comments">
            {selectedDayComments.length === 0 ? (
              <p className="help">등록된 추가 메모가 없습니다.</p>
            ) : (
              <ul className="day-comment-list">
                {selectedDayComments.map((row) => {
                  const authorName = users.find((u) => u.id === row.userId)?.name ?? row.userId;
                  const canManageComment = currentUserId === row.userId || isAdmin;
                  const isEditing = editingCommentId === row.id;
                  return (
                    <li key={row.id} className="day-comment-item">
                      {isEditing ? (
                        <div className="day-comment-edit-wrap">
                          <textarea rows={2} value={editingCommentDraft} onChange={(e) => setEditingCommentDraft(e.target.value)} />
                          <div className="row wrap" style={{ marginTop: 6 }}>
                            <button
                              type="button"
                              onClick={() => {
                                if (!editingCommentDraft.trim()) return;
                                void updateDayComment(row.id, editingCommentDraft);
                                setEditingCommentId("");
                                setEditingCommentDraft("");
                              }}
                              disabled={!editingCommentDraft.trim()}
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCommentId("");
                                setEditingCommentDraft("");
                              }}
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="day-comment-author">{authorName}</span>: {row.content}
                          {canManageComment ? (
                            <span className="row wrap day-comment-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCommentId(row.id);
                                  setEditingCommentDraft(row.content);
                                }}
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!window.confirm("이 댓글을 삭제할까요?")) return;
                                  void deleteDayComment(row.id);
                                }}
                              >
                                삭제
                              </button>
                            </span>
                          ) : null}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div style={{ marginTop: 8 }}>
              <textarea
                rows={2}
                placeholder="추가 메모를 입력하세요"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedYmd || !commentDraft.trim()) return;
                    void createDayComment(selectedYmd, commentDraft);
                    setCommentDraft("");
                  }}
                  disabled={!commentDraft.trim()}
                >
                  댓글 등록
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
      </div>

      {detailModalOpen ? (
        <div className="calendar-detail-modal-footer">
          <button
            type="button"
            className="calendar-detail-modal-close"
            onClick={() => {
              setDetailModalOpen(false);
              setSelectedYmd("");
            }}
          >
            닫기
          </button>
        </div>
      ) : null}
        </div>
      </div>
    </section>
  );
}

function AdminPage({ allRequests, users, notes, goldkeys, cancellations, serverMode, adminUserId }) {
  const [adminSubTab, setAdminSubTab] = useState("export");
  const [nameSearch, setNameSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [recordTypeFilter, setRecordTypeFilter] = useState("ALL");
  const minLeaveDate = useMemo(() => {
    const dates = (Array.isArray(allRequests) ? allRequests : []).map((r) => String(r.leaveDate ?? "").slice(0, 10)).filter(Boolean);
    if (dates.length === 0) return `${new Date().getFullYear()}-01-01`;
    return dates.sort()[0];
  }, [allRequests]);
  const maxLeaveDate = useMemo(() => {
    const dates = (Array.isArray(allRequests) ? allRequests : []).map((r) => String(r.leaveDate ?? "").slice(0, 10)).filter(Boolean);
    if (dates.length === 0) return `${new Date().getFullYear()}-12-31`;
    return dates.sort()[dates.length - 1];
  }, [allRequests]);
  const [exportFrom, setExportFrom] = useState(() => {
    const dates = (Array.isArray(allRequests) ? allRequests : []).map((r) => String(r.leaveDate ?? "").slice(0, 10)).filter(Boolean);
    if (dates.length === 0) return `${new Date().getFullYear()}-01-01`;
    return dates.sort()[0];
  });
  const [exportTo, setExportTo] = useState(() => {
    const dates = (Array.isArray(allRequests) ? allRequests : []).map((r) => String(r.leaveDate ?? "").slice(0, 10)).filter(Boolean);
    if (dates.length === 0) return `${new Date().getFullYear()}-12-31`;
    return dates.sort()[dates.length - 1];
  });
  const applyRows = (Array.isArray(allRequests) ? allRequests : []).map((r) => ({
    id: `apply_${r.id}`,
    requestId: r.id,
    recordType: "APPLY",
    userId: r.userId,
    leaveDate: r.leaveDate,
    leaveType: r.leaveType,
    leaveNature: r.leaveNature,
    status: r.status,
    eventAt: r.requestedAt,
    note: "",
    negotiationOrder: r.negotiationOrder,
  }));
  const cancelRows = (Array.isArray(cancellations) ? cancellations : [])
    .map((c) => {
      const req = allRequests.find((r) => r.id === c.leaveRequestId);
      if (!req) return null;
      return {
        id: `cancel_${c.id}`,
        requestId: req.id,
        recordType: "CANCEL",
        userId: req.userId,
        leaveDate: req.leaveDate,
        leaveType: req.leaveType,
        leaveNature: req.leaveNature,
        status: req.status,
        eventAt: c.cancelledAt,
        note: c.cancelReason || "",
        negotiationOrder: req.negotiationOrder,
      };
    })
    .filter(Boolean);
  const rows = [...applyRows, ...cancelRows]
    .filter((r) => (recordTypeFilter === "ALL" ? true : r.recordType === recordTypeFilter))
    .filter((r) => {
      const name = users.find((u) => u.id === r.userId)?.name ?? "";
      const matchedName = name.toLowerCase().includes(nameSearch.toLowerCase());
      const matchedType = typeFilter === "ALL" || r.leaveType === typeFilter;
      return matchedName && matchedType;
    })
    .sort((a, b) => {
      if (a.leaveDate !== b.leaveDate) return a.leaveDate.localeCompare(b.leaveDate);
      return String(a.eventAt ?? "").localeCompare(String(b.eventAt ?? ""));
    });
  return (
    <>
      <section className="card">
        <div className="segmented-wrap segmented-wrap--multi" role="tablist" aria-label="기록 하위 탭">
          <button
            type="button"
            role="tab"
            aria-selected={adminSubTab === "export"}
            className={`segmented-btn${adminSubTab === "export" ? " segmented-btn--active" : ""}`}
            onClick={() => setAdminSubTab("export")}
          >
            이력출력
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={adminSubTab === "records"}
            className={`segmented-btn${adminSubTab === "records" ? " segmented-btn--active" : ""}`}
            onClick={() => setAdminSubTab("records")}
          >
            신청·취소기록
          </button>
        </div>
      </section>

      {adminSubTab === "export" && serverMode && adminUserId ? (
        <section className="card">
          <h2 className="screen-title">이력 출력 (CSV)</h2>
          <p className="help page-lead">
            기본 기간은 전체 신청 범위입니다. 시작일·종료일을 조정하면 모든 신청/이력 CSV를 내려받을 수 있습니다.
          </p>
          <div className="row wrap export-action-row" style={{ alignItems: "center", gap: 8, marginBottom: 8 }}>
            <label className="export-date-field">
              시작일{" "}
              <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
            </label>
            <label className="export-date-field">
              종료일{" "}
              <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
            </label>
            <button type="button" className="export-btn export-btn--range" onClick={() => {
              setExportFrom(minLeaveDate);
              setExportTo(maxLeaveDate);
            }}>
              전체 기간
            </button>
            <button
              className="export-btn export-btn--leave"
              type="button"
              onClick={async () => {
                try {
                  const text = await api.downloadLeaveExportCsv({
                    actorUserId: adminUserId,
                    from: exportFrom,
                    to: exportTo,
                  });
                  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `leave-requests-${exportFrom}_${exportTo}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  window.alert?.(e?.message || e);
                }
              }}
            >
              신청·상태
            </button>
            <button
              className="export-btn export-btn--audit"
              type="button"
              onClick={async () => {
                try {
                  const text = await api.downloadLeaveAuditExportCsv({
                    actorUserId: adminUserId,
                    from: exportFrom,
                    to: exportTo,
                  });
                  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `leave-audit-${exportFrom}_${exportTo}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  window.alert?.(e?.message || e);
                }
              }}
            >
              상태변경 이력
            </button>
          </div>
        </section>
      ) : null}

      {adminSubTab === "records" ? (
      <section className="card">
        <h2 className="screen-title">신청·취소 기록</h2>
        <p className="help page-lead">휴가일 기준으로 정렬됩니다. 이름·유형으로 좁힐 수 있습니다.</p>
        <div className="row wrap">
          <input placeholder="간호사 이름 검색" value={nameSearch} onChange={(e) => setNameSearch(e.target.value)} />
          <select value={recordTypeFilter} onChange={(e) => setRecordTypeFilter(e.target.value)}>
            <option value="ALL">전체 기록</option>
            <option value="APPLY">휴가신청건</option>
            <option value="CANCEL">휴가취소건</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="ALL">전체 유형</option>
            <option value="GOLDKEY">골드키</option>
            <option value="GENERAL_PRIORITY">일반-우선</option>
            <option value="GENERAL_NORMAL">일반-후순위</option>
            <option value="HALF_DAY">반차</option>
          </select>
        </div>
        <div className="table-wrap admin-approval-table-wrap">
          <table className="admin-approval-table">
            <thead>
              <tr>
                <th>기록구분</th>
                <th>간호사</th>
                <th>휴가일</th>
                <th>유형</th>
                <th>성격</th>
                <th>상태</th>
                <th>협의순</th>
                <th>기록시각</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.recordType === "APPLY" ? "휴가신청건" : "휴가취소건"}</td>
                  <td>{users.find((u) => u.id === r.userId)?.name}</td>
                  <td>{r.leaveDate}</td>
                  <td>
                    <span className={`leave-type-pill ${buildLeaveChipClass(r.leaveType, r.status)}`}>{leaveTypeLabel(r.leaveType)}</span>
                  </td>
                  <td>{leaveNatureLabel(r.leaveNature)}</td>
                  <td>{statusLabel(r.status)}</td>
                  <td>{r.negotiationOrder != null ? r.negotiationOrder : "—"}</td>
                  <td>{new Date(r.eventAt).toLocaleString("ko-KR")}</td>
                  <td>{r.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}
    </>
  );
}

function SettingsPage({ managedUsers, onResetPassword, accountMessage }) {
  return (
    <section className="card">
      <h2 className="screen-title">설정</h2>
      <h3 className="settings-subheading">사용자 비밀번호 초기화</h3>
      <ul className="settings-password-reset-list">
        {managedUsers.map((u) => (
          <li key={u.id} className="settings-password-reset-row">
            <span className="settings-password-reset-name">{u.name}</span>
            <span className="settings-password-reset-emp">{u.employeeNo}</span>
            <span className="settings-password-reset-role">{u.role}</span>
            <button type="button" className="settings-password-reset-btn" onClick={() => onResetPassword(u.id)}>
              비밀번호 1234로 초기화
            </button>
          </li>
        ))}
      </ul>
      {accountMessage ? <p className="msg">{accountMessage}</p> : null}
    </section>
  );
}

function parseNegotiationOrder(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeParseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === "") return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRequestRow(r) {
  const ld = r.leave_date ?? r.leaveDate;
  const lt = String(r.leave_type ?? r.leaveType ?? "").trim();
  const ln = String(r.leave_nature ?? r.leaveNature ?? "PERSONAL").trim();
  return {
    id: r.id,
    userId: r.user_id ?? r.userId,
    leaveDate: normalizeLeaveDateStr(ld),
    leaveType: lt,
    leaveNature: ln || "PERSONAL",
    negotiationOrder: parseNegotiationOrder(r.negotiation_order ?? r.negotiationOrder),
    negotiationOrderLocked: Number(r.negotiation_order_locked ?? r.negotiationOrderLocked ?? 0) === 1,
    status: String(r.status ?? "").trim(),
    requestedAt: r.requested_at ?? r.requestedAt,
    memo: r.memo ?? "",
    cancelLocked: Boolean(r.cancel_locked ?? r.cancelLocked),
  };
}

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key);
    if (raw == null) return initialValue;
    try {
      return JSON.parse(raw);
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

/** 월 달력 칩: 같은 날·같은 사람은 1칩만 (로컬 캐시에 id만 다른 중복·유형 혼합 중복 방지) */
function dedupeRequestsForCalendarChips(sortedDayReqs) {
  const seen = new Set();
  const out = [];
  for (const r of sortedDayReqs) {
    const key = `${String(r.userId ?? "")}|${String(r.leaveDate ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function buildMonthMatrix(year, month, allRequests, users, holidaysCache) {
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells = [];

  const holidayByDate = new Map();
  if (Array.isArray(holidaysCache)) {
    for (const h of holidaysCache) {
      if (h?.isHoliday && h.holidayDate) holidayByDate.set(h.holidayDate, h.holidayName ?? "");
    }
  }

  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = toLocalYMD(d);
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = holidayByDate.has(iso);
    const isOffDay = isHoliday || isWeekend;
    const holidayName = holidayByDate.get(iso) ?? "";
    const dayReqs = allRequests.filter((r) => r.leaveDate === iso);
    const activeDayReqs = dayReqs.filter((r) => r.status !== "CANCELLED");
    const hasGoldkeyRequest = activeDayReqs.some((r) => r.leaveType === "GOLDKEY");
    const sortedDayReqs = [...dayReqs].sort((a, b) => compareSameLeaveDateRequests(a, b, users));
    const forDisplay = dedupeRequestsForCalendarChips(sortedDayReqs);
    const displayApplicants = forDisplay.map((r) => ({
      id: r.id,
      userId: r.userId,
      leaveType: r.leaveType,
      status: r.status,
      name: users.find((u) => u.id === r.userId)?.name ?? r.userId,
    }));
    cells.push({
      date: iso,
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1,
      isWeekend,
      isHoliday,
      isOffDay,
      holidayName,
      requestCount: activeDayReqs.length,
      hasGoldkeyRequest,
      displayApplicants,
      applicants: dayReqs
        .filter((r) => r.status !== "CANCELLED")
        .sort((a, b) => compareSameLeaveDateRequests(a, b, users))
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          leaveType: r.leaveType,
          status: r.status,
          name: users.find((u) => u.id === r.userId)?.name ?? r.userId,
        })),
      approvedApplicants: dayReqs
        .filter((r) => isWinnerStatus(r.status))
        .sort((a, b) => compareSameLeaveDateRequests(a, b, users))
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          leaveType: r.leaveType,
          status: r.status,
          name: users.find((u) => u.id === r.userId)?.name ?? r.userId,
        })),
    });
  }
  return cells;
}

function typeFullLabel(leaveType) {
  if (leaveType === "GOLDKEY") return "골드키";
  if (leaveType === "GENERAL_PRIORITY") return "일반휴가-우선순위";
  if (leaveType === "HALF_DAY") return "반차";
  return "일반휴가-후순위";
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: "application/sql;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default App;
