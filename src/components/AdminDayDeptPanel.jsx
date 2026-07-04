import { useEffect, useMemo, useState } from "react";
import { isUserActive, weeklyRosterAllSections } from "../data/shiftCodes.js";
import { buildCalendarSubstituteDisplayRows } from "../utils/leaveVisibility.js";

const CUSTOM_SHIFT_PREFIX = "__CUSTOM_SHIFT__:";

/** 관리자·관리자2·진기숙(DEPT_HEAD)은 전 부서 펼침, 그 외는 본인 부서만 */
function shouldExpandDeptBlockByDefault(viewerRole, staffRole) {
  if (viewerRole === "ADMIN" || viewerRole === "ADMIN2" || viewerRole === "DEPT_HEAD") {
    return true;
  }
  if (viewerRole === "NURSE" && staffRole === "NURSE") return true;
  if (viewerRole === "ANESTHESIA" && staffRole === "ANESTHESIA") return true;
  if (viewerRole === "CHIEF" && staffRole === "CHIEF") return true;
  return false;
}

function formatShiftCode(raw) {
  const s = String(raw ?? "").trim();
  if (s.startsWith(CUSTOM_SHIFT_PREFIX)) {
    return s.slice(CUSTOM_SHIFT_PREFIX.length).trim() || "—";
  }
  return s || "—";
}

function AdminDayDeptBlock({
  blockId,
  label,
  toneClass,
  selectedYmd,
  staffRole,
  applicants,
  substituteAssignments,
  users,
  defaultOpen,
  getWeeklyStaffCell,
}) {
  const leaveList = Array.isArray(applicants) ? applicants : [];
  const weeklyStaffCells = useMemo(() => {
    if (staffRole !== "CHIEF" || typeof getWeeklyStaffCell !== "function" || !selectedYmd) return [];
    const roster = weeklyRosterAllSections(users, selectedYmd).filter((u) => u.role === staffRole && isUserActive(u));
    const out = [];
    for (const u of roster) {
      const cell = getWeeklyStaffCell(u.id, u.name, selectedYmd);
      const kind = String(cell?.kind ?? "");
      const main = String(cell?.main ?? "").trim();
      if (!main || main === "—" || main === "off") continue;
      if (kind === "leave" || kind === "duty") continue;
      out.push({ userId: u.id, shiftCode: main });
    }
    return out;
  }, [getWeeklyStaffCell, selectedYmd, staffRole, users]);

  const substituteRows = useMemo(() => {
    const rows = buildCalendarSubstituteDisplayRows({
      selectedYmd,
      staffRole,
      approvedApplicants: leaveList,
      substituteAssignments,
      users,
      weeklyStaffCells,
    });
    return rows.map((row, idx) => ({
      key: `${blockId}_sub_${idx}`,
      shiftCode: formatShiftCode(row.shiftCode),
      substituteName: users.find((u) => u.id === row.substituteUserId)?.name ?? row.substituteUserId ?? "—",
    }));
  }, [blockId, leaveList, selectedYmd, staffRole, substituteAssignments, users, weeklyStaffCells]);

  const leaveCount = leaveList.length;
  const subCount = substituteRows.length;

  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [selectedYmd, defaultOpen]);

  return (
    <section className={`admin-day-dept-block ${toneClass}${open ? " admin-day-dept-block--open" : ""}`}>
      <button
        type="button"
        className="admin-day-dept-block__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="admin-day-dept-block__label">{label}</span>
        <span className="admin-day-dept-block__meta">
          <span className="admin-day-dept-block__badge">휴가 {leaveCount}</span>
          <span className="admin-day-dept-block__badge">대체 {subCount}</span>
        </span>
        <span className="admin-day-dept-block__chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="admin-day-dept-block__body">
          {subCount === 0 ? (
            <p className="help admin-day-dept-block__empty">대체 없음</p>
          ) : (
            <div className="admin-day-substitute-grid admin-day-substitute-grid--dept">
              <div className="admin-day-substitute-grid__head">번표</div>
              <div className="admin-day-substitute-grid__head">대체자</div>
              {substituteRows.flatMap((row) => [
                <div key={`${row.key}_code`} className="admin-day-substitute-grid__cell">
                  {row.shiftCode}
                </div>,
                <div key={`${row.key}_name`} className="admin-day-substitute-grid__cell">
                  {row.substituteName}
                </div>,
              ])}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function AdminDayDeptPanel({
  selectedYmd,
  selectedCell,
  substituteAssignments,
  users,
  viewerRole,
  getWeeklyStaffCell,
}) {
  const sections = [
    {
      blockId: "nurse",
      label: "수술실",
      toneClass: "admin-day-dept-block--nurse",
      staffRole: "NURSE",
      applicants: selectedCell?.approvedApplicants,
    },
    {
      blockId: "anesthesia",
      label: "마취과",
      toneClass: "admin-day-dept-block--anesthesia",
      staffRole: "ANESTHESIA",
      applicants: selectedCell?.anesthesiaApprovedApplicants,
    },
    {
      blockId: "chief",
      label: "주임",
      toneClass: "admin-day-dept-block--chief",
      staffRole: "CHIEF",
      applicants: selectedCell?.chiefApprovedApplicants,
    },
  ];

  return (
    <section className="admin-day-panel admin-day-panel--by-dept">
      <p className="admin-day-panel__date">{selectedYmd}</p>
      <p className="help admin-day-panel__date-hint">대체자 (부서별)</p>
      <div className="admin-day-dept-stack">
        {sections.map((sec) => (
          <AdminDayDeptBlock
            key={sec.blockId}
            {...sec}
            selectedYmd={selectedYmd}
            substituteAssignments={substituteAssignments}
            users={users}
            getWeeklyStaffCell={getWeeklyStaffCell}
            defaultOpen={shouldExpandDeptBlockByDefault(viewerRole, sec.staffRole)}
          />
        ))}
      </div>
    </section>
  );
}
