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
