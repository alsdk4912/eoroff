# Render에 v2(eoroff) 올리기 — 처음부터 (복붙용)

## 지금 에러가 났다면

`package.json` 을 `/src/` 안에서 찾는다고 나오면 → Render에 **Root Directory 가 `src` 로 잘못 들어간 것**입니다.  
**`package.json`은 GitHub 저장소 맨 바깥(최상단)** 에 있어야 합니다.

### `bash: added: command not found`

Render **Build Command** 칸 맨 앞에 **`added`** 같은 단어가 들어가 있을 때 납니다 (diff 복사 실수).  
**Settings → Build & Deploy → Build Command** 를 **완전히 비운 뒤** 저장하고, **Blueprint 다시 적용**하거나 한 줄만 넣으세요: `npm run render:install`

---

## 방법 A — Blueprint로 한 번에 (추천)

1. Render.com 로그인
2. 대시보드에서 **New +** → **Blueprint**
3. **Connect** 로 GitHub **`eoroff`** 저장소 연결
4. 브랜치 **main** 선택 후 **Apply**  
   → 저장소 안의 **`render.yaml`** 이 읽히면서 **Node / rootDir: .** 로 맞춰집니다.
5. 배포 끝난 뒤 주소로 접속: `https://(이름).onrender.com/api/health`

**이미 Elixir로 만든 서비스가 있다면** 그건 **삭제**하고, 위처럼 **Blueprint**로 다시 만드세요.  
(로그에 `Erlang` / `Elixir` 가 보이면 Node 전용 서비스가 아닙니다.)

---

## 방법 B — Web Service를 손으로 만들 때

1. **New +** → **Web Service** (Elixir / Static Site 말고 **Web Service**)
2. **`eoroff`** 저장소 연결
3. 아래만 정확히 맞추기:

| 항목 | 넣을 값 |
|------|---------|
| **Name** | 아무거나 (예: `eoroff-api`) |
| **Region** | Singapore 등 가까운 곳 |
| **Branch** | `main` |
| **Root Directory** | **비움** (아무 글자도 없음. `src` 넣지 마세요) |
| **Runtime** | **Node** |
| **Build Command** | `npm run render:install` |
| **Start Command** | `npm start` |

4. **Create Web Service**

---

## GitHub 저장소 구조 확인

브라우저에서 `github.com/alsdk4912/eoroff` 열었을 때 **맨 처음 목록에** 아래가 보여야 합니다.

- `package.json`  ← **여기(최상단)**
- `backend/`
- `render.yaml`

`package.json` 이 `src` 안에만 있으면 안 됩니다.  
로컬에서 프로젝트 **전체 폴더**를 그대로 푸시하세요.

---

## package-lock.json “권장” 하는 법 (선택)

터미널에서 프로젝트 폴더로 가서:

```bash
cd "/Users/threedong/v2_project/surgical-leave-app-v2"
npm install
git add package-lock.json
git commit -m "chore: add package-lock.json"
git push
```

없어도 `npm install --omit=dev` 로 배포는 됩니다.

---

## 다음 단계 (GitHub Pages랑 연결)

1. Render 주소 복사: `https://xxxx.onrender.com` (끝에 `/` 없이)
2. GitHub **`eoroff`** 저장소 → **Settings → Secrets and variables → Actions**
3. **New repository secret** → 이름 `VITE_API_BASE_URL` → 값에 위 주소 붙여넣기
4. Actions로 Pages 다시 배포되게 `main`에 빈 커밋 푸시 등으로 워크플로 다시 돌리기
