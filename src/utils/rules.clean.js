const LEAVE_TYPE_LABEL = {
  GOLDKEY: "골드키",
  GENERAL_PRIORITY: "일반휴가-우선순위",
  GENERAL_NORMAL: "일반휴가-후순위",
  HALF_DAY: "반차",
};

const LEAVE_NATURE_LABEL = {
  PERSONAL: "개인휴가",
  PAID_TRAINING: "보수교육공가",
  REQUIRED_TRAINING: "필수교육",
};

export const ALLOWED_LEAVE_NATURE = new Set(Object.keys(LEAVE_NATURE_LABEL));

const STATUS_LABEL = {
  APPLIED: "신청",
  SELECTED: "휴가 확정",
  APPROVED: "휴가 확정",
  CANCELLED: "취소",
  REJECTED: "휴가 반려",
};

export function toMonthString(dateLike) {
  const d = new Date(dateLike);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function addMonths(baseDate, offset) {
  const d = new Date(baseDate);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

export function leaveTypeLabel(type) {
  return LEAVE_TYPE_LABEL[type] ?? type;
}

export function leaveNatureLabel(nature) {
  const key = String(nature || "PERSONAL").trim();
  return LEAVE_NATURE_LABEL[key] ?? key;
}

export function statusLabel(status) {
  return STATUS_LABEL[status] ?? status;
}

/** 한국 표준시 기준 오늘 날짜 YYYY-MM-DD */
export function kstTodayYmd() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const mo = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !mo || !d) return "";
  return `${y}-${mo}-${d}`;
}

/**
 * 휴가일이 오늘(KST)보다 이전이면 true.
 * 과거 휴가는 취소 불가 정책에 사용한다.
 */
