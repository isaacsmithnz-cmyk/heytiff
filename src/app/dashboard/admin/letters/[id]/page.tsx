import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { todayInAu } from "@/lib/au-dates";
import { blankLetter, type LetterInput } from "@/lib/letters/letter";
import { letterheadFacts, letterSigner, letterSigners, loadLetter, mayOpenLetter } from "@/lib/letters/query";
import { orgTemplates } from "@/lib/templates/query";
import { LetterEditor } from "@/components/letters/letter-editor";

/* ONE LETTER — written on the business's letterhead, as it will print.
   `new` starts one dated today and signed by whoever is writing it. */
export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  const userId = session.user?.sub as string | undefined;
  if (!orgId || !userId) redirect("/dashboard");
  const role = await getDbRole();
  if (!hasMinRole(role, "admin")) redirect("/dashboard");

  const id = (await params).id;
  const staffId = await staffIdFor(orgId, userId);
  const [facts, templates, signers, me] = await Promise.all([
    letterheadFacts(orgId),
    orgTemplates(orgId),
    letterSigners(orgId),
    staffId ? letterSigner(orgId, staffId) : Promise.resolve(null),
  ]);

  let initial: LetterInput;
  if (id === "new") {
    initial = blankLetter(todayInAu(), staffId);
  } else {
    const letter = await loadLetter(orgId, id.slice(0, 80));
    if (!letter || !mayOpenLetter(letter, { staffId, isOwner: hasMinRole(role, "owner") })) notFound();
    initial = {
      id: letter.id,
      title: letter.title,
      date: letter.date,
      recipient: letter.recipient,
      subject: letter.subject,
      body: letter.body,
      signerStaffId: letter.signerStaffId,
      withSignature: letter.withSignature,
    };
  }

  return (
    <LetterEditor
      initial={initial}
      facts={facts}
      letterhead={templates.letterhead}
      signers={signers}
      me={staffId ? { staffId, signatureSvg: me?.signatureSvg ?? null } : null}
      today={todayInAu()}
    />
  );
}
