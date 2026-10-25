/* Deep-linkable leaf routes carry the same capability gate as their index
   pages — a revoked member typing the URL lands back on /dashboard, exactly
   as if they'd tried the nav entry that is no longer there. */

let allowed = false;
let role: string | null = "staff";
const can = jest.fn<Promise<boolean>, [capability: string]>(async () => allowed);
const getDbRole = jest.fn(async () => role);
const redirect = jest.fn((to: string): never => {
  throw new Error(`REDIRECT:${to}`);
});

jest.mock("@/lib/permissions-server", () => ({
  can: (c: string) => can(c),
  getDbRole: () => getDbRole(),
}));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  notFound: (): never => {
    throw new Error("NOT_FOUND");
  },
}));

/* the leaves' bodies are client components with suites of their own — the
   gate is what's under test, so they render to nothing here */
jest.mock("@/components/toolbox/tool-page", () => ({ ToolPage: () => null }));
jest.mock("@/components/toolbox/heat-load", () => ({ HeatLoadCalculator: () => null }));
jest.mock("@/components/toolbox/outdoor-unit", () => ({ OutdoorUnit: () => null }));
jest.mock("@/components/toolbox/running-pressures", () => ({ RunningPressures: () => null }));
jest.mock("@/components/toolbox/fault-finder", () => ({ FaultFinder: () => null }));
jest.mock("@/components/tiff/library", () => ({ Library: () => null }));
jest.mock("@/components/tiff/assistant", () => ({ TiffAssistant: () => null }));
jest.mock("@/lib/tiff/query", () => ({
  kbDocsForOrg: jest.fn(async () => []),
  kbUploaderNames: jest.fn(async () => ({})),
  kbCategoryCounts: jest.fn(async () => ({ install: 3, faults: 2, specs: 0, sops: 0 })),
  kbDocTitles: jest.fn(async () => ({})),
}));
/* Mocked at the module rather than at the Supabase client: lib/tiff/tags-query
   builds a real client on import, and without a URL in the environment the
   whole suite dies before the first gate is checked. */
jest.mock("@/lib/tiff/tags-query", () => ({
  kbTagsForOrg: jest.fn(async () => []),
  kbTagsByDocument: jest.fn(async () => ({})),
  kbTagUsage: jest.fn(async () => ({})),
  ensureKbSeedTags: jest.fn(async () => {}),
}));
jest.mock("@/lib/tiff/large", () => ({ kbLargeAllowance: async () => null }));
/* Knowledge from the field, the Library's (25 October 2026) */
const NOTE = { id: "n-1", title: "Daikin VRV needs the long purge", body: "Purge for ten minutes.", heading: null, authorName: "Alex L", createdAt: "2026-10-20T02:00:00Z" };
const listUnreviewedFieldNotes = jest.fn(async () => [NOTE]);
jest.mock("@/lib/tiff/field-notes", () => ({ listUnreviewedFieldNotes: () => listUnreviewedFieldNotes() }));
jest.mock("@/lib/tiff/quota", () => ({
  kbQuotaFor: jest.fn(async () => ({
    plan: "standard",
    month: "2026-08-01",
    pagesUsed: 0,
    questionsAsked: 0,
    pagesAllowed: 2000,
    pagesRemaining: 2000,
    resetsOn: "2026-09-01",
  })),
}));
let semanticOn = true;
const countUnembedded = jest.fn(async () => 106);
jest.mock("@/lib/tiff/embeddings", () => ({ isSemanticConfigured: () => semanticOn }));
jest.mock("@/lib/tiff/backfill", () => ({ countUnembedded: () => countUnembedded() }));
jest.mock("@/components/workboard/project-detail-screen", () => ({
  ProjectDetailScreen: () => null,
}));
jest.mock("@/lib/workboard/projects-query", () => ({
  listProjects: jest.fn(async () => []),
  getProjectDetail: jest.fn(async () => ({ id: "p-1", jobs: [], checklist: [], equipment: [] })),
}));
jest.mock("@/lib/workboard/projects-board-query", () => ({
  loadProjectsBoard: jest.fn(async () => ({ projects: [], visits: [], staff: [] })),
}));
jest.mock("@/lib/workboard/visit-ensure", () => ({
  ensureVisits: jest.fn(async () => {}),
}));
jest.mock("@/lib/workboard/query", () => ({
  getSm8Timezone: jest.fn(async () => null),
}));
jest.mock("@/lib/workboard/notes-query", () => ({
  listProjectEntries: jest.fn(async () => []),
  listIssues: jest.fn(async () => []),
}));
jest.mock("@/lib/voice/transcribe", () => ({ isTranscriptionConfigured: () => false }));
jest.mock("@/lib/integrations/store", () => ({
  getConnectionView: jest.fn(async () => null),
}));
jest.mock("@/components/workboard/quote/quote-screen", () => ({ QuoteScreen: () => null }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  resolveJobCard: jest.fn(async (_org: string, id: string) => ({ parentRemoteId: id, focusRemoteId: null })),
}));
jest.mock("@/app/actions/workboard", () => ({
  readMirrorJob: jest.fn(async () => ({ detail: { jobNumber: "2905" }, focusRemoteId: null })),
}));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

