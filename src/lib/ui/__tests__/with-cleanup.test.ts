/**
 * @jest-environment node
 */
import { withCleanup } from "../with-cleanup";

/* withCleanup stands in for `try { … } finally { … }` wherever React
   Compiler would otherwise refuse the component, so it has to BE one: the
   cleanup on every exit, a throw still thrown, and whatever `work` returns
   handed back — `return withCleanup(…)` is how a try/finally that ended a
   function returning a value converts. */

describe("withCleanup", () => {
  it("hands back what work returns, with the cleanup already run", async () => {
    const order: string[] = [];
    const out = await withCleanup(
      async () => {
        order.push("work");
        return true;
      },
      () => order.push("cleanup")
    );
    order.push("caller");
    expect(out).toBe(true);
    expect(order).toEqual(["work", "cleanup", "caller"]);
  });

  it("runs the cleanup after an early return", async () => {
    const cleanup = jest.fn();
    const after = jest.fn();
    const run = (early: boolean) =>
      withCleanup(async () => {
        if (early) return;
        after();
      }, cleanup);
    await run(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();
  });

  it("runs the cleanup when work throws, and still throws", async () => {
    const cleanup = jest.fn();
    await expect(
      withCleanup(async () => {
        throw new Error("refused");
      }, cleanup)
    ).rejects.toThrow("refused");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
