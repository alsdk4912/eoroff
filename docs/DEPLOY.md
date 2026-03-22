# EOR v2 (eoroff) 배포 체크리스트

## 1. GitHub Pages (프론트)

- 저장소: **eoroff** → Settings → Pages → Source: **GitHub Actions**
- **Actions** 시크릿 `VITE_API_BASE_URL` = `https://eoroff-api.onrender.com` (끝 `/` 없어도 됨)
  - 저장소 시크릿 또는 빌드 job의 Environment 시크릿 (둘 중 하나, 빌드 job에 `environment:`가 있으면 환경 시크릿이 우선)
- `main` 푸시 후 Actions **Deploy GitHub Pages** 가 초록색인지 확인
- 배포 후 로그인 화면 **빌드 7글자**가 최근 커밋 SHA와 맞는지 확인

## 2. Render (백엔드 API) — **휴가 신청 내역이 사라지지 않게 하려면**

앱은 **`@libsql/client`** 로 DB에 붙습니다.

- **권장(무료 플랜 유지): [Turso](https://turso.tech/) 무료 DB**  
  - DB는 Turso 쪽에 있으므로 Render를 재배포해도 **신청 내역이 유지**됩니다.  
  - Render **Environment** 에 다음을 넣습니다.  
    - `TURSO_DATABASE_URL` — Turso 대시보드의 **Database URL** (보통 `libsql://...`)  
    - `TURSO_AUTH_TOKEN` — 해당 DB용 **토큰**  
  - (선택) `LIBSQL_DATABASE_URL` / `LIBSQL_AUTH_TOKEN` 도 동일 의미로 인식합니다.  
  - 배포 후 `GET .../api/health` 에서 `remoteDb: true`, `dataLossRiskOnDeploy: false` 인지 확인합니다.

### 대안: Render Persistent Disk + 로컬 SQLite 파일

- Turso 없이 **`TURSO_*` 를 비우면** 로컬 파일(`backend/app.sqlite` 또는 `SQLITE_PATH`)을 씁니다.  
- Render **무료 Web Service**는 보통 **영구 디스크 없음** → 재시작·재배포 시 파일 DB가 **초기화**될 수 있습니다.  
- **Disk를 쓸 수 있는 플랜**이면 Disk를 마운트하고 **`SQLITE_PATH`** 를 그 아래 파일로 지정합니다.

#### Disk 설정 예시 (마운트 `/data`)

1. Render → **eoroff-api** → **Disks** → Add Disk — Mount: `/data`  
2. **Environment** → `SQLITE_PATH` = `/data/eoroff.sqlite`  
3. 재시작

### 무료 + Disk 불가 + Turso 미사용

- 이 조합이면 **`dataLossRiskOnDeploy: true`** 가 될 수 있으며, 재배포 시 데이터 유실 위험이 큽니다. **Turso 연동을 권장**합니다.

### 헬스 체크

`GET https://eoroff-api.onrender.com/api/health`

- `dataLossRiskOnDeploy: true` → Turso 연동 또는 Disk + `SQLITE_PATH` 필요.  
- `remoteDb: true` → 원격 libSQL 사용 중.

### 기타

- Build: `npm run render:install`, Start: `npm start`  
- Node **20+** 권장.

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
