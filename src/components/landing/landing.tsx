"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Chevron, Wordmark } from "@/components/logo";
import { startStage, type Pose } from "./stage";

/* THE FRONT PAGE, for anyone signed out (Isaac, 26 November 2026). After
   five rounds of mocks he picked the first loud one: "your first loud one
   was still best", https://claude.ai/artifact/BRVbBq25HzeQk7r46LQaAb. On the
   ink, Tiff's mark in black chrome in front of a giant HeyTiff, then four
   parts as you scroll, each a giant word behind the mark and one of the
   app's own screens in front of it. Two things joined on his word: the
   boomerang flies the app's own flight ("With app's flight"), and the quote
   rises from behind a lit horizon ("the horizon one you made was cool too.
   maybe incorporate", https://claude.ai/artifact/NJJJfbRxAfj1JqSMKx2eww).

   NO CREATE ACCOUNT. New businesses join by invitation for now ("lock
   create account for now"). Sign-up itself stays open at Auth0: an
   invitation's link opens its sign-up tab (invite/accept), and the phone
   sets up a business from its own screens (#1728).

   This page sits outside the app's frame and is named as such in
   docs/design.md, under Named exemptions: its type is display type, its
   ground is the ink, and its mark moves. Every figure on it is made up.

   THREE LAYERS. The giant words sit under the canvas, so the mark passes in
   front of them; the screens and the words you read sit over it. Each scene
   pins one screen while its stretch of the page scrolls past, and sets --p:
   -1 coming in, 0 in the middle, 1 leaving. */

const SCENES = 6;

const POSES: { wide: Pose[]; narrow: Pose[] } = {
  wide: [
    { x: 0, y: 0.09, ry: -0.22, rx: 0.08, s: 1.25 },
    { x: 0.33, y: 0.27, ry: -0.6, rx: 0.1, s: 0.5 },
    { x: -0.22, y: 0, ry: 0.75, rx: -0.1, s: 0.95 },
    { x: 0.22, y: 0, ry: -0.5, rx: 0.25, s: 0.95 },
    { x: -0.22, y: 0, ry: 0.9, rx: -0.05, s: 0.95 },
    { x: 0, y: 0.1, ry: Math.PI * 2, rx: 0, s: 1.06 },
  ],
  narrow: [
    { x: 0, y: 0.09, ry: -0.22, rx: 0.08, s: 0.69 },
    { x: 0.24, y: 0.34, ry: -0.6, rx: 0.1, s: 0.28 },
    { x: 0, y: 0.13, ry: 0.6, rx: -0.1, s: 0.38 },
    { x: 0, y: 0.13, ry: -0.5, rx: 0.2, s: 0.38 },
    { x: 0, y: 0.13, ry: 0.7, rx: 0, s: 0.38 },
    { x: 0, y: 0.1, ry: Math.PI * 2, rx: 0, s: 0.6 },
  ],
};

const GUTTER: CSSProperties = {
  paddingLeft: "max(24px, env(safe-area-inset-left, 0px))",
  paddingRight: "max(24px, env(safe-area-inset-right, 0px))",
};
const DISPLAY: CSSProperties = { letterSpacing: "-0.055em", lineHeight: 0.85 };

