import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 배포 업데이트 반영 (GitHub Pages + Vite 해시 번들)
 *
 * - 원리: 빌드 시 public/version.json 의 buildId 가 번들의 VITE_APP_BUILD_ID 와 동일.
 *   배포 후 사용자가 예전 JS를 쓰는 경우 fetch 로 최신 version.json 과 불일치 → 새로고침으로 최신 HTML/JS 로드.
 * - localStorage(or.auth 등)는 reload 후에도 유지 → 로그인 유지.
 * - HashRouter: sessionStorage 에 hash 저장 후 reload → 복귀 시 경로 유지.
 *
 * - 자동 새로고침: 불일치 시 1회 2초 지연 reload (같은 원격 buildId 로 반복 시도 방지로 무한 루프 차단).
 * - 수동: 불일치 시 상단 "업데이트" 버튼 표시(자동이 막힌 경우에도 동일 동작).
 */

const SS_HASH = "eor.resumeHashAfterReload";
const SS_RELOAD_FOR = "eor.updateReloadForRemoteBuildId";
const SS_BACKOFF = "eor.versionCheckBackoffUntil";
/** 상단「최신 버전」수동 새로고침 직후 1회만 안내(자동 reload 와 구분) */
const SS_MANUAL_VERSION_TOAST = "eor.manualVersionReloadToast";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_RELOAD_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 12_000;

export function getLocalBuildId() {
  return String(import.meta.env.VITE_APP_BUILD_ID ?? "").trim() || "unknown";
}

/**
 * version.json URL — base 가 "./" 일 때 location.href 의 hash 만 다른 경우
 * new URL("./version.json", "https://host/eoroff#/cal") 가 루트(/version.json)로 잘못 풀리는 브라우저 동작을 피함.
 */
export function getVersionJsonUrl() {
  const b = import.meta.env.BASE_URL || "/";
  if (b.startsWith("/")) {
    const path = b.endsWith("/") ? b : `${b}/`;
    return `${window.location.origin}${path}version.json`;
  }
  const u = new URL(window.location.href);
  u.hash = "";
  u.search = "";
  let pathname = u.pathname || "/";
  if (pathname.endsWith(".html")) {
    pathname = pathname.slice(0, pathname.lastIndexOf("/") + 1);
  } else if (!pathname.endsWith("/")) {
    pathname = `${pathname}/`;
  }
  return `${u.origin}${pathname}version.json`;
}

async function fetchRemoteBuildId() {
  const url = `${getVersionJsonUrl()}?t=${Date.now()}`;
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    return String(j?.buildId ?? "").trim();
  } finally {
    window.clearTimeout(t);
  }
}

/** 앱 마운트 직후 1회: reload 로 복귀한 경우 hash 복원 */
export function restoreHashAfterReload() {
  try {
    const h = sessionStorage.getItem(SS_HASH);
    if (!h) return;
    sessionStorage.removeItem(SS_HASH);
    const want = h.startsWith("#") ? h : `#${h}`;
    if (window.location.hash !== want) {
      window.location.hash = want.replace(/^#/, "");
    }
  } catch {
    /* ignore */
  }
}

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const autoTimerRef = useRef(null);
  const cancelledRef = useRef(false);

  const applyUpdate = useCallback(() => {
    try {
      sessionStorage.setItem(SS_HASH, window.location.hash || "#/calendar");
      sessionStorage.setItem(SS_MANUAL_VERSION_TOAST, "1");
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    /**
     * Vite dev 서버(import.meta.env.DEV)에서는 기본 비활성(매번 HMR과 충돌·불필요).
     * 프로덕션 번들 + vite preview 는 DEV=false → 동작.
     * 로컬에서 검증: VITE_UPDATE_CHECK_IN_DEV=true npm run dev
     */
    const checkEnabled = !import.meta.env.DEV || import.meta.env.VITE_UPDATE_CHECK_IN_DEV === "true";
    if (!checkEnabled) {
      setUpdateAvailable(false);
      return undefined;
    }

    let failStreak = 0;

    async function tick() {
      if (cancelledRef.current) return;
      try {
        const until = parseInt(sessionStorage.getItem(SS_BACKOFF) || "0", 10);
        if (until > Date.now()) return;
      } catch {
        /* ignore */
      }

      let remoteId = "";
      try {
        remoteId = await fetchRemoteBuildId();
        failStreak = 0;
        try {
          sessionStorage.removeItem(SS_BACKOFF);
        } catch {
          /* ignore */
        }
      } catch {
        failStreak += 1;
        if (failStreak >= 4) {
          try {
            sessionStorage.setItem(SS_BACKOFF, String(Date.now() + 10 * 60 * 1000));
          } catch {
            /* ignore */
          }
        }
        return;
      }

      const localId = getLocalBuildId();
      if (!remoteId || !localId || remoteId === localId) {
        try {
          sessionStorage.removeItem(SS_RELOAD_FOR);
        } catch {
          /* ignore */
        }
        setUpdateAvailable(false);
        if (autoTimerRef.current) {
          window.clearTimeout(autoTimerRef.current);
          autoTimerRef.current = null;
        }
        return;
      }

      setUpdateAvailable(true);

      let alreadyTriedRemote = false;
      try {
        alreadyTriedRemote = sessionStorage.getItem(SS_RELOAD_FOR) === remoteId;
      } catch {
        /* ignore */
      }

      if (alreadyTriedRemote) {
        if (autoTimerRef.current) {
          window.clearTimeout(autoTimerRef.current);
          autoTimerRef.current = null;
        }
        return;
      }

      /* 이미 자동 새로고침 예약됨 — visibility/주기 체크로 중복 타이머 방지 */
      if (autoTimerRef.current) return;

      autoTimerRef.current = window.setTimeout(() => {
        autoTimerRef.current = null;
        if (cancelledRef.current) return;
        try {
          sessionStorage.setItem(SS_HASH, window.location.hash || "#/calendar");
          sessionStorage.setItem(SS_RELOAD_FOR, remoteId);
        } catch {
          /* ignore */
        }
        window.location.reload();
      }, AUTO_RELOAD_DELAY_MS);
    }

    void tick();
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    const iv = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(iv);
      if (autoTimerRef.current) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
  }, []);

  return { updateAvailable, applyUpdate };
}

/** 수동 버전 새로고침 후 로드 시 1회 true, 이후 즉시 제거 */
export function consumeManualVersionReloadToast() {
  try {
    if (sessionStorage.getItem(SS_MANUAL_VERSION_TOAST) === "1") {
      sessionStorage.removeItem(SS_MANUAL_VERSION_TOAST);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
