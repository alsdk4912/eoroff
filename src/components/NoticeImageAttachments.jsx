import { useRef, useState } from "react";
import { NOTICE_MAX_IMAGES, compressNoticeImageFile } from "../utils/noticeImages.js";

export function NoticeImageGallery({ images }) {
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const list = Array.isArray(images) ? images : [];
  if (list.length === 0) return null;

  function openAt(idx) {
    setLightboxIdx(idx);
    setLightboxSrc(list[idx]);
  }
  function closeLightbox() { setLightboxSrc(null); }
  function prev(e) {
    e.stopPropagation();
    const next = (lightboxIdx - 1 + list.length) % list.length;
    setLightboxIdx(next);
    setLightboxSrc(list[next]);
  }
  function next(e) {
    e.stopPropagation();
    const n = (lightboxIdx + 1) % list.length;
    setLightboxIdx(n);
    setLightboxSrc(list[n]);
  }

  return (
    <>
      <div className="notice-image-gallery">
        {list.map((src, idx) => (
          <button
            key={`${idx}_${String(src).slice(0, 32)}`}
            type="button"
            className="notice-image-gallery__item"
            onClick={() => openAt(idx)}
            aria-label={`사진 ${idx + 1} 크게 보기`}
          >
            <img src={src} alt={`첨부 사진 ${idx + 1}`} loading="lazy" />
          </button>
        ))}
      </div>
      {lightboxSrc ? (
        <div className="notice-lightbox" onClick={closeLightbox}>
          <button type="button" className="notice-lightbox__close" onClick={closeLightbox} aria-label="닫기">×</button>
          {list.length > 1 ? (
            <button type="button" className="notice-lightbox__nav notice-lightbox__nav--prev" onClick={prev} aria-label="이전">‹</button>
          ) : null}
          <img
            className="notice-lightbox__img"
            src={lightboxSrc}
            alt={`사진 ${lightboxIdx + 1}`}
            onClick={(e) => e.stopPropagation()}
          />
          {list.length > 1 ? (
            <button type="button" className="notice-lightbox__nav notice-lightbox__nav--next" onClick={next} aria-label="다음">›</button>
          ) : null}
          {list.length > 1 ? (
            <div className="notice-lightbox__counter">{lightboxIdx + 1} / {list.length}</div>
          ) : null}
        </div>
      ) : null}
    </>
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