export function Landing() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const at = useRef(0);
  const [flat, setFlat] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const list = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-scene]") ?? []);
    if (list.length === 0) return;
    const onScroll = () => {
      const vh = window.innerHeight, y = window.scrollY;
      for (const el of list) {
        const r = el.getBoundingClientRect(), c = r.top + r.height / 2;
        el.style.setProperty("--p", reduced ? "0" : clamp((vh / 2 - c) / (r.height / 2 + vh / 2), -1, 1).toFixed(4));
      }
      let i = 0;
      while (i < list.length - 1 && y >= list[i + 1].offsetTop) i++;
      const span = (list[i + 1]?.offsetTop ?? list[i].offsetTop + list[i].offsetHeight) - list[i].offsetTop;
      at.current = i + clamp((y - list[i].offsetTop) / span, 0, 1);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    let stop: (() => void) | null = null, gone = false;
    if (canvas.current && typeof WebGLRenderingContext !== "undefined") {
      startStage(canvas.current, { scene: () => at.current, poses: POSES, working: [0.55, SCENES - 1.4], reduced })
        .then((s) => {
          if (gone) s?.();
          else if (s) stop = s;
          else setFlat(true);
        })
        .catch(() => setFlat(true));
    } else setFlat(true);
    return () => {
      gone = true;
      stop?.();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div ref={root} className="relative bg-[var(--ink)] text-[var(--white)] antialiased [overflow-x:clip]">
      <canvas ref={canvas} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[1] block h-full w-full" />

      <header className="fixed inset-x-0 top-0 z-[6] flex items-center justify-between py-4" style={{ ...GUTTER, top: "env(safe-area-inset-top, 0px)" }}>
        <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold" aria-label="HeyTiff">
          <Chevron size={26} decorative />
          <Wordmark inkColor="var(--white)" />
        </Link>
        <SignIn quiet />
      </header>

      <main>
        {/* THE MARK, in front of the word */}
        <section data-scene={0} className="relative" style={{ height: "170vh" }}>
          <Under>
            <p
              aria-hidden="true"
              className="absolute inset-x-0 top-1/2 m-0 whitespace-nowrap text-center font-bold"
              style={{ ...DISPLAY, fontSize: "clamp(88px, 23vw, 400px)", transform: "translateY(calc(-50% - 9vh)) scale(calc(1 + var(--p, 0) * .25))" }}
            >
              HeyTiff
            </p>
            {flat ? (
              <span className="absolute left-1/2 top-[calc(50%-9vh)] w-[min(44vw,300px)] -translate-x-1/2 -translate-y-1/2 text-[var(--white)]">
                <Chevron size={300} className="h-auto w-full" decorative />
              </span>
            ) : null}
          </Under>
          <Over className="flex flex-col items-center justify-end gap-4 text-center" style={{ paddingBottom: "max(10vh, 48px)" }}>
            <h1 className="m-0 max-w-[440px] text-balance text-base font-semibold md:text-xl">The office for a trade business, with Tiff to run it.</h1>
            <SignIn />
            <Invitation />
          </Over>
        </section>

        {/* QUOTE IT: the quote rises from behind a lit horizon */}
        <section data-scene={1} className="relative" style={{ height: "220vh" }}>
          <Under>
            <p aria-hidden="true" className="absolute m-0 whitespace-nowrap font-bold" style={{ ...DISPLAY, ...GUTTER, top: "11vh", left: 0, fontSize: "clamp(64px, 13vw, 220px)", transform: "translateX(calc(var(--p, 0) * -24vw))" }}>
              Quote it.
            </p>
          </Under>
          <Over>
            <h2 className="m-0 max-w-[520px] text-balance text-base font-semibold md:text-xl" style={{ paddingTop: "calc(11vh + clamp(64px, 13vw, 220px) * .85 + 16px)" }}>
              Tell Tiff the job. <span className="text-white/60">She prices it from your own book, asks what she can’t tell, and writes the proposal.</span>
            </h2>
            <div className="absolute left-1/2 w-[min(920px,92vw)] -translate-x-1/2 [perspective:1400px]" style={{ top: "48svh" }}>
              <div
                className="origin-bottom rounded-2xl shadow-[0_0_0_1px_rgba(255,255,255,.18),0_-10px_60px_rgba(220,224,232,.18)]"
                style={{ transform: "rotateX(calc(16deg + clamp(0, var(--p, 0) * -2, 1) * 18deg)) translateY(calc(clamp(0, var(--p, 0) * -2, 1) * 60%))" }}
              >
                <QuoteScreen />
              </div>
            </div>
            <div
              aria-hidden="true"
              className="absolute left-1/2 aspect-square w-[240vw] -translate-x-1/2 rounded-full bg-[var(--ink)] shadow-[0_-1px_0_1px_rgba(255,255,255,.95),0_-6px_18px_rgba(255,255,255,.55),0_-40px_120px_rgba(214,218,228,.35),0_-120px_240px_rgba(160,168,184,.18)]"
              style={{ top: "calc(48svh + 230px)" }}
            />
          </Over>
        </section>

        <Part i={2} word="Book it." right lede={<>Every job and the week ahead. <span className="text-white/60">Who is where, each day.</span></>}>
          <Week />
        </Part>
        <Part i={3} word="Clock on." lede={<>Time lands on the job. <span className="text-white/60">Hours go on as your team arrives and leaves.</span></>}>
          <Phone />
        </Part>
        <Part i={4} word="Covered." right lede={<>Your team’s papers, kept current. <span className="text-white/60">What’s running out is said before it does.</span></>}>
          <Papers />
        </Part>

        <section data-scene={5} className="relative" style={{ height: "130vh" }}>
          <Under>{null}</Under>
          <Over className="flex flex-col items-center justify-end gap-4 text-center" style={{ paddingBottom: "max(14vh, 64px)" }}>
            <h2 className="m-0 font-bold" style={{ fontSize: "clamp(40px, 8vw, 96px)", lineHeight: 1, letterSpacing: "-0.045em" }}>
              Tiff’s on.
            </h2>
            <SignIn />
            <Invitation />
          </Over>
        </section>
      </main>

      <footer className="relative z-[3] flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-[var(--ink)] py-6 text-[13px] leading-[18px] text-white/60" style={GUTTER}>
        <span>HeyTiff is run from New South Wales, Australia. Works with ServiceM8 and Xero.</span>
        <nav className="flex flex-wrap gap-1" aria-label="About HeyTiff">
          <FootLink href="/privacy">Privacy</FootLink>
          <FootLink href="/terms">Terms</FootLink>
          <FootLink href="/support">Support</FootLink>
          {/* the quiet staff door: HQ 404s for anyone not on the allowlist, and returnTo lands staff in /hq */}
          <FootLink href="/auth/login?returnTo=/hq">Staff HQ</FootLink>
        </nav>
      </footer>
    </div>
  );
}

