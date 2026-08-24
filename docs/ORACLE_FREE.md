# Oracle Cloud Always Free 에 eoroff-api 올리기

Render가 대역폭 한도로 중지돼도 **Turso 신청 데이터는 그대로**입니다.  
API만 Oracle VM으로 옮기면 `https://alsdk4912.github.io/eoroff/` · 홈화면 앱은 **그대로** 씁니다. (앱 재설치 불필요)

저장소에 준비된 것: `deploy/oracle/` (Docker + Caddy HTTPS)

---

## 전체 흐름

1. **(본인)** Oracle 계정·Always Free ARM VM 만들기  
2. **(본인)** 공인 IP → 무료 도메인(DuckDNS) 연결 + 보안 규칙 80/443/22  
3. **(본인)** VM에 SSH → 이 저장소 clone → `.env`에 Turso 값 → `setup-vm.sh`  
4. **(본인)** GitHub Secret `VITE_API_BASE_URL`을 `https://내도메인`으로 변경 후 Pages 재배포  

에이전트는 1~4의 콘솔·SSH·시크릿을 대신할 수 없습니다. 아래를 순서대로 하면 됩니다.

---

## 1. Oracle 계정 · VM

1. [Oracle Cloud](https://www.oracle.com/cloud/free/) → Always Free 가입 (카드 등록이 필요할 수 있음 · **Always Free만 쓰면 요금 0**이 목표)  
2. Compute → **Create instance**  
   - Image: **Ubuntu 22.04** (또는 24.04)  
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM) — Always Free  
     - OCPU 1 · Memory 6GB 정도면 API에 충분  
   - SSH 키: 본인 PC 공개키 등록  
3. 생성 후 **Public IP** 메모  

> ARM 용량이 “Out of capacity”면 다른 **Availability Domain**을 고르거나, AMD Micro(가능하면)로 시도합니다.

---

## 2. 방화벽 (중요)

Oracle은 VM 안 `ufw`만으로는 부족합니다. **VCN Security List / NSG**에서 인바운드:

| Port | 용도 |
|------|------|
| 22 | SSH |
| 80 | Let’s Encrypt · HTTP |
| 443 | HTTPS API |

---

## 3. 무료 도메인 (HTTPS 필수)

GitHub Pages는 HTTPS라서, API도 **HTTPS**여야 합니다. IP 주소만 `http://`로 쓰면 브라우저가 막습니다.

권장: [DuckDNS](https://www.duckdns.org/)

1. 가입 후 서브도메인 하나 만들기 → Public IP 입력  
2. 예: `eoroff-api.duckdns.org`  

이 이름을 아래 `DOMAIN`에 넣습니다.

---

## 4. VM에 API 올리기

SSH (키·유저명은 콘솔 안내 따름, Ubuntu면 보통 `ubuntu`):

```bash
ssh -i ~/.ssh/oracle_key ubuntu@PUBLIC_IP
```

```bash
sudo apt-get update -y
sudo apt-get install -y git
git clone https://github.com/alsdk4912/eoroff.git
cd eoroff/deploy/oracle
cp .env.example .env
nano .env
```

`.env`에 **Render에 쓰던 Turso 값**을 그대로:

```env
TURSO_DATABASE_URL=libsql://....turso.io
TURSO_AUTH_TOKEN=...
DOMAIN=eoroff-api.duckdns.org
```

(선택) 푸시 쓰던 `VAPID_*`도 있으면 동일하게.

```bash
bash setup-vm.sh
```

확인:

```bash
curl -sS https://eoroff-api.duckdns.org/api/health
```

`ok: true`, `remoteDb: true` 이면 Turso 연결 성공입니다.

코드 갱신 후 재배포:

```bash
cd ~/eoroff && git pull
cd deploy/oracle && docker compose up -d --build
```

---

## 5. GitHub Pages가 새 API를 보게 하기

1. GitHub `eoroff` → **Settings → Secrets and variables → Actions**  
2. `VITE_API_BASE_URL` = `https://eoroff-api.duckdns.org` (**끝 `/` 없음**, Render URL 교체)  
3. **Actions → Deploy GitHub Pages** 수동 실행 (또는 `main` 푸시)  
4. 폰·PC에서 https://alsdk4912.github.io/eoroff/ 열고 **새로고침 / 업데이트**  

홈화면 아이콘은 그대로 두시면 됩니다.

---

## 문제 해결

| 증상 | 확인 |
|------|------|
| `curl https://도메인/api/health` 실패 | Security List 80/443, DuckDNS IP, `docker compose ps` |
| health는 되는데 앱 저장 실패 | GitHub Secret·Pages 재빌드 여부, 로그인 화면 빌드 해시 |
| `remoteDb: false` | `.env` Turso 값 · `docker compose up -d` 재시작 |
| ARM Out of capacity | 다른 AD / 잠시 후 재시도 |

---

## Render와의 관계

- Render `eoroff-api`는 **꺼 두어도 됩니다** (대역폭 Suspend 상태면 어차피 불능).  
- **DB는 Turso**이므로 이중으로 옮길 필요 없습니다.  
- 나중에 Render를 다시 켜도, Pages Secret이 Oracle을 가리키면 Oracle만 사용합니다.
