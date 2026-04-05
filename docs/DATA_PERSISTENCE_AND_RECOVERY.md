# 휴가 데이터 보존·감사·복구 (eoroff v2)

## 변경 파일 목록

| 경로 | 내용 |
|------|------|
| `backend/db.clean.js` | `leave_request_audit` 테이블, `requests` 소프트 삭제 컬럼, `cancellations.revoked_*`, 트랜잭션 `queryAll`/`queryOne`, 골드키/백필 쿼리 보강, `reset` 시 감사 테이블 삭제 |
| `backend/server.clean.js` | 감사 INSERT, 승인/거절/취소/복원/협의순번 트랜잭션, 멱등 키, 상태 충돌 방지, CSV 내보내기, `/api/health` 감사 행 수 |
| `src/api/client.clean.js` | `rejectRequest` 본문, CSV 다운로드 메서드 |
| `src/App.jsx` | 거절 시 `actorUserId`, 협의 순번에 처리자, 관리자 CSV UI |
| `docs/DATA_PERSISTENCE_AND_RECOVERY.md` | 본 문서 |

## DB 스키마 변경

### `leave_request_audit` (신규)

| 컬럼 | 설명 |
|------|------|
| `id` | PK |
| `leave_request_id` | 대상 휴가 요청 ID |
| `action` | `APPLY`, `APPROVE`, `REJECT`, `CANCEL`, `UNCANCEL`, `NEGOTIATION_ORDER_SET`, `NEGOTIATION_ORDER_CLEAR` 등 |
| `from_status` / `to_status` | 변경 전·후 상태 (신청 시 `from_status`는 NULL 가능) |
| `actor_user_id` | 처리자(간호사/관리자/시스템 식별자) |
| `reason` | 거절·취소·복원 사유 등 |
| `idempotency_key` | UNIQUE, 동일 키 재전송 시 멱등 응답 |
| `metadata_json` | 협의 순번 이전/이후 값, selectionId 등 부가 정보 |
| `created_at` | ISO 시각 |

인덱스: `(leave_request_id, created_at)`, `created_at`.

### `requests` (마이그레이션)

| 컬럼 | 설명 |
|------|------|
| `deleted_at` | 소프트 삭제 시각 (NULL = 활성) |
| `deleted_yn` | 0/1 (조회는 주로 `deleted_at IS NULL`) |

일반 API·bootstrap은 **`deleted_at IS NULL`** 인 행만 반환.

### `cancellations` (마이그레이션)

| 컬럼 | 설명 |
|------|------|
| `revoked_at` | 관리자 복원(uncancel) 시각 — **물리 DELETE 대신** 이력 보존 |
| `revoked_by` | 복원 처리 관리자 ID |

활성 취소만 보려면 `revoked_at IS NULL`. bootstrap도 동일 필터.

## 이력 저장 방식

- **현재 상태**는 `requests.status` (및 협의 `negotiation_order` 등).
- **누적 이력**은 `leave_request_audit`에 append-only에 가깝게 저장.
- 승인 시 기존 `selections` 테이블은 그대로(선택 시각·선택자); 감사 행은 **승인 결정**을 별도로 남김.
- 거절도 감사에 `REJECT`로 기록(과거에는 `requests`·알림만 있던 부분 보강).
- 협의 순번 변경은 상태가 같아도 `metadata_json`에 이전/이후 순번을 넣어 추적.

## 장애·유실 방지 포인트

1. **트랜잭션**: 상태 변경(`UPDATE requests`)과 감사 `INSERT`를 **동일 트랜잭션**에서 처리 — 부분 반영 방지.
2. **동시성**: 승인/거절 시 트랜잭션 내 재조회 후 `APPLIED`가 아니면 충돌 오류(409) — 낙관적 동시 제어.
3. **멱등성**: `Idempotency-Key` 헤더 또는 본문 `idempotencyKey` + DB UNIQUE — 네트워크 재시도 시 중복 이력·중복 상태 변경 완화.
4. **배포 유실**: `/api/health`의 `dataLossRiskOnDeploy` — Render 로컬 SQLite 무료 디스크 미사용 시 true. **Turso(libSQL) + `TURSO_*` 환경변수** 권장.
5. **취소 복원**: `cancellations` 행을 지우지 않고 `revoked_*`로 남김 — 취소·복원 **타임라인** 유지.

## 백업 및 복구 권장

| 우선순위 | 방식 |
|----------|------|
| 1 | **Turso(또는 libSQL 호환) 원격 DB** — 앱 재배포와 무관하게 데이터 유지 |
| 2 | Turso **CLI/API 덤프** 또는 공식 백업(스케줄) — 주기적 스냅샷 |
| 3 | 관리자 **CSV 내보내기** (`/admin` → 신청·상태 / 상태 변경 이력) — **감사·열람·오프라인 보관**용. **원장 복구의 단일 진실 공급원으로 쓰기엔 부적합**(재적재 스크립트 미제공) |
| 4 | `POST /api/admin/reset-leave-data*` — **파괴적** 초기화. 운영에서는 제한·감사 로그 권장 |

**복구 기준**: 운영 복구는 **DB 백업 파일·Turso 시점 복구**를 기준으로 하고, CSV는 그와 대조·증빙용으로 사용하는 것이 안전합니다.

## 테스트 시나리오 (수동)

1. **신청**: 휴가 신청 후 DB에 `leave_request_audit`에 `APPLY` 1행, `requests` 1행.
2. **승인**: `APPLIED` → `APPROVED`, 감사 `APPROVE`, `selections` 1행, 동일 요청 재승인 시 `alreadyApproved`.
3. **거절**: 관리자 거절 시 `actorUserId` 포함 요청, 감사 `REJECT`, 비-`APPLIED` 상태에서 거절 시 409.
4. **취소·복원**: 취소 후 `cancellations` 1행; 복원 시 해당 행에 `revoked_at` 설정, 감사 `UNCANCEL`, bootstrap에 취소 목록에서 사라짐.
5. **멱등**: 동일 `Idempotency-Key`로 승인 API 재호출 → `idempotentReplay` (상태 변경 없음).
6. **CSV**: 관리자로 기간 지정 후 다운로드, Excel에서 한글 깨짐 없음(BOM 포함).
7. **헬스**: `GET /api/health`에 `leaveRequestAuditRows` 증가 확인.
