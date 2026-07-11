# Design Brief — Tiff AI & Knowledge Base (v2)

*Scope to hand to Claude design. Goal: take Tiff AI + Knowledge Base from the current staged preview to the real product surfaces. Deliverable: a standalone HTML/CSS/JS prototype (same handoff format as Time & Pay — self-contained, realistic interactions faked with local state) that dev then ports into the Next.js app.*

---

## 1. Product context

HeyTiff is an operating system for small HVAC trade businesses (5–30 people). Tiff AI is its intelligence layer: an assistant that answers **from the company's own knowledge** — install procedures, fault-code libraries, manufacturer manuals, and company SOPs — not from general knowledge. The Knowledge Base (KB) is not a side feature; it is Tiff's substrate. Every Tiff answer should be traceable to a KB document.

Two personas:
- **Office (desktop):** owner/admin managing the KB, reviewing threads, asking design/process questions.
- **Field tech:** needs a fault code answered in under 30 seconds with a citation they can trust before ordering a $400 part. Today they'll do this on a laptop/desktop; a dedicated mobile experience comes later, with the mobile shell.

**This pass is desktop-first.** Design for the desktop shell. Mobile is out of scope (see §5) — just avoid layouts that could never stack (no fixed multi-column dependencies in the conversation surface itself).

**This is a UI redesign pass, not a patch.** The current Tiff and KB screens (described in §2) are a starting point and visual reference, not a template. You are free to rework the layout, hierarchy, and interaction patterns of everything inside the content area — keep what earns its place, replace what doesn't. The only hard lines are the constraints in §3 and the fixed product structure noted in §2.

## 2. What exists today (reference, not a template)

What's fixed vs. what's yours to redesign:

