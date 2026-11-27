import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { GeminiApiKeyEntry, GuestCategory, SystemAiConfig } from '../types/pms';

/**
 * Production-hardened Gemini Vision OCR engine following `gemini-vision-ocr` standards:
 * - Zero hardcoded deprecated models (NEVER gemini-2.0-flash / gemini-1.5-* / gemini-pro-vision)
 * - 4-layer Model Resolver with live `/v1beta/models` auto-discovery & localStorage cache
 * - Unified runtime config reader across Firestore (`system_config/global_settings`), localStorage & .env
 * - Round-robin API key rotation on 429/401/403
 * - Zero Mock Fallback (never fabricates guest data on errors)
 */

const LS_LAST_MODEL = 'lfpms_gemini_last_working_model';
const LS_AI_CONFIG = 'lfpms_gemini_ai_config_cache';
const LS_DISCOVERED_MODELS = 'lfpms_gemini_discovered_models';
const DISCOVERED_TTL_MS = 15 * 60 * 1000;
const RAM_CONFIG_TTL_MS = 60 * 1000;

const DEPRECATED_PATTERNS = [
  'gemini-1.0',
  'gemini-1.5',
  'gemini-2.0',
  'gemini-pro-vision',
  'embedding',
  'tts',
  'imagen',
  'veo',
  'audio',
  'live',
  'aqa',
  'gemma',
];

const MODERN_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-flash-latest',
];

let ramConfigCache: { config: ResolvedAiConfig; loadedAt: number } | null = null;
let keyRotationCursor = 0;

export interface ResolvedAiConfig {
  apiKeys: string[];
  preferredModel?: string;
  configLoadError?: string;
}

export interface OcrExtractedGuest {
  guestCategory: GuestCategory;
  idNumber?: string;
  visaNumber?: string;
  fullName?: string;
  gender?: string;
  dob?: string;
  nationality?: string;
  address?: string;
  idIssueDate?: string;
  phone?: string;
  entryDate?: string;
  stayPermitExpiryDate?: string;
  stayPermitSource?: 'entry_stamp' | 'visa' | 'unknown';
  confidenceNote?: string;
  modelUsed: string;
}

export class GeminiOcrError extends Error {
  code:
    | 'NO_API_KEY'
    | 'CONFIG_LOAD_ERROR'
    | 'INVALID_API_KEY'
    | 'QUOTA_EXCEEDED'
    | 'MODEL_UNAVAILABLE'
    | 'EMPTY_RESULT'
    | 'INVALID_JSON'
    | 'NETWORK_ERROR';
  httpStatus?: number;
  triedModels?: string[];

  constructor(
    code: GeminiOcrError['code'],
    message: string,
    opts?: { httpStatus?: number; triedModels?: string[] }
  ) {
    super(message);
    this.name = 'GeminiOcrError';
    this.code = code;
    this.httpStatus = opts?.httpStatus;
    this.triedModels = opts?.triedModels;
  }
}

