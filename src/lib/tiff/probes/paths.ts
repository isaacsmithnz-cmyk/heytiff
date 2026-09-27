/* THE TWO WAYS TO READ A NOTE, AND THE ASK LOOP — server only, for the
   Phase 0 probes. Nothing here writes: the reads run against the live
   database through the brain's read-only tools, and a note's proposal is
   shaped and returned, never filed.

   TODAY'S ROUTER is `readNote` (lib/workboard/note-brain) with the model as
   a parameter: the same system prompt, the same content, the same schema,
   effort and token budget, so P1 can put Opus 5.5 in the chair without a
   second copy of the prompt drifting from the first.

   THE LOOP is the Phase 2 design in miniature: one call that holds the
   brain's five reads, a screen tool and `file_note`, whose input schema IS
   the router's proposal schema (strict). A note should come back as one
   `file_note` call, which is one model call, the same as today; a question
   should come back as an answer. The router's rules ride in the system
   prompt beside Tiff's, so the model is told exactly what the router is
   told. The words go in raw, as the modal would send them, with no "Note:"
   label: telling a note from a question is the loop's job now.

   Every read is timed on the model call alone and again with the English
   check after it, because `englishProposal` makes a second call only for a
   note that came back partly in another language, and both paths pay it. */

import Anthropic from "@anthropic-ai/sdk";
import {
  noteContent,
  shapeProposal,
  systemPrompt,
  TIFF_NOTE_SCHEMA,
  type NoteContext,
  type NoteProposal,
} from "@/lib/workboard/note-brain";
import { englishProposal } from "@/lib/workboard/note-english";
import { askSystemPrompt } from "@/lib/brain/ask";
import { TIFF_TOOLS, runTool, toolDefs, type Viewer } from "@/lib/tiff/registry";

/* The probes read as the workspace, not as a person: every read in the
   registry, no gate, the reads' own org scoping still applied. */
const probeViewer = (orgId: string): Viewer => ({
  orgId,
  userId: "probe",
  staffId: null,
  role: null,
  caps: new Set(),
  tz: null,
  today: new Date().toISOString().slice(0, 10),
});

async function runRead(orgId: string, name: string, input: Record<string, unknown>) {
  const res = await runTool(probeViewer(orgId), name, input, TIFF_TOOLS);
  if (!res.ok) return res;
  return { ok: true as const, result: res.outcome.kind === "result" ? res.outcome.value : res.outcome };
}
import { navFor } from "@/components/shell/nav";
import { CAPABILITIES } from "@/lib/permissions";
import { REPLY_IN_KIND } from "@/lib/lang/policy";
import type { Usage } from "./rows";

/* The router's own settings (note-brain's MAX_TOKENS and DEFAULT_EFFORT). */
const MAX_TOKENS = 16_000;
const EFFORT = "medium" as const;
const EPHEMERAL = { type: "ephemeral" } as const;

export type Round = { ms: number; usage: Usage; model: string; tools: string[] };

export type NoteRead = {
  /** What the read ended in: a note to file, a screen, an answer in words,
      a refusal, or a failure. Only `filed` carries a proposal. */
  outcome: "filed" | "screen" | "answered" | "refused" | "failed";
  proposal?: NoteProposal;
  /** Words the loop answered with instead of filing, or the failure. */
  text?: string;
  modelMs: number;
  totalMs: number;
  rounds: Round[];
};

const blank = (): Omit<NoteRead, "outcome"> => ({ modelMs: 0, totalMs: 0, rounds: [] });

