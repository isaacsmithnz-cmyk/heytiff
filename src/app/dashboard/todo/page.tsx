import { HomeTodo } from "@/components/dashboard/home-todo";
import { homeView } from "@/lib/dashboard/home-view";
import { loadDashboard } from "@/lib/dashboard/page-data";

/* TO DO, ALL OF IT — Home's Show all. The same rows as Home's To do
   (lib/dashboard/home-view), none held back. It takes in what the bell's
   "N more on the board" opened, /dashboard/action-required, which stays at
   its address for the links that name it. */
export default async function TodoPage() {
  const view = homeView(await loadDashboard());
  return (
    <div className="page in full">
      <div className="wrap hm">
        <HomeTodo rows={view.todo} all headingLevel={1} />
      </div>
    </div>
  );
}
