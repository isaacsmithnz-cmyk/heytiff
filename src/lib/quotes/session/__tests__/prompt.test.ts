import { sessionSystemPrompt } from "../prompt";

/* The write-up first is switched on only once the bench says she quotes as
   well or better with it (Isaac, 2026-10-11: "get as much built as possible
   before spending API credit"). */
it("asks for the job written out first only when it's switched on", () => {
  expect(sessionSystemPrompt()).not.toMatch(/write_up/);
  expect(sessionSystemPrompt({ writeUpFirst: true })).toMatch(/Before any line, write the job out \(write_up\)/);
  /* the same for every quote of every business: it caches */
  expect(sessionSystemPrompt()).toBe(sessionSystemPrompt());
});

/* Isaac on the 2749 runs, 2026-10-12: disposal "ask us how much labor we
   want to allow… It does need to have the line at least"; recovery "more of a
   cost that we should be putting in"; and Sonnet left its write-up as the
   first turn had it */
it("always gives old equipment a removal line, asks for disposal labour and the recovery cost, and writes the job again after answers", () => {
  const p = sessionSystemPrompt({ writeUpFirst: true });
  expect(p).toMatch(/Old equipment coming out always has its own line for removal and disposal, as labour: ask how many hours/);
  expect(p).toMatch(/Recovering its refrigerant is the business's own cost: ask what they allow, never research it/);
  expect(p).toMatch(/write it up again, whole, before you reply/);
});
