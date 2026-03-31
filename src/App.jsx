import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
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
  isSecondHalfGoldkeyAprilConsultationRequest,
  leaveNatureLabel,
  leaveTypeLabel,
  statusLabel,
  validateRequest,
} from "./utils/rules";
import { api } from "./api/client";
import { defaultGoldkeyQuotaForName } from "./data/goldkeyQuotas.js";

/** 오프라인 저장소 버전 — 배포 시 키 올리면 예전 휴가·골드키 캐시 무시(빈 신청·기본 골드키로 로드) */
const LS_REQUESTS = "or.requests.v3";
const LS_NOTES = "or.notes.v3";
const LS_CANCELLATIONS = "or.cancellations.v3";
const LS_SELECTIONS = "or.selections.v3";
const LS_GOLDKEYS = "or.goldkeys.v4";
const LS_ADJUSTMENT_LOGS = "or.adjustmentLogs.v3";
const LS_HOLIDAY_DUTIES = "or.holidayDuties.v1";
const LS_LADDER_RESULTS = "or.ladderResults.v1";
const LS_ADMIN_DAY_MEMOS = "or.adminDayMemos.v1";

/** 이전 버전 키는 남아 있으면 혼동만 되므로 제거(현재 키는 유지) */
function dropStaleOfflineLeaveKeys() {
  try {
    [
      "or.requests",
      "or.requests.v2",
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

  const currentUser = users.find((u) => u.id === auth?.userId);
  const isAdmin = currentUser?.role === "ADMIN";
  const canEditHolidayDuty = currentUser?.role === "NURSE" || currentUser?.role === "ADMIN" || currentUser?.role === "ANESTHESIA";
  const myGoldkey = goldkeys.find((g) => g.userId === auth?.userId);
  const isLoggedIn = Boolean(auth?.userId);

  function applyBootstrapPayload(data) {
    setUsers(data.users.map((u) => ({ id: u.id, name: u.name, role: u.role, employeeNo: u.employee_no })));
    setRequests(data.requests.map(mapRequestRow));
    setNotes(data.notes.map((n) => ({ id: n.id, leaveRequestId: n.leave_request_id, content: n.content, agreedOrder: n.agreed_order })));
    setCancellations(data.cancellations.map((c) => ({ id: c.id, leaveRequestId: c.leave_request_id, cancelledBy: c.cancelled_by, cancelReason: c.cancel_reason, cancelledAt: c.cancelled_at })));
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
    const memoRows = Array.isArray(data.adminDayMemos) ? data.adminDayMemos : [];
    const memoByDate = memoRows.reduce((acc, m) => {
      const ymd = m.target_date ?? m.targetDate;
      if (!ymd) return acc;
      acc[ymd] = String(m.content ?? "");
      return acc;
    }, {});
    setAdminDayMemos(memoByDate);

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

  async function bootstrap() {
    try {
      const data = await api.bootstrap();
      applyBootstrapPayload(data);
      setServerMode(true);
    } catch {
      setServerMode(false);
    }
  }

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
          await api.patchNegotiationOrder(u.requestId, { negotiationOrder: u.negotiationOrder });
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
        return u ? { ...r, negotiationOrder: u.negotiationOrder } : r;
      })
    );
  }

  async function saveNegotiationOrder(requestId, rawString) {
    const trimmed = String(rawString ?? "").trim();
    const negotiationOrder = trimmed === "" ? null : Number(trimmed);
    if (negotiationOrder !== null && (!Number.isInteger(negotiationOrder) || negotiationOrder < 1 || negotiationOrder > 999)) {
      window.alert?.("협의 순번은 1~999 사이 정수이거나 비워야 합니다.");
      return;
    }
    if (serverMode) {
      try {
        await api.patchNegotiationOrder(requestId, { negotiationOrder });
        await bootstrap();
      } catch (e) {
        window.alert?.(`저장 실패: ${e?.message || e}`);
      }
    } else {
      setRequests((prev) => {
        const next = prev.map((r) => (r.id === requestId ? { ...r, negotiationOrder } : r));
        try {
          localStorage.setItem(LS_REQUESTS, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
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
      setAuth({ userId: data.user.id });
      return;
    } catch (e) {
      const msg = String(e?.message || "");
      const allowOfflineLogin =
        e?.name === "TypeError" ||
        msg.includes("Failed to fetch") ||
        msg.includes("Load failed") ||
        msg.includes("NetworkError") ||
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
      setAuth({ userId: matches[0].id });
    }
  }

  function handleLogout() {
    setAuth(null);
  }

  const myRequests = useMemo(
    () => requests.filter((r) => r.userId === auth?.userId),
    [requests, auth?.userId]
  );
  const appliedRequests = useMemo(
    () =>
      [...requests]
        .filter((r) => r.status === "APPLIED")
        .sort((a, b) => compareAppliedRequests(a, b, users)),
    [requests, users]
  );
  const dashboard = useMemo(
    () => ({
      total: requests.length,
      applied: requests.filter((r) => r.status === "APPLIED").length,
      selected: requests.filter((r) => isWinnerStatus(r.status)).length,
      cancelled: requests.filter((r) => r.status === "CANCELLED").length,
    }),
    [requests]
  );
  const calendarData = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    return buildMonthMatrix(year, month, requests, users, holidays);
  }, [calendarMonth, requests, users, holidays]);

  const calendarDayRequests = useMemo(() => {
    if (!calendarSelectedYmd) return [];
    return [...requests]
      .filter((r) => r.leaveDate === calendarSelectedYmd)
      .sort((a, b) => compareSameLeaveDateRequests(a, b, users));
  }, [requests, calendarSelectedYmd, users]);

  async function submitRequest(e) {
    e.preventDefault();
    if (!dataHydrated) {
      setMessage("데이터를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const error = validateRequest({
      leaveType,
      leaveDate,
      leaveNature,
      now: new Date(),
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
    setLeaveDate(calendarSelectedYmd ?? toLocalYMD(new Date()));
    setMemo("");
  }

  async function cancelRequest(requestId) {
    const target = requests.find((r) => r.id === requestId);
    if (target?.cancelLocked) return;
    const reason = window.prompt("취소 사유를 입력하세요");
    if (!reason) return;
    const payload = {
      cancellationId: `lc_${Date.now()}`,
      cancelledBy: auth.userId,
      cancelReason: reason,
      cancelledAt: new Date().toISOString(),
    };
    const prevSnapshot = requests;
    const prevCancellations = cancellations;
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
    setCancellations((prev) => [...prev, { id: payload.cancellationId, leaveRequestId: requestId, ...payload }]);
    /* 골드키: 취소해도 used/remaining(신청·사용 횟수)은 되돌리지 않음 — 서버·오프라인 동일 */
    if (serverMode) {
      try {
        await api.cancelRequest(requestId, payload);
        await bootstrap();
      } catch (e) {
        window.alert?.(`취소 반영 실패: ${e?.message || e}`);
        setRequests(prevSnapshot);
        setCancellations(prevCancellations);
        try {
          localStorage.setItem(LS_REQUESTS, JSON.stringify(prevSnapshot));
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function selectRequest(requestId) {
    const payload = {
      selectionId: `ls_${Date.now()}`,
      selectedBy: auth.userId,
      selectedAt: new Date().toISOString(),
    };
    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "APPROVED" } : r)));
    setSelections((prev) => [...prev, { id: payload.selectionId, leaveRequestId: requestId, ...payload }]);
    if (serverMode) {
      try {
        await api.selectRequest(requestId, payload);
        await bootstrap();
      } catch (e) {
        window.alert?.(`선정 반영 실패: ${e?.message || e}`);
      }
    }
  }

  async function rejectRequest(requestId) {
    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "REJECTED" } : r)));
    if (serverMode) {
      try {
        await api.rejectRequest(requestId);
        await bootstrap();
      } catch (e) {
        window.alert?.(`미선정 반영 실패: ${e?.message || e}`);
      }
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
    if (serverMode) {
      try {
        await api.upsertAdminDayMemo({
          actorUserId: auth.userId,
          targetDate: ymd,
          content: txt,
        });
        await bootstrap();
      } catch (e) {
        window.alert?.(`관리자 메모 저장 실패: ${e?.message || e}`);
      }
      return;
    }
    setAdminDayMemos((prev) => ({
      ...(prev ?? {}),
      [ymd]: txt,
    }));
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

  async function handleResetPassword(targetUserId) {
    await api.resetUserPassword(targetUserId, { adminUserId: auth.userId, nextPassword: "1234" });
    setAccountMessage("선택한 사용자의 비밀번호를 1234로 초기화했습니다.");
  }

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="top">
        <h1>EOR 휴가 시스템 (v2 · eoroff)</h1>
        <div className="row wrap">
          <span className="help">
            {currentUser?.name} ({currentUser?.role}) / {serverMode ? "DB 모드" : "로컬 모드"} · Pages: alsdk4912.github.io/eoroff · 빌드{" "}
            {import.meta.env.VITE_DEPLOY_TAG
              ? String(import.meta.env.VITE_DEPLOY_TAG).slice(0, 7)
              : "로컬"}
          </span>
          <button onClick={handleLogout}>로그아웃</button>
        </div>
      </header>

      <nav className="card nav">
        {isAdmin ? (
          <>
            <Link to="/calendar">일정 관리</Link>
            <Link to="/dashboard">통합 현황</Link>
            <Link to="/admin">휴가 배정 내역</Link>
            <Link to="/ladder">추첨 배정</Link>
            <Link to="/account">비밀번호 변경</Link>
          </>
        ) : (
          <>
            <Link to="/calendar">휴가 일정</Link>
            {currentUser?.role === "NURSE" ? <Link to="/request">휴가 신청</Link> : null}
            {currentUser?.role === "NURSE" ? <Link to="/my">신청 내역</Link> : null}
            <Link to="/dashboard">종합 현황</Link>
            <Link to="/ladder">추첨 배정</Link>
            <Link to="/account">비밀번호 변경</Link>
          </>
        )}
      </nav>

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
        <Route path="/my" element={<MyRequestsPage myRequests={myRequests} cancelRequest={cancelRequest} />} />
        <Route
          path="/dashboard"
          element={
            <DashboardPage
              dashboard={dashboard}
              goldkeys={goldkeys}
              requests={requests}
              cancellations={cancellations}
              users={users}
              serverMode={serverMode}
            />
          }
        />
        <Route
          path="/ladder"
          element={
            <LadderGamePage
              users={users}
              requests={requests}
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
              rejectRequest={rejectRequest}
              adminDayMemos={adminDayMemos}
              saveAdminDayMemo={saveAdminDayMemo}
            />
          }
        />
        <Route path="/account" element={<AccountPage onChangePassword={handleChangePassword} message={accountMessage} />} />
        <Route
          path="/admin"
          element={
            isAdmin ? (
              <AdminPage
                allRequests={requests}
                users={users}
                notes={notes}
                goldkeys={goldkeys}
                serverMode={serverMode}
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
                serverMode={serverMode}
                onResetLeaveData={handleResetLeaveData}
                resetDataMessage={resetDataMessage}
              />
            ) : (
              <Navigate to="/calendar" />
            )
          }
        />
        <Route path="*" element={<Navigate to="/calendar" />} />
      </Routes>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await onLogin(loginName, password);
    } catch (e2) {
      setError(e2.message);
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
        {error ? <p className="msg">{error}</p> : null}
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
      <h2>간호사 신청 화면</h2>
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

function MyRequestsPage({ myRequests, cancelRequest }) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  function matchesStatusFilter(r) {
    if (statusFilter === "ALL") return true;
    if (statusFilter === "SELECTED") return isWinnerStatus(r.status);
    return r.status === statusFilter;
  }
  const rows = myRequests
    .filter(
      (r) =>
        matchesStatusFilter(r) &&
        `${r.leaveDate} ${leaveTypeLabel(r.leaveType)} ${leaveNatureLabel(r.leaveNature)} ${statusLabel(r.status)}`
          .toLowerCase()
          .includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (a.leaveDate !== b.leaveDate) return a.leaveDate.localeCompare(b.leaveDate);
      return a.requestedAt.localeCompare(b.requestedAt);
    });
  return (
    <section className="card">
      <h2>내 신청내역</h2>
      <div className="row wrap">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">전체 상태</option>
          <option value="APPLIED">신청</option>
          <option value="SELECTED">승인·선정</option>
          <option value="APPROVED">승인(APPROVED)</option>
          <option value="CANCELLED">취소</option>
          <option value="REJECTED">미선정</option>
        </select>
        <input placeholder="날짜/유형/상태 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
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
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.status === "CANCELLED" ? "request-cancelled-row" : ""}
              >
                <td>{r.leaveDate}</td>
                <td>
                  <span className={`leave-type-pill ${buildLeaveChipClass(r.leaveType, r.status)}`}>{leaveTypeLabel(r.leaveType)}</span>
                </td>
                <td>{leaveNatureLabel(r.leaveNature)}</td>
                <td>{statusLabel(r.status)}</td>
                <td>{new Date(r.requestedAt).toLocaleString("ko-KR")}</td>
                <td>
                  {(() => {
                    const isLocked = Boolean(r.cancelLocked);
                    const showButton = r.status === "APPLIED" || isLocked;
                    const buttonLabel = isLocked ? "취소 처리됨" : "취소";
                    return showButton ? (
                      <button type="button" disabled={isLocked || r.status !== "APPLIED"} onClick={() => void cancelRequest(r.id)}>
                        {buttonLabel}
                      </button>
                    ) : (
                      "-"
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 골드키 신청·사용 = 골드키로 제출한 건수(취소·반려 포함). 취소해도 횟수는 줄지 않음(한 번 신청한 슬롯은 회수 안 함). */
function countGoldkeyApplyUse(requests, userId) {
  return requests.filter((r) => r.userId === userId && r.leaveType === "GOLDKEY").length;
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

function DashboardPage({ dashboard, goldkeys, requests, cancellations, users, serverMode }) {
  return (
    <>
      <section className="card">
        <h2>골드키 잔여 내역</h2>
        <p className="help" style={{ marginBottom: 10 }}>
          <strong>신청·사용</strong>은 골드키로 제출한 누적 건수입니다(취소·반려 포함, 취소해도 숫자는 그대로). 잔여 = 총개수 − 신청·사용.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>골드키 총개수</th>
                <th>신청·사용</th>
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
                  const applyUse = countGoldkeyApplyUse(requests, u.id);
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
        <p className="help">
          참고: 전체 신청 {dashboard.total} / 신청중 {dashboard.applied} / 승인·선정 {dashboard.selected} / 취소 {dashboard.cancelled}
        </p>
      </section>
      <section className="card">
        <h2>취소 이력</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>요청ID</th>
                <th>취소자</th>
                <th>사유</th>
                <th>시각</th>
              </tr>
            </thead>
            <tbody>
              {cancellations.map((c) => (
                <tr key={c.id}>
                  <td>{c.leaveRequestId}</td>
                  <td>{users.find((u) => u.id === c.cancelledBy)?.name ?? c.cancelledBy}</td>
                  <td>{c.cancelReason}</td>
                  <td>{new Date(c.cancelledAt).toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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
      <h2>계정 관리</h2>
      <form className="login-form" onSubmit={submit}>
        <input type="password" placeholder="현재 비밀번호" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        <input type="password" placeholder="새 비밀번호 (4자 이상)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <button type="submit">비밀번호 변경</button>
      </form>
      {localMsg ? <p className="msg">{localMsg}</p> : null}
      {message ? <p className="help">{message}</p> : null}
    </section>
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

function LadderGamePage({ users, requests, ladderResults, createLadderResult, applyLadderResultToNegotiationOrder, currentUserId }) {
  const now = toLocalYMD(new Date());
  const [leaveDate, setLeaveDate] = useState(now);
  const [leaveType, setLeaveType] = useState("GENERAL_PRIORITY");
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [previewOrder, setPreviewOrder] = useState([]);
  const [ladderMsg, setLadderMsg] = useState("");

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

  function toggleUser(userId) {
    setSelectedUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  function runLadder() {
    setLadderMsg("");
    if (selectedUserIds.length < 2) {
      window.alert?.("사다리 게임은 참여자 2명 이상이 필요합니다.");
      return;
    }
    const order = shuffleArray(selectedUserIds);
    setPreviewOrder(order);
  }

  async function saveResult() {
    setLadderMsg("");
    if (previewOrder.length < 2) {
      window.alert?.("먼저 사다리 실행을 눌러 순번을 생성하세요.");
      return;
    }
    const selectedSet = new Set(selectedUserIds);
    const applicantSet = new Set(applicantUserIds);
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
      participants: selectedUserIds,
      order: previewOrder,
      createdBy: currentUserId,
      createdAt: new Date().toISOString(),
    };
    await createLadderResult(payload);
    await applyLadderResultToNegotiationOrder({
      leaveDate,
      leaveType,
      orderUserIds: previewOrder,
    });
    setLadderMsg("사다리 결과를 저장하고 달력 협의 순번에 자동 반영했습니다.");
  }

  return (
    <section className="card">
      <h2>사다리 게임</h2>
      <p className="help">동일 날짜·동일 유형에서 다수 신청 시 순번을 정하고 저장하면 모두가 같은 결과를 볼 수 있습니다.</p>
      <p className="help">
        해당일 협의 신청자:{" "}
        {applicantUserIds.length > 0
          ? applicantUserIds.map((id) => idToName.get(id) ?? id).join(", ")
          : "없음"}
      </p>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <div>
          <label className="field-label">휴가일</label>
          <YmdSplitInput value={leaveDate} onChange={setLeaveDate} />
        </div>
        <div>
          <label className="field-label">유형</label>
          <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
            <option value="GENERAL_PRIORITY">일반휴가-우선순위</option>
            <option value="GENERAL_NORMAL">일반휴가-후순위</option>
            <option value="GOLDKEY">골드키</option>
            <option value="HALF_DAY">반차</option>
          </select>
        </div>
      </div>

      <div className="table-wrap" style={{ marginBottom: 10 }}>
        <table>
          <thead>
            <tr>
              <th>선택</th>
              <th>간호사</th>
            </tr>
          </thead>
          <tbody>
            {nurseUsers.map((u) => (
              <tr key={u.id}>
                <td>
                  <input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={() => toggleUser(u.id)} />
                </td>
                <td>{u.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button type="button" onClick={runLadder}>
          사다리 실행
        </button>
        <button type="button" onClick={() => void saveResult()} disabled={previewOrder.length < 2}>
          결과 저장
        </button>
      </div>

      {previewOrder.length > 0 ? (
        <p className="help">
          미리보기 결과:{" "}
          {previewOrder.map((id, idx) => `${idx + 1}순위 ${idToName.get(id) ?? id}`).join(" / ")}
        </p>
      ) : null}
      {ladderMsg ? <p className="msg">{ladderMsg}</p> : null}

      <hr className="divider" />
      <h3>저장된 결과</h3>
      <div className="table-wrap">
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
    </section>
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
      className="negotiation-order-input"
      disabled={disabled}
      value={val}
      onChange={(e) => setVal(e.target.value.replace(/\D/g, "").slice(0, 3))}
      onBlur={() => onCommit(request.id, val)}
      aria-label="협의 순번"
      placeholder="순번"
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
  rejectRequest,
  adminDayMemos,
  saveAdminDayMemo,
}) {
  const [detailTab, setDetailTab] = useState("list");
  const touchStartRef = useRef(null);

  useEffect(() => {
    if (!selectedYmd) return;
    setLeaveDate(selectedYmd);
  }, [selectedYmd, setLeaveDate]);

  const selectedCell = selectedYmd ? calendarData.find((c) => c.date === selectedYmd) : null;
  const nurseUsers = users.filter((u) => u.role === "NURSE");
  const anesthesiaUsers = users.filter((u) => u.role === "ANESTHESIA");

  const selectedHolidayDuty = selectedYmd ? holidayDuties?.[selectedYmd] : null;
  const [duty1UserId, setDuty1UserId] = useState(selectedHolidayDuty?.nurse1UserId ?? "");
  const [duty2UserId, setDuty2UserId] = useState(selectedHolidayDuty?.nurse2UserId ?? "");
  const [anesthesiaDutyUserId, setAnesthesiaDutyUserId] = useState(selectedHolidayDuty?.anesthesiaUserId ?? "");
  const [adminMemoDraft, setAdminMemoDraft] = useState("");

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

  /**
   * 같은 휴가일·같은 유형 기준으로, 신청(제출)일이 같은 사람끼리만 묶음.
   * 하반기 골드키(같은 해 7~12월)를 4/1~4/10에 제출한 건은 항상 협의(자동 신청순 없음).
   * 그 외: 묶음에 2명 이상이면 협의, 제출일이 겹치지 않으면 신청순 자동.
   */
  const negotiationMetaByRequestId = useMemo(() => {
    const map = new Map();
    if (!selectedYmd) return map;
    const active = dayRequests.filter((r) => r.leaveDate === selectedYmd && r.status !== "CANCELLED");
    const byType = new Map();
    for (const r of active) {
      if (!byType.has(r.leaveType)) byType.set(r.leaveType, []);
      byType.get(r.leaveType).push(r);
    }
    for (const [, list] of byType) {
      if (list.length === 1) {
        const only = list[0];
        if (only.leaveType === "GOLDKEY" && isSecondHalfGoldkeyAprilConsultationRequest(only)) {
          map.set(only.id, { mode: "negotiate" });
        } else {
          map.set(only.id, { mode: "single" });
        }
        continue;
      }
      const sortedAll = [...list].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
      for (const r of list) {
        if (r.leaveType === "GOLDKEY" && isSecondHalfGoldkeyAprilConsultationRequest(r)) {
          map.set(r.id, { mode: "negotiate" });
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

  function moveCalendarMonth(offset) {
    const [yy, mm] = String(calendarMonth || "").split("-").map(Number);
    if (!Number.isInteger(yy) || !Number.isInteger(mm)) return;
    const d = new Date(yy, mm - 1, 1);
    d.setMonth(d.getMonth() + offset);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    setCalendarMonth(next);
  }

  return (
    <section className="card">
      <h2>휴가 달력(월간)</h2>
      <p className="help">
        {isAdmin
          ? "날짜를 누르면 아래에서 신청 현황을 보고 같은 화면에서 승인/거절, 승인된 휴가자, 관리자 메모를 확인할 수 있습니다."
          : "날짜를 누르면 아래에서 신청 인원·이름을 확인하고, 같은 화면에서 휴가를 신청할 수 있습니다."}
      </p>
      <div className="row">
        <label>월 선택 </label>
        <input type="month" value={calendarMonth} onChange={(e) => setCalendarMonth(e.target.value)} />
      </div>
      <div
        className="calendar"
        onTouchStart={(e) => {
          const t = e.changedTouches?.[0];
          if (!t) return;
          touchStartRef.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const t = e.changedTouches?.[0];
          const start = touchStartRef.current;
          touchStartRef.current = null;
          if (!t || !start) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) < 50) return;
          if (Math.abs(dy) > Math.abs(dx) * 0.8) return;
          if (dx < 0) moveCalendarMonth(1);
          else moveCalendarMonth(-1);
        }}
      >
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <div key={d} className="calendar-head">
            {d}
          </div>
        ))}
        {calendarData.map((cell, idx) => {
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
              role={cell.inMonth ? "button" : undefined}
              tabIndex={cell.inMonth ? 0 : undefined}
              className={`calendar-cell ${cell.inMonth ? "calendar-cell--clickable" : "muted"}${myDutyClass}${isSel ? " calendar-cell--selected" : ""}`}
              onClick={() => {
                if (!cell.inMonth) return;
                setSelectedYmd(cell.date);
                setLeaveDate(cell.date);
                setDetailTab("list");
              }}
              onKeyDown={(e) => {
                if (!cell.inMonth) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedYmd(cell.date);
                  setLeaveDate(cell.date);
                  setDetailTab("list");
                }
              }}
            >
              <div className={`calendar-date${cell.isOffDay ? " calendar-date--holiday" : ""}`}>{cell.day}</div>
              {cell.requestCount > 0 ? (
                <div className={`badge badge--count-only${cell.hasGoldkeyRequest ? " badge--count-goldkey" : ""}`}>
                  {cell.requestCount}명
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="calendar-detail">
        {!selectedYmd ? (
          <p className="help calendar-detail-placeholder">달력에서 날짜를 선택하세요.</p>
        ) : (
          <>
            <h3 className="calendar-detail-title">{selectedYmd} 상세</h3>
              {canEditHolidayDuty && selectedCell?.isOffDay ? (
                <section className="holiday-duty-panel">
                  <h4 className="holiday-duty-title">휴일 당직자 기록 (공휴일·주말)</h4>
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
                  </div>
                  {detailTab === "list" ? (
                    <div className="calendar-detail-body" role="tabpanel">
                      {dayRequests.length === 0 ? (
                        <p className="help">이 날짜에 등록된 신청이 없습니다.</p>
                      ) : (
                        <>
                          <ul className="calendar-applicant-list">
                            {dayRequests.map((r) => {
                              const nm = users.find((u) => u.id === r.userId)?.name ?? r.userId;
                              const meta = negotiationMetaByRequestId.get(r.id) ?? { mode: "single" };
                              const ord = r.negotiationOrder ?? r.negotiation_order;
                              const isNegotiate = meta.mode === "negotiate";
                              const isAuto = meta.mode === "auto";
                              const isCancelledRow = meta.mode === "cancelled";
                              const autoRank = meta.mode === "auto" ? meta.autoRank : null;
                              const showModePill = isNegotiate || isAuto;
                              let prefix = "";
                              if (isAuto && autoRank != null) prefix = `${autoRank}. `;
                              else if (isNegotiate && ord != null && ord !== "") prefix = `${ord}. `;
                              else if (meta.mode === "single" && ord != null && ord !== "") prefix = `${ord}. `;

                              return (
                                <li key={r.id} className="calendar-applicant-item calendar-applicant-item--row">
                                  <div className="negotiation-order-cell">
                                    {isNegotiate && r.status !== "CANCELLED" ? (
                                      <NegotiationOrderInput request={r} disabled={false} onCommit={saveNegotiationOrder} />
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
                                  <span className={`calendar-applicant-name ${buildLeaveChipClass(r.leaveType, r.status)}`}>
                                    {prefix}
                                    {nm} · {typeFullLabel(r.leaveType)} · {leaveNatureLabel(r.leaveNature)} · {statusLabel(r.status)}
                                  </span>
                                  {isAdmin && r.status === "APPLIED" ? (
                                    <span className="row wrap" style={{ marginLeft: "auto" }}>
                                      <button type="button" onClick={() => void selectRequest(r.id)}>
                                        승인
                                      </button>
                                      <button type="button" onClick={() => void rejectRequest(r.id)}>
                                        거절
                                      </button>
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
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

      {selectedYmd && selectedCell?.inMonth ? (
        <section className="admin-day-panel">
          <h3>{selectedYmd} 휴가자</h3>
          <ul>
            {selectedCell.approvedApplicants.length === 0 ? (
              <li>없음</li>
            ) : (
              selectedCell.approvedApplicants.map((item) => (
                <li key={item.id}>
                  {item.name} ({typeFullLabel(item.leaveType)})
                </li>
              ))
            )}
          </ul>
          <div style={{ marginTop: 10 }}>
            <h4>관리자 메모</h4>
            {isAdmin ? (
              <>
                <textarea rows={3} placeholder="해당 날짜 메모를 입력하세요" value={adminMemoDraft} onChange={(e) => setAdminMemoDraft(e.target.value)} />
                <div style={{ marginTop: 8 }}>
                  <button type="button" onClick={() => void saveAdminDayMemo(selectedYmd, adminMemoDraft)}>
                    메모 저장
                  </button>
                </div>
              </>
            ) : (
              <p className="help" style={{ whiteSpace: "pre-wrap" }}>{adminDayMemos?.[selectedYmd] || "등록된 메모가 없습니다."}</p>
            )}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function AdminPage({ allRequests, users, notes, goldkeys, serverMode }) {
  const [nameSearch, setNameSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const rows = allRequests
    .filter((r) => r.status === "APPROVED" || r.status === "REJECTED")
    .filter((r) => {
      const name = users.find((u) => u.id === r.userId)?.name ?? "";
      const matchedName = name.toLowerCase().includes(nameSearch.toLowerCase());
      const matchedType = typeFilter === "ALL" || r.leaveType === typeFilter;
      return matchedName && matchedType;
    })
    .sort((a, b) => {
      if (a.leaveDate !== b.leaveDate) return a.leaveDate.localeCompare(b.leaveDate);
      return a.requestedAt.localeCompare(b.requestedAt);
    });
  return (
    <>
      <section className="card">
        <h2>휴가선정내역</h2>
        <p className="help" style={{ marginBottom: 10 }}>
          승인/거절 이력은 신청일이 아니라 휴가일 기준으로 정렬됩니다.
        </p>
        <div className="row wrap">
          <input placeholder="간호사 이름 검색" value={nameSearch} onChange={(e) => setNameSearch(e.target.value)} />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="ALL">전체 유형</option>
            <option value="GOLDKEY">골드키</option>
            <option value="GENERAL_PRIORITY">일반-우선</option>
            <option value="GENERAL_NORMAL">일반-후순위</option>
            <option value="HALF_DAY">반차</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>간호사</th>
                <th>휴가일</th>
                <th>유형</th>
                <th>성격</th>
                <th>상태</th>
                <th>협의순</th>
                <th>신청시각</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{users.find((u) => u.id === r.userId)?.name}</td>
                  <td>{r.leaveDate}</td>
                  <td>
                    <span className={`leave-type-pill ${buildLeaveChipClass(r.leaveType, r.status)}`}>{leaveTypeLabel(r.leaveType)}</span>
                  </td>
                  <td>{leaveNatureLabel(r.leaveNature)}</td>
                  <td>{statusLabel(r.status)}</td>
                  <td>{r.negotiationOrder != null ? r.negotiationOrder : "—"}</td>
                  <td>{new Date(r.requestedAt).toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function SettingsPage({
  apiKey,
  setApiKey,
  syncYear,
  setSyncYear,
  syncMonth,
  setSyncMonth,
  syncHolidays,
  holidays,
  apiMessage,
  backupMessage,
  restoreSqlText,
  setRestoreSqlText,
  onBackup,
  onRestore,
  managedUsers,
  onResetPassword,
  accountMessage,
  serverMode,
  onResetLeaveData,
  resetDataMessage,
}) {
  return (
    <section className="card">
      <h2>공휴일 API 동기화</h2>
      <div className="grid-api">
        <input type="password" placeholder="(옵션) 서비스키 - 현재는 미사용" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <input type="number" placeholder="연도" value={syncYear} onChange={(e) => setSyncYear(e.target.value)} />
        <input type="text" placeholder="월(01-12)" value={syncMonth} onChange={(e) => setSyncMonth(e.target.value.padStart(2, "0").slice(0, 2))} />
        <button onClick={syncHolidays}>동기화 실행</button>
      </div>
      <p className="help">현재 저장된 공휴일 수: {holidays.length}건</p>
      {apiMessage ? <p className="msg">{apiMessage}</p> : null}
      <hr className="divider" />
      <h2>SQLite 백업/복구</h2>
      <div className="row"><button onClick={onBackup}>백업 SQL 다운로드</button></div>
      <textarea className="sql-textarea" placeholder="복구할 SQL을 여기에 붙여넣고 복구 실행" value={restoreSqlText} onChange={(e) => setRestoreSqlText(e.target.value)} />
      <div className="row"><button onClick={onRestore}>복구 실행</button></div>
      {backupMessage ? <p className="msg">{backupMessage}</p> : null}
      <hr className="divider" />
      <h2>휴가·골드키 데이터 초기화 (관리자)</h2>
      <p className="help" style={{ marginBottom: 10 }}>
        신청된 휴가 전부, 협의 메모·선정·취소 기록, 조정 로그를 지우고 간호사 골드키를 이름별 기본 총량·미사용으로 되돌립니다. 공휴일 캐시는 그대로입니다.
        {serverMode
          ? " DB 모드에서는 화면 데이터가 Turso 등 원격 DB에서 오므로, 여기서 버튼이 실패하거나 반영이 없으면 저장소의 워크플로「Reset Turso leave data」를 실행하거나, Render에 DATA_RESET_SECRET 설정 후 API 문서대로 curl로 초기화하세요."
          : " (현재: 이 브라우저 로컬만 반영 · GitHub Pages 단독 사용 시)"}
      </p>
      <div className="row">
        <button type="button" onClick={() => void onResetLeaveData()}>
          휴가·골드키 초기화 실행
        </button>
      </div>
      {resetDataMessage ? <p className="msg">{resetDataMessage}</p> : null}
      <hr className="divider" />
      <h2>사용자 비밀번호 초기화 (관리자)</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>이름</th><th>사번</th><th>권한</th><th>액션</th></tr></thead>
          <tbody>
            {managedUsers.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.employeeNo}</td><td>{u.role}</td>
                <td><button onClick={() => onResetPassword(u.id)}>비밀번호 1234로 초기화</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function toYmd(year, month1to12, day) {
  return `${year}-${String(month1to12).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseLocalDateYmd(ymd) {
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

function buildBaseDutyOrder(nurseUsers) {
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

function hasDutyPair(duty) {
  return Boolean(duty && duty.nurse1UserId && duty.nurse2UserId && duty.nurse1UserId !== duty.nurse2UserId);
}

function pickSequentialDutyPair(baseOrder, ymd, pointer) {
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

function buildWeekendBlocks(year) {
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

function buildAutoHolidayDutyPlan({ year, users, holidays, holidayDuties }) {
  const nurseUsers = (users ?? []).filter((u) => u.role === "NURSE");
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
      const idx2 = baseOrder.findIndex((u) => u.id === existingPair.nurse2UserId);
      if (idx2 >= 0) weekendPointer = (idx2 + 1) % baseOrder.length;
      for (const dt of block.dates) {
        if (!hasDutyPair(dutyByDate[dt])) {
          plan.push({
            holidayDate: dt,
            nurse1UserId: existingPair.nurse1UserId,
            nurse2UserId: existingPair.nurse2UserId,
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

  const holidayDates = (holidays ?? [])
    .filter((h) => h?.isHoliday && typeof h.holidayDate === "string")
    .map((h) => h.holidayDate)
    .filter((ymd) => String(ymd).startsWith(`${year}-`))
    .filter((ymd) => {
      const d = parseLocalDateYmd(ymd);
      if (Number.isNaN(d.getTime())) return false;
      const day = d.getDay();
      return day !== 0 && day !== 6;
    })
    .sort();

  let holidayPointer = 0;
  for (const ymd of holidayDates) {
    const existing = dutyByDate[ymd];
    if (hasDutyPair(existing)) {
      const idx2 = baseOrder.findIndex((u) => u.id === existing.nurse2UserId);
      if (idx2 >= 0) holidayPointer = (idx2 + 1) % baseOrder.length;
      continue;
    }
    const picked = pickSequentialDutyPair(baseOrder, ymd, holidayPointer);
    if (!picked) continue;
    holidayPointer = picked.nextPointer;
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

export default App;
