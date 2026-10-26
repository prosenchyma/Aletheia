import "dotenv/config";
import OpenAI from "openai";

export const client = new OpenAI({
  baseURL: "https://api.tokenfactory.nebius.com/v1/",
  apiKey: process.env.NEBIUS_API_KEY,
});

export const MODEL_STRONG = "nvidia/nemotron-3-super-120b-a12b";

export async function askJson(system: string, user: string): Promise<any> {
  const res = await client.chat.completions.create({
    model: MODEL_STRONG,
    temperature: 0.1,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = res.choices[0].message.content ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model did not return JSON: " + text);
  }
  return JSON.parse(text.slice(start, end + 1));
}