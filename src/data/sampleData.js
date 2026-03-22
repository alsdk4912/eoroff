// 서버 부트스트랩 이전에 화면이 뜨도록 하는 최소 seed 데이터입니다.
// 로그인 이후에는 `/api/bootstrap` 결과로 실제 데이터가 덮어써집니다.

export const users = [
  { id: "u_admin_001", name: "관리자", role: "ADMIN", employeeNo: "A0001" },
  { id: "u_admin_002", name: "진기숙", role: "ADMIN", employeeNo: "A0002" },
  { id: "u_nurse_001", name: "오민아", role: "NURSE", employeeNo: "N0001" },
];

export const initialGoldkeys = [{ userId: "u_nurse_001", quotaTotal: 10, usedCount: 0, remainingCount: 10 }];
export const initialRequests = [];
export const initialPriorityNotes = [];
export const initialCancellations = [];
export const initialSelections = [];
export const initialAdjustmentLogs = [];
export const holidaysCache = [];
