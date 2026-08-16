-- The Material picklist a Studio design pushes onto a HeyTiff job card.
--
-- WHY OURS AND NOT SERVICEM8'S. The job sheet already shows "Their checklist"
-- straight out of the SM8 mirror, and that mirror is READ-ONLY — we cannot
-- write a checklist item into ServiceM8 today. This table is the HeyTiff side:
-- our own list, on our own job card, tickable by our own staff. When SM8
-- writes eventually land, this stays the source and pushes outward; it does
-- not become a mirror of theirs.
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for exactly the reason
-- studio_designs_sm8_job.sql spells out: sm8_jobs is a DISPOSABLE CACHE of
-- somebody else's system, wiped and re-walked, and nothing may FK into it. A
-- picked list must survive its mirror row disappearing — the job still exists
-- in ServiceM8 and the materials are still on the van.
--
-- design_id IS a real FK with ON DELETE SET NULL. The list is derived FROM a
-- design, so knowing which one earns a link — but deleting the design must not
-- delete a list somebody has already ticked their way through in a warehouse.
-- The row keeps its name/description/qty because those are COPIED, not joined:
-- a picklist is a snapshot of what was ordered, and re-deriving it from a
-- design that has since changed would rewrite history under the picker.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: a new table nothing reads yet.

create table if not exists public.job_picklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- the ServiceM8 job this list belongs to (mirror uuid; see above)
  sm8_job_uuid text not null,
  -- the design it was pushed from; null once that design is deleted.
  -- TEXT, because studio_designs.id is text (client-minted design ids).
  design_id text,
  -- snapshot of the picklist row at push time — never re-derived
  name text not null,
  sub text not null default '',
  qty text not null default '',
  -- ordering within the list, as the sheet listed it
  position integer not null default 0,
  picked boolean not null default false,
  picked_at timestamptz,
  picked_by text,
  added_at timestamptz not null default now(),
  added_by text not null,
  -- Composite, carrying org_id, so a list can never cite another workspace's
  -- design — the pattern staff_notes.sql uses for the same reason. Column
  -- order follows studio_designs' PRIMARY KEY (org_id, id).
  --
  -- `set null (design_id)` names its column: a bare ON DELETE SET NULL would
  -- try to null org_id too, which is NOT NULL, and every design delete would
  -- fail. Same shape as staff_notes' source_note_id.
  constraint job_picklist_items_design_fk
    foreign key (org_id, design_id)
    references public.studio_designs (org_id, id) on delete set null (design_id)
);

comment on table public.job_picklist_items is
  'HeyTiff-side material picklist on a job card, pushed from a Studio design''s Material picklist and ticked by staff. Not a mirror of ServiceM8''s checklist — SM8 is read-only; this is ours.';
comment on column public.job_picklist_items.sm8_job_uuid is
  'sm8_jobs.uuid of the job. Deliberately NOT a foreign key: the mirror is disposable and a ticked list outlives it.';
comment on column public.job_picklist_items.name is
  'Snapshot of the item at push time. Never re-derived from the design — a picklist records what was ordered.';

-- The read this exists for: every item on a job, in the order it was listed.
create index if not exists job_picklist_items_job_idx
  on public.job_picklist_items (org_id, sm8_job_uuid, position);

-- "has this design already been pushed?" — so the sheet can say so instead of
-- silently duplicating the list on a second click.
create index if not exists job_picklist_items_design_idx
  on public.job_picklist_items (org_id, design_id)
  where design_id is not null;

-- RLS deny-all, enforcement app-layer, same as every other table here: the
-- service role is the only path in and every server action re-checks the org
-- and the capability for itself.
alter table public.job_picklist_items enable row level security;
