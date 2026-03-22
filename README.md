# surgical-leave-app v2

## GitHub Pages (버전2 = 저장소 `eoroff`)

- **URL**: `https://alsdk4912.github.io/eoroff/` (끝 **`/`** 권장)
- 버전1은 저장소 **`eor`** → `https://alsdk4912.github.io/eor/`
- **Settings → Pages → Source: GitHub Actions** 후 `main` 푸시로 배포
- **Render API** 쓰는 경우: 저장소 Secrets에 `VITE_API_BASE_URL` 설정 → 자세한 절차는 `docs/RENDER.md`
- API 없이: 샘플 이름 + 비밀번호 **`1234`**

## v1(원본)과 동시에 개발 서버 띄우기

두 프로젝트가 **같은 포트**를 쓰면 한쪽만 동작하거나 `EADDRINUSE` 오류가 납니다.  
v2는 기본적으로 **프론트 5175 · API 4015**로 분리되어 있습니다.

| 구분 | v1 (저장소 `eor`) | v2 (저장소 `eoroff`) |
|------|-------------------|----------------------|
| Vite | http://localhost:5173 (LAN: 터미널 Network URL) | http://localhost:5175 |
| API | http://localhost:4000 | http://localhost:4015 |

### 실행 예시

**터미널 A — v1**

```bash
cd /path/to/surgical-leave-app
npm run dev:all
```

**터미널 B — v2**

```bash
cd /path/to/surgical-leave-app-v2
npm run dev:all
```

GitHub Pages 등 배포 시에는 저장소/브랜치 **소스가 하나**만 공개되므로, 웹에서 “구버전이 사라진 것처럼” 보이면 Pages 설정에서 브랜치·폴더를 확인하세요.

### 환경 변수

로컬 기본값은 코드와 `vite.config.js`에 맞춰져 있습니다. 바꾸려면 `.env.example`을 참고해 `.env`를 만드세요.
