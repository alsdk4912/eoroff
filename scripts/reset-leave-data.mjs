/**
 * Turso(LIBSQL_*) 또는 로컬 SQLite(backend/**app.sqlite**)에 연결해
 * 휴가 신청·부가 테이블을 비우고 간호사 골드키를 미사용 기본값으로 맞춥니다.
 *
 * 사용: 프로젝트 루트에서 `npm run db:reset-leave`
 * (환경변수는 .env 또는 Render/Turso 대시보드와 동일하게 설정)
 */
import "dotenv/config";
import { initDb, resetLeaveDataToDefaults } from "../backend/db.clean.js";

try {
  await initDb();
  await resetLeaveDataToDefaults();
  console.log("[db:reset-leave] 완료: 휴가 신청 삭제, 골드키 기본값 복구");
  process.exit(0);
} catch (e) {
  console.error("[db:reset-leave] 실패:", e);
  process.exit(1);
}
