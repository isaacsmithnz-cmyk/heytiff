import fs from "node:fs";
import path from "node:path";
import { DIARY_LIT_MS } from "@/lib/dashboard/diary-doors";

/* THE NEW HOME'S FRAME, IN THE SHEET (docs/design.md, "Home is the day,
   three tabs and the list").

   Two promises Isaac asked for are made by the stylesheet, where jsdom
   cannot see them, so they are read off the rules here:

   - "the diary, calendar and tasks tabs shouldn't move positions each
     time". Choosing a tab sets it bold, and bold is wider; each tab holds a
     copy of its word at the bold weight, with no height and no paint, so it
     is as wide as its bold word from the start. That only works while the
     copy's weight IS the chosen tab's weight.
   - the slide. The faces slide past each other in one cell, and a face on
     its way must never paint over the day, the tabs or the list — so both
     cells clip (and with `clip`, not `hidden`, so neither is a scroller a
     flash could move), and the tabs stand outside them, pinned by where
     they are rather than by `sticky`.

   And the old one, still true: a face styled as a flex column beats the
   browser's own `[hidden]`, so hidden has to be said again. */

const CSS = fs
  .readFileSync(path.join(process.cwd(), "src/app/dashboard/shell.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the rule whose selector list is exactly `sel`. */
function rule(sel: string): Record<string, string> {
  const out: Record<string, string> = {};
  let found = false;
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() !== sel) continue;
    found = true;
    for (const d of m[2]!.split(";")) {
      const at = d.indexOf(":");
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
    }
  }
  if (!found) throw new Error(`no rule "${sel}" in shell.css`);
  return out;
}

describe("the tabs never move", () => {
  it("hold each tab's bold word at the chosen tab's own weight", () => {
    const chosen = rule(".fg .hd-tab.on")["font-weight"];
    expect(chosen).toBeDefined();
    expect(rule(".fg .hd-tabw")["font-weight"]).toBe(chosen);
  });

  it("give the held word width and nothing else: no height, no paint, no pointer", () => {
    const held = rule(".fg .hd-tabw");
    expect(held.height).toBe("0");
    expect(held.overflow).toBe("hidden");
    expect(held.visibility).toBe("hidden");
    expect(held["pointer-events"]).toBe("none");
  });

  it("stack the word over its held copy, so the tab is as wide as the wider of the two", () => {
    const t = rule(".fg .hd-tab");
    expect(t.display).toBe("inline-flex");
    expect(t["flex-direction"]).toBe("column");
  });

  it("stand the row above the body, never shrinking and never sticky", () => {
    const row = rule(".fg .hd-tabs");
    expect(row.flex).toBe("none");
    expect(row.position).toBeUndefined();
  });
});

describe("the slide stays in its cell", () => {
  it("clips the body and the diary column, so a face on its way paints over nothing", () => {
    expect(rule(".fg .hd-fx").overflow).toBe("clip");
    expect(rule(".fg .hd-col").overflow).toBe("clip");
  });

  /* `hidden` clips too, but it makes a scroll container, and the face on
     its way in gives that container room sideways. A diary door lands on
     Tasks mid-slide and Tasks' flash calls `scrollIntoView` on the row: the
     browser scrolls the column across to reach it (0 → 314px → 0 over the
     280 ms, measured in headless Chrome at 1440 against this sheet), and
     the two faces lurch. `clip` is not a scroll container, so nothing can
     scroll it. Nor may either axis be set on its own to anything else. */
  it("clips without making a scroller, so a flash mid-slide cannot scroll the cell sideways", () => {
    for (const sel of [".fg .hd-fx", ".fg .hd-col"]) {
      const r = rule(sel);
      expect(r["overflow-x"]).toBeUndefined();
      expect(r["overflow-y"]).toBeUndefined();
      expect(r.overflow).not.toMatch(/hidden|auto|scroll/);
    }
  });

  it("puts the parts that slide past each other in one cell", () => {
    expect(rule(".fg .hd-fx > .hd-main, .fg .hd-fx > .hd-face")["grid-area"]).toBe("1 / 1");
    expect(rule(".fg .hd-col > .hd-face")["grid-area"]).toBe("1 / 1");
  });

  it("lets only a face scroll", () => {
    expect(rule(".fg .hd-face")["overflow-y"]).toBe("auto");
    expect(rule(".fg .hd-body")["min-height"]).toBe("0");
  });

  it("hides a hidden face and a hidden body, which their own display would otherwise beat", () => {
    expect(rule(".fg .hd-main[hidden], .fg .hd-face[hidden]").display).toBe("none");
  });
});

