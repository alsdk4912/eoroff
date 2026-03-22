import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4015";
const STATIC_DIR = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : path.join(__dirname, "dist");
const PORT = Number(process.env.PORT || 5193);

// API: 백엔드(local)의 /api로 프록시합니다.
// 모바일/터널 환경에서 프론트와 API를 같은 origin으로 맞추면
// localtunnel 비밀번호/쿠키 이슈를 크게 줄일 수 있습니다.
app.use("/api", async (req, res) => {
  try {
    const target = `${BACKEND_URL}${req.originalUrl}`;

    let body;
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && req.body !== undefined) {
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }

    // 불필요한 hop-by-hop 헤더는 제거(Host 등).
    const headers = {
      "content-type": req.headers["content-type"] || "application/json",
    };

    const r = await fetch(target, { method, headers, body });
    const text = await r.text();

    res.status(r.status);
    const ct = r.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: "proxy_error", message: e?.message || String(e) });
  }
});

// 정적 파일: dist를 그대로 서빙
app.use(express.static(STATIC_DIR, { index: "index.html" }));

// HashRouter를 사용하므로 대부분은 index.html만 있으면 됩니다.
app.get("*", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
  console.log(`Proxying /api to ${BACKEND_URL}`);
  console.log(`Serving static: ${STATIC_DIR}`);
});

