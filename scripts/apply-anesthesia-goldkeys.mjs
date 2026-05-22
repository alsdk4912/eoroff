/**
 * Turso 또는 로컬 SQLite에 마취과 골드키 확정 일정 반영 + used_count 갱신
 *
 * npm run db:apply-anesthesia-goldkeys
 */
import "dotenv/config";
import { initDb, isUsingRemoteDb } from "../backend/db.clean.js";
import { applyAnesthesiaGoldkeyLeaves } from "../backend/anesthesiaGoldkeySeed.js";

try {
  await initDb();
  const remote = isUsingRemoteDb();
  console.log(`[db:apply-anesthesia-goldkeys] DB: ${remote ? "Turso(remote)" : "local sqlite"}`);
  if (process.env.CI === "true" && !remote) {
    throw new Error(
      "CI에서는 TURSO_DATABASE_URL·TURSO_AUTH_TOKEN이 필요합니다. GitHub Secrets에 추가 후 다시 실행하세요."
    );
  }
  const result = await applyAnesthesiaGoldkeyLeaves();
  console.log("[db:apply-anesthesia-goldkeys] updated:", result.report.updated.length);
  console.log("[db:apply-anesthesia-goldkeys] inserted:", result.report.inserted.length);
  if (result.report.errors.length) console.warn("errors:", result.report.errors);
  console.log("[db:apply-anesthesia-goldkeys] goldkeys:");
  for (const g of result.goldkeys) {
    console.log(`  ${g.name}: used ${g.used_count}/${g.quota_total}, remaining ${g.remaining_count}`);
  }
  process.exit(0);
} catch (e) {
  console.error("[db:apply-anesthesia-goldkeys] 실패:", e);
  process.exit(1);
}
