import { useMemo, useState } from "react";

function dialHref(user) {
  const digits = String(user?.phone ?? user?.employeeNo ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `tel:${digits}`;
}

function DutyCallRow({ label, user }) {
  const href = user ? dialHref(user) : null;
  return (
    <li className="emergency-duty-row">
      <span className="emergency-duty-row__label">{label}</span>
      <span className="emergency-duty-row__name">{user?.name ?? "미지정"}</span>
      {href ? (
        <a className="emergency-duty-row__call" href={href}>
          전화걸기
        </a>
      ) : (
        <span className="help emergency-duty-row__call--disabled">번호 없음</span>
      )}
    </li>
  );
}

export default function EmergencySurgeryPanel({
  selectedYmd,
  holidayName,
  holidayDuties,
  users,
  serverMode,
  onNotify,
}) {
  const [surgeryName, setSurgeryName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [anesthesiaType, setAnesthesiaType] = useState("GENERAL");
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState("");

  const duty = holidayDuties?.[selectedYmd];
  const userById = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);

  const dutyRows = useMemo(
    () => [
      { label: "수술실 당직 1", user: userById.get(duty?.nurse1UserId) },
      { label: "수술실 당직 2", user: userById.get(duty?.nurse2UserId) },
      { label: "마취과 당직", user: userById.get(duty?.anesthesiaUserId) },
      {
        label: "관리자",
        user: (users ?? []).find((u) => u.role === "ADMIN" && u.name === "진기숙"),
      },
    ],
    [duty, userById, users]
  );

  const dutyComplete = Boolean(duty?.nurse1UserId && duty?.nurse2UserId && duty?.anesthesiaUserId);

  async function submitNotify() {
    const name = String(surgeryName ?? "").trim();
    const time = String(startTime ?? "").trim();
    if (!name) {
      setLocalMsg("수술명을 입력해 주세요.");
      return;
    }
    if (!time) {
      setLocalMsg("수술 시작 시간을 입력해 주세요.");
      return;
    }
    if (!serverMode) {
      setLocalMsg("서버 연결 후 알림을 보낼 수 있습니다.");
      return;
    }
    if (!dutyComplete) {
      setLocalMsg("이 날짜 당직자가 아직 등록되지 않았습니다. 관리자에게 당직 등록을 요청해 주세요.");
      return;
    }
    setBusy(true);
    setLocalMsg("");
    try {
      await onNotify({
        leaveDate: selectedYmd,
        surgeryName: name,
        startTime: time,
        anesthesiaType,
      });
      setLocalMsg("당직자·진기숙에게 알림을 보냈습니다.");
    } catch (e) {
      setLocalMsg(e?.message || "알림 전송에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="emergency-surgery-panel">
      <h4 className="emergency-surgery-panel__title">응급 수술 알림</h4>
      <p className="help emergency-surgery-panel__lead">
        {selectedYmd}
        {holidayName ? ` · ${holidayName}` : ""} — 주말·공휴·명절·대체공휴일 당직 연락용입니다.
      </p>

      <ul className="emergency-duty-list">
        {dutyRows.map((row) => (
          <DutyCallRow key={row.label} label={row.label} user={row.user} />
        ))}
      </ul>
      {!dutyComplete ? (
        <p className="help">당직자 3명(수술실 2·마취 1)이 모두 지정된 날짜만 알림을 보낼 수 있습니다.</p>
      ) : null}

      <div className="emergency-surgery-form grid">
        <label className="field-label">수술명</label>
        <input
          type="text"
          value={surgeryName}
          onChange={(e) => setSurgeryName(e.target.value)}
          placeholder="예: 유리체절제술"
          disabled={busy}
        />
        <label className="field-label">수술 시작</label>
        <input
          type="datetime-local"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          disabled={busy}
        />
        <span className="field-label">마취 구분</span>
        <div className="emergency-anesthesia-type row wrap">
          <label>
            <input
              type="radio"
              name="anesthesiaType"
              value="GENERAL"
              checked={anesthesiaType === "GENERAL"}
              onChange={() => setAnesthesiaType("GENERAL")}
              disabled={busy}
            />{" "}
            전신마취
          </label>
          <label>
            <input
              type="radio"
              name="anesthesiaType"
              value="LOCAL"
              checked={anesthesiaType === "LOCAL"}
              onChange={() => setAnesthesiaType("LOCAL")}
              disabled={busy}
            />{" "}
            국소(로컬)마취
          </label>
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 10 }}>
        <button type="button" disabled={busy || !dutyComplete} onClick={() => void submitNotify()}>
          당직·진기숙에게 알림 보내기
        </button>
      </div>
      {localMsg ? <p className="msg">{localMsg}</p> : null}
    </section>
  );
}
