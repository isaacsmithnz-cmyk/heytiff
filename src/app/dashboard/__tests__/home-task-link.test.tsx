/* Home reads its own address: `?task=<id>` is the bell's door onto a task
   whose Done didn't go to ServiceM8 (two-way phase 2, PR C). What Home does
   with the id is pinned beside it (home-tasks-sm8.test.tsx, and the new
   Home's in home-desk.test.tsx); this pins what the PAGE hands over — only
   a task id's shape, and nothing otherwise — to whichever Home it draws. */

jest.mock("@/lib/org/setup-gate", () => ({ redirectIfSetupPending: jest.fn(async () => {}) }));
jest.mock("@/lib/staff/onboarding-gate", () => ({ redirectIfOnboardingPending: jest.fn(async () => {}) }));
type Loaded = { jobs: never[]; assignable: never[]; desk: { warnDays: number } | null };
let data: Loaded = { jobs: [], assignable: [], desk: null };
jest.mock("@/lib/dashboard/page-data", () => ({ loadDashboard: jest.fn(async () => data) }));
jest.mock("@/components/notes/note-context", () => ({ NoteScopeScreen: () => null }));
jest.mock("@/components/dashboard/home", () => ({ DashboardHome: () => null }));
jest.mock("@/components/dashboard/home-desk", () => ({ DashboardDesk: () => null }));

import DashboardHomePage from "../page";
import { DashboardHome } from "@/components/dashboard/home";
import { DashboardDesk } from "@/components/dashboard/home-desk";

type Search = Record<string, string | string[] | undefined>;
const T = "3a3a3a3a-0000-4000-8000-00000000000a";

beforeEach(() => {
  data = { jobs: [], assignable: [], desk: null };
});

/** The props the page hands the Home it draws, for this address. */
async function homeFor(search: Search, which: unknown = DashboardHome): Promise<Record<string, unknown>> {
  const tree = (await DashboardHomePage({ searchParams: Promise.resolve(search) })) as {
    props: { children: { type: unknown; props: Record<string, unknown> }[] };
  };
  const home = tree.props.children.find((c) => c && c.type === which);
  return home!.props;
}

it("(F) hands Home the task the address names", async () => {
  expect(await homeFor({ task: T })).toMatchObject({ data, taskId: T });
});

it("(F) hands the new Home (HOME_DESK's) the task the address names too", async () => {
  data = { jobs: [], assignable: [], desk: { warnDays: 45 } };
  expect(await homeFor({ task: T }, DashboardDesk)).toMatchObject({ data, taskId: T });
  expect((await homeFor({ task: "../admin" }, DashboardDesk)).taskId).toBeNull();
});

it("names nothing for anything that isn't a task's id, or for none", async () => {
  expect((await homeFor({ task: "../admin" })).taskId).toBeNull();
  expect((await homeFor({ task: [T, T] })).taskId).toBeNull();
  expect((await homeFor({})).taskId).toBeNull();
});
