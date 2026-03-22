import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
  holidaysCache as seedHolidays,
  initialAdjustmentLogs,
  initialCancellations,
  initialGoldkeys,
  initialPriorityNotes,
  initialRequests,
  initialSelections,
  users as seedUsers,
} from "./data/sampleData";
import { leaveTypeLabel, leaveTypeOrder, statusLabel, validateRequest } from "./utils/rules";
import { api } from "./api/client";

function App() {
  const navigate = useNavigate();
  const [auth, setAuth] = useLocalStorage("or.auth", null);
  const [users, setUsers] = useState(seedUsers);
  const [requests, setRequests] = useLocalStorage("or.requests", initialRequests);
  const [notes, setNotes] = useLocalStorage("or.notes", initialPriorityNotes);
  const [cancellations, setCancellations] = useLocalStorage("or.cancellations", initialCancellations);
  const [selections, setSelections] = useLocalStorage("or.selections", initialSelections);
  const [goldkeys, setGoldkeys] = useLocalStorage("or.goldkeys", initialGoldkeys);
  const [adjustmentLogs, setAdjustmentLogs] = useLocalStorage("or.adjustmentLogs", initialAdjustmentLogs);
  const [holidays, setHolidays] = useLocalStorage("or.holidays", seedHolidays);

  const [leaveType, setLeaveType] = useState("GOLDKEY");
  const [leaveDate, setLeaveDate] = useState("");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");
  const [apiMessage, setApiMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [restoreSqlText, setRestoreSqlText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [serverMode, setServerMode] = useState(false);
  const now = new Date();
  const [syncYear, setSyncYear] = useState(String(now.getFullYear()));
  const [syncMonth, setSyncMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [calendarMonth, setCalendarMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [managedUsers, setManagedUsers] = useState([]);

  const currentUser = users.find((u) => u.id === auth?.userId);
  const isAdmin = currentUser?.role === "ADMIN";
  const myGoldkey = goldkeys.find((g) => g.userId === auth?.userId);
  const isLoggedIn = Boolean(auth?.userId);

  useEffect(() => {
    if (isLoggedIn) bootstrap();
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn || !isAdmin) return;
    (async () => {
      try {
        const userList = await api.listUsers();
        setManagedUsers(
          userList.users.map((u) => ({
            id: u.id,
            name: u.name,
            employeeNo: u.employee_no,
            role: u.role,
          }))
        );
      } catch {
        setManagedUsers([]);
      }
    })();
  }, [isLoggedIn, isAdmin]);

  async function bootstrap() {
    try {
      const data = await api.bootstrap();
      setUsers(data.users.map((u) => ({ id: u.id, name: u.name, role: u.role, employeeNo: u.employee_no })));
      setRequests(data.requests.map(mapRequestRow));
      setNotes(data.notes.map((n) => ({ id: n.id, leaveRequestId: n.leave_request_id, content: n.content, agreedOrder: n.agreed_order })));
      setCancellations(data.cancellations.map((c) => ({ id: c.id, leaveRequestId: c.leave_request_id, cancelledBy: c.cancelled_by, cancelReason: c.cancel_reason, cancelledAt: c.cancelled_at })));
      setSelections(data.selections.map((s) => ({ id: s.id, leaveRequestId: s.leave_request_id, selectedBy: s.selected_by, selectedAt: s.selected_at })));
      setGoldkeys(data.goldkeys.map((g) => ({ userId: g.user_id, quotaTotal: g.quota_total, usedCount: g.used_count, remainingCount: g.remaining_count })));
      setAdjustmentLogs(data.logs.map((l) => ({ id: l.id, userId: l.user_id, beforeQuota: l.before_quota, afterQuota: l.after_quota, changedBy: l.changed_by, changedAt: l.changed_at })));
      setHolidays(data.holidays.map((h) => ({ holidayDate: h.holiday_date, holidayName: h.holiday_name, isHoliday: Boolean(h.is_holiday) })));
      setServerMode(true);
    } catch {
      setServerMode(false);
    }
  }

  function normalizeLoginName(s) {
    return String(s ?? "").replace(/\s/g, "");
  }

  async function handleLogin(loginName, password) {
    const trimmed = String(loginName ?? "").trim();
    if (!trimmed) throw new Error("이름을 입력해주세요.");
    if (/^[A-Za-z]?\d+$/.test(trimmed)) {
      throw new Error("사번 로그인은 비활성화되었습니다. 이름으로 로그인해주세요.");
    }

    try {
      const data = await api.login({ loginName: trimmed, password });
      setAuth({ userId: data.user.id });
      return;
    } catch (e) {
      const msg = String(e?.message || "");
      const allowOfflineLogin =
        e?.name === "TypeError" ||
        msg.includes("Failed to fetch") ||
        msg.includes("Load failed") ||
        msg.includes("NetworkError") ||
        /^HTTP 404\b/.test(msg) ||
        /^HTTP 405\b/.test(msg);

      if (!allowOfflineLogin) {
        throw new Error(msg || "로그인에 실패했습니다. 이름/비밀번호를 확인하세요.");
      }

      const n = normalizeLoginName(trimmed);
      const matches = users.filter((u) => normalizeLoginName(u.name) === n);
      if (matches.length === 0) {
        throw new Error(
          "지금은 API에 연결되지 않았습니다(GitHub Actions 빌드에 VITE_API_BASE_URL Secret 없음 등). 오프라인 로그인은 DB와 같은 이름만 됩니다: 오민아·김해림·관리자 등(비번 1234). Render를 쓰면 Secret 넣고 Pages를 다시 배포하세요."
        );
      }
      if (matches.length > 1) throw new Error("동명이인이 있어 로그인할 수 없습니다.");
      if (String(password) !== "1234") {
        throw new Error("이름 또는 비밀번호가 올바르지 않습니다.");
      }
      setAuth({ userId: matches[0].id });
    }
  }

  function handleLogout() {
    setAuth(null);
  }

  const myRequests = useMemo(
    () => requests.filter((r) => r.userId === auth?.userId),
    [requests, auth?.userId]
  );
  const appliedRequests = useMemo(
    () =>
      [...requests]
        .filter((r) => r.status === "APPLIED")
        .sort((a, b) =>
          a.leaveDate !== b.leaveDate
            ? a.leaveDate.localeCompare(b.leaveDate)
            : leaveTypeOrder(a.leaveType) - leaveTypeOrder(b.leaveType) ||
              a.requestedAt.localeCompare(b.requestedAt)
        ),
    [requests]
  );
  const dashboard = useMemo(
    () => ({
      total: requests.length,
      applied: requests.filter((r) => r.status === "APPLIED").length,
      selected: requests.filter((r) => r.status === "SELECTED").length,
      cancelled: requests.filter((r) => r.status === "CANCELLED").length,
    }),
    [requests]
  );
  const calendarData = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    return buildMonthMatrix(year, month, requests, users);
  }, [calendarMonth, requests, users]);

  function handleCalendarDateSelect(date, options = {}) {
    setLeaveDate(date);
    if (options.navigate !== false) {
      navigate("/request");
    }
  }

  async function submitRequest(e) {
    e.preventDefault();
    const error = validateRequest({
      leaveType,
      leaveDate,
      now: new Date(),
      remainingGoldkey: myGoldkey?.remainingCount ?? 0,
      holidaysCache: holidays,
    });
    if (error) return setMessage(error);
    const payload = {
      id: `lr_${Date.now()}`,
      userId: auth.userId,
      leaveDate,
      leaveType,
      status: "APPLIED",
      requestedAt: new Date().toISOString(),
      memo,
      cancelLocked: false,
    };
    setRequests((prev) => [...prev, payload]);
    if (serverMode) await api.createRequest(payload);
    if (leaveType === "GOLDKEY" && myGoldkey) {
      setGoldkeys((prev) =>
        prev.map((g) =>
          g.userId === auth.userId
            ? { ...g, usedCount: g.usedCount + 1, remainingCount: Math.max(0, g.remainingCount - 1) }
            : g
        )
      );
    }
    setMessage("휴가 신청이 등록되었습니다.");
    setLeaveDate("");
    setMemo("");
  }

  async function cancelRequest(requestId) {
    const target = requests.find((r) => r.id === requestId);
    if (target?.cancelLocked) return false;

    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, cancelLocked: true } : r))
    );

    const reason = window.prompt("취소 사유를 입력하세요");
    if (!reason) {
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, cancelLocked: false } : r))
      );
      return false;
    }
    const payload = {
      cancellationId: `lc_${Date.now()}`,
      cancelledBy: auth.userId,
      cancelReason: reason,
      cancelledAt: new Date().toISOString(),
    };
    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, status: "CANCELLED", cancelLocked: true } : r))
    );
    setCancellations((prev) => [...prev, { id: payload.cancellationId, leaveRequestId: requestId, ...payload }]);
    try {
      if (serverMode) await api.cancelRequest(requestId, payload);
    } catch (e) {
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "APPLIED", cancelLocked: false } : r))
      );
      throw e;
    }
    return true;
  }

  async function selectRequest(requestId) {
    const payload = {
      selectionId: `ls_${Date.now()}`,
      selectedBy: auth.userId,
      selectedAt: new Date().toISOString(),
    };
    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "APPROVED" } : r)));
    setSelections((prev) => [...prev, { id: payload.selectionId, leaveRequestId: requestId, ...payload }]);
    if (serverMode) await api.selectRequest(requestId, payload);
  }

  async function rejectRequest(requestId) {
    setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "REJECTED" } : r)));
    if (serverMode) await api.rejectRequest(requestId);
  }

  async function addPriorityNote(requestId) {
    const content = window.prompt("협의 메모를 입력하세요");
    if (!content) return;
    const agreedOrder = Number(window.prompt("협의 순번(숫자)") || "0");
    const payload = { id: `ln_${Date.now()}`, leaveRequestId: requestId, content, agreedOrder };
    setNotes((prev) => [...prev, payload]);
    if (serverMode) await api.addNote(payload);
  }

  async function syncHolidays() {
    try {
      if (!apiKey.trim()) return setApiMessage("API 키를 입력하세요.");
      if (serverMode) {
        const result = await api.syncHolidays({ serviceKey: apiKey.trim(), year: syncYear, month: syncMonth });
        return setApiMessage(`동기화 완료: ${result.count}건 반영`);
      }
      setApiMessage("서버 모드에서만 API 동기화가 가능합니다.");
    } catch (e) {
      setApiMessage(`동기화 오류: ${e.message}`);
    }
  }

  async function handleBackupSql() {
    try {
      const sql = await api.downloadBackupSql();
      downloadTextFile(sql, `backup-${new Date().toISOString().slice(0, 19)}.sql`);
      setBackupMessage("백업 SQL 다운로드 완료");
    } catch (e) {
      setBackupMessage(`백업 실패: ${e.message}`);
    }
  }

  async function handleRestoreSql() {
    try {
      if (!restoreSqlText.trim()) return setBackupMessage("복구할 SQL 내용을 입력하세요.");
      const result = await api.restoreSql(restoreSqlText);
      setBackupMessage(`복구 완료: ${result.restoredStatements}개 구문 적용`);
      await bootstrap();
    } catch (e) {
      setBackupMessage(`복구 실패: ${e.message}`);
    }
  }

  async function handleChangePassword(currentPassword, newPassword) {
    await api.changePassword({ userId: auth.userId, currentPassword, newPassword });
    setAccountMessage("비밀번호가 변경되었습니다.");
  }

  async function handleResetPassword(targetUserId) {
    await api.resetUserPassword(targetUserId, { adminUserId: auth.userId, nextPassword: "1234" });
    setAccountMessage("선택한 사용자의 비밀번호를 1234로 초기화했습니다.");
  }

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="top">
        <h1>EOR 휴가 시스템</h1>
        <div className="row wrap">
          <span className="help">
            {currentUser?.name} ({currentUser?.role}) / {serverMode ? "DB 모드" : "로컬 모드"}
          </span>
          <button onClick={handleLogout}>로그아웃</button>
        </div>
      </header>

      <nav className="card nav">
        <Link to="/calendar">달력</Link>
        <Link to="/request">신청</Link>
        <Link to="/my">내 신청내역</Link>
        <Link to="/dashboard">종합 현황</Link>
        <Link to="/account">계정</Link>
        {isAdmin ? <Link to="/admin">관리자</Link> : null}
        {isAdmin ? <Link to="/settings">설정</Link> : null}
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/calendar" />} />
        <Route path="/request" element={<RequestPage leaveType={leaveType} setLeaveType={setLeaveType} leaveDate={leaveDate} setLeaveDate={setLeaveDate} memo={memo} setMemo={setMemo} submitRequest={submitRequest} myGoldkey={myGoldkey} message={message} />} />
        <Route path="/my" element={<MyRequestsPage myRequests={myRequests} cancelRequest={cancelRequest} />} />
        <Route path="/dashboard" element={<DashboardPage dashboard={dashboard} goldkeys={goldkeys} cancellations={cancellations} users={users} />} />
        <Route path="/calendar" element={<CalendarPage calendarMonth={calendarMonth} setCalendarMonth={setCalendarMonth} calendarData={calendarData} users={users} isAdmin={isAdmin} onDateSelect={handleCalendarDateSelect} />} />
        <Route path="/account" element={<AccountPage onChangePassword={handleChangePassword} message={accountMessage} />} />
        <Route path="/admin" element={isAdmin ? <AdminPage appliedRequests={appliedRequests} users={users} selectRequest={selectRequest} rejectRequest={rejectRequest} addPriorityNote={addPriorityNote} notes={notes} goldkeys={goldkeys} /> : <Navigate to="/request" />} />
        <Route path="/settings" element={isAdmin ? <SettingsPage apiKey={apiKey} setApiKey={setApiKey} syncYear={syncYear} setSyncYear={setSyncYear} syncMonth={syncMonth} setSyncMonth={setSyncMonth} syncHolidays={syncHolidays} holidays={holidays} apiMessage={apiMessage} backupMessage={backupMessage} restoreSqlText={restoreSqlText} setRestoreSqlText={setRestoreSqlText} onBackup={handleBackupSql} onRestore={handleRestoreSql} managedUsers={managedUsers} onResetPassword={handleResetPassword} accountMessage={accountMessage} /> : <Navigate to="/request" />} />
        <Route path="*" element={<Navigate to="/calendar" />} />
      </Routes>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await onLogin(loginName, password);
    } catch (e2) {
      setError(e2.message);
    }
  }
  return (
    <div className="app login-wrap">
      <section className="card login-card">
        <h2>로그인</h2>
        <form className="login-form" onSubmit={submit}>
          <input placeholder="이름만 입력 (예: 김간호)" value={loginName} onChange={(e) => setLoginName(e.target.value)} />
          <input type="password" placeholder="비밀번호 (기본: 1234)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit">로그인</button>
        </form>
        {error ? <p className="msg">{error}</p> : null}
      </section>
    </div>
  );
}

