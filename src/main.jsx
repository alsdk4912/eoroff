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

if ("serviceWorker" in navigator) {
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
        /* 배포 직후 새 SW를 더 빨리 받기 위해 주기적으로 업데이트 확인 */
        window.setInterval(
          () => {
            if (document.visibilityState === "visible") void reg.update();
          },
          3 * 60 * 1000
        );
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });
  });
}
