import { GoogleGenAI, Modality } from "@google/genai";
import { loadSlideUpaEnv } from "./load-env.js";

const PRIMARY_IMAGE_MODEL = "gemini-2.5-flash-image";
const FALLBACK_IMAGE_MODEL = "imagen-4.0-generate-001";
const RETRYABLE_STATUSES = new Set([429, 502, 503]);

function getHttpStatus(e) {
  if (e && typeof e === "object" && "status" in e) {
    const s = e.status;
    if (typeof s === "number" && !Number.isNaN(s)) return s;
  }
  if (e && typeof e === "object" && "error" in e) {
    const err = e.error;
    if (typeof err?.code === "number") return err.code;
    if (err?.status === "UNAVAILABLE") return 503;
  }
  return undefined;
}

function isRetryable(e) {
  const st = getHttpStatus(e);
  return st !== undefined && RETRYABLE_STATUSES.has(st);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(label, fn, { maxAttempts = 3, baseDelayMs = 5000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts && isRetryable(e)) {
        const wait = baseDelayMs * attempt;
        console.warn(`[gemini] ${label}: ${wait}ms 後に再試行 (${attempt}/${maxAttempts})`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

function getClient() {
  loadSlideUpaEnv();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error("GEMINI_API_KEY が設定されていません（slide-upa/.env）"), {
      code: "NO_API_KEY",
    });
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * @param {string} prompt
 * @returns {Promise<{ buffer: Buffer, mimeType: string, model: string }>}
 */
export async function generateSlideImage(prompt) {
  const ai = getClient();

  try {
    const response = await withRetry(PRIMARY_IMAGE_MODEL, () =>
      ai.models.generateContent({
        model: PRIMARY_IMAGE_MODEL,
        contents: prompt,
        config: { responseModalities: [Modality.IMAGE] },
      }),
    );
    const parts = response?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          buffer: Buffer.from(part.inlineData.data, "base64"),
          mimeType: part.inlineData.mimeType ?? "image/png",
          model: PRIMARY_IMAGE_MODEL,
        };
      }
    }
    throw new Error(`${PRIMARY_IMAGE_MODEL} が画像データを返しませんでした`);
  } catch (primaryError) {
    console.warn(`[gemini] ${PRIMARY_IMAGE_MODEL} 失敗、${FALLBACK_IMAGE_MODEL} にフォールバック:`, primaryError?.message ?? primaryError);
    const response = await withRetry(FALLBACK_IMAGE_MODEL, () =>
      ai.models.generateImages({
        model: FALLBACK_IMAGE_MODEL,
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: "16:9",
        },
      }),
    );
    const bytes = response?.generatedImages?.[0]?.image?.imageBytes;
    if (!bytes) throw primaryError;
    return {
      buffer: Buffer.from(bytes, "base64"),
      mimeType: "image/png",
      model: FALLBACK_IMAGE_MODEL,
    };
  }
}