export function isLeaveDateBeforeTodayKst(leaveDateYmd) {
  const head = String(leaveDateYmd ?? "").trim().replace(/\//g, "-").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return false;
  const today = kstTodayYmd();
  if (!today) return false;
  return head < today;
}

export function leaveTypeOrder(type) {
  if (type === "GOLDKEY") return 1;
  if (type === "GENERAL_PRIORITY") return 2;
  if (type === "GENERAL_NORMAL") return 3;
  if (type === "HALF_DAY") return 4;
  return 99;
}

function negotiationOrderValue(r) {
  const v = r?.negotiationOrder ?? r?.negotiation_order;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 협의 후 입력한 순번이 있으면 그 순서로 먼저 정렬 (없는 항목은 뒤) */
function compareNegotiationOrder(a, b) {
  const ao = negotiationOrderValue(a);
  const bo = negotiationOrderValue(b);
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  if (ao != null && bo == null) return -1;
  if (ao == null && bo != null) return 1;
  return 0;
}

function isSameYearMonth(dateObj, year, month1to12) {
  return dateObj.getFullYear() === year && dateObj.getMonth() + 1 === month1to12;
}

function endOfDay(dateObj) {
  const d = new Date(dateObj);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * 관리자 신청 목록: 같은 휴가일·같은 유형에서 협의 순번이 있으면 우선.
 * 골드키: 휴가일이 다르면 신청시각 순, 같은 휴가일이면 순번→신청시각(먼저 신청한 사람이 앞).
 */
export function compareAppliedRequests(a, b, users) {
  const t = leaveTypeOrder(a.leaveType) - leaveTypeOrder(b.leaveType);
  if (t !== 0) return t;
  if (a.leaveType === "GOLDKEY" && b.leaveType === "GOLDKEY") {
    const ap = isRecruitConsultationGoldkeyRequest(a);
    const bp = isRecruitConsultationGoldkeyRequest(b);
    if (ap !== bp) return ap ? -1 : 1;
    if (a.leaveDate !== b.leaveDate) return a.requestedAt.localeCompare(b.requestedAt);
    const nc = compareNegotiationOrder(a, b);
    if (nc !== 0) return nc;
    return a.requestedAt.localeCompare(b.requestedAt);
  }
  if (a.leaveDate !== b.leaveDate) return a.leaveDate.localeCompare(b.leaveDate);
  const nc = compareNegotiationOrder(a, b);
  if (nc !== 0) return nc;
  return a.requestedAt.localeCompare(b.requestedAt);
}

/** 달력·같은 휴가일: 유형별로 협의 순번 → 골드키는 신청시각 → 기타도 신청시각 */
export function compareSameLeaveDateRequests(a, b, _users) {
  const ord = leaveTypeOrder(a.leaveType) - leaveTypeOrder(b.leaveType);
  if (ord !== 0) return ord;
  if (a.leaveType === "GOLDKEY" && b.leaveType === "GOLDKEY") {
    const ap = isRecruitConsultationGoldkeyRequest(a);
    const bp = isRecruitConsultationGoldkeyRequest(b);
    if (ap !== bp) return ap ? -1 : 1;
  }
  const nc = compareNegotiationOrder(a, b);
  if (nc !== 0) return nc;
  if (a.leaveType === "GOLDKEY" && b.leaveType === "GOLDKEY") {
    return a.requestedAt.localeCompare(b.requestedAt);
  }
  return a.requestedAt.localeCompare(b.requestedAt);
}

function holidaySetFromCache(holidaysCache) {
  const arr = Array.isArray(holidaysCache) ? holidaysCache : [];
  return new Set(arr.filter((h) => h.isHoliday).map((h) => h.holidayDate));
}

function toLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNthBusinessDay(year, monthIndex, n, holidaysCache) {
  const holidaySet = holidaySetFromCache(holidaysCache);
  let count = 0;
  const d = new Date(year, monthIndex, 1);

  while (d.getMonth() === monthIndex) {
    const dayOfWeek = d.getDay();
    const iso = toLocalYMD(d);
    const isBusiness = dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(iso);
    if (isBusiness) {
      count += 1;
      if (count === n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
  return new Date(year, monthIndex, 1);
}

/** `YYYY-MM-DD`(date input)를 로컬 자정으로 해석 — `new Date('YYYY-MM-DD')`는 UTC라 타임존에 따라 하루 어긋남 */
function parseYmdAsLocalDate(ymd) {
  const s = String(ymd ?? "").trim();
  const p = s.split("-");
  if (p.length !== 3) return new Date(NaN);
  const y = Number(p[0]);
  const mo = Number(p[1]);
  const d = Number(p[2]);
  if (!y || !mo || !d) return new Date(NaN);
  return new Date(y, mo - 1, d);
}

/** 신청 목록 행에서 YYYY-MM-DD 추출 (API snake_case·ISO 혼용 대비) */
function ymdFromRequestRow(r) {
  const raw = String(r?.leaveDate ?? r?.leave_date ?? "").trim().replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) return raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) || /Z|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  }
  return "";
}

/**
 * 하반기(같은 해 7~12월) 골드키를 매년 4/1~4/10(로컬 달력)에 제출한 신청.
 * 이 구간 신청분은 달력에서 「신청순」 자동 번호 없이 전부 「협의」로만 순번을 적습니다.
 */
export function isSecondHalfGoldkeyAprilConsultationRequest(request) {
  if (!request || request.leaveType !== "GOLDKEY") return false;
  const leaveYmd = ymdFromRequestRow(request);
  if (!leaveYmd) return false;
  const leave = parseYmdAsLocalDate(leaveYmd);
  if (Number.isNaN(leave.getTime())) return false;
  const lm = leave.getMonth() + 1;
  if (lm < 7 || lm > 12) return false;
  const rawReq = request.requestedAt ?? request.requested_at;
  if (!rawReq) return false;
  const reqAt = new Date(rawReq);
  if (Number.isNaN(reqAt.getTime())) return false;
  if (leave.getFullYear() !== reqAt.getFullYear()) return false;
  const rm = reqAt.getMonth() + 1;
  const rd = reqAt.getDate();
  return rm === 4 && rd >= 1 && rd <= 10;
}

/**
 * 익년 상반기(1~6월) 골드키를 매년 10/1~10/10에 제출한 신청.
 * (4월 하반기 모집과 동일하게 협의·사다리 규칙에 반영)
 */
export function isFirstHalfGoldkeyOctoberConsultationRequest(request) {
  if (!request || request.leaveType !== "GOLDKEY") return false;
  const leaveYmd = ymdFromRequestRow(request);
  if (!leaveYmd) return false;
  const leave = parseYmdAsLocalDate(leaveYmd);
  if (Number.isNaN(leave.getTime())) return false;
  const lm = leave.getMonth() + 1;
  if (lm < 1 || lm > 6) return false;
  const rawReq = request.requestedAt ?? request.requested_at;
  if (!rawReq) return false;
  const reqAt = new Date(rawReq);
  if (Number.isNaN(reqAt.getTime())) return false;
  if (leave.getFullYear() !== reqAt.getFullYear() + 1) return false;
  const rm = reqAt.getMonth() + 1;
  const rd = reqAt.getDate();
  return rm === 10 && rd >= 1 && rd <= 10;
}

function isRecruitConsultationGoldkeyRequest(request) {
  return isSecondHalfGoldkeyAprilConsultationRequest(request) || isFirstHalfGoldkeyOctoberConsultationRequest(request);
}

/**
 * 장기 모집기간(4/1~4/10 또는 10/1~10/10)에 제출한 골드키를 사용자가 취소한 건:
 * 신청내역·달력 칩 등 목록에서 표시하지 않는다(회색 취소 행 제외).
 */
export function shouldHideAprilRecruitHalfGoldkeyCancelledRow(request) {
  if (!request || request.status !== "CANCELLED") return false;
  return isRecruitConsultationGoldkeyRequest(request);
}

/** 취소·미선정 제외: 진행 중인 골드키가 해당 날짜에 이미 있으면 true */
export function hasBlockingGoldkeyOnDate(requests, userId, leaveDateYmd) {
  const ymd = String(leaveDateYmd ?? "").trim().slice(0, 10);
  if (!ymd || !userId) return false;
  return (requests ?? []).some((r) => {
    if (r.leaveType !== "GOLDKEY") return false;
    if (r.userId !== userId) return false;
    if (ymdFromRequestRow(r) !== ymd) return false;
    const st = r.status;
    if (st === "CANCELLED" || st === "REJECTED") return false;
    return true;
  });
}

/** 취소·미선정 제외: 진행 중인 휴가가 해당 날짜에 이미 있으면 true */
export function hasBlockingRequestOnDate(requests, userId, leaveDateYmd) {
  const ymd = String(leaveDateYmd ?? "").trim().slice(0, 10);
  if (!ymd || !userId) return false;
  return (requests ?? []).some((r) => {
    if (r.userId !== userId) return false;
    if (ymdFromRequestRow(r) !== ymd) return false;
    const st = r.status;
    if (st === "CANCELLED" || st === "REJECTED") return false;
    return true;
  });
}

function countActiveGeneralPriorityInMonth(requests, userId, leaveDateYmd) {
  const month = String(leaveDateYmd ?? "").trim().slice(0, 7);
  if (!month || !userId) return 0;
  return (requests ?? []).filter((r) => {
    if (r.userId !== userId) return false;
    if (r.leaveType !== "GENERAL_PRIORITY") return false;
    const ymd = ymdFromRequestRow(r);
    if (!ymd.startsWith(month)) return false;
    const st = r.status;
    if (st === "CANCELLED" || st === "REJECTED") return false;
    return true;
  }).length;
}

export function validateRequest({
  leaveType,
  leaveDate,
  leaveNature,
  now,
  remainingGoldkey,
  holidaysCache,
  userId,
  requests,
}) {
  if (!leaveType || !leaveDate) return "휴가 종류와 날짜를 입력하세요.";
  const nature = String(leaveNature ?? "").trim();
  if (!nature || !ALLOWED_LEAVE_NATURE.has(nature)) return "휴가 성격을 선택하세요.";

  const target = parseYmdAsLocalDate(leaveDate);
  if (Number.isNaN(target.getTime())) return "날짜 형식이 올바르지 않습니다.";

  const targetMonth = toMonthString(target);
  const currentMonth = toMonthString(now);
  const plus1 = toMonthString(addMonths(now, 1));
  const plus2 = toMonthString(addMonths(now, 2));
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  const aprilStart = new Date(nowYear, 3, 1, 0, 0, 0, 0);
  const april2At0900 = new Date(nowYear, 3, 2, 9, 0, 0, 0);
  const aprilEnd = endOfDay(new Date(nowYear, 3, 30));
  const inAprilPolicyMonth = nowMonth === 4;

  if (hasBlockingRequestOnDate(requests, userId, leaveDate)) {
    return "같은 날짜에는 휴가를 중복 신청할 수 없습니다.";
  }

  if (leaveType === "GENERAL_PRIORITY") {
    const monthlyPriorityCount = countActiveGeneralPriorityInMonth(requests, userId, leaveDate);
    if (monthlyPriorityCount >= 4) {
      return "해당월에 일반휴가-우선순위는 4개까지 가능합니다.";
    }
  }

  if (leaveType === "GOLDKEY") {
    const targetMonthNum = target.getMonth() + 1;
    const targetYear = target.getFullYear();

    if (nowMonth === 4) {
      const nd = now.getDate();
      if (nd >= 1 && nd <= 10) {
        if (targetYear !== nowYear) return "4월 장기(4/1~4/10) 골드키는 같은 해 7~12월 휴가만 신청 가능합니다.";
        if (targetMonthNum < 7 || targetMonthNum > 12) return "4/1~4/10 골드키는 7~12월 휴가만 신청 가능합니다.";
        return "";
      }
    }

    if (nowMonth === 10) {
      const nd = now.getDate();
      if (nd >= 1 && nd <= 10) {
        if (targetYear !== nowYear + 1) return "10월 장기(10/1~10/10) 골드키는 익년 1~6월 휴가만 신청 가능합니다.";
        if (targetMonthNum < 1 || targetMonthNum > 6) return "10/1~10/10 골드키는 익년 1~6월 휴가만 신청 가능합니다.";
        return "";
      }
    }

    if (targetMonth < plus2) return "골드키는 현재월+2달부터 신청 가능합니다.";
    if ((remainingGoldkey ?? 0) <= 0) return "잔여 골드키가 없습니다.";
    return "";
  }

  // 일반·반차: 해당월(잔여일자) + 다음달 모두 신청 가능
  if (targetMonth !== currentMonth && targetMonth !== plus1) {
    return "일반휴가·반차는 현재달(잔여일자) 또는 다음달만 신청 가능합니다.";
  }

  // 잔여일자만 허용: 신청 시각(now) 기준으로 과거 날짜는 차단
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (target < todayStart) return "해당월 잔여일자부터 신청 가능합니다.";

  if (leaveType === "GENERAL_PRIORITY" && !inAprilPolicyMonth && targetMonth !== plus1) {
    return "일반휴가-우선순위는 다음 달 휴가만 신청 가능합니다.";
  }

  if (leaveType === "GENERAL_PRIORITY" && inAprilPolicyMonth) {
    if (!isSameYearMonth(target, nowYear, 5)) return "4월 일반-우선은 5월 대상만 신청 가능합니다.";
    if (now < aprilStart || now > april2At0900) {
      return "4월 일반-우선은 4/1 00:00 ~ 4/2 09:00까지만 신청 가능합니다.";
    }
    return "";
  }

  if (leaveType === "GENERAL_NORMAL" && inAprilPolicyMonth) {
    if (isSameYearMonth(target, nowYear, 4)) {
      if (now < aprilStart || now > aprilEnd) return "4월 일반-후순위(당월)는 4/1 ~ 4/30에만 신청 가능합니다.";
      return "";
    }
    if (isSameYearMonth(target, nowYear, 5)) {
      if (now < april2At0900 || now > aprilEnd) {
        return "4월 일반-후순위(다음달)는 4/2 09:00 ~ 4/30에만 신청 가능합니다.";
      }
      return "";
    }
    return "4월 일반-후순위는 4월(당월) 또는 5월(다음달)만 신청 가능합니다.";
  }

  const firstBusiness = getNthBusinessDay(now.getFullYear(), now.getMonth(), 1, holidaysCache);
  const secondBusiness = getNthBusinessDay(now.getFullYear(), now.getMonth(), 2, holidaysCache);
  firstBusiness.setHours(0, 0, 0, 0);
  secondBusiness.setHours(9, 0, 0, 0);

  const priorityMonthStart = new Date(nowYear, now.getMonth(), 1, 0, 0, 0, 0);
  const priorityMonth2At0900 = new Date(nowYear, now.getMonth(), 2, 9, 0, 0, 0);

  if (leaveType === "GENERAL_PRIORITY") {
    if (now < priorityMonthStart || now > priorityMonth2At0900) {
      return "일반-우선은 매월 1일 00시 ~ 2일 09시까지 신청 가능합니다.";
    }
    return "";
  }

  if (leaveType === "GENERAL_NORMAL") {
    if (now < secondBusiness) return "일반-후순위는 영업일 2일 09시 이후부터 신청 가능합니다.";
    return "";
  }

  if (leaveType === "HALF_DAY") {
    if (now < secondBusiness) return "반차는 영업일 2일 09시 이후부터 신청 가능합니다.";
    return "";
  }

  return "";
}

