/* HOME, v2: the page runs Home's gates (sign-in lands here), reads the
   page's data once, works Today and To do out of it on the server, and
   hands both to the screen, with the capture's scope. The screen and the
   working-out each have a suite of their own; here they are names. */

const order: string[] = [];
const loadDashboard = jest.fn(async () => {
  order.push("load");
  return { assignable: [{ id: "s1", name: "Dane Cooper" }, { id: "s2", name: "J" }] };
});
jest.mock("@/lib/dashboard/page-data", () => ({ loadDashboard: () => loadDashboard() }));
jest.mock("@/lib/org/setup-gate", () => ({ redirectIfSetupPending: jest.fn(async () => void order.push("setup")) }));
jest.mock("@/lib/staff/onboarding-gate", () => ({
  redirectIfOnboardingPending: jest.fn(async () => void order.push("onboarding")),
}));
const view = { today: { rows: [], summary: "Nothing booked" }, todo: [{ key: "notice:n1" }] };
jest.mock("@/lib/dashboard/home-view", () => ({ homeView: jest.fn(() => view) }));
jest.mock("@/components/notes/note-context", () => ({ NoteScopeScreen: () => null }));
jest.mock("@/components/dashboard/home", () => ({ HomeScreen: () => null }));

import DashboardHomePage from "../page";
import { HomeScreen } from "@/components/dashboard/home";
import { NoteScopeScreen } from "@/components/notes/note-context";
import { homeView } from "@/lib/dashboard/home-view";

type Tree = { props: { children: { type: unknown; props: Record<string, unknown> }[] } };

it("(F) runs Home's gates first, then hands the screen Today and To do", async () => {
  const tree = (await DashboardHomePage()) as Tree;
  expect(order).toEqual(["setup", "onboarding", "load"]);
  expect(homeView).toHaveBeenCalledTimes(1);
  const screen = tree.props.children.find((c) => c && c.type === HomeScreen)!;
  expect(screen.props).toEqual({ today: view.today, todo: view.todo, voice: false });
  const scope = tree.props.children.find((c) => c && c.type === NoteScopeScreen)!;
  expect(scope.props.staffFirstNames).toEqual(["Dane"]);
});
