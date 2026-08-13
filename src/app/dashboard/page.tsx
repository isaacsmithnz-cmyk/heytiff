import { DashboardHome } from "@/components/dashboard/home";
import { loadDashboard } from "@/lib/dashboard/page-data";
import { NoteScopeScreen } from "@/components/notes/note-context";

/* THE GREETING IS GONE, and with it the viewer's name, the daypart and the
   date line. It said "Good morning, Isaac" at 56px — the largest type in the
   app spent on the two facts the reader was surest of. The date and time moved
   to the frame's clock, where every screen gets them; the page opens on the
   day's work instead. `getViewerName` and `greetingFor` went with it. */

export default async function DashboardHomePage() {
  const data = await loadDashboard();

  /* Home is the universal case — nothing here is ABOUT a job, so the default
     target stays none. The debrief's staff roster is whoever can be assigned
     tasks, which the page already loaded; first names only, because that is
     what a spoken "tell Dane…" contains.

     THE JOBS ARE NEW, and they are what make the picker reachable. `scope.jobs`
     is the list a capture can be pinned to, and only the two Workboard screens
     ever pushed one — so on Home a debrief that named a job the matcher could
     not resolve said "No job named" and offered nothing (Isaac, 2026-08-13:
     "I mentioned a job, but I couldn't find one"). They are candidates, not a
     target: pinning is still an explicit choice on the review. */
  return (
    <>
      <NoteScopeScreen
        jobs={data.jobs}
        staffFirstNames={data.assignable
          .map((s) => s.name.trim().split(/\s+/)[0])
          .filter((n) => n.length >= 2)}
      />
      <DashboardHome data={data} />
    </>
  );
}
