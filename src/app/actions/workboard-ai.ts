"use server";

import Anthropic from "@anthropic-ai/sdk";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";

/* Create-from-ServiceM8 (D7): read a mirrored job and PROPOSE an agreement.
   The philosophy is the fleet-ai validated-call pattern — schema-constrained
   output, review-before-save (the create form IS the review; nothing writes
   until the person presses Create), and a graceful floor: with no API key
   the form still prefills from the mirror fields directly, so the flow never
   depends on Tiff being awake. SM8 stays read-only throughout. */

const MODEL = "claude-opus-4-8";

function offline(): string | null {
  return process.env.ANTHROPIC_API_KEY ? null : "no-key";
}

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Tiff is offline — API key rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff — check the connection.";
  if (err instanceof Anthropic.APIError) return "Tiff hit an API error — try again.";
  return "Tiff couldn't read that job.";
}

export type AgreementProposal = {
  label: string | null;
  intervalMonths: number | null;
  hoursEstimate: number | null;
  techsNeeded: number | null;
  accessNotes: string | null;
  /** Packing-list suggestions — become agreement_packing_items on create. */
  bringItems: string[];
};

export type AnalyseJobResult =
  | { ok: true; proposal: AgreementProposal }
  | { ok: false; reason: string };

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    label: { anyOf: [{ type: "string" }, { type: "null" }] },
    intervalMonths: { anyOf: [{ type: "integer" }, { type: "null" }] },
    hoursEstimate: { anyOf: [{ type: "number" }, { type: "null" }] },
    techsNeeded: { anyOf: [{ type: "integer" }, { type: "null" }] },
    accessNotes: { anyOf: [{ type: "string" }, { type: "null" }] },
    bringItems: { type: "array", items: { type: "string" } },
  },
  required: ["label", "intervalMonths", "hoursEstimate", "techsNeeded", "accessNotes", "bringItems"],
  additionalProperties: false,
} as const;

export async function analyseSm8JobForAgreement(remoteId: string): Promise<AnalyseJobResult> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return { ok: false, reason: "Not signed in." };
  if (!(await can("workboard_manage"))) {
    return { ok: false, reason: "You don't have access to manage the Workboard." };
  }
  if (offline()) return { ok: false, reason: "no-key" };

  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, job_description, work_done_description, job_address, geo_city, status")
    .eq("org_id", orgId)
    .eq("uuid", remoteId)
    .maybeSingle();
  const job = data as {
    uuid: string;
    job_description: string | null;
    work_done_description: string | null;
    job_address: string | null;
    geo_city: string | null;
    status: string | null;
  } | null;
  if (!job) return { ok: false, reason: "That job isn't in this workspace's mirror." };

  const material = [
    job.job_description ? `Job description:\n${job.job_description.slice(0, 4000)}` : null,
    job.work_done_description ? `Work done:\n${job.work_done_description.slice(0, 4000)}` : null,
    job.job_address ? `Address: ${job.job_address}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!material) return { ok: false, reason: "That job has no description to read." };

  const prompt =
    "You are Tiff, the AI inside HeyTiff, helping a small Australian HVAC company turn a " +
    "completed ServiceM8 job into a standing maintenance agreement. Read the job below and " +
    "propose the agreement fields. Be conservative: null beats a guess.\n\n" +
    "- label: a short service name the office would say out loud (e.g. \"Rooftop package " +
    "units\", \"Split fleet — 12 heads\"). Never include the client's name in it.\n" +
    "- intervalMonths: how often this kind of service typically recurs, as WHOLE months " +
    "(1, 2, 3, 6 or 12). Only if the work clearly implies a cadence; otherwise null.\n" +
    "- hoursEstimate: hours on site for one visit, from the work described (0.5–24, halves " +
    "allowed). Null if unclear.\n" +
    "- techsNeeded: 1–6, only if the work clearly needs more than one; otherwise null.\n" +
    "- accessNotes: anything in the text about getting in — keys, roof access, contacts, " +
    "induction, after-hours. Null if nothing.\n" +
    "- bringItems: up to 8 short packing-list items a tech should bring for THIS service " +
    "(materials, filters, gas, ladders), from the text only. Empty array if nothing.\n\n" +
    material;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: PROPOSAL_SCHEMA },
      },
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "Tiff declined to read this job." };
    }
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as AgreementProposal;

    // The semantic layer: shape is the schema's job, RANGES are ours.
    const interval =
      typeof parsed.intervalMonths === "number" &&
      Number.isInteger(parsed.intervalMonths) &&
      parsed.intervalMonths >= 1 &&
      parsed.intervalMonths <= 24
        ? parsed.intervalMonths
        : null;
    const hours =
      typeof parsed.hoursEstimate === "number" && parsed.hoursEstimate > 0 && parsed.hoursEstimate <= 24
        ? Math.round(parsed.hoursEstimate * 10) / 10
        : null;
    const techs =
      typeof parsed.techsNeeded === "number" &&
      Number.isInteger(parsed.techsNeeded) &&
      parsed.techsNeeded >= 1 &&
      parsed.techsNeeded <= 6
        ? parsed.techsNeeded
        : null;

    return {
      ok: true,
      proposal: {
        label: typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim().slice(0, 140) : null,
        intervalMonths: interval,
        hoursEstimate: hours,
        techsNeeded: techs,
        accessNotes:
          typeof parsed.accessNotes === "string" && parsed.accessNotes.trim()
            ? parsed.accessNotes.trim().slice(0, 2000)
            : null,
        bringItems: Array.isArray(parsed.bringItems)
          ? parsed.bringItems
              .filter((x): x is string => typeof x === "string" && !!x.trim())
              .map((x) => x.trim().slice(0, 200))
              .slice(0, 8)
          : [],
      },
    };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
}
