/* The one-off that settles ServiceM8's byte-download path.

   WHY A PROBE EXISTS AT ALL: `sm8_attachments` mirrors metadata for ~25,000
   photos, invoices and quotes, and not one of them has bytes behind it yet.
   The download endpoint is the whole gate on that — and it is the one part of
   the attachment surface their documentation does NOT state. Their upload doc
   names `POST …/Attachment/{uuid}.file`; the matching download page 404s, and
   update/delete live under a DIFFERENT noun (`dboattachment/{uuid}.json`) than
   list/create (`attachment.json`). So the path is a guess between at least
   three plausible shapes, and guessing wrong is a caching layer built on a
   404. Cheaper to ask the live account once — cf. the rule that a vendor's
   endpoints are fetched, never written from memory.

   PURE ON PURPOSE: the candidate list and the magic-number sniff are the parts
   worth pinning in a test. Everything that touches the network lives in the
   route, so the shapes we tried are recorded here even after the probe has
   served its purpose and the answer is a one-line constant. */

import { SM8_API_BASE } from "./sm8";

/** A path shape worth trying, newest guess LAST — the list is walked in order
    and the first 2xx wins, so the documented-by-analogy shape goes first. */
export type Sm8FileCandidate = { shape: string; url: string };

/** The three ways ServiceM8's own surface suggests the bytes might be named.

    1. `Attachment/{uuid}.file` — the exact noun and extension their UPLOAD doc
       uses. If download mirrors upload, this is it.
    2. `attachment/{uuid}.file` — same shape, lowercase. Their list endpoint is
       lowercase (`attachment.json`), so the capital in the upload doc may be
       prose rather than path.
    3. `dboattachment/{uuid}.file` — the noun update and delete actually use.
       The endpoint asymmetry between list/create and update/delete is real and
       already pinned in sm8-sync-plan's tests, so the bytes may follow the
       `dbo` side rather than the plain one. */
export function attachmentFileCandidates(uuid: string): Sm8FileCandidate[] {
  return [
    { shape: "Attachment/{uuid}.file", url: new URL(`Attachment/${uuid}.file`, SM8_API_BASE).toString() },
    { shape: "attachment/{uuid}.file", url: new URL(`attachment/${uuid}.file`, SM8_API_BASE).toString() },
    { shape: "dboattachment/{uuid}.file", url: new URL(`dboattachment/${uuid}.file`, SM8_API_BASE).toString() },
  ];
}

/** What the first bytes SAY they are, independent of the Content-Type header.

    This is the difference between "the endpoint answered 200" and "the
    endpoint answered with a file". A signed-URL redirect that has expired, an
    HTML error page, or a JSON `{"error":…}` all arrive as a cheerful 200 with
    a plausible header; the magic number is the only witness that won't lie.
    Returns null for bytes we don't recognise — which is a real answer for,
    say, a HEIC, not a failure. */
export function sniffFileKind(head: Uint8Array): string | null {
  const startsWith = (...bytes: number[]) =>
    bytes.length <= head.length && bytes.every((b, i) => head[i] === b);

  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (startsWith(0xff, 0xd8, 0xff)) return "jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "png"; // \x89PNG
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "gif"; // GIF8
  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46) && head.length >= 12 &&
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "webp";
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return "zip"; // also docx/xlsx
  // ....ftyp — MP4/QuickTime/HEIC family, byte 4 onward
  if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70)
    return "isobmff";

  // The two shapes a NON-file answer takes, worth naming because they are the
  // failures this probe exists to catch.
  if (startsWith(0x3c)) return "markup-or-html"; // '<'
  if (startsWith(0x7b) || startsWith(0x5b)) return "json"; // '{' or '['

  return null;
}

/** Does the body look like the thing the mirror row claims it is? Loose on
    purpose — the question is "bytes or an error page", not "exactly this
    codec". A null sniff is NOT a failure; markup and JSON are. */
export function looksLikeFile(kind: string | null): boolean {
  return kind !== "markup-or-html" && kind !== "json";
}
