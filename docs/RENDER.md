# Render에 버전2 API 올리기 (`eoroff` 저장소)

GitHub Pages 주소: **`https://USER.github.io/eoroff/`**  
Pages는 정적 파일만 제공하므로, 폰·PWA에서 공용 DB를 쓰려면 API를 Render 등에 배포합니다.

## Render Web Service

1. Render → **New** → **Blueprint** 로 이 저장소 연결 (`render.yaml` 사용) **또는** **Web Service** → **Environment: Node** (Elixir 아님!)
2. **Build**: `npm install --omit=dev` (Blueprint면 `render.yaml`에 이미 있음)  
3. **Start**: `npm start` (`backend/server.clean.js`, `PORT`는 Render가 지정)  

### `npm ci` / package-lock.json 오류가 났다면

- 예전 설정은 `npm ci`라서 **`package-lock.json`이 Git에 없으면** 빌드가 실패합니다.  
- 지금 `render.yaml`은 **`npm install --omit=dev`** 로 바뀌어 있어 lock 파일 없이도 됩니다.  
- 그래도 로컬에서 `npm install` 후 **`package-lock.json`을 커밋·푸시**해 두면 버전이 고정되어 더 안전합니다.
4. 배포 후 `https://<이름>.onrender.com/api/health` 확인  

무료 플랜은 **슬립** 후 첫 요청이 느릴 수 있습니다.

## GitHub Actions + API URL

`eoroff` 저장소 → **Settings → Secrets → Actions** → `VITE_API_BASE_URL`  
값: `https://xxxx.onrender.com` (**끝 슬래시 없음**)

워크플로에 이미 `VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}` 가 있으면 `main` 푸시로 재빌드됩니다.  
Secret을 비워 두면 빈 값으로 빌드되어 GitHub Pages에서는 **오프라인(샘플) 로그인** 모드가 됩니다.

## 같은 Wi-Fi 로컬 테스트 (Render 없이)

터미널의 **Network** URL로 폰에서 접속하면 됩니다. **`.env` 불필요** (자동으로 같은 IP의 4015 포트 사용).

## SQLite

Render 무료 인스턴스는 재배포 시 DB가 초기화될 수 있습니다.