function RequestPage({ leaveType, setLeaveType, leaveDate, setLeaveDate, memo, setMemo, submitRequest, myGoldkey, message }) {
  return (
    <section className="card">
      <h2>간호사 신청 화면</h2>
      <form className="grid" onSubmit={submitRequest}>
        <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
          <option value="GOLDKEY">골드키</option><option value="GENERAL_PRIORITY">일반-우선</option><option value="GENERAL_NORMAL">일반-후순위</option>
        </select>
        <input type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} />
        <input type="text" placeholder="신청 메모" value={memo} onChange={(e) => setMemo(e.target.value)} />
        <button type="submit">신청</button>
      </form>
      <p className="help">내 골드키 잔여: {myGoldkey?.remainingCount ?? 0} / {myGoldkey?.quotaTotal ?? 0}</p>
      {message ? <p className="msg">{message}</p> : null}
    </section>
  );
}

function MyRequestsPage({ myRequests, cancelRequest }) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  async function handleCancelClick(requestId) {
    await cancelRequest(requestId);
  }

  const rows = myRequests.filter((r) => (statusFilter === "ALL" || r.status === statusFilter) && (`${r.leaveDate} ${leaveTypeLabel(r.leaveType)} ${statusLabel(r.status)}`).toLowerCase().includes(search.toLowerCase()));
  return (
    <section className="card">
      <h2>내 신청내역</h2>
      <div className="row wrap">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">전체 상태</option><option value="APPLIED">신청</option><option value="SELECTED">선정</option><option value="CANCELLED">취소</option><option value="REJECTED">미선정</option>
        </select>
        <input placeholder="날짜/유형/상태 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="table-wrap"><table><thead><tr><th>휴가일</th><th>유형</th><th>상태</th><th>신청시각</th><th>액션</th></tr></thead><tbody>{rows.map((r) => {
        const isLocked = Boolean(r.cancelLocked);
        const showButton = r.status === "APPLIED" || isLocked;
        const buttonLabel = isLocked ? "취소 처리됨" : "취소";
        return <tr key={r.id}><td>{r.leaveDate}</td><td>{leaveTypeLabel(r.leaveType)}</td><td>{statusLabel(r.status)}</td><td>{new Date(r.requestedAt).toLocaleString("ko-KR")}</td><td>{showButton ? <button disabled={isLocked || r.status !== "APPLIED"} onClick={() => handleCancelClick(r.id)}>{buttonLabel}</button> : "-"}</td></tr>;
      })}</tbody></table></div>
    </section>
  );
}

