import "dotenv/config";
import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";

export const client = new OpenAI({
  baseURL: "https://api.tokenfactory.nebius.com/v1/",
  apiKey: process.env.NEBIUS_API_KEY,
});

export const MODEL_STRONG =
  process.env.MODEL_NAME ?? "nvidia/nemotron-3-super-120b-a12b";

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
    // Try to repair small syntax errors
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
    try {
      const t0 = Date.now();
      const res = await client.chat.completions.create({
        model: MODEL_STRONG,
        temperature: opts.temperature ?? 0,
        seed: opts.seed ?? 42,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      console.log(
        `  [LLM] ${((Date.now() - t0) / 1000).toFixed(1)} s | output tokens: ${res.usage?.completion_tokens}`
      );
      return parseJson(res.choices[0].message.content ?? "");
    } catch (err) {
      lastError = err;
      console.warn(`  (attempt ${attempt} failed, retrying...)`);
    }
  }
  throw lastError;
}