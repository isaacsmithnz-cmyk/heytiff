/* THE FIVE READS — moved here from lib/brain/tools, unchanged.

   Names, descriptions and schemas are what they were, so nothing the model
   sees differs; only the call now carries the viewer rather than a bare org
   id. The readers themselves stay in lib/brain/tools, which the note router
   also reads from, and that module imports nothing from here: the registry
   depends on the readers, never the other way round.

   The descriptions say "knowledge base" to the model on purpose (see
   components/tiff/__tests__/vocabulary.test.ts, which lists this file as
   model-facing). */

import { issueLog, jobHistory, openTaskLoad, TARGET_KINDS } from "@/lib/brain/tools";
import { searchMirrorJobs, type JobSearchHit } from "@/lib/workboard/projects-query";
import { retrieveForQuestion } from "@/lib/tiff/retrieve";
import type { NoteTarget } from "@/app/actions/workboard-notes";
import type { Outcome, TiffTool } from "./types";

const str = { type: "string" } as const;
const result = (value: unknown): Outcome => ({ kind: "result", value });

/** One search_jobs candidate, shaped to be handed straight to job_history. */
export type JobSearchResult = { kind: "job"; id: string } & Pick<
  JobSearchHit,
  "jobNumber" | "status" | "clientName" | "suburb" | "address" | "description" | "linkedTo"
>;

export const READS: readonly TiffTool[] = [
  {
    name: "job_history",
    label: "Reading the job's history",
    risk: "read",
    gate: { capability: "workboard" },
    description:
      "Everything already on record for one job: open issues with how often each has recurred, " +
      "active flags, the last few notes, equipment on site, and the job's own notes. Call this " +
      "before answering anything about a specific job. A ServiceM8 job is kind \"job\" — pass " +
      "the kind and id a search_jobs result gives you.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: TARGET_KINDS },
        id: str,
      },
      required: ["kind", "id"],
      additionalProperties: false,
    },
    run: async (viewer, input) =>
      result(
        await jobHistory(viewer.orgId, {
          kind: input.kind as NoteTarget["kind"],
          id: String(input.id ?? ""),
        })
      ),
  },
  {
    name: "search_jobs",
    label: "Searching the board's jobs",
    risk: "read",
    gate: { capability: "workboard" },
    description:
      "Find ServiceM8 jobs by client, site, service or job number. Each candidate carries the " +
      "kind and id job_history takes — pass them as they are to read one in depth.",
    inputSchema: {
      type: "object",
      properties: { query: str },
      required: ["query"],
      additionalProperties: false,
    },
    /* A hit is a mirror job, known by its ServiceM8 uuid — `remoteId` to the
       attach picker, which is no name a model would think to hand job_history
       as an `id`. So each one says outright what job_history wants, `kind`
       and `id`. The rest is named field by field: the client's company uuid
       answers nothing, and a column the picker grows later should not reach
       the prompt unasked. */
    run: async (viewer, input) =>
      result(
        (await searchMirrorJobs(viewer.orgId, String(input.query ?? ""))).map(
          (h): JobSearchResult => ({
            kind: "job",
            id: h.remoteId,
            jobNumber: h.jobNumber,
            status: h.status,
            clientName: h.clientName,
            suburb: h.suburb,
            address: h.address,
            description: h.description,
            linkedTo: h.linkedTo,
          })
        )
      ),
  },
  {
    name: "open_task_load",
    label: "Checking who's carrying what",
    risk: "read",
    gate: { capability: "workboard" },
    description:
      "Open tasks per person, heaviest first, with overdue counts — who is already carrying " +
      "what. `today` must be the org's own date (YYYY-MM-DD).",
    inputSchema: {
      type: "object",
      properties: { today: str },
      required: ["today"],
      additionalProperties: false,
    },
    run: async (viewer, input) => result(await openTaskLoad(viewer.orgId, String(input.today ?? ""))),
  },
  {
    name: "issue_log",
    label: "Scanning recurring issues",
    risk: "read",
    gate: { capability: "workboard" },
    description:
      "Open recurring issues across every job, most-repeated first — the cross-job pattern " +
      "view. Use it for 'what keeps breaking' questions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (viewer) => result(await issueLog(viewer.orgId)),
  },
  {
    name: "kb_search",
    label: "Searching the library",
    risk: "read",
    gate: { capability: "tiff" },
    description:
      "Search the knowledge base — manuals AND field notes the crew has taught. Returns " +
      "excerpts with their sources; field notes carry who learned them and where.",
    inputSchema: {
      type: "object",
      properties: { query: str },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (viewer, input) => {
      const found = await retrieveForQuestion(viewer.orgId, String(input.query ?? ""));
      /* The loop wants excerpts, not the full retrieval trace. */
      return result(
        found.chunks.slice(0, 8).map((c) => ({
          title: c.title,
          category: c.category,
          heading: c.heading,
          pages: c.pageFrom === c.pageTo ? `${c.pageFrom}` : `${c.pageFrom}–${c.pageTo}`,
          content: c.content.slice(0, 1200),
        }))
      );
    },
  },
];
