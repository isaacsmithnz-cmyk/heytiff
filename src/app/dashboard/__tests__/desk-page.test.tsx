/* The desk, the old Home, at /dashboard/desk since v2's Home took
   /dashboard. It reads its own address: `?task=<id>` is To do's and an
   alert's door onto a task (two-way phase 2, PR C: a Done that didn't go to
   ServiceM8), `?ask=<note>` To do's Reply, `?face=` Home's Calendar. What
   the desk does with each is pinned beside it (home-desk.test.tsx); this
   pins what the PAGE hands over: only an id's shape, a face the desk has,
   and nothing otherwise. */

type Loaded = { assignable: { id: string; name: string }[]; desk: { warnDays: number } | null };
let data: Loaded = { assignable: [], desk: null };
jest.mock("@/lib/dashboard/page-data", () => ({ loadDashboard: jest.fn(async () => data) }));
jest.mock("@/components/notes/note-context", () => ({ NoteScopeScreen: () => null }));
jest.mock("@/components/dashboard/home-desk", () => ({ DashboardDesk: () => null }));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import DeskPage from "../desk/page";
import { DashboardDesk } from "@/components/dashboard/home-desk";
import { NoteScopeScreen } from "@/components/notes/note-context";

type Search = Record<string, string | string[] | undefined>;
const T = "3a3a3a3a-0000-4000-8000-00000000000a";

beforeEach(() => {
  data = { assignable: [{ id: "s1", name: "Dane Cooper" }], desk: { warnDays: 45 } };
});

type Tree = { props: { children: { type: unknown; props: Record<string, unknown> }[] } };

/** The props the page hands the desk, for this address. */
async function deskFor(search: Search): Promise<Record<string, unknown>> {
  const tree = (await DeskPage({ searchParams: Promise.resolve(search) })) as Tree;
  return tree.props.children.find((c) => c && c.type === DashboardDesk)!.props;
}

it("(F) hands the desk the task the address names", async () => {
  expect(await deskFor({ task: T })).toMatchObject({ data, taskId: T, askId: null, face: null });
});

it("(F) hands the desk the ask, and the Diary, the address names", async () => {
  expect(await deskFor({ ask: T })).toMatchObject({ askId: T, taskId: null });
  expect(await deskFor({ face: "diary" })).toMatchObject({ face: "diary", taskId: null, askId: null });
});

it("names nothing for anything that isn't an id", async () => {
  expect((await deskFor({ task: T, ask: "x" })).askId).toBeNull();
  expect((await deskFor({ ask: T, task: "../admin" })).taskId).toBeNull();
  expect((await deskFor({ ask: T, task: [T, T] })).taskId).toBeNull();
});

/* the rest of the desk is retired (the v2 audit, 20 October 2026): Home
   took it, and its Calendar is Schedule */
it("sends an address with no task, ask or Diary on to Home, the Calendar to Schedule", async () => {
  await expect(DeskPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
  await expect(DeskPage({ searchParams: Promise.resolve({ face: "tasks" }) })).rejects.toThrow("REDIRECT:/dashboard");
  await expect(DeskPage({ searchParams: Promise.resolve({ face: "bell" }) })).rejects.toThrow("REDIRECT:/dashboard");
  await expect(DeskPage({ searchParams: Promise.resolve({ task: "../admin" }) })).rejects.toThrow("REDIRECT:/dashboard");
  await expect(DeskPage({ searchParams: Promise.resolve({ face: "calendar" }) })).rejects.toThrow("REDIRECT:/dashboard/schedule");
});

it("keeps the capture's scope: the first names of who can be given a task", async () => {
  const tree = (await DeskPage({ searchParams: Promise.resolve({ task: T }) })) as Tree;
  const scope = tree.props.children.find((c) => c && c.type === NoteScopeScreen)!;
  expect(scope.props.staffFirstNames).toEqual(["Dane"]);
});
