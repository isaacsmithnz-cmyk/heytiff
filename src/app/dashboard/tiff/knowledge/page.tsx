import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { KnowledgeBase } from "@/components/tiff/knowledge";
import { asKbCategory } from "@/lib/tiff/files";
import { kbDocsForOrg, kbUploaderNames } from "@/lib/tiff/query";
import { kbQuotaFor } from "@/lib/tiff/quota";

/* The library. Deep-linkable leaf — same `tiff` gate as the assistant page:
   the capability is revocable, so every route checks for itself and not just
   the nav entry.

   READING IS THE STAFF TIER, MANAGING IS NOT. `tiff` opens this page for
   everyone; `tiff_manage` is what adds uploading, editing and the page
   allowance, and the owner check is the same one deleteKbDoc makes. All three
   answers are decided here and re-decided by every action — this is what to
   RENDER, not what is allowed.

   `?cat=` is how the assistant's category cards arrive: the card you clicked
   is the filter you land on. */
export default async function KnowledgeBasePage({
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

  const [docs, quota, canManage, role, uploaders] = await Promise.all([
    kbDocsForOrg(orgId),
    kbQuotaFor(orgId),
    can("tiff_manage"),
    getDbRole(),
    kbUploaderNames(orgId),
  ]);

  return (
    <KnowledgeBase
      docs={docs.map((d) => ({
        ...d,
        uploaderName: d.uploadedById ? (uploaders[d.uploadedById] ?? null) : null,
      }))}
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
      initialCategory={asKbCategory(raw)}
    />
  );
}
