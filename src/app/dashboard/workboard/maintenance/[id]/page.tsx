import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { ensureVisits, autoCompleteVisitsFromMirror } from "@/lib/workboard/visit-ensure";
import { getAgreementDetail } from "@/lib/workboard/maintenance-query";
import { getConnectionView } from "@/lib/integrations/store";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { AgreementDetailScreen } from "@/components/workboard/agreement-detail-screen";

/* One agreement: the onboarding story, the gear on site, and every visit —
   ticked, booked, linked, or overdue and breathing red. The auto-complete
   tail runs here too: opening the page is when "the job was finished in
   ServiceM8 yesterday" should become "done" without anyone typing it. */

export default async function WorkboardAgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await can("workboard"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const { id } = await params;
  const today = todayInZone(await getSm8Timezone(orgId));
  await ensureVisits(orgId, { agreementId: id, today });
  await autoCompleteVisitsFromMirror(orgId);

  const [agreement, manage, connection] = await Promise.all([
    getAgreementDetail(orgId, id, today),
    can("workboard_manage"),
    getConnectionView(orgId, "servicem8"),
  ]);
  if (!agreement) notFound();

  return (
    <AgreementDetailScreen
      agreement={agreement}
      manage={manage}
      today={today}
      sm8Connected={connection?.status === "connected"}
    />
  );
}
