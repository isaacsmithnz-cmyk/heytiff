/* Open tabs (rules 10 and 11): a tab holds a page, and two tabs never show
   the same page. The store is module state, so each test loads it fresh. */

type Store = typeof import("../open-tabs");

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
