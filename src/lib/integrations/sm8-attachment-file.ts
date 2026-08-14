/* Fetching one attachment's bytes from ServiceM8.

   THE PATH IS A CONSTANT BECAUSE THE QUESTION IS ANSWERED. The probe ran
   against the live account on 2026-08-14 and both subjects agreed on the
   first candidate:

     GET /api_1.0/Attachment/{uuid}.file
       .jpg  → 200, image/jpeg,      671,234 bytes, sniffs jpeg
       .pdf  → 200, application/pdf,  99,526 bytes, sniffs pdf
       both 302 → data-cdn-ap-southeast-2.servicem8.com

   Discovery deliberately does NOT live in this path. Walking three
   candidates on every cold cache miss would spend three calls against a
   rate-limited vendor to re-learn something one probe settled permanently,
   and it would bake an unknown into the request a person is waiting on.
   attachmentFileCandidates() remains exported by the probe module: if
   ServiceM8 ever moves the bytes, re-run the probe and change this line.

   THE SNIFF STAYS, as a guard rather than a search. The redirect lands on a
   CDN with a signed URL, and an expired one, an HTML error page and a JSON
   error body all arrive as a cheerful 200 with a plausible Content-Type. The
   magic number is the only witness that doesn't lie, so nothing is stored
   until the first bytes agree it is a file.

   CONTENT-LENGTH IS NOT TRUSTWORTHY — the live PDF came back with none at
   all. The cap is enforced against the bytes actually received. */

import { SM8_API_BASE } from "./sm8";
import { looksLikeFile, sniffFileKind } from "./sm8-attachment-probe";

/** The shape that serves bytes. Verified live; see the header. */
export const SM8_ATTACHMENT_FILE_SHAPE = "Attachment/{uuid}.file";

export function attachmentFileUrl(uuid: string): string {
  return new URL(`Attachment/${uuid}.file`, SM8_API_BASE).toString();
}

/** Bigger than any photo the live account holds (the largest sampled was
    671 KB) and matched to the documents bucket's own 10 MB ceiling, so a
    file that would be rejected at upload is never downloaded first. */
export const SM8_MAX_FILE_BYTES = 10 * 1024 * 1024;

const HTTP_TIMEOUT_MS = 45_000;

export type Sm8FileResult =
  | { ok: true; bytes: Uint8Array; contentType: string; kind: string | null }
  | { ok: false; reason: "unauthorized" | "gone" | "too_big" | "not_a_file" | "unavailable" };

/** One attachment's bytes, or a reason we're not storing them. Never throws:
    a job with one bad file must still show its other twenty. */
export async function fetchSm8AttachmentFile(
  accessToken: string,
  uuid: string
): Promise<Sm8FileResult> {
  let res: Response;
  try {
    res = await fetch(attachmentFileUrl(uuid), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (res.status === 403) return { ok: false, reason: "unauthorized" };
  if (res.status === 404 || res.status === 410) return { ok: false, reason: "gone" };
  if (!res.ok) return { ok: false, reason: "unavailable" };

  /* Read before measuring: Content-Length was absent on the live PDF, so the
     header can neither confirm nor deny the size. The timeout is the backstop
     against something pathological. */
  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const bytes = new Uint8Array(buf);
  if (bytes.byteLength === 0) return { ok: false, reason: "gone" };
  if (bytes.byteLength > SM8_MAX_FILE_BYTES) return { ok: false, reason: "too_big" };

  const kind = sniffFileKind(bytes.subarray(0, 16));
  if (!looksLikeFile(kind)) return { ok: false, reason: "not_a_file" };

  return {
    ok: true,
    bytes,
    contentType: res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
    kind,
  };
}
