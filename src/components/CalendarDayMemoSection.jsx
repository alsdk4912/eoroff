/** 날짜별 의사소통 메모 (휴일 당직: 당직자·진기숙·의국 / 평일: 기존 댓글) */
export default function CalendarDayMemoSection({
  selectedYmd,
  variant = "default",
  selectedDayComments,
  users,
  currentUserId,
  canComposeMemo = true,
  canManageCommentForRow,
  commentDraft,
  onCommentDraftChange,
  onCreateComment,
  editingCommentId,
  editingCommentDraft,
  onEditingCommentDraftChange,
  onStartEditComment,
  onCancelEditComment,
  onUpdateComment,
  onDeleteComment,
  adminDayMemos,
  adminMemoDraft,
  onAdminMemoDraftChange,
  isOrLeaveAdmin,
  onSaveAdminMemo,
}) {
  const isHolidayDuty = variant === "holiday-duty" || variant === "emergency";
  const showAdminDutyMemo = variant === "default";
  const title = isHolidayDuty ? "의사소통 메모" : "듀티 메모";

  return (
    <section className={`calendar-day-memo-section${isHolidayDuty ? " calendar-day-memo-section--holiday-duty" : ""}`}>
      {showAdminDutyMemo ? (
        <div data-calendar-scroll-target="duty-memo">
          <h4 className="calendar-day-memo-section__heading">{title}</h4>
          {isOrLeaveAdmin ? (
            <>
              <textarea
                className="duty-memo-text"
                rows={3}
                placeholder="해당 날짜 메모를 입력하세요"
                value={adminMemoDraft}
                onChange={(e) => onAdminMemoDraftChange(e.target.value)}
              />
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => void onSaveAdminMemo?.(selectedYmd, adminMemoDraft)}>
                  메모 저장
                </button>
              </div>
            </>
          ) : (
            <p className="help duty-memo-text calendar-day-memo-section__admin-memo">
              {adminDayMemos?.[selectedYmd]?.trim() || "등록된 메모가 없습니다."}
            </p>
          )}
        </div>
      ) : null}

      <div className="day-comment-section" data-calendar-scroll-target="comments">
        {showAdminDutyMemo ? null : <h4 className="calendar-day-memo-section__heading">{title}</h4>}
        {selectedDayComments.length === 0 ? (
          <p className="help">아직 등록된 메모가 없습니다.</p>
        ) : (
          <ul className="day-comment-list">
            {selectedDayComments.map((row) => {
              const authorName = users.find((u) => u.id === row.userId)?.name ?? row.userId;
              const canManageComment = canManageCommentForRow
                ? canManageCommentForRow(row)
                : currentUserId === row.userId;
              const isEditing = editingCommentId === row.id;
              return (
                <li key={row.id} className="day-comment-item">
                  {isEditing ? (
                    <div className="day-comment-edit-wrap">
                      <textarea
                        rows={2}
                        value={editingCommentDraft}
                        onChange={(e) => onEditingCommentDraftChange(e.target.value)}
                      />
                      <div className="row wrap" style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!editingCommentDraft.trim()) return;
                            void onUpdateComment(row.id, editingCommentDraft);
                          }}
                          disabled={!editingCommentDraft.trim()}
                        >
                          저장
                        </button>
                        <button type="button" onClick={onCancelEditComment}>
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="day-comment-author">{authorName}</span>: {row.content}
                      {canManageComment ? (
                        <span className="row wrap day-comment-actions">
                          <button type="button" onClick={() => onStartEditComment(row.id, row.content)}>
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!window.confirm("이 메모를 삭제할까요?")) return;
                              void onDeleteComment(row.id);
                            }}
                          >
                            삭제
                          </button>
                        </span>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canComposeMemo ? (
          <div className="calendar-day-memo-section__compose">
            <textarea
              rows={isHolidayDuty ? 3 : 2}
              placeholder={isHolidayDuty ? "응급·당직 관련 메모를 입력하세요" : "추가 메모를 입력하세요"}
              value={commentDraft}
              onChange={(e) => onCommentDraftChange(e.target.value)}
            />
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  if (!selectedYmd || !commentDraft.trim()) return;
                  void onCreateComment(selectedYmd, commentDraft);
                }}
                disabled={!commentDraft.trim()}
              >
                메모 등록
              </button>
            </div>
          </div>
        ) : (
          <p className="help">이 날짜 메모는 당직 간호사·진기숙·의국만 이용할 수 있습니다.</p>
        )}
      </div>
    </section>
  );
}