/** Today's router, with the model in the chair a parameter. */
export async function routerRead(
  client: Anthropic,
  transcript: string,
  ctx: NoteContext,
  model: string,
  effort: "low" | "medium" | "high" = EFFORT,
): Promise<NoteRead> {
  const out = blank();
  const started = performance.now();
  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      output_config: { effort, format: { type: "json_schema", schema: TIFF_NOTE_SCHEMA } },
      system: systemPrompt(ctx),
      messages: [{ role: "user", content: noteContent(transcript) }],
    });
    out.modelMs = performance.now() - started;
    out.rounds.push({ ms: out.modelMs, usage: response.usage, model: response.model, tools: [] });
    if (response.stop_reason === "refusal") return { ...out, outcome: "refused", totalMs: out.modelMs };
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ...out, outcome: "failed", text: "no text block", totalMs: out.modelMs };
    const proposal = await englishProposal(shapeProposal(JSON.parse(block.text), ctx, transcript));
    return { ...out, outcome: "filed", proposal, totalMs: performance.now() - started };
  } catch (err) {
    return { ...out, outcome: "failed", text: err instanceof Error ? err.message : String(err), totalMs: performance.now() - started };
  }
}

/* ── the loop ─────────────────────────────────────────────────────────── */

const SCREENS = navFor({ caps: new Set(CAPABILITIES), role: "owner" }).map((n) => n.key);

const OPEN_SCREEN = {
  name: "open_screen",
  description:
    "Open one of the app's screens for the person, when they ask to be taken somewhere " +
    "(\"take me to the workboard\", \"open my timesheet\"). Only for moving the screen: " +
    "never use it to record anything.",
  input_schema: {
    type: "object",
    properties: { screen: { type: "string", enum: SCREENS } },
    required: ["screen"],
    additionalProperties: false,
  },
};

/* Two knobs for asking why the loop is slower, when it is: its effort
   (TIFF_LOOP_EFFORT, the router's medium by default) and whether file_note
   is strict (TIFF_LOOP_STRICT=0 turns it off, to see what the grammar costs). */
const LOOP_EFFORT = (process.env.TIFF_LOOP_EFFORT ?? EFFORT) as "low" | "medium" | "high";
const LOOP_STRICT = process.env.TIFF_LOOP_STRICT !== "0";
/* TIFF_LOOP_NOLOOKUP=1: tell the loop not to look a job up before filing.
   The router never does (a note is filed on what was said, and "which job?"
   is asked after), and in P0 the loop spent 3 to 6 s doing it on 4 notes. */
const LOOP_NOLOOKUP = process.env.TIFF_LOOP_NOLOOKUP === "1";

const FILE_NOTE = {
  name: "file_note",
  description:
    "Record what the person told you: tasks and reminders, bring items, board flags, " +
    "progress lines, commissioning entries, recurring-issue entries, know-how for the " +
    "library, or a plain remark, routed exactly as the note-routing rules in the system " +
    "prompt say. Call it once for anything they say to you that is not a question or a " +
    "request to open a screen, noise and tests included (the rules say how to keep those). " +
    "Your line back to them goes in `say`; don't also answer in words.",
  input_schema: TIFF_NOTE_SCHEMA,
  strict: LOOP_STRICT,
};

/** Tiff's side of the loop, ahead of the router's rules. Plain and short:
    the router's prompt already carries the hard part. */
function loopSystem(ctx: NoteContext): string {
  return [
    "You are Tiff, the assistant inside an Australian HVAC business's own workspace.",
    "People talk to you in a few words, by voice or by typing. They do one of three things:",
    "tell you something to record or get done, ask you something, or ask to be taken to a screen.",
    "",
    "When they tell you something, call file_note once, filled as the note-routing rules below say.",
    "When they ask you something, answer it, using the read tools for anything about this workspace.",
    "When they ask to go somewhere, call open_screen.",
    "Words that are noise, a test or not meant for you still go to file_note, kept as the rules say.",
    ...(LOOP_NOLOOKUP
      ? ["Never look anything up before filing a note: file it on what they said. Which job it is gets asked afterwards."]
      : []),
    "",
    REPLY_IN_KIND,
    "",
    "The note-routing rules you follow when you call file_note:",
    "",
    systemPrompt(ctx),
  ].join("\n");
}

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

/** One pass of the Phase 2 loop over one person's words. Reads run for
    real (read-only); a file_note call is shaped and returned, never filed. */
