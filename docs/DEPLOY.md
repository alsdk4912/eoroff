# EOR v2 (eoroff) 배포 체크리스트

## 1. GitHub Pages (프론트)

- 저장소: **eoroff** → Settings → Pages → Source: **GitHub Actions**
- **Actions** 시크릿 `VITE_API_BASE_URL` = `https://eoroff-api.onrender.com` (끝 `/` 없어도 됨)
  - 저장소 시크릿 또는 빌드 job의 Environment 시크릿 (둘 중 하나, 빌드 job에 `environment:`가 있으면 환경 시크릿이 우선)
- `main` 푸시 후 Actions **Deploy GitHub Pages** 가 초록색인지 확인
- 배포 후 로그인 화면 **빌드 7글자**가 최근 커밋 SHA와 맞는지 확인

## 2. Render (백엔드 API) — **휴가 신청 내역이 사라지지 않게 하려면**

앱 코드는 배포 시 `requests` 테이블을 **삭제하지 않습니다**. 그런데도 업데이트 후 신청이 안 보이면, 거의 항상 **SQLite 파일이 재배포마다 새로 생겼기 때문**입니다.

- Render **무료 Web Service**는 기본적으로 **영구 디스크가 없음** → 빌드/재시작 시 프로젝트 폴더의 `backend/app.sqlite`가 **초기화**될 수 있음.
- **해결:** **Persistent Disk**를 서비스에 붙이고, 환경 변수 **`SQLITE_PATH`** 를 **디스크 마운트 경로 아래**로 지정합니다.

### 설정 예시 (디스크 마운트를 `/data` 로 했다고 가정)

1. Render → **eoroff-api** → **Disks** → Add Disk  
   - Mount path: `/data`  
   - Size: 플랜에 맞게 (최소 1GB 등)
2. **Environment** → Add Environment Variable  
   - Key: `SQLITE_PATH`  
   - Value: `/data/eoroff.sqlite`
3. 서비스 **재시작** (또는 재배포)

이후에는 같은 `eoroff.sqlite` 파일을 계속 쓰므로, **코드를 푸시해도 이전 휴가 신청 내역이 유지**됩니다.

> **참고:** 무료 플랜에서 Disk를 쓸 수 없다면 Render 정책상 **유료 인스턴스**로 올리거나, 외부 DB(예: 관리형 PostgreSQL)로 이전해야 합니다. Disk 없이는 “절대 유실 없음”을 인프라에서 보장하기 어렵습니다.

### 헬스 체크로 확인

`GET https://eoroff-api.onrender.com/api/health`

- `dataLossRiskOnDeploy: true` 이면 **지금 설정으로는 재배포 시 DB 유실 위험**이 큽니다 → 위처럼 `SQLITE_PATH` + Disk 필요.
- `dataLossRiskOnDeploy: false` 이면 `SQLITE_PATH`가 잡혀 있는 상태입니다.

### 기타

- DB는 **`better-sqlite3`**. Build: `npm run render:install`, Start: `npm start`
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
