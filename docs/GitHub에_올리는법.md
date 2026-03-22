# “GitHub eoroff에 푸시한다”는 뜻

**내 맥에 있는 프로젝트 폴더**의 파일을 **인터넷上的 GitHub 저장소 `eoroff`** 로 보내는 것입니다.  
그래야 Render가 GitHub에서 최신 `render.yaml` 등을 받아서 다시 빌드합니다.

---

## 한 줄 요약

터미널에서 프로젝트 폴더로 들어간 뒤, 아래 네 줄을 **순서대로** 칩니다.

```bash
cd "/Users/threedong/v2_project/surgical-leave-app-v2"
git add -A
git commit -m "Render 설정 수정"
git push
```

`git push` 가 끝나면 “GitHub에 올라갔다” = **푸시 완료**입니다.

---

## 처음 한 번만 할 일 (저장소 연결)

위 명령에서 `git push` 할 때 **에러**가 나면, 아직 GitHub와 연결이 안 된 것입니다.

### 1) 이 폴더가 Git 저장소인지 확인

```bash
cd "/Users/threedong/v2_project/surgical-leave-app-v2"
git status
```

- `not a git repository` 라고 나오면:

```bash
git init
git branch -M main
```

### 2) GitHub에 `eoroff` 저장소가 이미 있어야 함

브라우저에서 `github.com/alsdk4912/eoroff` 가 보이면 OK.

### 3) 연결 주소 붙이기 (remote)

```bash
git remote add origin https://github.com/alsdk4912/eoroff.git
```

이미 `origin` 이 있다고 나오면:

```bash
git remote -v
```

주소가 `eoroff` 가 맞는지 보고, 다르면 GitHub 웹에서 주소를 다시 복사해 수정합니다.

### 4) 첫 푸시

```bash
git push -u origin main
```

GitHub 로그인/토큰을 물어보면 화면 안내에 따라 진행합니다.

---

## Cursor로 하는 방법 (터미널 싫으면)

1. 왼쪽 **소스 제어** 아이콘(가지 모양) 클릭  
2. 변경된 파일 옆 **+** 로 전부 스테이징  
3. 위에 메시지 칸에 `Render 설정 수정` 입력 → **Commit**  
4. **Sync / Push** 버튼이 있으면 눌러서 GitHub로 보내기  

(메뉴 이름은 Cursor 버전마다 조금 다를 수 있습니다.)

---

## 올라갔는지 확인

브라우저에서 `github.com/alsdk4912/eoroff` → 파일 목록에 **`render.yaml`** 이 보이고,  
최근 커밋 메시지가 방금 쓴 것과 같으면 성공입니다.

그다음 Render 대시보드에서 **Manual Deploy** 로 다시 배포하면 됩니다.
