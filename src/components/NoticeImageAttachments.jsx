import { useRef } from "react";
import { NOTICE_MAX_IMAGES, compressNoticeImageFile } from "../utils/noticeImages.js";

export function NoticeImageGallery({ images }) {
  const list = Array.isArray(images) ? images : [];
  if (list.length === 0) return null;
  return (
    <div className="notice-image-gallery">
      {list.map((src, idx) => (
        <a
          key={`${idx}_${String(src).slice(0, 32)}`}
          className="notice-image-gallery__item"
          href={src}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={src} alt={`첨부 사진 ${idx + 1}`} loading="lazy" />
        </a>
      ))}
    </div>
  );
}

export function NoticeImagePicker({ images, onChange, disabled = false }) {
  const inputRef = useRef(null);
  const list = Array.isArray(images) ? images : [];
  const remaining = NOTICE_MAX_IMAGES - list.length;

  async function onFilesSelected(fileList) {
    const files = [...fileList];
    if (files.length === 0) return;
    if (list.length + files.length > NOTICE_MAX_IMAGES) {
      window.alert?.(`사진은 최대 ${NOTICE_MAX_IMAGES}장까지 첨부할 수 있습니다.`);
      return;
    }
    const next = [...list];
    for (const file of files.slice(0, NOTICE_MAX_IMAGES - next.length)) {
      try {
        const dataUrl = await compressNoticeImageFile(file);
        next.push(dataUrl);
      } catch (e) {
        window.alert?.(e?.message || "사진을 첨부하지 못했습니다.");
      }
    }
    onChange?.(next);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="notice-image-picker">
      <div className="notice-image-picker__toolbar">
        <button
          type="button"
          className="notice-image-picker__add-btn"
          disabled={disabled || remaining <= 0}
          onClick={() => inputRef.current?.click()}
        >
          사진 추가 ({list.length}/{NOTICE_MAX_IMAGES})
        </button>
        <span className="help notice-image-picker__hint">JPEG·PNG·WEBP, 장당 최대 8MB</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        hidden
        onChange={(e) => void onFilesSelected(e.target.files ?? [])}
      />
      {list.length > 0 ? (
        <div className="notice-image-picker__grid">
          {list.map((src, idx) => (
            <div key={`${idx}_${String(src).slice(0, 32)}`} className="notice-image-picker__item">
              <img src={src} alt={`첨부 사진 ${idx + 1}`} />
              {!disabled ? (
                <button
                  type="button"
                  className="notice-image-picker__remove"
                  onClick={() => onChange?.(list.filter((_, i) => i !== idx))}
                  aria-label="사진 삭제"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
