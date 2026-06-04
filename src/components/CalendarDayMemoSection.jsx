/** 날짜별 듀티 메모·의사소통 댓글 (의국·관리자·간호사 공유) */
export default function CalendarDayMemoSection({
  selectedYmd,
  variant = "default",
  adminDayMemos,
  adminMemoDraft,
  onAdminMemoDraftChange,
  isOrLeaveAdmin,
  onSaveAdminMemo,
  selectedDayComments,
  users,
  currentUserId,
  isOrLeaveAdmin: isOrAdmin,
  isAnesthesiaLeaveAdmin,
  isChiefLeaveAdmin,
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
}) {
  const isEmergency = variant === "emergency";
  const title = isEmergency ? "의사소통 메모" : "듀티 메모";
  const commentTitle = isEmergency ? "의국·당직 대화" : "추가 메모";

  return (
    <section className={`calendar-day-memo-section${isEmergency ? " calendar-day-memo-section--emergency" : ""}`}>
      <div data-calendar-scroll-target="duty-memo">
        <h4 className="calendar-day-memo-section__heading">{title}</h4>
        {isOrLeaveAdmin && !isEmergency ? (
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
            {adminDayMemos?.[selectedYmd]?.trim() || (isEmergency ? "관리자 듀티 메모가 없습니다." : "등록된 메모가 없습니다.")}
          </p>
        )}
      </div>

      <div className="day-comment-section" data-calendar-scroll-target="comments">
        <h4 className="calendar-day-memo-section__heading">{commentTitle}</h4>
        {selectedDayComments.length === 0 ? (
          <p className="help">아직 등록된 메모가 없습니다.</p>
        ) : (
          <ul className="day-comment-list">
            {selectedDayComments.map((row) => {
              const authorName = users.find((u) => u.id === row.userId)?.name ?? row.userId;
              const canManageComment =
                currentUserId === row.userId ||
                isOrAdmin ||
                isAnesthesiaLeaveAdmin ||
                isChiefLeaveAdmin;
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
        <div className="calendar-day-memo-section__compose">
          <textarea
            rows={isEmergency ? 3 : 2}
            placeholder={isEmergency ? "응급·당직 관련 메모를 입력하세요" : "추가 메모를 입력하세요"}
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
              {isEmergency ? "메모 등록" : "댓글 등록"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
