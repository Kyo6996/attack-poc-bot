import "server-only";
import { env } from "./env";

// Si falla devuelve null y se usa el scoring heurístico.
export async function askClaudeJson<T>(prompt: string): Promise<T | null> {
  const key = env.anthropicKey();
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.anthropicModel(),
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error("Claude", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = json.content.find((b) => b.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as T) : null;
  } catch (e) {
    console.error("Claude", e);
    return null;
  }
}
