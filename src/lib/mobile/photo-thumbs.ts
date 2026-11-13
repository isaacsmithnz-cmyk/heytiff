import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET, SIGNED_URL_SECONDS } from "@/lib/documents/query";
import { signedPath, THUMB } from "./photo-thumbs-plan";

/* Each photo's square, a small copy, signed beside its full link (photo-thumbs-plan
   says why). One signing per photo, as Supabase signs a resized copy one at a time,
   a few at once; a photo whose square can't be signed keeps its full link alone. */

const AT_ONCE = 30;

export async function withThumbs<T extends { kind: string; url: string | null }>(items: readonly T[]): Promise<(T & { thumbUrl?: string })[]> {
  const out: (T & { thumbUrl?: string })[] = items.map((it) => ({ ...it }));
  const todo = out.flatMap((it, i) => {
    const path = it.kind === "photo" ? signedPath(it.url, DOCUMENTS_BUCKET) : null;
    return path ? [{ i, path }] : [];
  });
  for (let k = 0; k < todo.length; k += AT_ONCE) {
    await Promise.all(
      todo.slice(k, k + AT_ONCE).map(async ({ i, path }) => {
        const { data } = await supabaseAdmin.storage
          .from(DOCUMENTS_BUCKET)
          .createSignedUrl(path, SIGNED_URL_SECONDS, { transform: THUMB })
          .catch(() => ({ data: null }));
        if (data?.signedUrl) out[i]!.thumbUrl = data.signedUrl;
      }),
    );
  }
  return out;
}
