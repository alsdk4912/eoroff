# 앱 업데이트 자동 반영 (배포 버전 감지)

## 변경 파일

| 파일 | 설명 |
|------|------|
| `scripts/write-version.mjs` | `npm run build` 직전 실행, `public/version.json`에 `buildId` / `builtAt` / `sha` 기록 |
| `vite.config.js` | `public/version.json`을 읽어 `import.meta.env.VITE_APP_BUILD_ID`를 번들에 주입 |
| `package.json` | `build` 스크립트에 `write-version` 선행 |
| `src/useAppUpdate.js` | 운영에서만 원격 `version.json`과 로컬 빌드 ID 비교, 자동 새로고침·업데이트 버튼 |
| `src/App.jsx` | `useAppUpdate`, 해시 복원, 헤더 `업데이트` 버튼 |
| `src/styles.css` | `.app-header-update-btn` 스타일 |
| `public/sw.js` | `version.json` 요청은 항상 네트워크(`no-store`), 캐시 이름 버전 업 |

## 동작 요약

1. **빌드**: `buildId`는 `git rev-parse --short` + 재빌드 구분용 짧은 접미(타임스탬프 base36)로 매 빌드 고유.
2. **런타임(`npm run dev` 제외)**: `vite build` + `vite preview` / GitHub Pages 등에서 `version.json`을 `cache: no-store`로 가져와 번들의 `VITE_APP_BUILD_ID`와 비교.
3. **불일치 시**: 약 2초 후 `location.reload()` 1회 시도(해시 라우트는 `sessionStorage`에 저장 후 복원).
4. **같은 원격 `buildId`로 이미 자동 새로고침을 시도한 뒤에도 여전히 불일치**(SW/브라우저 캐시 등)면 **무한 새로고침 방지**를 위해 자동 재시도는 하지 않고, **「업데이트」 버튼만** 유지.
5. **네트워크 실패**: 연속 실패 시 10분 백오프; 실패해도 기존 앱은 그대로 사용.
6. **개발(`npm run dev`)**: 기본 비활성(`import.meta.env.DEV`). HMR과 맞지 않고, `version.json`이 매번 같아 버튼이 쓸모없음.  
   로컬에서 업데이트 UI를 보려면: `VITE_UPDATE_CHECK_IN_DEV=true npm run dev` 후 `public/version.json`의 `buildId`만 번들과 다르게 잠시 수정.
7. **GitHub Pages + `base: "./"`**: 예전에는 `new URL('./version.json', …)`가 `/repo#/…` 에서 `/version.json`(루트)으로 잘못 요청될 수 있어 404였음 → **현재 페이지 pathname 기준**으로 `…/repo/version.json` 을 쓰도록 수정됨.

## 자동 새로고침이 가능한 이유

- 정적 호스팅(GitHub Pages) + Vite 해시 파일명 번들에서, **배포 후 사용자가 옛 JS를 들고 있는 경우**에만 `version.json`(서버 최신) ≠ **번들에 박힌 ID**가 됨.
- `reload()`는 **같은 origin·같은 localStorage**를 유지하므로 `or.auth` 등 **로그아웃 없이** 최신 `index.html`/JS를 다시 받을 수 있음.
- Hash 라우트는 `sessionStorage`로 **복귀 시 화면 유지** 가능(완벽하진 않으나 일반 사용에 충분).

## 업데이트 버튼을 함께 둔 이유

- 자동 1회 후에도 캐시 때문에 구번들이 남는 경우, **사용자가 수동으로 한 번 더 새로고침**할 수 있게 함.
- 불일치가 감지된 동안만 표시(앰버 톤으로 구분).

## 환경 변수 / 설정

| 항목 | 설명 |
|------|------|
| `VITE_APP_BUILD_ID` | 빌드 시 `vite.config.js`가 `public/version.json`에서 주입(소스에 직접 쓰지 않음) |
| `import.meta.env.BASE_URL` | `version.json` URL 조합에 사용(Vite `base`) |
| `VITE_UPDATE_CHECK_IN_DEV` | `true`이면 `npm run dev`에서도 버전 체크(디버그용) |

별도 Secrets 불필요.

## 테스트 시나리오

1. **로컬**: `npm run dev` → 업데이트 로직 미동작, 콘솔 에러 없음.
2. **프로덕션 빌드**: `npm run build` → `dist/version.json`의 `buildId`가 JS 번들 문자열과 일치하는지(수동으로 `grep` 또는 네트워크 탭).
3. **배포 시뮬레이션**: `dist`를 프리뷰 서버로 띄운 뒤, `public/version.json`만 다른 `buildId`로 바꿔 다시 배포하거나, 원격만 수정해 불일치를 만들면 → 약 2초 후 자동 새로고침 또는 「업데이트」 표시.
4. **오프라인**: 네트워크 끊고 앱 사용 → 무한 로딩/무한 새로고침 없음(백오프 후 재시도).

## 참고

- 서비스 워커는 기존대로 주기적 `update()`를 수행하며, `version.json`은 **캐시 우회**하도록 SW에서 별도 처리함.
