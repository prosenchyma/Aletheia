import { client } from "./llm";

async function main() {
  const models = await client.models.list();
  for await (const m of models) {
    console.log(m.id);
  }
}

main().catch((err) => console.error("ERROR:", err.message));