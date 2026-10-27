import "dotenv/config";
import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";

export const client = new OpenAI({
  baseURL: "https://api.tokenfactory.nebius.com/v1/",
  apiKey: process.env.NEBIUS_API_KEY,
  maxRetries: 0,
});

export const MODEL_STRONG =
  process.env.MODEL_NAME ?? "nvidia/nemotron-3-super-120b-a12b";

// Limit how many model calls run at the same time, to avoid rate limits
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT ?? 10);
let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

function parseJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model did not return JSON: " + text.slice(0, 300));
  }
  const raw = text.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(jsonrepair(raw));
  }
}

export async function askJson(
  system: string,
  user: string,
  opts: { temperature?: number; seed?: number } = {}
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await acquire();
    try {
      const t0 = Date.now();
      const res = await client.chat.completions.create(
        {
          model: MODEL_STRONG,
          temperature: opts.temperature ?? 0,
          seed: opts.seed ?? 42,
          max_tokens: 3000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { timeout: 90000 }
      );
      console.log(
        `  [LLM] ${((Date.now() - t0) / 1000).toFixed(1)} s | output tokens: ${res.usage?.completion_tokens}`
      );
      return parseJson(res.choices[0].message.content ?? "");
    } catch (err: any) {
      lastError = err;
      console.warn(
        `  (attempt ${attempt} failed: ${err?.status ?? ""} ${String(err?.message).slice(0, 150)})`
      );
    } finally {
      release();
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw lastError;
}