function isModelAllowed(modelName: string | undefined | null): boolean {
  if (!modelName) return false;
  const clean = modelName.replace(/^models\//, '').toLowerCase().trim();
  if (!clean.startsWith('gemini')) return false;
  return !DEPRECATED_PATTERNS.some((bad) => clean.includes(bad));
}

function parseEnvKeys(): string[] {
  const raw =
    (import.meta.env.VITE_GEMINI_API_KEYS as string | undefined) ||
    (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ||
    '';
  return raw
    .split(/[\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function extractActiveKeys(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const out: string[] = [];
  for (const item of entries) {
    if (typeof item === 'string') {
      const k = item.trim();
      if (k) out.push(k);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (obj.enabled === false || obj.active === false) continue;
      const k = String(obj.key || obj.apiKey || obj.value || '').trim();
      if (k) out.push(k);
    }
  }
  return out;
}

export async function saveSystemAiConfig(
  entries: GeminiApiKeyEntry[],
  preferredModel: string | undefined,
  updatedBy: string
): Promise<void> {
  const payload: SystemAiConfig = {
    geminiApiKeys: entries.filter((e) => e.key.trim().length > 0),
    preferredModel: isModelAllowed(preferredModel) ? preferredModel : '',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await setDoc(doc(db, 'system_config', 'global_settings'), payload, { merge: true });
  try {
    localStorage.setItem(LS_AI_CONFIG, JSON.stringify(payload));
  } catch {
    // ignore storage quota
  }
  ramConfigCache = null;
}

export async function fetchAiRuntimeConfig(opts?: {
  forceRefresh?: boolean;
}): Promise<ResolvedAiConfig> {
  const now = Date.now();
  if (!opts?.forceRefresh && ramConfigCache && now - ramConfigCache.loadedAt < RAM_CONFIG_TTL_MS) {
    return ramConfigCache.config;
  }

  let cloudData: Record<string, unknown> | null = null;
  let configLoadError: string | undefined;

  try {
    const fetchPromise = getDoc(doc(db, 'system_config', 'global_settings'));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Hết thời gian đọc cấu hình AI (8s)')), 8000)
    );
    const snap = await Promise.race([fetchPromise, timeoutPromise]);
    if (snap.exists()) {
      cloudData = snap.data() as Record<string, unknown>;
      try {
        localStorage.setItem(LS_AI_CONFIG, JSON.stringify(cloudData));
      } catch {
        // ignore
      }
    }
  } catch (err) {
    configLoadError = err instanceof Error ? err.message : 'Lỗi đọc cấu hình AI từ Firestore';
    try {
      const cached = localStorage.getItem(LS_AI_CONFIG);
      if (cached) cloudData = JSON.parse(cached) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  const keys = new Set<string>();
  if (cloudData) {
    extractActiveKeys(cloudData.geminiApiKeys || cloudData.apiKeys).forEach((k) => keys.add(k));
    const single = String(cloudData.geminiApiKey || cloudData.apiKey || '').trim();
    if (single) keys.add(single);
  }
  parseEnvKeys().forEach((k) => keys.add(k));

  const rawPreferred = cloudData?.preferredModel ? String(cloudData.preferredModel) : undefined;
  const resolved: ResolvedAiConfig = {
    apiKeys: Array.from(keys),
    preferredModel: isModelAllowed(rawPreferred) ? rawPreferred : undefined,
    configLoadError: keys.size === 0 ? configLoadError : undefined,
  };

  ramConfigCache = { config: resolved, loadedAt: now };
  return resolved;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverAvailableGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const cachedRaw = localStorage.getItem(LS_DISCOVERED_MODELS);
    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw) as { ts: number; models: string[] };
      if (Date.now() - parsed.ts < DISCOVERED_TTL_MS && parsed.models.length > 0) {
        return parsed.models;
      }
    }
  } catch {
    // ignore
  }

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: 'GET' },
    8000
  );
  if (!res.ok) {
    return [];
  }
  const json = (await res.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };
  const candidates = (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((name) => isModelAllowed(name));

  // Rank newest flash models first, then pro
  candidates.sort((a, b) => {
    const score = (n: string) => {
      let s = 0;
      if (n.includes('2.5')) s += 30;
      if (n.includes('3.')) s += 40;
      if (n.includes('flash')) s += 20;
      if (n.includes('lite')) s -= 3;
      if (n.includes('latest')) s += 5;
      return s;
    };
    return score(b) - score(a);
  });

  try {
    localStorage.setItem(
      LS_DISCOVERED_MODELS,
      JSON.stringify({ ts: Date.now(), models: candidates })
    );
  } catch {
    // ignore
  }

  return candidates;
}

export async function testGeminiApiKey(
  apiKey: string
): Promise<{ ok: boolean; recommendedModel?: string; availableModels: string[]; message: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { ok: false, availableModels: [], message: 'Vui lòng nhập API key.' };
  }
  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`,
      { method: 'GET' },
      8000
    );
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = (errJson as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
      return { ok: false, availableModels: [], message: `Key không hợp lệ (${res.status}): ${msg}` };
    }
    localStorage.removeItem(LS_DISCOVERED_MODELS);
    const models = await discoverAvailableGeminiModels(cleanKey);
    const top = models[0] || MODERN_FALLBACK_CHAIN[0];
    return {
      ok: true,
      recommendedModel: top,
      availableModels: models.slice(0, 8),
      message: `Kết nối thành công. Model đề xuất: ${top}`,
    };
  } catch (err) {
    return {
      ok: false,
      availableModels: [],
      message: err instanceof Error ? err.message : 'Lỗi kết nối mạng tới Google Gemini API',
    };
  }
}

function buildOcrPrompt(category: GuestCategory, labels: string[]): string {
  if (category === 'vietnamese') {
    return `Bạn là hệ thống OCR giấy tờ tùy thân Việt Nam (CCCD/CMND) cho lễ tân khách sạn.
Các ảnh đính kèm theo thứ tự: ${labels.join(', ')}.
Hãy trích xuất CHÍNH XÁC thông tin có thực trên ảnh. Tuyệt đối KHÔNG bịa đặt hoặc đoán bừa nếu ảnh mờ (để chuỗi rỗng "").
Trả về JSON duy nhất đúng schema sau:
{
  "idNumber": "Số CCCD 12 số",
  "fullName": "HỌ VÀ TÊN in hoa có dấu đúng như trên CCCD",
  "gender": "Nam hoặc Nữ",
  "dob": "YYYY-MM-DD",
  "address": "Nơi thường trú đầy đủ",
  "idIssueDate": "YYYY-MM-DD (lấy từ mặt sau CCCD nếu có)",
  "nationality": "Việt Nam",
  "confidenceNote": "Ghi chú ngắn nếu có vùng bị mờ hoặc thiếu mặt sau"
}`;
  }

  return `You are a precision hotel front-desk OCR extractor for foreign guest immigration compliance in Vietnam (ASM portal).
Attached images in order: ${labels.join(', ')}.
CRITICAL RULE FOR STAY PERMIT EXPIRY:
Compare BOTH the Visa/e-Visa validity date AND the Vietnam Immigration Entry Stamp (Dấu mộc nhập cảnh "Được phép tạm trú đến ngày / Permitted to remain until").
ALWAYS prioritize the date stamped on the Vietnam Entry Stamp as "stayPermitExpiryDate" whenever an entry stamp is present, because border immigration officers grant the actual lawful stay limit.

Extract ONLY real visible text. Leave empty string "" if unreadable. Never fabricate data.
Return strictly one JSON object matching this schema:
{
  "idNumber": "Passport number",
  "visaNumber": "Visa / e-Visa number if visible, else empty",
  "fullName": "FULL NAME from passport MRZ/bio page",
  "dob": "YYYY-MM-DD",
  "gender": "Nam (if M/Male) or Nữ (if F/Female)",
  "nationality": "Country name or 3-letter nationality",
  "entryDate": "YYYY-MM-DD from Vietnam entry stamp",
  "stayPermitExpiryDate": "YYYY-MM-DD (PRIORITIZE Vietnam Entry Stamp permitted-until date over Visa expiry)",
  "stayPermitSource": "entry_stamp | visa | unknown",
  "confidenceNote": "Short Vietnamese note confirming whether date came from Entry Stamp or Visa, or if blurry"
}`;
}

function dataUrlToInlinePart(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Định dạng ảnh Base64 không hợp lệ');
  }
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2],
    },
  };
}

export async function runGuestDocumentOcr(params: {
  category: GuestCategory;
  images: Array<{ label: string; dataUrl: string }>;
  forceRefreshConfig?: boolean;
}): Promise<OcrExtractedGuest> {
  if (!params.images.length) {
    throw new GeminiOcrError('EMPTY_RESULT', 'Vui lòng tải lên ít nhất 1 ảnh giấy tờ trước khi quét.');
  }

  const runtime = await fetchAiRuntimeConfig({ forceRefresh: params.forceRefreshConfig });
  if (runtime.apiKeys.length === 0) {
    if (runtime.configLoadError) {
      throw new GeminiOcrError(
        'CONFIG_LOAD_ERROR',
        `Không thể tải cấu hình Gemini API Key từ Firestore: ${runtime.configLoadError}`
      );
    }
    throw new GeminiOcrError(
      'NO_API_KEY',
      'Chưa cấu hình Gemini API Key. Vào mục Cài đặt (Admin) để thêm API Key hoặc cấu hình VITE_GEMINI_API_KEYS.'
    );
  }

  const lastWorking = (() => {
    try {
      const m = localStorage.getItem(LS_LAST_MODEL);
      return isModelAllowed(m) ? m : null;
    } catch {
      return null;
    }
  })();

  const baseModels: string[] = [];
  if (lastWorking) baseModels.push(lastWorking);
  if (runtime.preferredModel && !baseModels.includes(runtime.preferredModel)) {
    baseModels.push(runtime.preferredModel);
  }
  for (const fb of MODERN_FALLBACK_CHAIN) {
    if (!baseModels.includes(fb)) baseModels.push(fb);
  }

  const prompt = buildOcrPrompt(
    params.category,
    params.images.map((i) => i.label)
  );
  const parts = [{ text: prompt }, ...params.images.map((i) => dataUrlToInlinePart(i.dataUrl))];

  const triedModels: string[] = [];
  let discoveredOnce = false;
  const candidateQueue = [...baseModels];
  let lastHttpError: { status: number; message: string } | null = null;

  const totalKeys = runtime.apiKeys.length;
  let keyAttempts = 0;

  while (candidateQueue.length > 0 && keyAttempts < totalKeys * 4) {
    const model = candidateQueue.shift()!;
    if (triedModels.includes(model)) continue;

    let keyFailedAll = false;
    for (let k = 0; k < totalKeys; k++) {
      const keyIdx = (keyRotationCursor + k) % totalKeys;
      const apiKey = runtime.apiKeys[keyIdx];
      keyAttempts++;

      try {
        const res = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
          )}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
              },
            }),
          },
          35000
        );

        if (res.ok) {
          keyRotationCursor = keyIdx;
          const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!rawText.trim()) {
            throw new GeminiOcrError(
              'EMPTY_RESULT',
              'AI không đọc được văn bản từ ảnh. Vui lòng chụp rõ nét hơn hoặc nhập thủ công.'
            );
          }

          let parsed: Record<string, unknown>;
          try {
            const cleanJson = rawText
              .replace(/^```json\s*/i, '')
              .replace(/^```\s*/i, '')
              .replace(/```$/i, '')
              .trim();
            parsed = JSON.parse(cleanJson) as Record<string, unknown>;
          } catch {
            throw new GeminiOcrError(
              'INVALID_JSON',
              'Kết quả trả về từ AI không đúng định dạng JSON. Vui lòng thử quét lại.'
            );
          }

          try {
            localStorage.setItem(LS_LAST_MODEL, model);
          } catch {
            // ignore
          }

          const hasAnyField = Boolean(
            parsed.fullName || parsed.idNumber || parsed.visaNumber || parsed.stayPermitExpiryDate
          );
          if (!hasAnyField) {
            throw new GeminiOcrError(
              'EMPTY_RESULT',
              'Ảnh bị mờ hoặc không phải giấy tờ tùy thân hợp lệ. Vui lòng chụp lại rõ hơn hoặc nhập thủ công.'
            );
          }

          return {
            guestCategory: params.category,
            idNumber: String(parsed.idNumber || '').trim(),
            visaNumber: String(parsed.visaNumber || '').trim(),
            fullName: String(parsed.fullName || '').trim(),
            gender: String(parsed.gender || '').trim(),
            dob: String(parsed.dob || '').trim(),
            nationality:
              String(parsed.nationality || '').trim() ||
              (params.category === 'vietnamese' ? 'Việt Nam' : ''),
            address: String(parsed.address || '').trim(),
            idIssueDate: String(parsed.idIssueDate || '').trim(),
            entryDate: String(parsed.entryDate || '').trim(),
            stayPermitExpiryDate: String(parsed.stayPermitExpiryDate || '').trim(),
            stayPermitSource:
              (parsed.stayPermitSource as OcrExtractedGuest['stayPermitSource']) || 'unknown',
            confidenceNote: String(parsed.confidenceNote || '').trim(),
            modelUsed: model,
          };
        }

        const errBody = await res.json().catch(() => ({}));
        const errMsg =
          (errBody as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`;
        lastHttpError = { status: res.status, message: errMsg };

        // 429 or 401/403 -> rotate immediately to next API key
        if (res.status === 429 || res.status === 401 || res.status === 403) {
          keyRotationCursor = (keyIdx + 1) % totalKeys;
          if (k === totalKeys - 1) {
            keyFailedAll = true;
          }
          continue;
        }

        // 404 or deprecated -> clear cached model, discover live models, try next model
        if (
          res.status === 404 ||
          errMsg.toLowerCase().includes('not found') ||
          errMsg.toLowerCase().includes('deprecated') ||
          errMsg.toLowerCase().includes('no longer available')
        ) {
          triedModels.push(model);
          try {
            if (localStorage.getItem(LS_LAST_MODEL) === model) {
              localStorage.removeItem(LS_LAST_MODEL);
            }
          } catch {
            // ignore
          }
          if (!discoveredOnce) {
            discoveredOnce = true;
            const liveModels = await discoverAvailableGeminiModels(apiKey);
            for (const lm of liveModels) {
              if (!triedModels.includes(lm) && !candidateQueue.includes(lm)) {
                candidateQueue.unshift(lm);
              }
            }
          }
          break;
        }

        // Other HTTP error -> break model loop and report cleanly
        throw new GeminiOcrError('NETWORK_ERROR', `Lỗi Gemini API (HTTP ${res.status}): ${errMsg}`, {
          httpStatus: res.status,
          triedModels: [...triedModels, model],
        });
      } catch (err) {
        if (err instanceof GeminiOcrError) throw err;
        const msg = err instanceof Error ? err.message : 'Lỗi kết nối mạng';
        throw new GeminiOcrError('NETWORK_ERROR', `Không thể kết nối Gemini Vision: ${msg}`, {
          triedModels: [...triedModels, model],
        });
      }
    }

    if (keyFailedAll && lastHttpError) {
      if (lastHttpError.status === 429) {
        throw new GeminiOcrError(
          'QUOTA_EXCEEDED',
          `Tất cả ${totalKeys} Gemini API key đều vượt hạn mức (HTTP 429): ${lastHttpError.message}`,
          { httpStatus: 429, triedModels: [...triedModels, model] }
        );
      }
      throw new GeminiOcrError(
        'INVALID_API_KEY',
        `Gemini API Key không hợp lệ hoặc bị từ chối (HTTP ${lastHttpError.status}): ${lastHttpError.message}`,
        { httpStatus: lastHttpError.status, triedModels: [...triedModels, model] }
      );
    }
  }

  throw new GeminiOcrError(
    'MODEL_UNAVAILABLE',
    `Không tìm thấy model Gemini khả dụng (${lastHttpError?.message || 'HTTP 404'}). Đã thử: ${triedModels.join(', ')}`,
    { httpStatus: lastHttpError?.status || 404, triedModels }
  );
}
