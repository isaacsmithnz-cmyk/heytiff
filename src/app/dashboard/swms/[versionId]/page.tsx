import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { loadSwmsDocument } from "@/lib/swms/query";
import { SwmsSignOn } from "@/components/swms/sign-on";

/* SIGNING ON TO A SWMS — where the bell's "Sign on to the SWMS" lands.

   THE DOOR IS BEING ON IT. Someone the SWMS covers can always open it, with
   or without the Workboard: the bell sends them here, and a sign-on nobody
   can reach is a text message with extra steps. Anyone else needs the
   Workboard, where the SWMS was issued from. A version from another
   workspace is a 404. */
export default async function SwmsSignOnPage({ params }: { params: Promise<{ versionId: string }> }) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) redirect("/dashboard");

  const { versionId } = await params;
  const [doc, me] = await Promise.all([loadSwmsDocument(orgId, versionId.slice(0, 80)), staffIdFor(orgId, userId)]);
  if (!doc) notFound();
  const onIt = !!me && doc.people.some((p) => p.staffProfileId === me);
  if (!onIt && !(await can("workboard"))) redirect("/dashboard");

  return <SwmsSignOn doc={doc} me={me} />;
}
