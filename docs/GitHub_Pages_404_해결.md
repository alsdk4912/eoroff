# github.io/eoroff 가 404일 때

Render API(`onrender.com`)는 **별개**입니다.  
`alsdk4912.github.io/eoroff` 는 **GitHub Actions로 Pages를 배포한 뒤**에만 열립니다.

---

## Actions에서 `Failed to create deployment (status: 404)` 가 나올 때

이건 **빌드 실패가 아니라**, GitHub에 **Pages가 “GitHub Actions” 모드로 켜져 있지 않을 때** 나는 오류입니다.

### 꼭 할 일 (순서대로)

1. 브라우저에서 열기:  
   **`https://github.com/alsdk4912/eoroff/settings/pages`**
2. **Build and deployment** 섹션에서  
   **Source** 를 **`GitHub Actions`** 로 바꾼다.  
   - `Deploy from a branch` / `None` 이면 안 됨.
3. 페이지가 저장될 때까지 기다린다.
4. 다시 **Actions** 탭 → **Deploy GitHub Pages** → **Re-run failed jobs** 또는 **Run workflow**

이후 `deploy` 단계가 통과해야 `github.io/eoroff/` 가 열립니다.

---

## 1) 주소 확인

- 맞는 주소: **`https://alsdk4912.github.io/eoroff/`** (슬래시 **한 번**)
- 틀린 예: `.../eoroff//` (슬래시 두 번)

## 2) Pages 소스 설정 (필수)

GitHub → **`eoroff`** 저장소 → **Settings** → 왼쪽 **Pages**

- **Build and deployment → Source** 를 **`GitHub Actions`** 로 선택  
  (Branch / docs 폴더가 아님)

저장 후 잠시 기다리기.

## 3) Actions가 성공했는지 보기

저장소 **Actions** 탭 → **Deploy GitHub Pages** 워크플로

- **초록 체크**면 배포됨 → 1~2분 뒤 `github.io/eoroff/` 다시 열기
- **빨간 X**면 로그를 열어 에러 확인 (보통 `npm ci` 실패 등)

## 4) 수동으로 한 번 더 돌리기

코드 푸시 없이 다시 배포하려면:

1. **Actions** → 왼쪽 **Deploy GitHub Pages** 클릭  
2. 오른쪽 **Run workflow** → **Run workflow** 버튼

(저장소에 최신 `.github/workflows/deploy-pages.yml` 이 있어야 합니다.)

## 5) 첫 배포 시 “승인 대기”

`deploy` 단계가 **Waiting for approval** 이면, 관리자가 **Approve** 해야 사이트가 공개됩니다.

## HTTP 405 (Method Not Allowed) 가 보일 때

GitHub Pages에는 **API 서버가 없습니다.**  
빌드할 때 **Render 주소**를 넣지 않으면, 예전에는 앱이 `github.io/.../api/...` 로 **POST** 를 보내고, 정적 서버가 **405** 를 돌려줄 수 있었습니다.

**해결**

1. `eoroff` 저장소 → **Settings → Secrets → Actions** → `VITE_API_BASE_URL` = `https://당신.onrender.com` (끝 `/` 없음)  
2. **Actions** 로 Pages 워크플로를 다시 성공시키기  

또는 (코드 수정 후) Secret 없이도 **오프라인(샘플) 로그인**만 쓰면 405 없이 열립니다.

---

## 6) Render랑 연결 (로그인/API)

Pages가 뜬 뒤, 폰에서도 DB 쓰려면:

`eoroff` 저장소 → **Settings → Secrets → Actions** → `VITE_API_BASE_URL`  
값: `https://당신의-render주소.onrender.com` (끝 `/` 없음)

넣은 뒤 **Actions를 다시 한 번 성공**시켜야 빌드에 API 주소가 박힙니다.
