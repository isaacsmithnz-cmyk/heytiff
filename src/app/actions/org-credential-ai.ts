"use server";

import Anthropic from "@anthropic-ai/sdk";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { isCredKind } from "@/lib/org/credentials";
import {
  ORG_CRED_READ_SCHEMA,
  orgCredPrompt,
  parseOrgCredRead,
  type OrgCredRead,
} from "@/lib/org/cred-readers";

/* The business's certificate ← Tiff.

   The fleet's renewal reader (actions/fleet-ai.ts) one level up: the same
   scan-then-confirm contract, the same one short vision call, the same refusal
   wording. Tiff fills the form; the person checks it against the paper and
   saves. Nothing is written here.

   OWNER-ONLY, matching actions/org-credentials.ts and the upload gate on the
   two org document kinds. A Server Function is reachable by direct POST, so
   the role is checked here rather than only in the UI — otherwise a delegated
   admin could feed the company's papers through the model without being able
   to see the screen that shows them. */

const MODEL = "claude-opus-4-8";

const IMAGE_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageMedia = (typeof IMAGE_MEDIA)[number];

export type ReadOrgCredResult = ({ ok: true } & OrgCredRead) | { ok: false; reason: string };

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Tiff is offline — API key rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff — check the connection.";
  if (err instanceof Anthropic.APIError) return "Tiff hit an API error — try again.";
  return "Tiff couldn't complete that.";
}

export async function readOrgCredentialDocument(
  fileBase64: string,
  mediaType: string,
  kind: string,
): Promise<ReadOrgCredResult> {
  const session = await auth0.getSession();
  if (!session) return { ok: false, reason: "Not signed in." };
  if (!hasMinRole(await getDbRole(), "owner")) {
    return { ok: false, reason: "Only an owner can read the company's papers." };
  }
  if (!isCredKind(kind)) return { ok: false, reason: "Couldn't read that." };
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
        format: { type: "json_schema", schema: ORG_CRED_READ_SCHEMA },
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
            { type: "text", text: orgCredPrompt(kind) },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "Tiff declined to read this document." };
    }
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    return { ok: true, ...parseOrgCredRead(JSON.parse(text), kind) };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
}