/* ---- the layers ---- */

function Under({ children }: { children: ReactNode }) {
  return <div className="sticky top-0 z-0 h-screen overflow-hidden [height:100svh]">{children}</div>;
}

function Over({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`sticky top-0 z-[2] -mt-[100vh] h-screen overflow-hidden [height:100svh] [margin-top:-100svh] ${className}`} style={{ ...GUTTER, ...style }}>
      {children}
    </div>
  );
}

function Part({ i, word, lede, right = false, children }: { i: number; word: string; lede: ReactNode; right?: boolean; children: ReactNode }) {
  return (
    <section data-scene={i} className="relative" style={{ height: "200vh" }}>
      <Under>
        <p
          aria-hidden="true"
          className={`absolute m-0 whitespace-nowrap font-bold max-[760px]:!bottom-auto max-[760px]:!left-0 max-[760px]:!right-auto max-[760px]:top-[16vh] ${right ? "right-0" : "left-0"}`}
          style={{ ...DISPLAY, ...GUTTER, bottom: "3vh", fontSize: "clamp(80px, 19vw, 340px)", transform: right ? "translateX(calc(var(--p, 0) * 28vw - 6vw))" : "translateX(calc(var(--p, 0) * -28vw + 6vw))" }}
        >
          {word}
        </p>
      </Under>
      <Over className={`flex items-center max-[760px]:items-end max-[760px]:justify-center max-[760px]:pb-6 ${right ? "justify-end" : ""}`}>
        <div className="flex w-full max-w-[440px] flex-col gap-4" style={{ transform: "translateY(calc(var(--p, 0) * -10vh))" }}>
          <h2 className="m-0 text-balance text-base font-semibold md:text-xl">{lede}</h2>
          {children}
        </div>
      </Over>
    </section>
  );
}

function SignIn({ quiet = false }: { quiet?: boolean }) {
  return quiet ? (
    <a href="/auth/login" className="flex h-9 items-center rounded-[10px] px-4 text-sm font-semibold text-[var(--white)] transition-[background-color] duration-[120ms] hover:bg-white/10">
      Sign in
    </a>
  ) : (
    <a href="/auth/login" className="flex h-11 items-center rounded-[10px] bg-[var(--blue)] px-6 text-sm font-semibold text-[var(--white)]">
      Sign in
    </a>
  );
}

function Invitation() {
  return <p className="m-0 text-[13px] leading-[18px] text-white/60">New businesses join by invitation for now.</p>;
}

function FootLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-[10px] px-2 py-1.5 font-semibold text-[var(--white)] transition-[background-color] duration-[120ms] hover:bg-white/10">
      {children}
    </Link>
  );
}

/* ---- the app's own screens, drawn with made-up work ---- */

