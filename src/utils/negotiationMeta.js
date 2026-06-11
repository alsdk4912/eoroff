import {
  isFirstHalfGoldkeyOctoberConsultationRequest,
  isSecondHalfGoldkeyAprilConsultationRequest,
} from "./rules.clean.js";

/** 운영 예외: 해당 날짜·인원 골드키는 수동 협의로 처리 */
export const FORCE_GOLDKEY_NEGOTIATION_KEYS = new Set([
  "2026-05-22|u_nurse_2",
  "2026-05-22|u_nurse_8",
  "2026-05-22|u_nurse_16",
]);

const FORCE_MANUAL_ORDER_ONLY_KEYS = new Set(["2026-05-08|GENERAL_PRIORITY"]);

/** 같은 휴가일 골드키: 최초 신청 시각으로부터 24시간 이내 제출분끼리 협의 */
export const GOLDKEY_NEGOTIATION_WINDOW_MS = 24 * 60 * 60 * 1000;

function toLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function goldkeyAnchorRequestedAtMs(requestRows) {
  const sorted = [...requestRows].sort((a, b) =>
    String(a.requestedAt ?? a.requested_at ?? "").localeCompare(String(b.requestedAt ?? b.requested_at ?? ""))
  );
  const t = new Date(sorted[0]?.requestedAt ?? sorted[0]?.requested_at ?? "").getTime();
  return Number.isFinite(t) ? t : NaN;
}

export function isGoldkeyWithin24HoursAfterAnchor(anchorMs, requestedAtIso) {
  if (!Number.isFinite(anchorMs)) return false;
  const t = new Date(requestedAtIso ?? "").getTime();
  if (!Number.isFinite(t)) return false;
  return t - anchorMs <= GOLDKEY_NEGOTIATION_WINDOW_MS;
}

/** 최초 신청 후 24시간 협의 대기 구간이 아직 열려 있는지 */
export function isGoldkeyNegotiationWindowOpen(anchorMs, nowMs = Date.now()) {
  if (!Number.isFinite(anchorMs)) return false;
  return nowMs < anchorMs + GOLDKEY_NEGOTIATION_WINDOW_MS;
}

export function isForceManualOrderOnly(leaveDate, leaveType) {
  return FORCE_MANUAL_ORDER_ONLY_KEYS.has(`${String(leaveDate ?? "").trim()}|${String(leaveType ?? "").trim()}`);
}

/** 사다리·협의 대상: 최초 신청 후 24시간 이내 제출분(2명 이상일 때만 협의) */
export function filterGoldkeyRowsForNegotiationPeers(rows) {
  const sorted = [...rows].sort((a, b) =>
    String(a.requestedAt ?? a.requested_at ?? "").localeCompare(String(b.requestedAt ?? b.requested_at ?? ""))
  );
  if (sorted.length === 0) return [];
  const month = Number(String(sorted[0]?.leaveDate ?? sorted[0]?.leave_date ?? "").slice(5, 7));

  if (month >= 1 && month <= 6) {
    const octConsult = sorted.filter((r) => isFirstHalfGoldkeyOctoberConsultationRequest(r));
    if (octConsult.length >= 2) return octConsult;
    const anchorMs = goldkeyAnchorRequestedAtMs(sorted);
    return sorted.filter((r) => isGoldkeyWithin24HoursAfterAnchor(anchorMs, r.requestedAt ?? r.requested_at));
  }
  if (month >= 7 && month <= 12) {
    const aprConsult = sorted.filter((r) => isSecondHalfGoldkeyAprilConsultationRequest(r));
    if (aprConsult.length >= 2) return aprConsult;
    const anchorMs = goldkeyAnchorRequestedAtMs(sorted);
    return sorted.filter((r) => isGoldkeyWithin24HoursAfterAnchor(anchorMs, r.requestedAt ?? r.requested_at));
  }

  const anchorMs = goldkeyAnchorRequestedAtMs(sorted);
  return sorted.filter((r) => isGoldkeyWithin24HoursAfterAnchor(anchorMs, r.requestedAt ?? r.requested_at));
}

