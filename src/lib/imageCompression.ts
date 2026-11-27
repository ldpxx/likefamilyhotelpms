/**
 * Browser-side HTML5 Canvas image compression utility.
 * Storage target (Firestore `guest_documents` Base64): maxWidth 800px, JPEG q=0.65 (~40KB-80KB).
 * OCR target (in-memory Gemini Vision input): maxWidth 1600px, JPEG q=0.90 (sharp for tiny passport/stamp dates).
 */

export interface CompressedImagePair {
  storageBase64: string;
  storageSizeBytes: number;
  ocrBase64: string;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function renderCanvasJpeg(
  img: HTMLImageElement,
  maxWidth: number,
  quality: number
): string {
  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ HTML5 Canvas');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', quality);
}

export function estimateBase64Bytes(dataUrl: string | null | undefined): number {
  if (!dataUrl) return 0;
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return Math.round((base64.length * 3) / 4);
}

export async function compressDocumentImage(file: File): Promise<CompressedImagePair> {
  const img = await loadImageFromFile(file);
  const storageBase64 = renderCanvasJpeg(img, 800, 0.65);
  const ocrBase64 = renderCanvasJpeg(img, 1600, 0.9);
  return {
    storageBase64,
    storageSizeBytes: estimateBase64Bytes(storageBase64),
    ocrBase64,
  };
}

export async function compressLogoImage(file: File): Promise<string> {
  const img = await loadImageFromFile(file);
  const MAX_BASE64_CHARS = 60_000;
  const widths = [320, 260, 200, 160];

  const renderAt = (maxWidth: number, mime: 'image/webp' | 'image/png', quality?: number) => {
    const scale = img.width > maxWidth ? maxWidth / img.width : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas không khả dụng');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(mime, quality);
  };

  // Prefer PNG if already compact (< 60KB) for crisp vector/logo edges with full alpha transparency
  const png320 = renderAt(320, 'image/png');
  if (png320.length < MAX_BASE64_CHARS) {
    return png320;
  }

  // Try WebP (preserves alpha transparency with much smaller size) across decreasing widths & qualities
  for (const w of widths) {
    for (const q of [0.85, 0.72, 0.58, 0.45]) {
      const webp = renderAt(w, 'image/webp', q);
      if (webp.startsWith('data:image/webp') && webp.length < MAX_BASE64_CHARS) {
        return webp;
      }
    }
    const pngSmaller = renderAt(w, 'image/png');
    if (pngSmaller.length < MAX_BASE64_CHARS) {
      return pngSmaller;
    }
  }

  throw new Error('Ảnh logo quá nặng, vui lòng chọn ảnh PNG/WebP gọn hơn (< 60 KB sau nén).');
}

export function formatFileSizeKB(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