export async function loopRead(
  client: Anthropic,
  words: string,
  ctx: NoteContext,
  orgId: string,
  model: string,
  maxRounds = 4,
): Promise<NoteRead> {
  const out = blank();
  const system = loopSystem(ctx);
  const defs = [...toolDefs(TIFF_TOOLS), OPEN_SCREEN, FILE_NOTE];
  const tools = defs.map((d, i) => (i === defs.length - 1 ? { ...d, cache_control: EPHEMERAL } : d));
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: words }];
  const started = performance.now();

  try {
    for (let round = 0; round < maxRounds; round++) {
      const t = performance.now();
      const response = await client.beta.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: "claude-opus-4-8" }],
        output_config: { effort: LOOP_EFFORT },
        system,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
      });
      const ms = performance.now() - t;
      out.modelMs += ms;
      const blocks = response.content as Block[];
      const calls = blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      out.rounds.push({ ms, usage: response.usage as Usage, model: response.model, tools: calls.map((c) => c.name) });

      if (response.stop_reason === "refusal") return { ...out, outcome: "refused", totalMs: performance.now() - started };

      const file = calls.find((c) => c.name === "file_note");
      if (file) {
        const proposal = await englishProposal(shapeProposal(file.input, ctx, words));
        return { ...out, outcome: "filed", proposal, totalMs: performance.now() - started };
      }
      const screen = calls.find((c) => c.name === "open_screen");
      if (screen) return { ...out, outcome: "screen", text: String(screen.input.screen ?? ""), totalMs: performance.now() - started };
      if (calls.length === 0) {
        const text = blocks.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
        return { ...out, outcome: "answered", text, totalMs: performance.now() - started };
      }

      messages.push({ role: "assistant", content: blocks });
      const results = [];
      for (const call of calls) {
        const res = await runRead(orgId, call.name, call.input ?? {});
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: res.ok ? JSON.stringify(res.result).slice(0, 20_000) : res.error,
          is_error: !res.ok,
        });
      }
      messages.push({ role: "user", content: results });
    }
    return { ...out, outcome: "failed", text: "ran out of rounds", totalMs: performance.now() - started };
  } catch (err) {
    return { ...out, outcome: "failed", text: err instanceof Error ? err.message : String(err), totalMs: performance.now() - started };
  }
}

/* ── the ask loop, for P1's questions ─────────────────────────────────── */

export type AskRead = {
  answer: string;
  tools: string[];
  modelMs: number;
  rounds: Round[];
  error?: string;
};

/** Today's ask loop (lib/brain/ask), without the streaming, with the model
    a parameter. Same prompt, same tools, same round cap. */
export async function askRead(
  client: Anthropic,
  question: string,
  orgId: string,
  todayISO: string,
  model: string,
  maxRounds = 5,
): Promise<AskRead> {
  const out: AskRead = { answer: "", tools: [], modelMs: 0, rounds: [] };
  const defs = toolDefs(TIFF_TOOLS);
  const tools = defs.map((d, i) => (i === defs.length - 1 ? { ...d, cache_control: EPHEMERAL } : d));
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: question }];
  try {
    for (let round = 0; round <= maxRounds; round++) {
      const t = performance.now();
      const response = await client.beta.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: "claude-opus-4-8" }],
        output_config: { effort: EFFORT },
        system: askSystemPrompt({ todayISO }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: (round === maxRounds ? [] : tools) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
      });
      const ms = performance.now() - t;
      out.modelMs += ms;
      const blocks = response.content as Block[];
      const calls = blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      out.rounds.push({ ms, usage: response.usage as Usage, model: response.model, tools: calls.map((c) => c.name) });
      out.answer += blocks.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
      if (response.stop_reason !== "tool_use" || calls.length === 0) return out;
      messages.push({ role: "assistant", content: blocks });
      const results = [];
      for (const call of calls) {
        out.tools.push(call.name);
        const res = await runRead(orgId, call.name, call.input ?? {});
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: res.ok ? JSON.stringify(res.result).slice(0, 20_000) : res.error,
          is_error: !res.ok,
        });
      }
      messages.push({ role: "user", content: results });
    }
    return out;
  } catch (err) {
    return { ...out, error: err instanceof Error ? err.message : String(err) };
  }
}