/** 저장된 사다리 결과 키 집합 (`leaveDate|leaveType`) */
export function buildLadderDoneKeySet(ladderResults) {
  const set = new Set();
  for (const r of Array.isArray(ladderResults) ? ladderResults : []) {
    const d = String(r?.leaveDate ?? "").trim();
    const t = String(r?.leaveType ?? "").trim();
    if (d && t) set.add(`${d}|${t}`);
  }
  return set;
}

function goldkeyLadderDoneKey(leaveDateYmd) {
  const d = String(leaveDateYmd ?? "").trim();
  return d ? `${d}|GOLDKEY` : "";
}

/** 같은 휴가일 골드키 중 실제 협의가 필요한 신청 id (24시간 내 2명 이상) */
function goldkeyIdsNeedingNegotiation(rows, options = {}) {
  const sorted = [...rows].sort((a, b) =>
    String(a.requestedAt ?? a.requested_at ?? "").localeCompare(String(b.requestedAt ?? b.requested_at ?? ""))
  );
  const forced = sorted.filter((r) =>
    FORCE_GOLDKEY_NEGOTIATION_KEYS.has(`${String(r.leaveDate ?? r.leave_date ?? "")}|${String(r.userId ?? r.user_id ?? "")}`)
  );
  if (forced.length >= 2) return new Set(forced.map((r) => String(r.id)));

  const peers = filterGoldkeyRowsForNegotiationPeers(sorted);
  if (peers.length >= 2) return new Set(peers.map((r) => String(r.id)));
  return new Set();
}

/**
 * 같은 휴가일·같은 유형 기준 협의/신청순 판정 (캘린더 칩·상세 목록 공통).
 * @returns {Map<string, { mode: string, autoRank?: number }>}
 */
