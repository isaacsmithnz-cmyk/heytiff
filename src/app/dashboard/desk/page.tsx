import { redirect } from "next/navigation";
import { DashboardDesk } from "@/components/dashboard/home-desk";
import { loadDashboard } from "@/lib/dashboard/page-data";
import { NoteScopeScreen } from "@/components/notes/note-context";
import { DESK_FACES, type DeskFace } from "@/lib/dashboard/desk-focus";

/* THE DESK — the old Home, whole, at its own address since v2's Home took
   /dashboard (18 October 2026): Your day, the Diary, Tasks, the Calendar
   and the list. It stays until its faces have their v2 homes (the Diary in
   Conversations, the Calendar in Schedule, a task's own form from To do),
   so nothing a person does today is lost on the way
   (docs/plans/layout-2026-10/7-feature-checklist.md).

   No setup gates here: they are Home's, and sign-in lands on Home. */

/* A TASK THE ADDRESS NAMES — `/dashboard/desk?task=<id>`, To do's door
   onto a task and an alert's onto a Done that didn't go to ServiceM8
   (two-way phase 2, PR C) — opens the desk on the Tasks face with that task
   chosen. Only a task's id shape is passed on; anything else opens the desk
   as ever. A task no longer on the face (past the last five done) opens the
   face with the first row chosen. An ASK it names (`?ask=<note uuid>`,
   To do's Reply) opens the Diary on its conversation, and a FACE
   (`?face=calendar`, Home's Calendar link) opens that face. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (v: string | string[] | undefined): string | null => (typeof v === "string" ? v : null);

export default async function DeskPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [data, search] = await Promise.all([loadDashboard(), searchParams]);
  const task = one(search?.task);
  const taskId = task && UUID.test(task) ? task : null;
  const ask = one(search?.ask);
  const askId = ask && UUID.test(ask) ? ask : null;
  const face = one(search?.face);
  const named = face && (DESK_FACES as readonly string[]).includes(face) ? (face as DeskFace) : null;
  /* RETIRED BUT FOR A TASK OR AN ASK (v2 audit, 20 October 2026): the desk
     itself is Home, the Calendar is Schedule. A task's row and an ask's
     reply have no v2 screen yet, nor has the Diary (an entry, a mention or a
     field issue with no job), so only those doors still open it. */
  if (!taskId && !askId && named !== "diary") redirect(named === "calendar" ? "/dashboard/schedule" : "/dashboard");

  /* The desk is the universal case — nothing here is ABOUT a job, so the
     default target stays none. The staff roster is whoever can be assigned
     tasks, which the page already loaded; first names only, because that is
     what a spoken "tell Dane…" contains. */
  return (
    <>
      <NoteScopeScreen
        staffFirstNames={data.assignable
          .map((s) => s.name.trim().split(/\s+/)[0])
          .filter((n) => n.length >= 2)}
      />
      <DashboardDesk data={data} taskId={taskId} askId={askId} face={named} />
    </>
  );
}
