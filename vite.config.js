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

/** 프로덕션 빌드에서만 manifest·아이콘 URL에 buildId 쿼리 → 브라우저·PWA가 신규 자산을 더 잘 받게 함 */
function brandingCacheBustPlugin() {
  let query = "";
  let outDirAbs = path.join(__dirname, "dist");

  return {
    name: "eor-branding-cache-bust",
    configResolved(config) {
      outDirAbs = config.build.outDir;
      if (config.command !== "build") return;
      const id = readBuildIdFromPublic();
      if (id && id !== "unknown" && id !== "dev") query = `?v=${encodeURIComponent(id)}`;
    },
    transformIndexHtml(html) {
      if (!query) return html;
      return html
        .replace('href="./manifest.json"', `href="./manifest.json${query}"`)
        .replace('href="./favicon-32.png"', `href="./favicon-32.png${query}"`)
        .replace('href="./icon-192.png"', `href="./icon-192.png${query}"`)
        .replace('href="./apple-touch-icon.png"', `href="./apple-touch-icon.png${query}"`);
    },
    closeBundle() {
      if (!query) return;
      const manifestPath = path.join(outDirAbs, "manifest.json");
      try {
        const j = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        for (const icon of j.icons || []) {
          if (typeof icon.src === "string" && icon.src.startsWith("./") && !icon.src.includes("?")) {
            icon.src = `${icon.src}${query}`;
          }
        }
        fs.writeFileSync(manifestPath, `${JSON.stringify(j, null, 2)}\n`);
      } catch {
        /* dist 없거나 복사 전이면 무시 */
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), brandingCacheBustPlugin()],
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
