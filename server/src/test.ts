import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.tokenfactory.nebius.com/v1/",
  apiKey: process.env.NEBIUS_API_KEY,
});

async function main() {
  const res = await client.chat.completions.create({
    model: "nvidia/nemotron-3-super-120b-a12b",
    messages: [{ role: "user", content: "Say hello in Swedish." }],
  });
  console.log(res.choices[0].message.content);
}

main().catch((err) => console.error("ERROR:", err.message));