import HeatLoadPage from "../toolbox/heat-load/page";
import OutdoorUnitPage from "../toolbox/outdoor-unit/page";
import RunningPressuresPage from "../toolbox/running-pressures/page";
import TroubleshootingPage from "../toolbox/troubleshooting/page";
import TiffPage from "../tiff/page";
import LibraryPage from "../tiff/library/page";
import WorkboardPage from "../workboard/page";
import WorkboardProjectsPage from "../workboard/projects/page";
import ProjectPage from "../jobs/projects/[id]/page";
import JobQuotePage from "../jobs/[id]/quote/page";
import OldProjectPage from "../workboard/projects/[id]/page";
import OldQuotePage from "../workboard/quotes/[id]/page";
import ToolboxPage from "../toolbox/page";
import TaxPage from "../admin/tax/page";
import KnowledgePage from "../admin/knowledge/page";

const LEAVES: [string, () => Promise<unknown>, string][] = [
  ["toolbox/heat-load", HeatLoadPage, "toolbox"],
  ["toolbox/outdoor-unit", OutdoorUnitPage, "toolbox"],
  ["toolbox/running-pressures", RunningPressuresPage, "toolbox"],
  ["toolbox/troubleshooting", TroubleshootingPage, "toolbox"],
  ["tiff/library", LibraryPage, "tiff"],
];

beforeEach(() => {
  can.mockClear();
  redirect.mockClear();
  role = "staff";
});

describe("revoked → straight back to /dashboard", () => {
  it.each(LEAVES)("%s", async (_route, Page, capability) => {
    allowed = false;
    await expect(Page()).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith(capability);
  });
});

