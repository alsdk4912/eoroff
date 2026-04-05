import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.VITE_BASE?.trim() || "./";

/** public/version.json — write-version.mjs(빌드 전) 또는 dev용 기본값 */
function readBuildIdFromPublic() {
  const p = path.join(__dirname, "public", "version.json");
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return String(j.buildId || "unknown");
  } catch {
    return "dev";
  }
}

export default defineConfig({
  base,
  plugins: [react()],
  /** 번들에 박혀 원격 version.json 과 문자열 비교 */
  define: {
    "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(readBuildIdFromPublic()),
  },
  server: {
    host: true,
    port: 5175,
  },
  preview: {
    host: true,
    port: 5175,
  },
});
