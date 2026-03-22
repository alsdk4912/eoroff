# EOR v2 (eoroff) 배포 체크리스트

## 1. GitHub Pages (프론트)

- 저장소: **eoroff** → Settings → Pages → Source: **GitHub Actions**
- **Actions** 시크릿 `VITE_API_BASE_URL` = `https://eoroff-api.onrender.com` (끝 `/` 없어도 됨)
  - 저장소 시크릿 또는 빌드 job의 Environment 시크릿 (둘 중 하나, 빌드 job에 `environment:`가 있으면 환경 시크릿이 우선)
- `main` 푸시 후 Actions **Deploy GitHub Pages** 가 초록색인지 확인
- 배포 후 로그인 화면 **빌드 7글자**가 최근 커밋 SHA와 맞는지 확인

## 2. Render (백엔드 API)

- Start command 예: `npm start` → `node backend/server.clean.js`
- Root에 `backend/app.sqlite`만 쓰면 **무료 인스턴스 재시작 시 DB가 초기화**될 수 있음. 데이터를 유지하려면 **Persistent Disk**를 마운트하고 DB 경로를 디스크로 두는 설정이 필요합니다.

## 3. 캐시·서비스 워커

- **github.io** 에 올린 Pages에서는 **서비스 워커를 쓰지 않도록** 해 두었습니다. (예전 SW가 옛 JS를 물고 빌드 SHA가 그대로인 것처럼 보이는 문제 방지)
- `index.html` 로드 시 기존 등록 SW를 **unregister** 하는 인라인 스크립트가 한 번 실행됩니다.
- 커스텀 도메인만 쓰는 경우(github.io 아님)에는 로컬과 같이 SW가 등록될 수 있습니다.

## 4. 로컬 개발

```bash
npm install
npm run dev:all
```

- 프론트: `http://localhost:5175` (또는 Vite 안내 포트)
- API: `http://localhost:4015`
