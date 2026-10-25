/* THE JOBS LIST'S READS, TIMED FOR A DAY (Isaac, 25 October 2026: "add
   timing to the Jobs page's reads for a day, logged on the server only,
   and report what it shows before changing anything else").

   Each read of the list writes one line to the function's own log,
   `[jobs-timing]` and JSON: when each wait finished, in milliseconds from
   the start of the read, and whether this server instance had just woken
   (its first read). Nothing reaches the page or the browser. It comes out
   once the day's lines are read. */

let woken = false;

export type JobsTimer = {
  /** a wait just finished */
  mark: (name: string) => void;
  /** when this one finishes, whatever else is still out */
  lap: <T>(name: string, p: Promise<T>) => Promise<T>;
  /** the read is done: write its line */
  done: (extra: Record<string, unknown>) => void;
};

export function jobsTimer(
  from: string,
  opts: {
    /** where the line goes: the server's log (tests hand their own) */
    write?: (line: string) => void;
  } = {},
): JobsTimer {
  const t0 = performance.now();
  const write = opts.write ?? (process.env.NODE_ENV === "test" ? () => {} : (line: string) => console.info(line));
  const cold = !woken;
  woken = true;
  const marks: Record<string, number> = {};
  const mark = (name: string) => {
    marks[name] = Math.round(performance.now() - t0);
  };
  return {
    mark,
    lap: (name, p) =>
      p.then((v) => {
        mark(name);
        return v;
      }),
    done: (extra) => {
      mark("total");
      write(`[jobs-timing] ${JSON.stringify({ from, cold, ...marks, ...extra })}`);
    },
  };
}