function DashboardPage({ dashboard, goldkeys, cancellations, users }) {
  return (
    <>
      <section className="card">
        <h2>골드키 잔여 내역</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>골드키 총개수</th>
                <th>사용개수</th>
                <th>잔여개수</th>
              </tr>
            </thead>
            <tbody>
              {goldkeys
                .slice()
                .sort((a, b) => (users.find((u) => u.id === a.userId)?.name || "").localeCompare(users.find((u) => u.id === b.userId)?.name || ""))
                .map((g) => (
                  <tr key={g.userId}>
                    <td>{users.find((u) => u.id === g.userId)?.name ?? g.userId}</td>
                    <td>{g.quotaTotal}</td>
                    <td>{g.usedCount}</td>
                    <td>{g.remainingCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="help">참고: 전체 신청 {dashboard.total} / 신청중 {dashboard.applied} / 취소 {dashboard.cancelled}</p>
      </section>
      <section className="card"><h2>취소 이력</h2><div className="table-wrap"><table><thead><tr><th>요청ID</th><th>취소자</th><th>사유</th><th>시각</th></tr></thead><tbody>{cancellations.map((c) => <tr key={c.id}><td>{c.leaveRequestId}</td><td>{users.find((u) => u.id === c.cancelledBy)?.name ?? c.cancelledBy}</td><td>{c.cancelReason}</td><td>{new Date(c.cancelledAt).toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div></section>
    </>
  );
}

function AccountPage({ onChangePassword, message }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [localMsg, setLocalMsg] = useState("");
  async function submit(e) {
    e.preventDefault();
    setLocalMsg("");
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setLocalMsg("비밀번호 변경 완료");
    } catch (e2) {
      setLocalMsg("비밀번호 변경 실패: 현재 비밀번호를 확인하세요.");
    }
  }
  return (
    <section className="card">
      <h2>계정 관리</h2>
      <form className="login-form" onSubmit={submit}>
        <input type="password" placeholder="현재 비밀번호" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        <input type="password" placeholder="새 비밀번호 (4자 이상)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <button type="submit">비밀번호 변경</button>
      </form>
      {localMsg ? <p className="msg">{localMsg}</p> : null}
      {message ? <p className="help">{message}</p> : null}
    </section>
  );
}

function CalendarPage({ calendarMonth, setCalendarMonth, calendarData, users, isAdmin, onDateSelect }) {
  const [selectedDate, setSelectedDate] = useState("");
  const selectedCell = calendarData.find((c) => c.date === selectedDate);
  const approvedIds = new Set((selectedCell?.approvedApplicants ?? []).map((item) => item.userId));
  const nurseUsers = users.filter((u) => u.role === "NURSE");
  const workingUsers = nurseUsers.filter((u) => !approvedIds.has(u.id));

  function handleDateClick(cell) {
    if (!cell.inMonth) return;
    setSelectedDate(cell.date);
    if (isAdmin) {
      onDateSelect(cell.date, { navigate: false });
      return;
    }
    onDateSelect(cell.date, { navigate: true });
  }

  return (
    <section className="card">
      <h2>전체 휴가 달력(월간)</h2>
      <div className="row wrap">
        <label>월 선택 </label>
        <input type="month" value={calendarMonth} onChange={(e) => setCalendarMonth(e.target.value)} />
        <span className="help">날짜를 누르면 {isAdmin ? "해당일 휴가/출근자 현황을 확인" : "해당일로 신청 화면 이동"}합니다.</span>
      </div>
      <div className="calendar">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <div key={d} className="calendar-head">{d}</div>
        ))}
        {calendarData.map((cell, idx) => (
          <button
            key={`${cell.date}-${idx}`}
            type="button"
            className={`calendar-cell clickable ${cell.inMonth ? "" : "muted"} ${selectedDate === cell.date ? "active-day" : ""}`}
            onClick={() => handleDateClick(cell)}
          >
            <div className="calendar-date">{cell.inMonth ? cell.day : ""}</div>
            {cell.inMonth && cell.requestCount > 0 ? <div className="badge">신청 {cell.requestCount}</div> : null}
            {cell.inMonth && cell.applicants.map((item) => (
              <div
                key={item.id}
                className={`selected-item type-${item.leaveType.toLowerCase()} status-${normalizeStatus(item.status)}`}
              >
                {typeFullLabel(item.leaveType)} {item.name}
              </div>
            ))}
          </button>
        ))}
      </div>
      {isAdmin && selectedCell ? (
        <section className="admin-day-panel">
          <h3>{selectedCell.date} 관리자 상세</h3>
          <div className="admin-day-grid">
            <div>
              <h4>휴가자</h4>
              <ul>
                {selectedCell.approvedApplicants.length === 0 ? <li>없음</li> : selectedCell.approvedApplicants.map((item) => <li key={item.id}>{item.name} ({typeFullLabel(item.leaveType)})</li>)}
              </ul>
            </div>
            <div>
              <h4>출근자</h4>
              <ul>
                {workingUsers.length === 0 ? <li>없음</li> : workingUsers.map((u) => <li key={u.id}>{u.name}</li>)}
              </ul>
            </div>
          </div>
          <button type="button" onClick={() => onDateSelect(selectedCell.date, { navigate: true })}>이 날짜로 신청 화면 이동</button>
        </section>
      ) : null}
    </section>
  );
}

function AdminPage({ appliedRequests, users, selectRequest, rejectRequest, addPriorityNote, notes, goldkeys }) {
  const [nameSearch, setNameSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const rows = appliedRequests.filter((r) => {
    const name = users.find((u) => u.id === r.userId)?.name ?? "";
    const matchedName = name.toLowerCase().includes(nameSearch.toLowerCase());
    const matchedType = typeFilter === "ALL" || r.leaveType === typeFilter;
    return matchedName && matchedType;
  });
  return (
    <>
      <section className="card">
        <h2>관리자 신청자 관리</h2>
        <div className="row wrap">
          <input placeholder="간호사 이름 검색" value={nameSearch} onChange={(e) => setNameSearch(e.target.value)} />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="ALL">전체 유형</option><option value="GOLDKEY">골드키</option><option value="GENERAL_PRIORITY">일반-우선</option><option value="GENERAL_NORMAL">일반-후순위</option>
          </select>
        </div>
        <div className="table-wrap"><table><thead><tr><th>간호사</th><th>휴가일</th><th>유형</th><th>신청시각</th><th>액션</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{users.find((u) => u.id === r.userId)?.name}</td><td>{r.leaveDate}</td><td>{leaveTypeLabel(r.leaveType)}</td><td>{new Date(r.requestedAt).toLocaleString("ko-KR")}</td><td className="row wrap"><button onClick={() => selectRequest(r.id)}>승인</button><button onClick={() => rejectRequest(r.id)}>반려</button>{r.leaveType !== "GOLDKEY" ? <button onClick={() => addPriorityNote(r.id)}>협의메모</button> : null}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card"><h2>일반휴가 협의 메모</h2><ul>{notes.map((n) => <li key={n.id}>요청ID {n.leaveRequestId} / 순번 {n.agreedOrder} / {n.content}</li>)}</ul></section>
      <section className="card"><h2>골드키 관리(조회 전용)</h2><div className="table-wrap"><table><thead><tr><th>간호사</th><th>총할당</th><th>사용</th><th>잔여</th></tr></thead><tbody>{goldkeys.map((g) => <tr key={g.userId}><td>{users.find((u) => u.id === g.userId)?.name}</td><td>{g.quotaTotal}</td><td>{g.usedCount}</td><td>{g.remainingCount}</td></tr>)}</tbody></table></div></section>
    </>
  );
}

function SettingsPage({ apiKey, setApiKey, syncYear, setSyncYear, syncMonth, setSyncMonth, syncHolidays, holidays, apiMessage, backupMessage, restoreSqlText, setRestoreSqlText, onBackup, onRestore, managedUsers, onResetPassword, accountMessage }) {
  return (
    <section className="card">
      <h2>공휴일 API 동기화</h2>
      <div className="grid-api">
        <input type="password" placeholder="서비스키(Decoded)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <input type="number" placeholder="연도" value={syncYear} onChange={(e) => setSyncYear(e.target.value)} />
        <input type="text" placeholder="월(01-12)" value={syncMonth} onChange={(e) => setSyncMonth(e.target.value.padStart(2, "0").slice(0, 2))} />
        <button onClick={syncHolidays}>동기화 실행</button>
      </div>
      <p className="help">현재 저장된 공휴일 수: {holidays.length}건</p>
      {apiMessage ? <p className="msg">{apiMessage}</p> : null}
      <hr className="divider" />
      <h2>SQLite 백업/복구</h2>
      <div className="row"><button onClick={onBackup}>백업 SQL 다운로드</button></div>
      <textarea className="sql-textarea" placeholder="복구할 SQL을 여기에 붙여넣고 복구 실행" value={restoreSqlText} onChange={(e) => setRestoreSqlText(e.target.value)} />
      <div className="row"><button onClick={onRestore}>복구 실행</button></div>
      {backupMessage ? <p className="msg">{backupMessage}</p> : null}
      <hr className="divider" />
      <h2>사용자 비밀번호 초기화 (관리자)</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>이름</th><th>사번</th><th>권한</th><th>액션</th></tr></thead>
          <tbody>
            {managedUsers.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.employeeNo}</td><td>{u.role}</td>
                <td><button onClick={() => onResetPassword(u.id)}>비밀번호 1234로 초기화</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {accountMessage ? <p className="msg">{accountMessage}</p> : null}
    </section>
  );
}

function mapRequestRow(r) {
  return {
    id: r.id,
    userId: r.user_id,
    leaveDate: r.leave_date,
    leaveType: r.leave_type,
    status: r.status,
    requestedAt: r.requested_at,
    memo: r.memo,
    cancelLocked: false,
  };
}

function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key);
    if (raw == null) return initialValue;
    try {
      return JSON.parse(raw);
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

function buildMonthMatrix(year, month, allRequests, users) {
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    cells.push({
      date: iso,
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1,
      applicants: allRequests
        .filter((r) => r.leaveDate === iso && r.status !== "CANCELLED")
        .sort((a, b) =>
          leaveTypeOrder(a.leaveType) - leaveTypeOrder(b.leaveType) ||
          a.requestedAt.localeCompare(b.requestedAt)
        )
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          leaveType: r.leaveType,
          status: r.status,
          name: users.find((u) => u.id === r.userId)?.name ?? r.userId,
        })),
      approvedApplicants: allRequests
        .filter((r) => r.leaveDate === iso && isApprovedStatus(r.status))
        .sort((a, b) =>
          leaveTypeOrder(a.leaveType) - leaveTypeOrder(b.leaveType) ||
          a.requestedAt.localeCompare(b.requestedAt)
        )
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          leaveType: r.leaveType,
          status: r.status,
          name: users.find((u) => u.id === r.userId)?.name ?? r.userId,
        })),
      requestCount: allRequests.filter((r) => r.leaveDate === iso).length,
    });
  }
  return cells;
}

function isApprovedStatus(status) {
  return status === "APPROVED" || status === "SELECTED";
}

function normalizeStatus(status) {
  if (status === "SELECTED") return "approved";
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  return "pending";
}

function typeFullLabel(leaveType) {
  if (leaveType === "GOLDKEY") return "골드키";
  if (leaveType === "GENERAL_PRIORITY") return "일반휴가-우선순위";
  return "일반휴가-후순위";
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: "application/sql;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default App;
