import { HomeScreen } from "@/components/dashboard/home";
import { NoteScopeScreen } from "@/components/notes/note-context";
import { homeView } from "@/lib/dashboard/home-view";
import { loadDashboard } from "@/lib/dashboard/page-data";
import { redirectIfSetupPending } from "@/lib/org/setup-gate";
import { redirectIfOnboardingPending } from "@/lib/staff/onboarding-gate";
import { isTranscriptionConfigured } from "@/lib/voice/transcribe";

/* HOME, v2 (docs/plans/layout-2026-10, the board v2-board-home): Tiff's
   mark over her box, Today, and To do. Signing in lands here (decision 2).

   The old Home, the desk, is at /dashboard/desk until its faces have their
   v2 homes; Today's Calendar and To do's Open and Reply go there. It still
   reads what the desk reads (loadDashboard), so Home costs what it cost
   before; Today and To do are worked out from it on the server
   (lib/dashboard/home-view), dated by the same day. */
export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // A brand-new org's owner goes to first-run setup before an empty Home can
  // read as a broken product. Home only — sign-in lands here, and the gate's
  // header says why it is neither in the proxy nor the (synchronous) layout.
  await redirectIfSetupPending();
  // And a newly joined staff member to their own first run, once — same
  // shape, same soft landing (lib/staff/onboarding-gate.ts).
  await redirectIfOnboardingPending();

  const [data, { reply }] = await Promise.all([loadDashboard(), searchParams]);
  const view = homeView(data);
  return (
    <>
      <NoteScopeScreen
        staffFirstNames={data.assignable
          .map((s) => s.name.trim().split(/\s+/)[0])
          .filter((n) => n.length >= 2)}
      />
      <HomeScreen
        today={view.today}
        todo={view.todo}
        feed={view.feed}
        /* To do's Reply on a mention names its note: the box opens in Your feed */
        replyTo={typeof reply === "string" && /^[0-9a-f-]{36}$/i.test(reply) ? reply : null}
        voice={isTranscriptionConfigured()}
      />
    </>
  );
}