export function buildNegotiationMetaByRequestId(dayRequests, leaveDateYmd, options = {}) {
  const map = new Map();
  const selectedYmd = String(leaveDateYmd ?? "").trim();
  if (!selectedYmd) return map;

  const nowMs = options.nowMs ?? Date.now();
  const todayYmd = options.todayYmd ?? toLocalYMD(new Date());
  const active = (Array.isArray(dayRequests) ? dayRequests : []).filter(
    (r) => String(r.leaveDate ?? r.leave_date ?? "").slice(0, 10) === selectedYmd && r.status !== "CANCELLED"
  );

  const byType = new Map();
  for (const r of active) {
    const lt = r.leaveType ?? r.leave_type;
    if (!byType.has(lt)) byType.set(lt, []);
    byType.get(lt).push(r);
  }

  for (const [, list] of byType) {
    const forcedManual = isForceManualOrderOnly(list[0]?.leaveDate ?? list[0]?.leave_date, list[0]?.leaveType ?? list[0]?.leave_type);
    if (forcedManual) {
      for (const r of list) map.set(String(r.id), { mode: "manual" });
      continue;
    }
    if (list.length === 1) {
      const only = list[0];
      const ld = String(only.leaveDate ?? only.leave_date ?? "").slice(0, 10);
      const lt = only.leaveType ?? only.leave_type;
      if (lt === "GENERAL_NORMAL" && ld > todayYmd) {
        map.set(String(only.id), { mode: "negotiate" });
        continue;
      }
      if (lt === "GOLDKEY") {
        const ladderDoneKeys = options.ladderDoneKeys ?? null;
        const gkLadderDone = Boolean(ladderDoneKeys?.has?.(goldkeyLadderDoneKey(selectedYmd)));
        if (gkLadderDone) {
          map.set(String(only.id), { mode: "negotiate", ladderDone: true });
          continue;
        }
        const negotiateIds = goldkeyIdsNeedingNegotiation([only], { nowMs });
        if (negotiateIds.has(String(only.id))) {
          map.set(String(only.id), { mode: "negotiate" });
          continue;
        }
        const anchorMs = goldkeyAnchorRequestedAtMs([only]);
        if (isGoldkeyNegotiationWindowOpen(anchorMs, nowMs)) {
          map.set(String(only.id), { mode: "waitingWindow" });
        } else {
          map.set(String(only.id), { mode: "auto", autoRank: 1 });
        }
        continue;
      }
      map.set(String(only.id), { mode: "single" });
      continue;
    }

    const sortedAll = [...list].sort((a, b) =>
      String(a.requestedAt ?? a.requested_at ?? "").localeCompare(String(b.requestedAt ?? b.requested_at ?? ""))
    );
    const leaveType0 = list[0]?.leaveType ?? list[0]?.leave_type;
    const ladderDoneKeys = options.ladderDoneKeys ?? null;
    const gkLadderDone =
      leaveType0 === "GOLDKEY" && Boolean(ladderDoneKeys?.has?.(goldkeyLadderDoneKey(selectedYmd)));
    const goldkeyNegotiateIds =
      leaveType0 === "GOLDKEY" && !gkLadderDone ? goldkeyIdsNeedingNegotiation(list, { nowMs }) : new Set();
    const gkAnchorMs = leaveType0 === "GOLDKEY" ? goldkeyAnchorRequestedAtMs(sortedAll) : NaN;
    const gkWindowOpen = leaveType0 === "GOLDKEY" && isGoldkeyNegotiationWindowOpen(gkAnchorMs, nowMs);

    for (const r of list) {
      const lt = r.leaveType ?? r.leave_type;
      const reqAt = r.requestedAt ?? r.requested_at;

      if (lt === "GENERAL_PRIORITY" || lt === "GENERAL") {
        map.set(String(r.id), { mode: "negotiate" });
        continue;
      }
      if (lt === "GENERAL_NORMAL") {
        map.set(String(r.id), { mode: "negotiate" });
        continue;
      }
      if (lt === "GOLDKEY") {
        const autoRankGlobal = sortedAll.findIndex((x) => x.id === r.id) + 1;
        if (gkLadderDone) {
          map.set(String(r.id), { mode: "negotiate", ladderDone: true });
        } else if (goldkeyNegotiateIds.has(String(r.id))) {
          map.set(String(r.id), { mode: "negotiate" });
        } else if (
          gkWindowOpen &&
          goldkeyNegotiateIds.size === 0 &&
          isGoldkeyWithin24HoursAfterAnchor(gkAnchorMs, reqAt)
        ) {
          map.set(String(r.id), { mode: "waitingWindow" });
        } else {
          map.set(String(r.id), { mode: "auto", autoRank: autoRankGlobal });
        }
        continue;
      }

      const myDay = toLocalYMD(new Date(reqAt));
      const sameSubmitDayPeers = list.filter((x) => toLocalYMD(new Date(x.requestedAt ?? x.requested_at)) === myDay);
      const autoRankGlobal = sortedAll.findIndex((x) => x.id === r.id) + 1;
      if (sameSubmitDayPeers.length >= 2) {
        map.set(String(r.id), { mode: "negotiate" });
      } else {
        map.set(String(r.id), { mode: "auto", autoRank: autoRankGlobal });
      }
    }
  }

  for (const r of Array.isArray(dayRequests) ? dayRequests : []) {
    if (String(r.leaveDate ?? r.leave_date ?? "").slice(0, 10) === selectedYmd && r.status === "CANCELLED") {
      map.set(String(r.id), { mode: "cancelled" });
    }
  }

  return map;
}

/** 캘린더 점선: 동일 휴가일·24시간 내 2명 이상 골드키로 협의 순번 미정일 때만 */
export function isGoldkeyNegotiationPendingChip(requestRow, metaByRequestId) {
  if (!requestRow || (requestRow.leaveType ?? requestRow.leave_type) !== "GOLDKEY") return false;
  if (String(requestRow.status ?? "").trim() !== "APPLIED") return false;
  const meta = metaByRequestId?.get?.(String(requestRow.id));
  if (meta?.ladderDone) return false;
  return meta?.mode === "negotiate";
}

export function goldkeyNegotiationChipHint(meta) {
  if (meta?.mode === "waitingWindow") return " · 24시간 내 동일일 신청 대기";
  if (meta?.mode === "negotiate") return " · 협의 대기(동일일·24시간 내 신청)";
  return "";
}

/** 캘린더: 확정 전 골드키(신청순 자동 대기 포함) */
export function isGoldkeyUnconfirmedChip(requestRow) {
  if (!requestRow || (requestRow.leaveType ?? requestRow.leave_type) !== "GOLDKEY") return false;
  const st = String(requestRow.status ?? "").trim();
  return st === "APPLIED";
}
