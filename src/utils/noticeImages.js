export const NOTICE_MAX_IMAGES = 5;
export const NOTICE_MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
export const NOTICE_MAX_IMAGE_DATA_URL_LEN = 1_400_000;

const NOTICE_IMAGE_DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

export function isValidNoticeImageDataUrl(value) {
  const s = String(value ?? "").trim();
  return NOTICE_IMAGE_DATA_URL_RE.test(s) && s.length <= NOTICE_MAX_IMAGE_DATA_URL_LEN;
}

export function parseNoticeImages(raw) {
  if (Array.isArray(raw)) {
    return raw.filter(isValidNoticeImageDataUrl);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isValidNoticeImageDataUrl) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function readAndCompressImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 1400;
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height, 1));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("이미지를 처리하지 못했습니다."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 불러오지 못했습니다."));
    };
    img.src = objectUrl;
  });
}

export async function compressNoticeImageFile(file) {
  if (!file || !String(file.type ?? "").startsWith("image/")) {
    throw new Error("이미지 파일만 첨부할 수 있습니다.");
  }
  if (file.size > NOTICE_MAX_IMAGE_FILE_BYTES) {
    throw new Error("사진 용량이 너무 큽니다. (장당 최대 8MB)");
  }
  const dataUrl = await readAndCompressImageFile(file);
  if (!isValidNoticeImageDataUrl(dataUrl)) {
    throw new Error("압축 후에도 용량이 큽니다. 다른 사진을 선택해 주세요.");
  }
  return dataUrl;
}