const CARD = "overflow-hidden rounded-2xl bg-[var(--white)] text-[var(--ink)] shadow-[0_12px_32px_rgba(5,5,5,.16)]";
const ROW = "flex min-h-11 items-center justify-between gap-3 border-t border-[var(--line)] px-4 text-sm";
const Dot = ({ c }: { c: string }) => <span className="mr-2 inline-block size-2 shrink-0 rounded-full" style={{ background: c }} />;
const Glyph = () => (
  <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true" className="mt-px shrink-0">
    <path d="M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z" fill="var(--ink)" stroke="var(--ink)" strokeWidth="7" />
    <path d="M54 24 L72 24 L90 46" fill="none" stroke="var(--grey)" strokeWidth="7" />
  </svg>
);

function QuoteScreen() {
  return (
    <div className={`${CARD} shadow-none`}>
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
        <span className="inline-flex h-7 min-w-11 items-center justify-center rounded-md bg-[var(--orange-card)] px-1.5 text-[13px] font-bold text-[var(--white)]">2860</span>
        <span className="flex min-w-0 flex-col">
          <b className="text-sm font-semibold">Priya Shah</b>
          <span className="text-xs text-[var(--q)]">Ducted, 4 bed, Box Hill</span>
        </span>
        <span className="ml-auto flex items-center text-[13px] font-semibold text-[var(--orange-w)]">
          <Dot c="var(--orange)" />2 to answer
        </span>
      </div>
      <div className="flex gap-4 border-b border-[var(--line)] px-4">
        <span className="py-2.5 text-[13px] font-semibold text-[var(--orange-w)] shadow-[inset_0_-2px_0_var(--ink)]">Build</span>
        <span className="py-2.5 text-[13px] font-semibold text-[var(--q)]">Breakdown</span>
        <span className="py-2.5 text-[13px] font-semibold text-[var(--q)]">Proposal</span>
      </div>
      <div className="grid grid-cols-1 gap-3 bg-[var(--soft)] p-3 md:grid-cols-[minmax(0,1fr)_250px]">
        <div className="hidden min-w-0 flex-col gap-2.5 rounded-xl bg-[var(--white)] p-3 md:flex">
          <div className="max-w-[88%] self-end rounded-[14px] bg-[var(--bubble-them)] px-3 py-2 text-[13px] leading-[18px]">
            Ducted for the whole house off the builder’s plans, 5 outlets, zoned upstairs and down.
          </div>
          <div className="flex gap-2 text-[13px] leading-[18px]">
            <Glyph />
            <span>I read 142 m² over two floors and sized a 14 kW system. Two things I can’t tell from the plans:</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-xl p-2.5 shadow-[inset_0_0_0_1px_var(--edge)]">
            <b className="text-[13px] font-semibold">Is there 400 mm of roof space over the garage?</b>
            <span className="text-xs text-[var(--q)]">On the quote now: unit in the garage roof</span>
            <span className="flex h-9 items-center justify-between rounded-[10px] bg-[var(--blue)] px-3 text-[13px] font-semibold text-[var(--white)]">
              <span>Yes, room for the unit</span>
              <span className="font-medium tabular-nums">$0</span>
            </span>
            <span className="flex h-9 items-center justify-between rounded-[10px] px-3 text-[13px] font-semibold shadow-[inset_0_0_0_1px_var(--edge)]">
              <span>No, under the house</span>
              <span className="font-medium tabular-nums">+$640</span>
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="rounded-xl bg-[var(--white)] p-3">
            <div className="flex items-baseline justify-between">
              <b className="text-[13px] font-semibold">Total ex GST</b>
              <span className="text-2xl font-bold tabular-nums">$18,940</span>
            </div>
            <div className="text-right text-xs text-[var(--q)] tabular-nums">$20,834 inc GST</div>
            {[
              ["Units", "$7,980", ""],
              ["Materials", "$4,310", ""],
              ["Labour", "$3,420", "38 h"],
              ["Profit", "$3,230", "22%"],
            ].map(([k, v, sub]) => (
              <div key={k} className="flex justify-between border-t border-[var(--line)] py-1.5 text-[13px]">
                <span>
                  {k} {sub ? <span className="font-medium text-[var(--q)]">{sub}</span> : null}
                </span>
                <span className={`tabular-nums ${k === "Profit" ? "font-semibold text-[var(--green-w)]" : ""}`}>{v}</span>
              </div>
            ))}
          </div>
          <span className="flex h-11 items-center justify-center rounded-[10px] bg-[var(--blue)] text-sm font-semibold text-[var(--white)]">Answer 2 questions</span>
        </div>
      </div>
    </div>
  );
}

