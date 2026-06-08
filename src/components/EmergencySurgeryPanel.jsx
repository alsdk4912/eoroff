import { useEffect, useMemo, useState } from "react";
import {
  SURGERY_START_TOO_SOON_MSG,
  isSurgeryStartTimeAllowed,
  minSurgeryStartDatetimeLocal,
} from "../utils/emergencySurgeryTime.js";

function dialHref(user) {
  const digits = String(user?.phone ?? user?.employeeNo ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `tel:${digits}`;
}

function DutyCallChip({ label, user }) {
  const href = user ? dialHref(user) : null;
  return (
    <div className="emergency-duty-chip">
      <span className="emergency-duty-chip__label">{label}</span>
      <span className="emergency-duty-chip__name">{user?.name ?? "미지정"}</span>
      {href ? (
        <a className="emergency-duty-chip__call" href={href}>
          전화걸기
        </a>
      ) : (
        <span className="help emergency-duty-chip__call--disabled">없음</span>
      )}
    </div>
  );
}

export default function EmergencySurgeryPanel({
  selectedYmd,
  holidayName,
  holidayDuties,
  users,
  serverMode,
  onNotify,
  memoSection = null,
}) {
  const [surgeryName, setSurgeryName] = useState("");
  const [attendingPhysician, setAttendingPhysician] = useState("");
  const [specialistPhysician, setSpecialistPhysician] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [startTime, setStartTime] = useState("");
  const [anesthesiaType, setAnesthesiaType] = useState("GENERAL");
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState("");
  const [minStartLocal, setMinStartLocal] = useState(minSurgeryStartDatetimeLocal);

  const duty = holidayDuties?.[selectedYmd];
  const userById = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);

  const dutyRows = useMemo(
    () => [
      { label: "수술실1", user: userById.get(duty?.nurse1UserId) },
      { label: "수술실2", user: userById.get(duty?.nurse2UserId) },
      { label: "마취", user: userById.get(duty?.anesthesiaUserId) },
      { label: "파트장", user: (users ?? []).find((u) => u.role === "DEPT_HEAD") },
    ],
    [duty, userById, users]
  );

  const dutyComplete = Boolean(duty?.nurse1UserId && duty?.nurse2UserId && duty?.anesthesiaUserId);

  useEffect(() => {
    setSurgeryName("");
    setAttendingPhysician("");
    setSpecialistPhysician("");
    setEmergencyContact("");
    setStartTime("");
    setAnesthesiaType("GENERAL");
    setLocalMsg("");
    setMinStartLocal(minSurgeryStartDatetimeLocal());
  }, [selectedYmd]);

  useEffect(() => {
    const tick = () => setMinStartLocal(minSurgeryStartDatetimeLocal());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  function handleStartTimeChange(next) {
    const value = String(next ?? "").trim();
    if (!value) {
      setStartTime("");
      return;
    }
    if (!isSurgeryStartTimeAllowed(value)) {
      window.alert?.(SURGERY_START_TOO_SOON_MSG);
      return;
    }
    setStartTime(value);
  }

  async function submitNotify() {
    const name = String(surgeryName ?? "").trim();
    const attending = String(attendingPhysician ?? "").trim();
    const specialist = String(specialistPhysician ?? "").trim();
    const contact = String(emergencyContact ?? "").replace(/\D/g, "").trim();
    const time = String(startTime ?? "").trim();

    if (!name) {
      setLocalMsg("수술명을 입력해 주세요.");
      return;
    }
    if (!attending) {
      setLocalMsg("주치의를 입력해 주세요.");
      return;
    }
    if (!specialist) {
      setLocalMsg("담당전공의를 입력해 주세요.");
      return;
    }
    if (!time) {
      setLocalMsg("수술 시작 시간을 입력해 주세요.");
      return;
    }
    if (!isSurgeryStartTimeAllowed(time)) {
      window.alert?.(SURGERY_START_TOO_SOON_MSG);
      return;
    }
    if (!contact || contact.length < 9) {
      setLocalMsg("응급연락처를 입력해 주세요.");
      return;
    }
    if (!serverMode) {
      setLocalMsg("서버 연결 후 알림을 보낼 수 있습니다.");
      return;
    }
    if (!dutyComplete) {
      setLocalMsg("이 날짜 당직자가 아직 등록되지 않았습니다.");
      return;
    }

    setBusy(true);
    setLocalMsg("");
    try {
      await onNotify({
        leaveDate: selectedYmd,
        surgeryName: name,
        attendingPhysician: attending,
        specialistPhysician: specialist,
        emergencyContact: contact,
        startTime: time,
        anesthesiaType,
      });
      setLocalMsg("당직자·부서파트장에게 알림을 보냈습니다.");
    } catch (e) {
      setLocalMsg(e?.message || "알림 전송에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="emergency-duty-day">
      <div className="emergency-duty-day__head">
        <p className="emergency-duty-day__date">
          {selectedYmd}
          {holidayName ? ` · ${holidayName}` : ""}
        </p>
      </div>

      <div className="emergency-duty-day__form">
        <label className="emergency-duty-day__field">
          <span className="field-label">수술명</span>
          <input
            type="text"
            value={surgeryName}
            onChange={(e) => setSurgeryName(e.target.value)}
            placeholder="예: 유리체절제술"
            disabled={busy}
          />
        </label>
        <label className="emergency-duty-day__field">
          <span className="field-label">주치의</span>
          <input
            type="text"
            value={attendingPhysician}
            onChange={(e) => setAttendingPhysician(e.target.value)}
            placeholder="주치의 성명"
            disabled={busy}
          />
        </label>
        <label className="emergency-duty-day__field">
          <span className="field-label">담당전공의</span>
          <input
            type="text"
            value={specialistPhysician}
            onChange={(e) => setSpecialistPhysician(e.target.value)}
            placeholder="전공의 성명"
            disabled={busy}
          />
        </label>
        <div className="emergency-duty-day__field emergency-duty-day__field--anes">
          <span className="field-label">마취</span>
          <div className="emergency-anesthesia-type emergency-anesthesia-type--inline">
            <label>
              <input
                type="radio"
                name="anesthesiaType"
                value="GENERAL"
                checked={anesthesiaType === "GENERAL"}
                onChange={() => setAnesthesiaType("GENERAL")}
                disabled={busy}
              />{" "}
              전신
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
              국소
            </label>
          </div>
        </div>
        <label className="emergency-duty-day__field emergency-duty-day__field--start">
          <span className="field-label">수술 시작</span>
          <input
            type="datetime-local"
            value={startTime}
            min={minStartLocal}
            onChange={(e) => handleStartTimeChange(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="emergency-duty-day__field emergency-duty-day__field--contact">
          <span className="field-label">응급연락처</span>
          <input
            type="tel"
            inputMode="numeric"
            value={emergencyContact}
            onChange={(e) => setEmergencyContact(e.target.value)}
            placeholder="01012345678"
            disabled={busy}
          />
        </label>
        <div className="emergency-duty-day__notify">
          <button type="button" disabled={busy || !dutyComplete} onClick={() => void submitNotify()}>
            알림
          </button>
        </div>
      </div>

      <div className="emergency-duty-day__calls">
        {dutyRows.map((row) => (
          <DutyCallChip key={row.label} label={row.label} user={row.user} />
        ))}
      </div>
      {!dutyComplete ? <p className="help emergency-duty-day__duty-hint">당직 3인 등록 후 알림을 보낼 수 있습니다.</p> : null}

      {memoSection ? <div className="emergency-duty-day__memo">{memoSection}</div> : null}

      {localMsg ? <p className="msg emergency-duty-day__msg">{localMsg}</p> : null}
    </section>
  );
}
