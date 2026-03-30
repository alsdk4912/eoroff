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
  SELECTED: "선정",
  APPROVED: "승인",
  CANCELLED: "취소",
  REJECTED: "미선정",
};

export function toMonthString(dateLike) {
  const d = new Date(dateLike);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function addMonths(baseDate, offset) {
  const d = new Date(baseDate);
  d.setMonth(d.getMonth() + offset);
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

/**
 * 관리자 신청 목록: 같은 휴가일·같은 유형에서 협의 순번이 있으면 우선.
 * 골드키: 휴가일이 다르면 신청시각 순, 같은 휴가일이면 순번→신청시각(먼저 신청한 사람이 앞).
 */
export function compareAppliedRequests(a, b, users) {
  const t = leaveTypeOrder(a.leaveType) - leaveTypeOrder(b.leaveType);
  if (t !== 0) return t;
  if (a.leaveType === "GOLDKEY" && b.leaveType === "GOLDKEY") {
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

  if (leaveType === "GOLDKEY") {
    if (targetMonth < plus2) return "골드키는 현재월+2달부터 신청 가능합니다.";
    if ((remainingGoldkey ?? 0) <= 0) return "잔여 골드키가 없습니다.";
    if (hasBlockingGoldkeyOnDate(requests, userId, leaveDate)) {
      return "해당 날짜에 이미 골드키 신청이 있습니다.";
    }
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

  const firstBusiness = getNthBusinessDay(now.getFullYear(), now.getMonth(), 1, holidaysCache);
  const secondBusiness = getNthBusinessDay(now.getFullYear(), now.getMonth(), 2, holidaysCache);
  firstBusiness.setHours(0, 0, 0, 0);
  secondBusiness.setHours(9, 0, 0, 0);

  if (leaveType === "GENERAL_PRIORITY") {
    if (now < firstBusiness || now > secondBusiness) {
      return "일반-우선은 영업일 1일 00시 ~ 영업일 2일 09시까지 신청 가능합니다.";
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