const BOOKINGS: Array<{ n: string; who: string; at: string; when: string; c: string; i: number }> = [
  { n: "2841", who: "Lena Ortiz", at: "Kellyville", when: "7:30", c: "var(--green-w)", i: 0 },
  { n: "2841", who: "Lena Ortiz", at: "Kellyville", when: "7:30", c: "var(--green-w)", i: 1 },
  { n: "2856", who: "Northgate", at: "Castle Hill", when: "8:00", c: "var(--purple-w)", i: 2 },
  { n: "2860", who: "Priya Shah", at: "Box Hill", when: "Quote 9:00", c: "var(--orange-card)", i: 1 },
  { n: "2849", who: "Ridge St", at: "Rouse Hill", when: "7:00", c: "var(--pink-card)", i: 2 },
  { n: "2849", who: "Ridge St", at: "Rouse Hill", when: "7:00", c: "var(--pink-card)", i: 3 },
];

function Week() {
  return (
    <div className={`${CARD} grid grid-cols-3 gap-2 p-3`}>
      {["Mon 30", "Tue 1", "Wed 2"].map((d) => (
        <span key={d} className="text-xs font-medium text-[var(--q)]">{d}</span>
      ))}
      {BOOKINGS.map((b, k) => (
        <div
          key={k}
          className="flex min-w-0 gap-1.5 rounded-[10px] bg-[var(--white)] p-1.5"
          style={{ boxShadow: `inset 0 0 0 1px ${b.c}`, transform: `translateY(calc(clamp(0, var(--p, 0) * -1.6 - .1, 1) * ${b.i * 36 + 48}px))` }}
        >
          <span className="self-start rounded-md px-1 py-0.5 text-xs font-bold tabular-nums text-[var(--white)]" style={{ background: b.c }}>{b.n}</span>
          <span className="min-w-0 text-xs">
            <b className="block font-semibold">{b.who}</b>
            <span className="block text-[var(--q)]">{b.at}</span>
            <span className="block text-[var(--q)]">{b.when}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Phone() {
  return (
    <div className="flex w-full max-w-[280px] flex-col gap-3 rounded-[40px] bg-[var(--white)] p-3 text-[var(--ink)] shadow-[0_12px_32px_rgba(5,5,5,.16)] max-[760px]:max-w-none">
      <div className="flex justify-between rounded-t-[26px] bg-[var(--ink)] px-4 py-3 text-[13px] font-semibold text-[var(--white)]">
        <span>Today</span>
        <span>Tue 1 Dec</span>
      </div>
      <div className="flex h-11 items-center justify-between rounded-[10px] bg-[var(--green-w)] px-4 font-semibold tabular-nums text-[var(--white)]">
        <span>Clock off</span>
        <span>7:26</span>
      </div>
      <div className="flex flex-col gap-0.5 px-1">
        <b className="text-base font-semibold">2849 Ridge St Homes</b>
        <span className="text-[13px] text-[var(--q)]">Rough-in, Rouse Hill</span>
      </div>
      <div className="flex flex-col px-1 pb-2 text-sm tabular-nums">
        {[
          ["Arrived", "7:04", false],
          ["Left", "12:40", false],
          ["On 2849", "5.6 h", true],
        ].map(([k, v, b]) => (
          <div key={k as string} className={`flex justify-between gap-3 border-t border-[var(--line)] py-2 ${b ? "font-semibold" : ""}`}>
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Papers() {
  const rows: Array<[string, string, string, string, string]> = [
    ["Sam Reid", "Refrigerant licence", "Current", "var(--green)", "var(--green-w)"],
    ["Jo Mills", "Heights", "12 days", "var(--orange)", "var(--orange-w)"],
    ["Van 2", "Registration", "Current", "var(--green)", "var(--green-w)"],
  ];
  return (
    <div className={`${CARD} flex flex-col`}>
      {rows.map(([who, what, state, dot, word], k) => (
        <div key={who} className={`${ROW} ${k === 0 ? "border-t-0" : ""}`}>
          <span>
            <b className="font-semibold">{who}</b> <span className="text-[13px] font-medium text-[var(--q)]">{what}</span>
          </span>
          <span className="flex items-center whitespace-nowrap font-semibold" style={{ color: word }}>
            <Dot c={dot} />
            {state}
          </span>
        </div>
      ))}
    </div>
  );
}
