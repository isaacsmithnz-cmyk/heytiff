-- The picklist generalises into the job's own running checklist
-- (job-card redesign, slice 3). A row's KIND names its fixed section:
--
--   material — something to bring, quantity-bearing. The Studio's design
--              push writes these, and always has: every existing row is a
--              pushed material, which is what makes the default a backfill.
--   todo     — tickable work, typed straight onto the job card.
--
-- One column, not a sections table: the face draws exactly two sections by
-- design, so free-text sections would be a place for drift, not a feature.
-- ServiceM8's own checklist stays in its mirror table and renders read-only
-- at the foot of the face — it never mixes into these rows.

alter table public.job_picklist_items
  add column if not exists kind text not null default 'material'
    constraint job_picklist_items_kind_check check (kind in ('material', 'todo'));
