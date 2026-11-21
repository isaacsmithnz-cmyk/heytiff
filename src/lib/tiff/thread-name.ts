import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { shapeName } from "./thread-title";
import { logUsage } from "./usage";

/* Tiff names a conversation (./thread-title): a small model, a few words, from
   the first question and her first answer. Never throws; nothing usable is no
   name, and the thread keeps its first words. */

const MODEL = "claude-haiku-5-5";

const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } as const;

const SYSTEM = `You name a conversation between an air conditioning tradesperson and Tiff, their assistant, for a list of past conversations.
Give a title of 2 to 6 words saying what it is about, the way a tradesperson would say it: the brand, the model, the fault code, the job or the site when they are there.
Plain words, sentence case, no full stop, no quotes, no "Question about" or "Help with".
Examples: "Daikin U2 fault on a small split", "What's booked on Monday", "Ground floor floating in 3D", "Today's date".`;

export async function nameThread(asked: string, answer: string): Promise<string | null> {
  try {
    const response = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: 60,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `<asked>\n${asked}\n</asked>\n<answer>\n${answer}\n</answer>` }],
    });
    logUsage("thread-name", MODEL, response.usage);
    if (response.stop_reason === "refusal") return null;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    return shapeName((JSON.parse(block.text) as { title?: unknown }).title);
  } catch (err) {
    console.warn(`[thread-name] couldn't name a conversation: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