/* THE LIST (H19), beside Diary and Tasks. What the sheet promises for it:
   it takes the frame's second column and scrolls on its own; every rule is
   two classes deep, as the family's are, so `.fg button` (0,1,1) — the
   frame's reset — never beats a title, a verb or the box; a row's fill
   reaches past the column by exactly the row's own side padding, so its
   words stand on the column's edge; and nothing folds or grows under
   reduced motion. */
describe("the list", () => {
  it("takes the frame's second column, and scrolls on its own", () => {
    expect(rule(".fg .hd-main:has(> .hd-list)")["grid-template-columns"]).toBe("minmax(0,1fr) minmax(280px,420px)");
    const list = rule(".fg .hd-list");
    expect(list["overflow-y"]).toBe("auto");
    expect(list["min-height"]).toBe("0");
  });

  it("sets every one of its rules two classes deep, under the frame", () => {
    const parts: string[] = [];
    for (const m of CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const sel = m[1]!.trim();
      if (!/\.hd-(ls-|list\b)/.test(sel)) continue;
      parts.push(...sel.split(",").map((s) => s.trim()));
    }
    expect(parts.length).toBeGreaterThan(20);
    expect(parts.filter((p) => !/^\.fg \.hd-[\w-]/.test(p))).toEqual([]);
  });

  it("reaches a row's fill past the column by the row's own side padding", () => {
    const row = rule(".fg .hd-ls-row");
    const [, side] = row.padding!.split(" ");
    expect(row.margin).toBe(`0 -${side}`);
  });

  it("folds and grows nothing under reduced motion", () => {
    const quiet = [...CSS.matchAll(/@media \(prefers-reduced-motion:reduce\) \{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]
      .map((m) => m[1]!)
      .find((body) => body.includes(".hd-ls-"));
    expect(quiet).toBeDefined();
    expect(quiet).toMatch(/\.fg \.hd-ls-it \{ transition:none; \}/);
    expect(quiet).toMatch(/\.fg \.hd-ls-in\[data-grow\] \{ animation:none; \}/);
  });
});

/* THE TASKS FACE (home-tasks-face.tsx) wears the list's rows, so what is
   held here is only what it adds: its rules two classes deep like the
   rest of the family; what opens under a row standing under the title, in
   from the row's edge by exactly the row's lead and its gap, so the words
   line up whatever either becomes; and the open row's fill giving way to
   a lit one, so a door's light is seen on a row it opens. */
describe("the Tasks face", () => {
  it("sets every one of its rules two classes deep, under the frame", () => {
    const parts: string[] = [];
    for (const m of CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const sel = m[1]!.trim();
      if (!/\.hd-(tk|cf)\b/.test(sel)) continue;
      parts.push(...sel.split(",").map((s) => s.trim()));
    }
    expect(parts.length).toBeGreaterThan(20);
    expect(parts.filter((p) => !/^\.fg \.hd-[\w-]/.test(p))).toEqual([]);
  });

  it("stands what opens under a row under its title: past the lead and the gap", () => {
    const row = rule(".fg .hd-ls-row");
    const lead = row["grid-template-columns"]!.split(" ")[0];
    const gap = row["column-gap"];
    expect(rule(".fg .hd-tk-d").padding).toBe(`4px 0 16px calc(${lead} + ${gap})`);
  });

  it("fills the open row as the pointer does, and lets a lit one keep its light", () => {
    const open = rule('.fg .hd-tk .hd-ls-row:not([data-lit]):has(> .hd-ls-t[aria-expanded="true"])');
    expect(open.background).toBe(rule(".fg .hd-ls-row.opens:hover").background);
  });
});

/* THE DIARY (H16), in the Diary tab. What the sheet promises for it: its
   rules are two classes deep, like the family's, so the frame's reset never
   beats a door; it scrolls with its face, never on its own (only a face
   scrolls, and the diary's door brings an entry up by moving the face); an
   entry's wash reaches past the column by exactly its own side padding, so
   the words never move when it lights, and the rule under it stays on the
   column; the wash is his, a fill that moves nothing — held for three
   quarters of its seven seconds and faded over the last, a still tint under
   reduced motion (a named exemption in docs/design.md); and a door, and
   the entry a door lands on, wear the focus ring (law 32). */
describe("the diary", () => {
  /** The sheet without its @media blocks: the rules as they stand for
      everyone, before reduced motion takes anything away. */
  const atRest = CSS.replace(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g, "");
  const restRule = (sel: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of atRest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1]!.trim() !== sel) continue;
      for (const d of m[2]!.split(";")) {
        const at = d.indexOf(":");
        if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
      }
    }
    return out;
  };

  it("sets every one of its rules two classes deep, under the frame", () => {
    const parts: string[] = [];
    for (const m of CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const sel = m[1]!.trim();
      if (!/\.hd-dy\b|\.hd-dy-/.test(sel)) continue;
      parts.push(...sel.split(",").map((s) => s.trim()));
    }
    expect(parts.length).toBeGreaterThan(10);
    expect(parts.filter((p) => !/^\.fg \.hd-[\w-]/.test(p))).toEqual([]);
  });

  it("scrolls with its face, never on its own", () => {
    for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\.hd-dy\b|\.hd-dy-/.test(m[1]!)) continue;
      expect(m[2]).not.toMatch(/overflow(-y)?\s*:\s*(auto|scroll)/);
    }
  });

  it("reaches an entry's wash past the column by the entry's own side padding, with the rule on the item", () => {
    const en = rule(".fg .hd-dy-en");
    const [, side] = en.padding!.split(" ");
    expect(en.margin).toBe(`0 -${side}`);
    expect(en["border-bottom"]).toBeUndefined();
    expect(rule(".fg .hd-dy-it")["border-bottom"]).toBe("1px solid var(--hd-rule)");
  });

  /* His prototype's `protoFresh 7s var(--ease) both`: on at once, held to
     75%, gone at the end — the same seven seconds the face keeps it lit. */
  it("lights an entry with his wash, held for three quarters of seven seconds and then faded, and moves nothing", () => {
    const lit = restRule(".fg .hd-dy-en[data-lit]");
    expect(lit).toEqual({ background: "var(--hd-fresh)", animation: "hdDyLit 7s var(--ease) both" });
    expect(DIARY_LIT_MS).toBe(7000);
    const frames = CSS.match(/@keyframes hdDyLit \{((?:[^{}]*\{[^{}]*\})*)\s*\}/);
    expect(frames).not.toBeNull();
    const steps = [...frames![1]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!.trim()]);
    expect(steps).toEqual([
      ["0%, 75%", "background:var(--hd-fresh);"],
      ["to", "background:transparent;"],
    ]);
    // it comes on at once: nothing eases it in
    expect(restRule(".fg .hd-dy-en").transition).toBeUndefined();
  });

  /* The global rule under reduced motion cuts every animation to a
     thousandth of a second, which would put the wash out at once: the
     wash is taken off instead, and the lit rule's own fill stands still. */
  it("stands the wash still under reduced motion", () => {
    const quiet = [...CSS.matchAll(/@media \(prefers-reduced-motion:reduce\) \{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]
      .map((m) => m[1]!)
      .find((body) => body.includes(".hd-dy-"));
    expect(quiet).toBeDefined();
    expect(quiet).toMatch(/\.fg \.hd-dy-en\[data-lit\] \{ animation:none; \}/);
    expect(restRule(".fg .hd-dy-en[data-lit]").background).toBe("var(--hd-fresh)");
    // and a message in a conversation's thread (H17), the same way
    expect(quiet).toMatch(/\.fg \.hd-dy-tr\[data-lit\] \{ animation:none; \}/);
    expect(restRule(".fg .hd-dy-tr[data-lit]").background).toBe("var(--hd-fresh)");
  });

  /* A conversation's thread (H17): his newest message lights on the
     entry's own wash, and its fill reaches past its words by its own
     padding, so they never move when it lights or goes out. */
  it("lights a message in a thread with the entry's wash, reaching past its words by its own padding", () => {
    expect(restRule(".fg .hd-dy-tr[data-lit]")).toEqual(restRule(".fg .hd-dy-en[data-lit]"));
    const tr = rule(".fg .hd-dy-tr");
    const [, side] = tr.padding!.split(" ");
    expect(tr.margin).toBe(`0 -${side}`);
    expect(restRule(".fg .hd-dy-tr").transition).toBeUndefined();
  });

  /* His spacing round a thread, as his v33 renders it at 1440 (H17
     review): 12px from the words above to the first message and from one
     message to the next, and 8px from the last message's words down to the
     doors, as under an ask with no thread. Each message's own padding is
     given back by the space round it. */
  it("keeps his spacing round a thread, whatever a message's own padding", () => {
    const px = (v: string | undefined) => Number((v ?? "").replace(/px$/, "")) || 0;
    const [padY] = rule(".fg .hd-dy-tr").padding!.split(" ").map(px);
    const [top] = rule(".fg .hd-dy-thread").margin!.split(" ").map(px);
    const between = px(rule(".fg .hd-dy-tr + .hd-dy-tr")["margin-top"]);
    const doors = px(rule(".fg .hd-dy-thread + .hd-dy-doors")["margin-top"]);
    expect(padY).toBeGreaterThan(0);
    expect(top + padY).toBe(12);
    expect(padY + between + padY).toBe(12);
    expect(padY + doors).toBe(8);
    // and under an ask with no thread, the doors' own 8px
    expect(px(rule(".fg .hd-dy-doors")["margin-top"])).toBe(8);
  });

  /* His v33 render draws a thread message on the entry's own 32px line
     (its later `.tent .m` outranks the `.tr .m` 24px), with its 24px disc
     at the top of it, and the disc's initials at 12/600: the 700 is only
     the entry's own disc (`.tent>.av2`). */
  it("sets a thread message on the entry's 32px line, its disc 24px at 12/600", () => {
    expect(restRule(".fg .hd-dy-tr .hd-dy-m")["line-height"]).toBeUndefined();
    expect(rule(".fg .hd-dy-m")["line-height"]).toBe("32px");
    const disc = rule(".fg .hd-dy-tr .hd-dy-av");
    expect([disc.width, disc.height, disc["font-weight"]]).toEqual(["24px", "24px", "600"]);
    expect(disc["margin-top"]).toBeUndefined();
    expect(rule(".fg .hd-dy-av")["font-size"]).toBe("12px");
  });

  it("rings a door, and the entry a door lands on, for the keyboard (law 32)", () => {
    expect(rule(".fg .hd-dy-door:focus-visible")).toEqual({ outline: "none", "box-shadow": "var(--ring)" });
    expect(rule(".fg .hd-dy-en:focus-visible")).toEqual({ outline: "none", "box-shadow": "var(--ring)" });
  });

  /* Tiff's line that opens her conversation again, and the entry's Undo,
     are buttons the keyboard lands on too. */
  it("rings Tiff's line and Undo for the keyboard (law 32)", () => {
    expect(rule(".fg .hd-dy-tiff.opens:focus-visible")).toEqual({ outline: "none", "box-shadow": "var(--ring)" });
    expect(rule(".fg .hd-dy-undo:focus-visible")).toEqual({ outline: "none", "box-shadow": "var(--ring)" });
  });

  /* His door (`.dr.real`) is ink on his edge, the line: ink is the one
     link token, and its words are underlined (law 34). */
  it("dresses a door as a link, on the one link token and the line's edge", () => {
    const door = rule(".fg .hd-dy-door");
    expect(door.color).toBe("var(--link)");
    expect(door.border).toBe("1px solid var(--line)");
    expect(door["text-decoration"]).toBe("underline");
  });

  /* ONE UNDO ON THE PAGE: the list's, the modal's and the diary's alike,
     ink, 600 and underlined (law 34), and gone quiet while it is out. */
  it("gives the diary the page's one Undo, which goes quiet while it is out", () => {
    const undo = rule(".fg .hd-dy-undo");
    const list = rule(".fg .hd-ls-undo, .fg .hd-ls-link");
    expect(undo.color).toBe(list.color);
    expect(undo["font-weight"]).toBe(list["font-weight"]);
    expect(undo["text-decoration"]).toBe("underline");
    expect(rule('.fg .hd-dy-undo[aria-disabled="true"]').color).toBe("var(--q)");
  });

  /* Tiff's line is a door where the modal is on: her name wears the link
     token on the line, as the doors do. Where it is not a door it does not. */
  it("underlines Tiff's name where her line is a door, and only there", () => {
    expect(rule(".fg .hd-dy-tiff b").color).toBe("var(--hd-ink)");
    expect(rule(".fg .hd-dy-tiff b")["text-decoration"]).toBeUndefined();
    expect(rule(".fg .hd-dy-tiff.opens b")["text-decoration"]).toBe("underline");
  });

  /* The place Undo's sentence is written into is there before it is said
     (a live region mounted with its words is often not read out), and
     takes no room in the row while it is empty. */
  it("keeps Undo's sentence place out of the row while it is empty", () => {
    expect(rule(".fg .hd-dy-said:empty")).toEqual({ position: "absolute" });
  });
});
