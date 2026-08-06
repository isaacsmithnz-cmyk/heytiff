import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { listUnreviewedFieldNotes } from "@/lib/tiff/field-notes";
import { KbQueue } from "@/components/admin/kb-queue";

/* Admin+, same gate as the section that lists it — see actions/kb-review.ts
   for why this is deliberately NOT owner-only like manual deletion. */
export default async function AdminKnowledgePage() {
  if (!hasMinRole(await getDbRole(), "admin")) redirect("/dashboard");
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  return <KbQueue entries={await listUnreviewedFieldNotes(orgId)} />;
}
