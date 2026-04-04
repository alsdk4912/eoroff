import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

/** 렌더 단계 오류 시 하얀 화면 대신 메시지 표시 (원인 파악·캐시 안내) */
class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Root render error:", error, info);
  }

  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.message || this.state.error);
      return (
        <div
          style={{
            padding: "20px",
            maxWidth: 520,
            margin: "32px auto",
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.5,
          }}
        >
          <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>화면을 불러오지 못했습니다</h1>
          <p style={{ fontSize: 14, color: "#444", margin: "0 0 12px" }}>
            브라우저에서 <strong>캐시 비우기 후 강력 새로고침</strong>을 해 보세요. 문제가 계속되면 아래 오류 문구를 복사해 주세요.
          </p>
          <pre
            style={{
              fontSize: 12,
              background: "#f4f4f5",
              padding: 12,
              borderRadius: 8,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
            }}
          >
            {msg}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </RootErrorBoundary>
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
