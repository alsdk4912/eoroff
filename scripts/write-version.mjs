/**
 * 배포 직전 실행: public/version.json 에 고유 buildId 기록.
 * 런타임이 동일 URL로 fetch 해 번들에 박힌 VITE_APP_BUILD_ID 와 비교해 신규 배포 여부를 판별한다.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outFile = path.join(root, "public", "version.json");

function gitShort() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: root }).trim();
  } catch {
    return "";
  }
}

const sha = gitShort() || "nogit";
const builtAt = new Date().toISOString();
/* 커밋이 같아도 재빌드마다 달라지게 해 캐시된 번들 vs 신규 배포 구분 */
const buildId = `${sha}-${Date.now().toString(36)}`;

const payload = { buildId, builtAt, sha };
fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 0)}\n`, "utf8");
console.log("[write-version]", buildId);
