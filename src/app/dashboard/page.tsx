import { DashboardHome } from "@/components/dashboard/home";
import { DashboardDesk } from "@/components/dashboard/home-desk";
import { loadDashboard } from "@/lib/dashboard/page-data";
import { NoteScopeScreen } from "@/components/notes/note-context";
import { redirectIfSetupPending } from "@/lib/org/setup-gate";
import { redirectIfOnboardingPending } from "@/lib/staff/onboarding-gate";

/* THE GREETING IS GONE, and with it the viewer's name, the daypart and the
   date line. It said "Good morning, Isaac" at 56px — the largest type in the
   app spent on the two facts the reader was surest of. The date and time moved
   to the frame's clock, where every screen gets them; the page opens on the
   day's work instead. `getViewerName` and `greetingFor` went with it. */

/* A TASK THE ADDRESS NAMES — `/dashboard?task=<id>`, the bell's door onto a
   Done that didn't go to ServiceM8 (two-way phase 2, PR C) — opens Home on
   the Tasks face with that task chosen. Only a task's id shape is passed
   on; anything else opens Home as ever. A task no longer on the face (past
   the last five done) opens the face with the first row chosen. */
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const [data, search] = await Promise.all([loadDashboard(), searchParams]);
  const task = search?.task;
  const taskId = typeof task === "string" && TASK_ID.test(task) ? task : null;

  /* Home is the universal case — nothing here is ABOUT a job, so the default
     target stays none. The staff roster is whoever can be assigned tasks,
     which the page already loaded; first names only, because that is what a
     spoken "tell Dane…" contains.

     THE JOBS ARE NEW, and they are what make the picker reachable. `scope.jobs`
     is the list a capture can be pinned to, and only the two Workboard screens
     ever pushed one — so on Home a capture that named a job the matcher could
     not resolve said "No job named" and offered nothing (Isaac, 2026-08-13:
     "I mentioned a job, but I couldn't find one"). They are candidates, not a
     target: pinning is still an explicit choice on the review.

     TWO HOMES, ONE SWITCH. `desk` is the new Home's own data, and the loader
     sets it only for a viewer `HOME_DESK` gives the new Home to (the owner,
     until the flip; lib/dashboard/desk-flag) — so the switch is the data's
     presence, decided on the server, and everyone else gets today's Home
     exactly as it was. The capture's scope is the same for both. */
  return (
    <>
      <NoteScopeScreen
        jobs={data.jobs}
        staffFirstNames={data.assignable
          .map((s) => s.name.trim().split(/\s+/)[0])
          .filter((n) => n.length >= 2)}
      />
      {data.desk ? <DashboardDesk data={data} taskId={taskId} /> : <DashboardHome data={data} taskId={taskId} />}
    </>
  );
}