- **Fixed:** the v3 shell (sidebar, topbar, ⌘K palette) is shipped and **must not be redesigned**. Tiff screens render inside the shell's content outlet.
- **Fixed:** the 4 KB categories are product structure: **Install procedures** (teal #00E5C0) · **Fault code library** (blue #2E68FF) · **Manufacturer specs** (amber #f59e0b) · **Company SOPs** (violet #8A2BE2). Their colours are established; their presentation is not.
- **Yours to redesign** — the current v1 screens, for reference:
  - Tiff page: dark ink hero ("What are we building today?"), 4 suggestion cards (category/title/desc), glowing chat input, right sidebar (340px) with Knowledge Base category rows (label + count) and Recent Threads. Conversation view: dark user bubbles right, white Tiff bubbles left with bot avatar, 3-dot typing indicator.
  - KB page: 4 category cards (Toolbox-style: colour top bar, icon, doc rows with kind badge PDF/Doc/Sheet), search box, breadcrumb back to Tiff.

  None of these layout decisions are load-bearing. The sidebar could become something else, the hero could shrink or go, the KB could stop being a card grid — judge each against the scope in §4 and redesign where the v2 requirements (citations, uploads, processing states) outgrow the v1 shapes.

## 3. Hard constraints (violations have burned us before)

1. **Typography: Plus Jakarta Sans only. No monospace anywhere** — not for numbers, badges, codes, or "techy" accents. If the old v3 CSS uses `var(--mono)`, do not carry that pattern forward.
2. **Do not touch the shell** — no changes to sidebar, topbar, page-entrance animations, or the `.page`/`.stg` structure. Design only what lives inside the content area.
3. **Modals/overlays must be viewport-fixed and portal-friendly** (they will be portalled to `<body>` in the app — design them as full-viewport overlays, never positioned relative to a page container).
4. Existing tokens: ink #050505 · teal #00E5C0 (dark #00A389) · blue #2E68FF (Tiff's accent) · violet #8A2BE2 · red #FF3366 · orange #FF8A00 · light bg, white cards, 24–40px radii, soft shadows. Light theme only.
5. Real interaction over decoration: no fake data claims in copy (no "trained on 1,240 jobs"); every state must be designable with real data or an honest empty state.

## 4. Scope — surfaces & states to design

### A. Tiff assistant — conversation (the core surface)
- **Answer with citations.** Every Tiff answer can carry 0–3 source references to KB documents (doc title + category colour + page/section where available). Design: how citations appear inline or beneath the answer, and what tapping one does (peek panel with the doc excerpt → "Open in Knowledge Base"). Citations are the trust mechanism — make them prominent but not noisy.
- **Streaming state:** answer arriving progressively (not just the 3-dot indicator — design mid-stream appearance).
- **Answer quality states:** (1) confident answer with sources · (2) "found nothing in your KB" — honest miss, offers what to upload to fix it · (3) error/retry (model unreachable).
- **Follow-up suggestions:** 2–3 tappable follow-up chips after an answer.
- **Thread management:** rename, delete (confirm), and a "new chat" affordance; thread list states: active, hover, unread(?), empty.
- **Long answers:** tables (e.g. pressure/temp tables), step lists (SOP procedures), and code-like fault sequences — all in Jakarta, no mono.

### B. Tiff assistant — landing
- Rethink the landing freely. Requirements: a clear prompt to start asking, suggestions that read as *categories of question Tiff is good at* (diagnostics, system design, fault codes, company SOP), and visibility of the KB + recent threads. Whether that's the current hero/cards/sidebar arrangement or something else entirely is your call.
- First-run vs returning: returning users with threads should get a lighter entry (resume matters more than the hero).

### C. Knowledge Base — library management
- **Upload flow (Manager+ only):** drag-drop + file picker, multi-file; per-file category assignment (with a sensible guess pre-selected); title/source/edition metadata edit. Files are PDF/DOCX/XLSX/images.
- **Processing pipeline states per document:** uploading → processing (being indexed for Tiff) → ready → failed (with retry). The processing state matters — a doc that isn't "ready" can't be cited yet, and users need to see that distinction.
- **Document row/detail:** title, category, kind, source, edition, updated, uploader, status; actions: view (opens the file), edit metadata, re-categorise, archive/delete (Owner; confirm).
- **Search:** live filter across all categories, showing match context (which doc, which category).
- **Browsing:** must work at both extremes — 2 docs total on day one, and 20+ per category a year in. Card grid, list, table, or a hybrid: your call, but design both densities.
- **Per-role rendering:** Staff = read/search/ask only (no upload/edit affordances) · Manager = upload/edit · Owner = + delete. Design the Staff (stripped) and Manager (full) variants of the page.

### D. "Ask Tiff" entry points (pattern, one instance each)
- **⌘K palette:** an "Ask Tiff…" row that carries typed text straight into a new thread.
- **Ask-about-this:** a small affordance pattern for other pages to deep-link into Tiff with context pre-filled (design one example: from a KB document → "Ask Tiff about this document"). This pattern later serves fault rows, Studio designs, etc.

### E. Empty & edge states (all of them, not as an afterthought)
- KB with zero documents (the real day-1 state): should sell *why* to upload — "Tiff can only answer from what's here."
- Empty thread list; first message of a first thread.
- A category with 0 docs while others have many.
- Upload failure; processing stuck; searching with no results.

## 5. Explicitly out of scope (do not design)

- **Mobile layouts** — this pass is desktop-only. The mobile shell doesn't exist yet; mobile chat gets its own brief later. (Just keep the conversation surface stackable in principle.)
- Voice input, photo/nameplate capture (later wave).
- Job linking / jobs entity (data model not settled).
- Admin "Documents" section merge (KB docs will share the backend documents store, but only KB surfaces are being designed now).
- Model behaviour/prompting; anything server-side.
- Dark theme; tablet-specific layouts.
- The Toolbox "Reference Library" category (it will later point at the KB — no design needed).

## 6. Data shapes to design against

```
Document: { title, category: install|faults|specs|sops, kind: PDF|Doc|Sheet|Image,
            source, edition?, updated, uploader, status: uploading|processing|ready|failed }
Thread:   { title, updatedAt, messages[] }
Message:  { role: user|tiff, text (rich: paragraphs, steps, tables),
            citations?: [{ docTitle, category, page? }], followups?: [string] }
```

## 7. Acceptance checklist for the handoff

- [ ] Every surface has empty, loading, error, and populated states.
- [ ] Citations: visible on the answer, peekable, and linkable to the KB doc.
- [ ] Staff vs Manager variants of the KB page shown.
- [ ] No monospace font anywhere; Jakarta only.
- [ ] All overlays are full-viewport/portal-safe.
- [ ] Shell untouched; everything lives inside the content outlet.
- [ ] Prototype interactions run on local state (like the Time & Pay handoff) so dev can read intended behaviour from the code.
