"use server";

import Anthropic from "@anthropic-ai/sdk";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { RawExtraction } from "@/lib/studio/document";
import { EXTRACTION_SCHEMA, EXTRACTION_SYSTEM } from "@/lib/studio/simple-extract";

/* AI plan extraction — sends a stored plan raster to Claude vision and returns
   structured floor-plan geometry (spaces / openings / fixtures / labels) in
   image-pixel coordinates. Kept separate from studio-plans.ts so the Anthropic
   SDK never loads on the hot signed-URL path. The API key lives server-side
   only; clients reach this via a lazy import (remote-store.ts pattern).

   Deployment note: a generation takes 15–60 s — when this ships to Vercel the
   invoking route segment needs `maxDuration` raised accordingly. */

const BUCKET = "studio-plans";
const EXTRACTION_MODEL = "claude-opus-4-8";

async function requireOrg(): Promise<string> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

function assertOrgRef(ref: string, orgId: string): void {
  if (!ref.startsWith(`org/${orgId}/`)) {
    throw new Error("Plan image does not belong to this organization");
  }
}

export async function extractPlanGeometry(
  ref: string,
  opts: { sheetName?: string; width: number; height: number }
): Promise<{ extraction: RawExtraction; model: string }> {
  const orgId = await requireOrg();
  assertOrgRef(ref, orgId);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "AI plan extraction is not configured — add ANTHROPIC_API_KEY to the server environment"
    );
  }

  const { data: blob, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(ref);
  if (error || !blob) {
    throw new Error(error?.message ?? "Could not read the plan image");
  }
  const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const mediaType = /\.jpe?g$/i.test(ref) ? "image/jpeg" : "image/png";

  const client = new Anthropic();
  const res = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      format: {
        type: "json_schema",
        schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: b64 },
          },
          {
            type: "text",
            text: `Floor-plan sheet "${opts.sheetName ?? "plan"}" — a ${opts.width}×${opts.height} px raster. Extract the floor-plan geometry.`,
          },
        ],
      },
    ],
  });

  if (res.stop_reason === "refusal") {
    throw new Error("The model declined to analyse this drawing");
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error(
      "Extraction ran out of output space before finishing — try Regenerate"
    );
  }

  const text = res.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (!text) throw new Error("The model returned no extraction output");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new Error("The model returned unexpected output — try Regenerate");
  }
  const e = parsed as Partial<RawExtraction>;
  if (
    typeof e !== "object" ||
    e === null ||
    !Array.isArray(e.spaces) ||
    !Array.isArray(e.openings) ||
    !Array.isArray(e.fixtures) ||
    typeof e.imageWidth !== "number" ||
    typeof e.imageHeight !== "number" ||
    typeof e.notes !== "object"
  ) {
    throw new Error("The model returned an incomplete extraction — try Regenerate");
  }

  return { extraction: e as RawExtraction, model: EXTRACTION_MODEL };
}
