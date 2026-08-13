import { authorised } from "@/lib/integrations/cron-auth";
import {
  attachmentFileCandidates,
  looksLikeFile,
  sniffFileKind,
} from "@/lib/integrations/sm8-attachment-probe";
import { sm8Access } from "@/lib/integrations/sm8-store";
import { supabaseAdmin } from "@/lib/supabase-server";

/* Is there a byte-download endpoint, and what is it called?

   A DIAGNOSTIC, NOT A FEATURE. It answers one question that blocks the media
   cache — which of three path shapes serves an attachment's bytes — and it is
   meant to be deleted once the answer is a constant in the caching layer. It
   writes nothing, caches nothing, and returns no bytes.

   WHY IT IS LOCKED THE SAME WAY THE CRON IS: like the sweep, it runs as
   nobody and reaches an org's grant through the service-role client, so
   CRON_SECRET is the whole gate and it fails closed when unset. Unlike the
   cron it is aimed at ONE workspace, named in the query string, because a
   probe that walked every customer's account to answer a question about a
   URL would be spending other people's rate limit on our curiosity.

   WHAT IT DELIBERATELY DOESN'T RETURN: the file bytes, the attachment's name,
   and any signed URL a redirect lands on. The first is the point of the lazy
   cache and not of a probe; the second is customer data; the third is a
   credential with a timer on it. The host of a redirect target IS returned,
   because "it 302s to a CDN" changes the caching design and a bare hostname
   gives nothing away. */

/** One attachment's bytes shouldn't take longer than a page of metadata. */
const HTTP_TIMEOUT_MS = 20_000;

/** Bytes we'll pull before deciding it's a real file. The whole body is read
    so Content-Length can be checked against reality — a photo is a few MB and
    this runs once, by hand. Anything past this is a sign we probed a video. */
const SANE_MAX_BYTES = 64 * 1024 * 1024;

type Subject = {
  uuid: string;
  file_type: string | null;
  attachment_source: string | null;
  photo_width: number | null;
};

type CandidateResult = {
  shape: string;
  status: number;
  ok: boolean;
  /** Whether fetch followed a redirect, and to whose host — never the URL. */
  redirectedTo: string | null;
  contentType: string | null;
  contentLength: string | null;
  /** What the first bytes actually are, header notwithstanding. */
  bytes?: { length: number; kind: string | null; looksLikeAFile: boolean };
  error?: string;
};

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  const orgId = new URL(request.url).searchParams.get("org");
  if (!orgId) {
    return Response.json({ error: "Name the workspace: ?org=<uuid>" }, { status: 400 });
  }

  const access = await sm8Access(orgId);
  if (!access) {
    return Response.json(
      { error: "No usable ServiceM8 grant for that workspace." },
      { status: 409 }
    );
  }

  /* Two subjects, because one answer wouldn't generalise: a photo (the bulk of
     the mirror, and the case the media UI is for) and a PDF (invoices and
     quotes arrive by a different route inside ServiceM8 and may well be served
     by a different one). `active=1` because a soft-deleted row is still
     readable on the metadata API and its bytes may not be — which would read
     as "no download endpoint" and be wrong. */
  const [photo, pdf] = await Promise.all([pickSubject(".jpg"), pickSubject(".pdf")]);

  const subjects = [photo, pdf].filter((s): s is Subject => s !== null);
  if (subjects.length === 0) {
    return Response.json(
      { error: "No active attachment rows mirrored for that workspace yet." },
      { status: 409 }
    );
  }

  const results = [];
  for (const subject of subjects) {
    const candidates: CandidateResult[] = [];
    for (const candidate of attachmentFileCandidates(subject.uuid)) {
      const outcome = await tryCandidate(candidate.url, access.accessToken);
      candidates.push({ shape: candidate.shape, ...outcome });
      // First shape that serves a real file settles it for this subject —
      // no reason to spend two more calls proving the others don't.
      if (outcome.ok && outcome.bytes?.looksLikeAFile) break;
    }
    results.push({
      subject: {
        // A prefix is enough to correlate with the mirror row by hand, and
        // isn't a working identifier on its own.
        uuidPrefix: subject.uuid.slice(0, 8),
        fileType: subject.file_type,
        source: subject.attachment_source,
        /* The raw number, not a derived "isPhoto" — 0 is this column's null,
           and a value above it only means the file has pixels, which a video
           has too. Reported so the answer can be checked against the extension
           rather than trusted. */
        photoWidth: subject.photo_width,
      },
      candidates,
    });
  }

  const winner = results
    .flatMap((r) => r.candidates)
    .find((c) => c.ok && c.bytes?.looksLikeAFile);

  return Response.json({
    verdict: winner
      ? `Bytes are served by ${winner.shape}.`
      : "No candidate shape served a file — the download path is something else.",
    results,
  });

  /** One subject by extension.

      WHY `file_type` AND NOT THE TWO COLUMNS THAT LOOK BETTER:

      `attachment_source` can't name a photo — the live mirror spells it four
      ways (Photo, PHOTO, PHOTO_LIBRARY, PHOTO_LIBRARY_ON_CHECKOUT), and the
      one row this probe picks would depend on which spelling was asked for.

      `photo_width` is worse, and it was this route's first attempt. It reads
      like "images only" and it is NEVER NULL on the live account — every one
      of the 24,999 rows carries a value, including PDFs, .docx and .txt, with
      0 as the sentinel. So `photo_width IS NOT NULL` matched the whole table
      and would have handed the "photo" slot whatever came back first. Even the
      repaired form, `photo_width > 0`, means MEDIA rather than photo: 506 of
      523 .mp4 and 12 of 13 .mov rows carry real dimensions. A probe that
      downloads a video to answer a question about a JPEG is both the wrong
      test and a needlessly large one.

      An extension is the thing that is actually true. */
  async function pickSubject(fileType: string): Promise<Subject | null> {
    const { data } = await supabaseAdmin
      .from("sm8_attachments")
      .select("uuid, file_type, attachment_source, photo_width")
      .eq("org_id", orgId)
      .eq("active", 1)
      .ilike("file_type", fileType)
      .limit(1)
      .maybeSingle();
    return (data as Subject | null) ?? null;
  }
}

async function tryCandidate(
  url: string,
  accessToken: string
): Promise<Omit<CandidateResult, "shape">> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    const base = {
      status: res.status,
      ok: res.ok,
      // res.url is the FINAL url after redirects; only its host escapes here,
      // because a signed CDN link is a bearer credential in a query string.
      redirectedTo: res.redirected ? safeHost(res.url) : null,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
    };

    if (!res.ok) {
      // The vendor's own error text is the diagnosis when a shape is refused —
      // truncated, and it never travels with the token.
      const detail = await res.text().catch(() => "<unreadable body>");
      console.error(`[sm8] attachment probe ${res.status} at ${url}: ${detail.slice(0, 300)}`);
      return base;
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > SANE_MAX_BYTES) {
      return { ...base, error: "Body larger than the probe's sanity cap — not inspected." };
    }
    const head = new Uint8Array(buf.slice(0, 16));
    const kind = sniffFileKind(head);
    return {
      ...base,
      bytes: { length: buf.byteLength, kind, looksLikeAFile: looksLikeFile(kind) },
    };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      redirectedTo: null,
      contentType: null,
      contentLength: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
