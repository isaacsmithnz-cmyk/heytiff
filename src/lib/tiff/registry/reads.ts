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
import { fitDesignRead } from "@/lib/quotes/design-read";
import { readAnyDesign } from "@/lib/quotes/design-read-server";
import { reviseDesignRoof } from "@/lib/studio/revise-server";
import type { Outcome, TiffTool } from "./types";

const str = { type: "string" } as const;
const result = (value: unknown): Outcome => ({ kind: "result", value });

/** One search_jobs candidate, shaped to be handed straight to job_history. */
export type JobSearchResult = { kind: "job"; id: string } & Pick<
  JobSearchHit,
  "jobNumber" | "status" | "clientName" | "suburb" | "address" | "description" | "linkedTo"
>;

export const READS: readonly TiffTool[] = [
  /* One engine (Isaac, 19 October: "make sure that this is still part of
     the same engine throughout the whole system so you can talk to it
     through any screen"): a Studio design as its Summary reads it, and what
     Tiff read off its plans, from Home or anywhere else. */
  {
    name: "studio_design",
    label: "Reading the design",
    risk: "read",
    gate: { capability: "studio" },
    description:
      "One of the business's Studio designs, named by its name, its job's number or its id (the newest that matches; the newest of all when you name none). " +
      "Gives the design as its Summary reads it (each system, its units, the rooms with their loads and cover, the pipe runs, what fails its checks), " +
      "and what was read off its plans when they were read: per floor, the rooms and small spaces with their areas once the floor is scaled, " +
      "the stairs, voids and notches, the windows with their facing and width, doors, skylights, notes about air conditioning and roof space, " +
      "built-ins, ceiling fans, furniture, what was looked for and not found, and labels on the plan the reading doesn't account for. " +
      "And the roof read off the drawings: each floor's ceiling height, the roof's parts (form, pitch, eave height, overhang), the raked rooms, what the set says of the roof space, " +
      "and over every room the clear height between the ceiling joists and the rafters, lowest and highest. Use that for whether a ducted unit, a fan coil or a duct fits in the roof void: compare the unit's height plus its clearances with the clear height where it would go, and say the framing is assumed. " +
      "Use it for any question about a design, a floor, a room's size or glass, or where a unit could go. Areas are only given for a floor whose scale is set; say so when one isn't.",
    inputSchema: {
      type: "object",
      properties: {
        design: { type: "string", description: "The design's name, its job's number, or its id; leave empty for the newest" },
        system: { type: "string", description: "One system by its name, when a long design came back a system at a time" },
      },
      additionalProperties: false,
    },
    run: async (viewer, input) => {
      const got = await readAnyDesign(viewer.orgId, typeof input.design === "string" ? input.design : "");
      if (!got.found) return result({ found: false, said: got.reason, designs: got.designs ?? [] });
      const system = typeof input.system === "string" ? input.system.slice(0, 120) : null;
      return result({ ...fitDesignRead(got.read, { system }), plans: got.plans, roof: got.roof, other_designs: got.others });
    },
  },

  /* Tiff revises the 3D from the chat (Isaac, 20 October: "She should also
     be able to revise 3d renderings if you are not happy… open up the TIFF
     button. And talk to it"). She reads the drawings again with what she
     read before and the words; the corrected roof goes to the open design,
     which takes it through its own history, so Undo takes it back. Nothing
     is written here. */
  {
    name: "revise_design_3d",
    label: "Reading the drawings again",
    risk: "read",
    gate: { capability: "studio" },
    description:
      "Correct the 3D of the design open on the screen (its id is in the screen line) when the person says the roof, a ceiling height, a pitch, the eaves or a raked room is wrong: " +
      "the drawings are read again with what was read before and their words, and the corrected roof goes onto the design they have open, which they can undo. " +
      "Only for the design open on the screen, and only when they ask for a change; pass their words as they said them. Then say in a line what changed.",
    inputSchema: {
      type: "object",
      properties: {
        design_id: { type: "string", description: "The open design's id, from the screen line" },
        words: { type: "string", description: "What they said is wrong, or what it should be" },
      },
      required: ["design_id", "words"],
      additionalProperties: false,
    },
    run: async (viewer, input) => {
      const designId = typeof input.design_id === "string" ? input.design_id.slice(0, 80) : "";
      const got = await reviseDesignRoof(viewer.orgId, designId, typeof input.words === "string" ? input.words : "");
      if (!got.ok) return result({ changed: false, said: got.error });
      return { kind: "apply", target: "design-roof", designId, roof: got.roof, said: got.said };
    },
  },

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