describe("held → the page renders", () => {
  it.each(LEAVES)("%s", async (_route, Page) => {
    allowed = true;
    expect(await Page()).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("the dynamic leaves check the same door", () => {
  type Leaf = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
  const DYNAMIC: [string, (p: Leaf) => Promise<unknown>][] = [
    ["jobs/projects/[id]", ProjectPage],
    ["jobs/[id]/quote", JobQuotePage],
  ];
  const props = { params: Promise.resolve({ id: "x-1" }), searchParams: Promise.resolve({}) };

  it.each(DYNAMIC)("%s — revoked → straight back to /dashboard", async (_route, Page) => {
    allowed = false;
    await expect(Page(props)).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith("workboard");
  });

  it.each(DYNAMIC)("%s — held → the page renders", async (_route, Page) => {
    allowed = true;
    expect(await Page(props)).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});

/* The knowledge base has a second question after "may you be here": what may
   you DO here. Managing is `tiff_manage` and removing is the owner, decided on
   the server and re-decided by every action — these pin that the page answers
   both, rather than handing the client a blanket yes. */
describe("the knowledge base hands the client what this viewer may do", () => {
  // the page returns the element; its props ARE the answer being handed over
  const propsOf = async (search?: Record<string, string>) => {
    const el = (await LibraryPage(
      search ? { searchParams: Promise.resolve(search) } : undefined
    )) as { props: Record<string, unknown> };
    return el.props;
  };

  beforeEach(() => {
    allowed = true;
    semanticOn = true;
    countUnembedded.mockClear();
  });

  it("asks for tiff_manage separately from tiff", async () => {
    const props = await propsOf();
    expect(can).toHaveBeenCalledWith("tiff");
    expect(can).toHaveBeenCalledWith("tiff_manage");
    expect(props.canManage).toBe(true);
  });

  it("holds removal back to the owner, whatever the capability says", async () => {
    role = "admin";
    expect((await propsOf()).isOwner).toBe(false);
    role = "owner";
    expect((await propsOf()).isOwner).toBe(true);
  });

  it("opens on the category the URL named, and ignores an invented one", async () => {
    expect((await propsOf({ cat: "faults" })).initialCategory).toBe("faults");
    expect((await propsOf({ cat: "nonsense" })).initialCategory).toBeNull();
    expect((await propsOf()).initialCategory).toBeNull();
  });

  /* the Toolbox shelf (v2) is the tools' own gate, asked here as their pages ask it */
  it("hands the Toolbox shelf only to someone who holds toolbox", async () => {
    const shelf = (await propsOf()).toolbox as { today: string } | null;
    expect(can).toHaveBeenCalledWith("toolbox");
    expect(shelf?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    can.mockImplementation(async (c: string) => c !== "toolbox");
    expect((await propsOf()).toolbox).toBeNull();
    can.mockImplementation(async () => allowed);
  });

  it("opens on the shelf the URL named, and on nothing it invented", async () => {
    expect((await propsOf({ view: "toolbox" })).initialView).toBe("toolbox");
    expect((await propsOf({ cat: "field", view: "review" })).initialView).toBe("review");
    expect((await propsOf({ view: "nonsense" })).initialView).toBeNull();
  });

  /* Knowledge from the field is an admin's, as the actions that act on it
     are (actions/kb-review.ts): read for them, and for nobody else */
  it("hands what's to look over from the field to an admin, and to nobody else", async () => {
    role = "admin";
    expect((await propsOf()).review).toEqual([NOTE]);
    listUnreviewedFieldNotes.mockClear();
    role = "staff";
    expect((await propsOf()).review).toBeNull();
    expect(listUnreviewedFieldNotes).not.toHaveBeenCalled();
  });

  it("nulls the unlimited tier's page ceiling rather than sending Infinity", async () => {
    const props = (await propsOf()).quota as Record<string, unknown>;
    expect(props.pagesAllowed).toBe(2000);
    expect(props).not.toHaveProperty("pagesRemaining");
  });

  it("counts the passages with no vector yet", async () => {
    expect((await propsOf()).unembedded).toBe(106);
  });

  /* Without a key EVERY chunk is null by design, and counting them would put
     "285 passages aren't searchable by meaning" on a library that is working
     exactly as this deployment was configured to. */
  it("doesn't count them at all where semantic search is switched off", async () => {
    semanticOn = false;
    expect((await propsOf()).unembedded).toBe(0);
    expect(countUnembedded).not.toHaveBeenCalled();
  });
});

/* Anyone on the Workboard quotes, its money hidden without financials
   (Isaac, 2026-10-12: "the quoting section should still be accessible. For
   techs who are quoting a job"); without the Workboard, nobody. */
describe("the quote page", () => {
  it("lets a tech in without Workboard manage, without the money", async () => {
    (can as jest.Mock).mockImplementation(async (cap: string) => cap === "workboard");
    const page = (await JobQuotePage({ params: Promise.resolve({ id: "x-1" }), searchParams: Promise.resolve({}) })) as { props: { moneyVisible: boolean; financials: boolean; start: boolean } };
    expect(page.props).toMatchObject({ moneyVisible: false, financials: false, start: false });
  });

  /* the job card's Create a quote links ?start=1 (the chat-first page, 2026-10-13) */
  it("starts at the reply box from the job card's Create a quote", async () => {
    (can as jest.Mock).mockImplementation(async () => true);
    const page = (await JobQuotePage({ params: Promise.resolve({ id: "x-1" }), searchParams: Promise.resolve({ start: "1" }) })) as { props: { start: boolean } };
    expect(page.props.start).toBe(true);
  });

  it("sends someone without the Workboard away", async () => {
    (can as jest.Mock).mockImplementation(async () => false);
    await expect(JobQuotePage({ params: Promise.resolve({ id: "x-1" }), searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/dashboard");
  });
});

/* THE RETIRED ADDRESSES (the v2 audit, 20 October 2026) land on their v2
   homes, so no old link, bookmark or open tab reaches an old screen. */
describe("retired → the v2 home", () => {
  beforeEach(() => {
    can.mockImplementation(async () => allowed);
  });
  const board = (q: Record<string, string>) => () => WorkboardPage({ searchParams: Promise.resolve(q) });
  it.each<[string, () => unknown, string]>([
    ["tiff", TiffPage, "/dashboard/conversations"],
    ["workboard/projects", WorkboardProjectsPage, "/dashboard/jobs?view=projects"],
    /* a project's page and a job's quote are under Jobs (24 October 2026) */
    ["workboard/projects/[id]", () => OldProjectPage({ params: Promise.resolve({ id: "p-1" }) }), "/dashboard/jobs/projects/p-1"],
    [
      "workboard/quotes/[id]?start=1",
      () => OldQuotePage({ params: Promise.resolve({ id: "j-1" }), searchParams: Promise.resolve({ start: "1" }) }),
      "/dashboard/jobs/j-1/quote?start=1",
    ],
    [
      "workboard/quotes/[id]?option=2",
      () => OldQuotePage({ params: Promise.resolve({ id: "j-1" }), searchParams: Promise.resolve({ option: "2" }) }),
      "/dashboard/jobs/j-1/quote?option=2",
    ],
    /* the field tools are the Library's Toolbox shelf */
    ["toolbox", ToolboxPage, "/dashboard/tiff/library?view=toolbox"],
    ["workboard", board({}), "/dashboard/jobs"],
    ["workboard?job=", board({ job: "j-1" }), "/dashboard/jobs/j-1"],
    ["workboard?job=&face=quote", board({ job: "j-1", face: "quote" }), "/dashboard/jobs/j-1?tab=quote"],
    ["workboard?q=", board({ q: "Smith & Sons" }), "/dashboard/jobs?q=Smith%20%26%20Sons"],
    ["workboard?visit=", board({ visit: "v-1" }), "/dashboard/jobs?open=visit.v-1"],
    /* Settings is one page (25 October 2026): Tax and EOFY is a view in
       Reports, its year kept; Knowledge from the field is the Library's */
    ["admin/tax", () => TaxPage({ searchParams: Promise.resolve({}) }), "/dashboard/analytics?view=tax"],
    ["admin/tax?fy=", () => TaxPage({ searchParams: Promise.resolve({ fy: "2026" }) }), "/dashboard/analytics?view=tax&fy=2026"],
    ["admin/tax?fy=nonsense", () => TaxPage({ searchParams: Promise.resolve({ fy: "x" }) }), "/dashboard/analytics?view=tax"],
    ["admin/knowledge", KnowledgePage, "/dashboard/tiff/library?cat=field&view=review"],
  ])("%s", async (_route, Page, to) => {
    allowed = true;
    await expect(Promise.resolve().then(Page)).rejects.toThrow(`REDIRECT:${to}`);
  });
});
