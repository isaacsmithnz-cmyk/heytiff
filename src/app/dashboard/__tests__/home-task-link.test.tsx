/* Home reads its own address: `?task=<id>` is the bell's door onto a task
   whose Done didn't go to ServiceM8 (two-way phase 2, PR C). What Home does
   with the id is pinned beside it (home-tasks-sm8.test.tsx); this pins what
   the PAGE hands over — only a task id's shape, and nothing otherwise. */

jest.mock("@/lib/org/setup-gate", () => ({ redirectIfSetupPending: jest.fn(async () => {}) }));
jest.mock("@/lib/staff/onboarding-gate", () => ({ redirectIfOnboardingPending: jest.fn(async () => {}) }));
const data = { jobs: [], assignable: [], desk: null };
jest.mock("@/lib/dashboard/page-data", () => ({ loadDashboard: jest.fn(async () => data) }));
jest.mock("@/components/notes/note-context", () => ({ NoteScopeScreen: () => null }));
jest.mock("@/components/dashboard/home", () => ({ DashboardHome: () => null }));

import DashboardHomePage from "../page";
import { DashboardHome } from "@/components/dashboard/home";

type Search = Record<string, string | string[] | undefined>;
const T = "3a3a3a3a-0000-4000-8000-00000000000a";

/** The props the page hands Home, for this address. */
async function homeFor(search: Search): Promise<Record<string, unknown>> {
  const tree = (await DashboardHomePage({ searchParams: Promise.resolve(search) })) as {
    props: { children: { type: unknown; props: Record<string, unknown> }[] };
  };
  const home = tree.props.children.find((c) => c && c.type === DashboardHome);
  return home!.props;
}

it("(F) hands Home the task the address names", async () => {
  expect(await homeFor({ task: T })).toMatchObject({ data, taskId: T });
});

it("names nothing for anything that isn't a task's id, or for none", async () => {
  expect((await homeFor({ task: "../admin" })).taskId).toBeNull();
  expect((await homeFor({ task: [T, T] })).taskId).toBeNull();
  expect((await homeFor({})).taskId).toBeNull();
});
