"use server";

import Anthropic from "@anthropic-ai/sdk";
import { auth0 } from "@/lib/auth0";
import { getCapabilities } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import {
  WORK_RIGHTS_READ_PROMPT,
  WORK_RIGHTS_READ_SCHEMA,
  parseWorkRightsRead,
  type WorkRightsRead,
} from "@/lib/staff/work-rights-readers";

/* A VEVO result or a visa grant notice ← Tiff.

   Same scan-then-confirm contract as everywhere else: Tiff fills the form, the
   person checks it against the document, only Save writes. Nothing is written
   here.

   THE GATE IS THE CARD'S. Your own evidence is intrinsic — a document about
   your own right to work is one you must be able to supply whatever
   capabilities you hold, which is the reasoning beginUpload already applies to
   the `work_rights` kind. Somebody else's needs `team`, the same gate the rest
   of their staff card carries. A Server Function is reachable by direct POST,
   so this is decided here and not by which screen rendered the button.

   The prompt is deliberately narrow — see lib/staff/work-rights-readers.ts for
   the list of things it refuses to read, and why nationality and passport
   number are named explicitly. */

const MODEL = "claude-opus-4-8";

const IMAGE_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageMedia = (typeof IMAGE_MEDIA)[number];

export type ReadWorkRightsResult = ({ ok: true } & WorkRightsRead) | { ok: false; reason: string };

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Tiff is offline — API key rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff — check the connection.";
  if (err instanceof Anthropic.APIError) return "Tiff hit an API error — try again.";
  return "Tiff couldn't complete that.";
}

export async function readWorkRightsDocument(
  fileBase64: string,
  mediaType: string,
  /** Whose evidence this is. Your own is intrinsic; anyone else's needs `team`. */
  staffId: string,
): Promise<ReadWorkRightsResult> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { ok: false, reason: "Not signed in." };

  const mine = await staffProfileIdFor(orgId, userId);
  if (staffId !== mine) {
    const caps = await getCapabilities();
    if (!caps.has("team")) return { ok: false, reason: "You don't have access to staff records." };
  }
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "no-key" };

  const isPdf = mediaType === "application/pdf";
  if (!isPdf && !IMAGE_MEDIA.includes(mediaType as ImageMedia)) {
    return { ok: false, reason: "Unsupported file type." };
  }
  if (!fileBase64 || fileBase64.length > 14_000_000) {
    return { ok: false, reason: "That file is too large to read." };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: WORK_RIGHTS_READ_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            isPdf
              ? {
                  type: "document" as const,
                  source: { type: "base64" as const, media_type: "application/pdf" as const, data: fileBase64 },
                }
              : {
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: mediaType as ImageMedia, data: fileBase64 },
                },
            { type: "text", text: WORK_RIGHTS_READ_PROMPT },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "Tiff declined to read this document." };
    }
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    return { ok: true, ...parseWorkRightsRead(JSON.parse(text)) };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
}
