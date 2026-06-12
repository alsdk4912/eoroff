import { useEffect, useMemo, useRef, useState } from "react";
import {
  SURGERY_START_TOO_SOON_MSG,
  combineSurgeryStartDatetime,
  isSurgeryStartTimeAllowedForDate,
  minSurgeryStartTimeForYmd,
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

function EmergencySurgeryRecordsListInPanel({ records = [] }) {
  if (!records || records.length === 0) return null;
  const anesLabel = (t) => (t === "LOCAL" ? "국소" : "전신");
  return (
    <div className="esr-list esr-list--panel">
      <h5 className="esr-list__title">전송된 응급수술 정보</h5>
      {records.map((r) => (
        <div key={r.id} className="esr-list__item">
          <div className="esr-list__row">
            <span className="esr-list__label">수술명</span>
            <span className="esr-list__value">{r.surgeryName}</span>
          </div>
          <div className="esr-list__row">
            <span className="esr-list__label">주치의</span>
            <span className="esr-list__value">{r.attendingPhysician}</span>
          </div>
          <div className="esr-list__row">
            <span className="esr-list__label">전공의</span>
            <span className="esr-list__value">{r.specialistPhysician}</span>
          </div>
          <div className="esr-list__row">
            <span className="esr-list__label">마취</span>
            <span className="esr-list__value">{anesLabel(r.anesthesiaType)}</span>
          </div>
          <div className="esr-list__row">
            <span className="esr-list__label">수술 시작</span>
            <span className="esr-list__value">{r.startTime ? r.startTime.slice(11, 16) : ""}</span>
          </div>
          {r.createdByName ? (
            <div className="esr-list__meta">
              {r.createdAt
                ? new Date(r.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
                : ""}
              {" "}전송
            </div>
          ) : null}
        </div>
      ))}
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
  surgeryRecords = [],
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
  const [startTimeGuideAck, setStartTimeGuideAck] = useState(false);
  const startTimeGuideAckRef = useRef(false);
  const [minStartTime, setMinStartTime] = useState(() => minSurgeryStartTimeForYmd(selectedYmd));

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
    setStartTimeGuideAck(false);
    startTimeGuideAckRef.current = false;
    setMinStartTime(minSurgeryStartTimeForYmd(selectedYmd));
  }, [selectedYmd]);

  useEffect(() => {
    const tick = () => setMinStartTime(minSurgeryStartTimeForYmd(selectedYmd));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [selectedYmd]);

  function handleStartTimePointerDown(e) {
    if (startTimeGuideAckRef.current) return;
    e.preventDefault();
    window.alert?.(SURGERY_START_TOO_SOON_MSG);
    setStartTimeGuideAck(true);
    startTimeGuideAckRef.current = true;
  }

  function handleStartTimeChange(next) {
    const value = String(next ?? "").trim();
    if (!value) {
      setStartTime("");
      return;
    }
    if (!isSurgeryStartTimeAllowedForDate(selectedYmd, value)) {
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
    const timeHm = String(startTime ?? "").trim();
    const time = combineSurgeryStartDatetime(selectedYmd, timeHm);

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
    if (!timeHm || !time) {
      setLocalMsg("수술 시작 시간을 입력해 주세요.");
      return;
    }
    if (!isSurgeryStartTimeAllowedForDate(selectedYmd, timeHm)) {
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
            type="time"
            className="emergency-duty-day__time-input"
            value={startTime}
            min={minStartTime || undefined}
            onPointerDown={handleStartTimePointerDown}
            onChange={(e) => handleStartTimeChange(e.target.value)}
            disabled={busy}
            readOnly={!startTimeGuideAck}
            aria-label={`${selectedYmd} 수술 시작 시각`}
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

      <EmergencySurgeryRecordsListInPanel records={surgeryRecords} />
    </section>
  );
}
