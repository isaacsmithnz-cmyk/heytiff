/* Open tabs (rules 10 and 11): a tab holds a page, and two tabs never show
   the same page. The store is module state, so each test loads it fresh. */

type Store = typeof import("../open-tabs");

// a module, so its helpers don't share the global scope with other test files
export {};

async function load(): Promise<Store> {
  let mod!: Store;
  await jest.isolateModulesAsync(async () => {
    mod = await import("../open-tabs");
  });
  return mod;
}

async function fresh(): Promise<Store> {
  window.sessionStorage.clear();
  return load();
}

const hrefs = (s: Store) => s.tabsSnapshot().tabs.map((t) => t.href);
const onHref = (s: Store) => {
  const { tabs, on } = s.tabsSnapshot();
  return tabs.find((t) => t.id === on)?.href ?? null;
};

describe("open tabs", () => {
  it("opens with one tab holding the page you're on, and moving moves it", async () => {
    const s = await fresh();
    s.arrive("/dashboard");
    s.arrive("/dashboard/team");
    expect(hrefs(s)).toEqual(["/dashboard/team"]);
  });

  it("fills a new tab with the next page, leaving the first where it was", async () => {
    const s = await fresh();
    s.arrive("/dashboard");
    s.newTab("/dashboard");
    s.arrive("/dashboard/team");
    expect(hrefs(s)).toEqual(["/dashboard", "/dashboard/team"]);
    expect(onHref(s)).toBe("/dashboard/team");
  });

  it("never shows one page in two tabs: going to it switches to its tab", async () => {
    const s = await fresh();
    s.arrive("/dashboard");
    s.newTab("/dashboard");
    s.arrive("/dashboard/team");
    s.arrive("/dashboard");
    expect(hrefs(s)).toEqual(["/dashboard", "/dashboard/team"]);
    expect(onHref(s)).toBe("/dashboard");
  });

  it("drops a new tab you left before it held anything", async () => {
    const s = await fresh();
    s.arrive("/dashboard");
    s.newTab("/dashboard");
    const first = s.tabsSnapshot().tabs[0].id;
    expect(s.choose(first)).toBe("/dashboard");
    expect(hrefs(s)).toEqual(["/dashboard"]);
  });

  it("closing the tab you're on shows its neighbour", async () => {
    const s = await fresh();
    s.arrive("/dashboard");
    s.newTab("/dashboard");
    s.arrive("/dashboard/team");
    const on = s.tabsSnapshot().on!;
    expect(s.closeTab(on)).toBe("/dashboard");
    expect(hrefs(s)).toEqual(["/dashboard"]);
  });

  it("closing another tab leaves you where you are", async () => {
    const s = await fresh();
    s.arrive("/dashboard");
    s.newTab("/dashboard");
    s.arrive("/dashboard/team");
    const first = s.tabsSnapshot().tabs[0].id;
    expect(s.closeTab(first)).toBeNull();
    expect(onHref(s)).toBe("/dashboard/team");
  });

  it("keeps the tabs through a reload of the page", async () => {
    const s = await fresh();
    s.arrive("/dashboard");
    s.newTab("/dashboard");
    s.arrive("/dashboard/team");
    const again = await load();
    expect(hrefs(again)).toEqual(["/dashboard", "/dashboard/team"]);
  });
});

/* A tab keeps where you were on its page, query and all (Isaac, 26 October
   2026: Design's canvas, then a job's tab, then back to Design opened the
   list of designs, because the tab held only the path). */
describe("where you were on a page", () => {
  it("keeps the design open on the canvas when you come back to its tab", async () => {
    const s = await fresh();
    s.arrive("/dashboard/studio");
    s.arrive("/dashboard/studio?design=d1");
    s.newTab("/dashboard/studio?design=d1");
    s.arrive("/dashboard/jobs/3385");
    const design = s.tabsSnapshot().tabs[0].id;
    expect(s.choose(design)).toBe("/dashboard/studio?design=d1");
  });

  it("is still one page whatever its query: going to it switches to its tab", async () => {
    const s = await fresh();
    s.arrive("/dashboard/studio?design=d1");
    s.newTab("/dashboard/studio?design=d1");
    s.arrive("/dashboard/jobs");
    s.arrive("/dashboard/studio");
    expect(hrefs(s)).toEqual(["/dashboard/studio", "/dashboard/jobs"]);
    expect(onHref(s)).toBe("/dashboard/studio");
  });

  it("follows a view changed on the page, in the tab you're on only", async () => {
    const s = await fresh();
    s.arrive("/dashboard/jobs");
    s.newTab("/dashboard/jobs");
    s.arrive("/dashboard/documents");
    s.arrive("/dashboard/documents?view=letters");
    expect(hrefs(s)).toEqual(["/dashboard/jobs", "/dashboard/documents?view=letters"]);
  });
});
