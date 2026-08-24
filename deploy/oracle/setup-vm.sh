#!/usr/bin/env bash
# Oracle Ubuntu VM에서 한 번 실행: Docker + compose로 eoroff-api 기동
# 사용법:
#   cd ~/eoroff/deploy/oracle   (또는 git clone 후)
#   cp .env.example .env && nano .env
#   bash setup-vm.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "[오류] .env 가 없습니다. 먼저: cp .env.example .env 후 Turso·DOMAIN 을 채우세요."
  exit 1
fi

# shellcheck disable=SC1091
set -a
# DOMAIN / TURSO 등 compose가 읽도록
source .env
set +a

if [[ -z "${DOMAIN:-}" || "${DOMAIN}" == "eoroff-api.duckdns.org" ]]; then
  echo "[경고] DOMAIN 을 본인 DuckDNS 도메인으로 바꿨는지 확인하세요. 현재: ${DOMAIN:-비어 있음}"
fi
if [[ -z "${TURSO_DATABASE_URL:-}" || "${TURSO_DATABASE_URL}" == *"YOUR-DB"* ]]; then
  echo "[오류] TURSO_DATABASE_URL 을 Turso 대시보드 값으로 넣으세요."
  exit 1
fi
if [[ -z "${TURSO_AUTH_TOKEN:-}" || "${TURSO_AUTH_TOKEN}" == *"YOUR_TURSO"* ]]; then
  echo "[오류] TURSO_AUTH_TOKEN 을 Turso 토큰으로 넣으세요."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[1/3] Docker 설치…"
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi

echo "[2/3] 방화벽(ufw) — 22/80/443 (Oracle 콘솔 Security List도 같이 열어야 함)"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH || true
  sudo ufw allow 80/tcp || true
  sudo ufw allow 443/tcp || true
  sudo ufw --force enable || true
fi

echo "[3/3] docker compose up…"
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif sudo docker compose version >/dev/null 2>&1; then
  COMPOSE=(sudo docker compose)
else
  echo "[오류] docker compose 플러그인이 없습니다."
  exit 1
fi

"${COMPOSE[@]}" up -d --build

echo
echo "완료. 잠시 후 확인:"
echo "  curl -sS https://${DOMAIN}/api/health"
echo
echo "다음(본인 PC / GitHub):"
echo "  1) GitHub eoroff → Settings → Secrets → Actions"
echo "     VITE_API_BASE_URL = https://${DOMAIN}   (끝 / 없음)"
echo "  2) Actions에서 Deploy GitHub Pages 재실행 또는 main에 빈 커밋 푸시"
echo "  3) https://alsdk4912.github.io/eoroff/ 새로고침"
