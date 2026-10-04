-- THE BUSINESS'S USUAL DUCTWORK (Isaac, 2026-10-04: "We don't have a 5
-- spigot plenum… Normal path is btos and ys"; "Some companies might"; "The
-- brief will decide all of this").
--
-- The brief decides the layout; this is only for a brief that doesn't
-- describe one. Each business says how it usually runs it: trunks off the
-- unit stepped down through BTOs and Ys, or a plenum with a spigot each. Null:
-- not set, and a brief without a layout has it asked.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: one new nullable column nothing reads
-- yet.

alter table public.quote_settings add column if not exists usual_layout text;
alter table public.quote_settings drop constraint if exists quote_settings_usual_layout_check;
alter table public.quote_settings
  add constraint quote_settings_usual_layout_check check (usual_layout is null or usual_layout in ('trunks', 'plenum'));

comment on column public.quote_settings.usual_layout is
  'How the business usually runs ductwork when a brief doesn''t say: trunks (BTOs and Ys) or plenum (a spigot each). Null: asked.';
