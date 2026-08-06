import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import type { HeroStat } from "@/lib/dashboard/hero-stats";

/* The dashboard hero — greeting, date, and the four counters.

   IT USED TO BE AN HTML STRING (`heroHtml` in shell/screens.ts) rendered
   through `dangerouslySetInnerHTML`, which cost two things worth having back:

   1. THE COUNTERS WERE PLAIN ANCHORS, so every door out of the most-visited
      screen in the app was a full document reload — no client routing, no
      prefetch, the whole shell torn down and rebuilt to move one screen.
   2. EVERY INTERPOLATED VALUE HAD TO BE HAND-ESCAPED. The viewer's own name
      goes in here, and the builder carried a comment and a dedicated test
      suite about exactly that hazard. React escapes by construction, so the
      hazard is gone rather than guarded.

   The markup and class names are unchanged — this renders byte-for-byte what
   the v3 design did, so shell.css needed no edit. */

export function DashboardHero({
  greeting,
  firstName,
  date,
  stats,
}: {
  greeting: string;
  firstName: string;
  date: string;
  stats: readonly HeroStat[];
}) {
  /* A tile with nothing in it is deliberately DIM (`.zero`): the counters are
     a "does anything need me" glance, so a clear day should read as calm
     rather than as four lit-up badges all saying nothing.

     And when EVERY counter is zero the tiles go away entirely — four zeroes
     are still four things to read. The column says it once, in words. */
  const clear = stats.length > 0 && stats.every((s) => s.count === 0);

  return (
    <div className="hero">
      <div className="mesh">
        <i className="m1" />
        <i className="m2" />
        <i className="m3" />
      </div>
      <div className="hrow">
        <div className="hlead">
          <div className="pill">
            <Icon name="activity" size={12} />
            {date}
          </div>
          <h1>
            {greeting},
            <br />
            <span>{firstName}.</span>
          </h1>
          <p className="lede">Welcome back. Your workspace is ready.</p>
        </div>

        {stats.length > 0 && (
          <div className={`hstats${clear ? " clear" : ""}`}>
            {clear ? (
              <div className="hclear">
                <span className="hc-ic">
                  <Icon name="check" size={22} />
                </span>
                <b className="hc-t">All clear</b>
                <em className="hc-s">Nothing needs you right now</em>
              </div>
            ) : (
              stats.map((s) => (
                /* `Link`, not `<a>` — this is the whole point of the rewrite.
                   The tasks tile is the exception: its href is the in-page
                   anchor `#dash-tasks`, and an anchor is not a route. */
                <Link
                  key={s.key}
                  className={`hstat ${s.tone}${s.count === 0 ? " zero" : ""}`}
                  href={s.href}
                  scroll={!s.href.startsWith("#")}
                >
                  <span className="hs-ic">
                    <Icon name={s.icon} size={17} />
                  </span>
                  <b className="hs-n">{s.count}</b>
                  <em className="hs-l">{s.label}</em>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
