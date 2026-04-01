// 서버 부트스트랩 전 초기 화면용. backend/db.clean.js 시드와 동일한 이름·id (API 없을 때 오프라인 로그인)
// 로그인 후 `/api/bootstrap`이 있으면 서버 데이터로 덮어씀.

import { defaultGoldkeyQuotaForName } from "./goldkeyQuotas.js";

const NURSE_NAMES = [
  "오민아",
  "이양희",
  "김해림",
  "손다솜",
  "양현아",
  "유진",
  "이지선",
  "임희종",
  "장성필",
  "장지은",
  "정수영",
  "최유경",
  "최유리",
  "최종선",
  "허정숙",
  "이현숙",
];

const ADMIN_NAMES = ["관리자", "진기숙"];
const EMPLOYEE_NO_BY_NAME = {
  양현아: "0534411",
  오민아: "0550117",
  유진: "0530199",
  윤지민: "0548397",
  이양희: "0512513",
  이지선: "0572657",
  이지현: "0511968",
  임희종: "0511936",
  장성필: "0559871",
  장지은: "0539515",
  정수영: "0592526",
  진기숙: "0516980",
  최유경: "0561359",
  최유리: "0554136",
  최종선: "0552153",
  김인자: "0071876",
  김해림: "0530914",
  박현정: "0516973",
  손다솜: "0548090",
  허정숙: "0511929",
};

export const users = [
  ...NURSE_NAMES.map((name, idx) => ({
    id: `u_nurse_${idx + 1}`,
    name,
    role: "NURSE",
    employeeNo: EMPLOYEE_NO_BY_NAME[name] || `N${String(idx + 1).padStart(4, "0")}`,
  })),
  ...ADMIN_NAMES.map((name, idx) => ({
    id: `u_admin_${idx + 1}`,
    name,
    role: "ADMIN",
    employeeNo: EMPLOYEE_NO_BY_NAME[name] || `A${String(idx + 1).padStart(4, "0")}`,
  })),
];

export const initialGoldkeys = NURSE_NAMES.map((name, idx) => {
  const q = defaultGoldkeyQuotaForName(name);
  return {
    userId: `u_nurse_${idx + 1}`,
    quotaTotal: q,
    usedCount: 0,
    remainingCount: q,
  };
});

export const initialRequests = [];
export const initialPriorityNotes = [];
export const initialCancellations = [];
export const initialSelections = [];
export const initialAdjustmentLogs = [];
export const holidaysCache = [];
export const initialHolidayDuties = {};
export const initialLadderResults = [];
