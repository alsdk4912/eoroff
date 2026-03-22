import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);

/**
 * GitHub Pages(github.io): 서비스 워커가 예전 빌드를 오래 캐시해 배포 SHA가 안 바뀐 것처럼 보이는 문제가 있어,
 * 해당 호스트에서는 SW를 등록하지 않음. (index.html 인라인 스크립트에서 기존 SW unregister)
 */
const isGithubPages =
  typeof window !== "undefined" && Boolean(window.location?.hostname?.endsWith?.("github.io"));

if (!isGithubPages && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const scope = import.meta.env.BASE_URL || "/";
    const swUrl = `${scope}sw.js`;
    void navigator.serviceWorker
      .register(swUrl, { scope, updateViaCache: "none" })
      .then((reg) => {
        void reg.update();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void reg.update();
        });
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });
  });
}
