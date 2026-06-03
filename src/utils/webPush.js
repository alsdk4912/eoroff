import { api } from "../api/client.js";

export function isWebPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export function appServiceWorkerScope() {
  const scope = import.meta.env.BASE_URL || "/";
  return scope.endsWith("/") ? scope : `${scope}/`;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** PWA·푸시용 서비스 워커 등록 (권한 요청 없음) */
export async function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const scope = appServiceWorkerScope();
  const swUrl = `${scope}sw.js`;
  let reg = await navigator.serviceWorker.getRegistration(scope);
  if (!reg) {
    reg = await withTimeout(
      navigator.serviceWorker.register(swUrl, { scope, updateViaCache: "none" }),
      10000,
      "서비스 워커 등록 시간이 초과되었습니다."
    );
  }
  void reg.update();
  return withTimeout(navigator.serviceWorker.ready, 10000, "서비스 워커 준비 시간이 초과되었습니다.");
}

/** 브라우저 푸시 구독 객체 반환 (없으면 생성) */
export async function getOrCreatePushSubscription(readyReg) {
  const keyResp = await api.getPushVapidPublicKey();
  const publicKey = String(keyResp?.publicKey ?? "").trim();
  if (!publicKey) throw new Error("서버 VAPID 설정이 없어 푸시를 사용할 수 없습니다.");

  let sub = await readyReg.pushManager.getSubscription();
  if (!sub) {
    sub = await withTimeout(
      readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }),
      12000,
      "푸시 구독 시간이 초과되었습니다."
    );
  }
  return sub;
}

export async function syncPushSubscriptionToServer(userId, subscription) {
  await api.savePushSubscription({
    userId,
    subscription: subscription.toJSON(),
  });
}

/** 권한이 이미 허용된 경우 조용히 구독·서버 동기화 (로그인 시) */
export async function trySilentPushResubscribe(userId) {
  if (!userId || !isWebPushSupported()) return false;
  if (Notification.permission !== "granted") return false;
  try {
    const readyReg = await registerAppServiceWorker();
    const sub = await getOrCreatePushSubscription(readyReg);
    await syncPushSubscriptionToServer(userId, sub);
    return true;
  } catch (e) {
    console.warn("[push] silent resubscribe failed", e);
    return false;
  }
}

/** 사용자에게 권한 요청 후 푸시 활성화 */
export async function enableWebPushForUser(userId, { sendTest = true } = {}) {
  if (!userId) throw new Error("로그인이 필요합니다.");
  if (!isWebPushSupported()) throw new Error("이 기기/브라우저는 Web Push를 지원하지 않습니다.");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("알림 권한이 허용되지 않았습니다.");

  const readyReg = await registerAppServiceWorker();
  const sub = await getOrCreatePushSubscription(readyReg);
  await syncPushSubscriptionToServer(userId, sub);
  if (sendTest) await api.sendPushTestToSelf({ userId });
  return true;
}

/** 탭이 백그라운드일 때 앱 내 폴링으로 새 알림이 생기면 로컬 알림(푸시 보조) */
export function showLocalNotificationIfAllowed({ title, body, tag }) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    const n = new Notification(String(title || "EOR 알림"), {
      body: String(body || ""),
      tag: tag || `eor-local-${Date.now()}`,
      icon: `${appServiceWorkerScope()}icon-192.png`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* iOS 등 미지원 환경 */
  }
}

export function pushSetupHintForPlatform() {
  const ua = String(navigator.userAgent || "");
  const ios = /iPhone|iPad|iPod/i.test(ua);
  if (ios) {
    return "아이폰: Safari에서 공유 → 「홈 화면에 추가」 후, 추가된 앱 아이콘으로 실행해야 푸시가 동작합니다.";
  }
  if (/Android/i.test(ua)) {
    return "안드로이드: Chrome 메뉴 → 「홈 화면에 추가」 또는 「앱 설치」 후 실행하면 푸시가 안정적입니다.";
  }
  return "브라우저에서 이 사이트 알림을 허용하고, 가능하면 홈 화면에 추가해 사용하세요.";
}
