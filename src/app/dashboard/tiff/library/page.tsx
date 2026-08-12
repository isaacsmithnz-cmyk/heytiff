import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { Library } from "@/components/tiff/library";
import { asKbCategory } from "@/lib/tiff/files";
import { countUnembedded } from "@/lib/tiff/backfill";
import { isSemanticConfigured } from "@/lib/tiff/embeddings";
import { kbDocsForOrg, kbUploaderNames } from "@/lib/tiff/query";
import { kbQuotaFor } from "@/lib/tiff/quota";
import { ensureKbSeedTags, kbTagsByDocument, kbTagsForOrg, kbTagUsage } from "@/lib/tiff/tags-query";

/* The library. Deep-linkable leaf — same `tiff` gate as the assistant page:
   the capability is revocable, so every route checks for itself and not just
   the nav entry.

   READING IS THE STAFF TIER, MANAGING IS NOT. `tiff` opens this page for
   everyone; `tiff_manage` is what adds uploading, editing and the page
   allowance, and the owner check is the same one deleteKbDoc makes. All three
   answers are decided here and re-decided by every action — this is what to
   RENDER, not what is allowed.

   `?cat=` is how the assistant's category cards arrive: the card you clicked
   is the filter you land on. `?tag=` is the same idea on the second axis, and
   repeatable — `?tag=daikin&tag=vrv` is a link to the Daikin VRV shelf.

   `?doc=` names ONE document and opens its search panel on arrival — how a
   journal chip that says "Daikin VRV commissioning notes" becomes that
   document. An id that matches nothing in this org's library is simply
   dropped, like an unknown tag: a plain library is the honest landing.

   THE SEED TAGS ARE MATERIALISED HERE, before the read that would otherwise
   come back empty. It is a write on a GET, which is why it is guarded by a
   count and made idempotent on the (org_id, slug) index rather than by this
   page being careful: two people opening the library at once must not race
   each other into a duplicate or a failed load. */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  if (!(await can("tiff"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const params = searchParams ? await searchParams : {};
  const raw = Array.isArray(params.cat) ? params.cat[0] : params.cat;
  const rawTags = Array.isArray(params.tag) ? params.tag : params.tag ? [params.tag] : [];
  const rawDoc = Array.isArray(params.doc) ? params.doc[0] : params.doc;

  await ensureKbSeedTags(orgId);

  /* The passages stored without a vector. Counted only where a key exists:
     without one, EVERY chunk is null by design and the whole library would
     read as broken rather than as keyword-only. */
  const [docs, quota, canManage, role, uploaders, unembedded, tags, docTags, tagUsage] =
    await Promise.all([
      kbDocsForOrg(orgId),
      kbQuotaFor(orgId),
      can("tiff_manage"),
      getDbRole(),
      kbUploaderNames(orgId),
      isSemanticConfigured() ? countUnembedded(orgId) : Promise.resolve(0),
      kbTagsForOrg(orgId),
      kbTagsByDocument(orgId),
      kbTagUsage(orgId),
    ]);

  /* The URL names tags by SLUG, not by id — a link that survives being pasted
     into Slack has to be readable, and an id would also leak nothing useful
     while breaking the moment a workspace is re-seeded. Anything that doesn't
     match a real tag is dropped rather than rendered as a dead filter. */
  const bySlug = new Map(tags.map((t) => [t.slug, t.id]));
  const initialTagIds = [
    ...new Set(rawTags.map((s) => bySlug.get(String(s).toLowerCase())).filter(Boolean) as string[]),
  ];

  return (
    <Library
      docs={docs.map((d) => ({
        ...d,
        uploaderName: d.uploadedById ? (uploaders[d.uploadedById] ?? null) : null,
        tags: docTags[d.id] ?? [],
      }))}
      tags={tags}
      tagUsage={tagUsage}
      initialTagIds={initialTagIds}
      quota={{
        plan: quota.plan,
        month: quota.month,
        pagesUsed: quota.pagesUsed,
        questionsAsked: quota.questionsAsked,
        resetsOn: quota.resetsOn,
        // Infinity is not a value to hand across the boundary; null is the
        // unlimited tier on the other side, and `pagesRemaining` (also
        // Infinity up there) is not something the screen renders at all
        pagesAllowed: Number.isFinite(quota.pagesAllowed) ? quota.pagesAllowed : null,
      }}
      canManage={canManage}
      isOwner={hasMinRole(role, "owner")}
      unembedded={unembedded}
      initialCategory={asKbCategory(raw)}
      /* resolved against the docs actually being rendered, so an id from
         another org — or one deleted since — opens nothing */
      initialDocId={docs.some((d) => d.id === rawDoc) ? String(rawDoc) : null}
    />
  );
}
