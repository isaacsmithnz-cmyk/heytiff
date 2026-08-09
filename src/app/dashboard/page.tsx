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

  /* Home is the universal case — no job in scope, and the debrief's staff
     roster is whoever can be assigned tasks, which the page already loaded.
     First names only: that's what a spoken "tell Dane…" contains. */
  return (
    <>
      <NoteScopeScreen
        staffFirstNames={data.assignable
          .map((s) => s.name.trim().split(/\s+/)[0])
          .filter((n) => n.length >= 2)}
      />
      <DashboardHome data={data} />
    </>
  );
}
