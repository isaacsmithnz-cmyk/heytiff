-- Smart Notes — the tables behind "a note is a call to action, not a notepad".
--
-- THE SHAPE OF THE FEATURE: someone dictates or pastes a note. It is
-- transcribed, then routed by a Claude call into three lanes —
--
--   ACTION  tasks (through the EXISTING tasks table, so assignment and
--           notification come free), bring-items, and board flags
--   DATA    dated progress bullets, commissioning entries, a recurring-issue
--           log, or simply a note that is allowed to be a note
--   ASK     a clarifying question back to the author when intent, target or
--           assignee is genuinely ambiguous
--
-- NOTHING AUTO-APPLIES. The parsed proposal is reviewed and confirmed by a
-- human first; `workboard_notes.status` tracks that, and `applied` records
-- exactly what the confirmation created so the outcome is auditable back to
-- the sentence that caused it.
--
-- WHY THE TRANSCRIPT IS STORED AND THE AUDIO IS NOT: the transcript is the
-- evidence for what was applied. The recording is a voice in a customer's
-- house — it buys nothing once transcribed and is a liability to keep.
--
-- POSTURE: RLS ON, NO policies (deny-all house-wide); composite FKs carry
-- org_id so a note can never point at another workspace's project.
--
-- APPLY THIS BEFORE MERGING THE PR.

create table if not exists public.workboard_notes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,

  -- Who dictated it. Kept as provenance; survives them leaving.
  author_id     uuid,

  -- What it was about. 'none' is legitimate: a note captured from the board
  -- with no project or visit in mind yet.
  target_kind   text not null default 'none'
                  check (target_kind in ('none', 'project', 'visit', 'agreement')),
  target_id     uuid,

  -- The words. Whether typed or spoken, this is what the brain read.
  transcript    text not null,
  source        text not null default 'text' check (source in ('text', 'voice')),

  status        text not null default 'pending'
                  check (status in ('pending', 'clarifying', 'applied', 'dismissed')),

  -- The brain's proposal, verbatim, and what the human's confirmation
  -- actually created (task ids, flag ids, entry ids). Two different facts:
  -- one is what was suggested, the other is what exists because of it.
  proposal      jsonb,
  applied       jsonb,

  created_at    timestamptz not null default now(),
  applied_at    timestamptz,

  constraint workboard_notes_author_fkey
    foreign key (author_id, org_id)
    references public.staff_profiles(id, org_id) on delete set null (author_id)
);

create index if not exists workboard_notes_org_status_idx
  on public.workboard_notes (org_id, status);
create index if not exists workboard_notes_org_target_idx
  on public.workboard_notes (org_id, target_kind, target_id);

-- Three tables below carry a composite FK to this pair, so the unique index
-- has to exist before they are created — not at the end of the file.
create unique index if not exists workboard_notes_id_org_uniq
  on public.workboard_notes (id, org_id);

-- The things that pulse on the Overview board until somebody deals with them.
create table if not exists public.workboard_flags (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  id            uuid primary key default gen_random_uuid(),

  target_kind   text not null default 'none'
                  check (target_kind in ('none', 'project', 'visit', 'agreement')),
  target_id     uuid,

  message       text not null,
  severity      text not null default 'warn' check (severity in ('info', 'warn', 'urgent')),
  active        boolean not null default true,

  -- Traceable back to the sentence that raised it.
  note_id       uuid,
  cleared_by    uuid,
  cleared_at    timestamptz,
  created_at    timestamptz not null default now(),

  constraint workboard_flags_note_fkey
    foreign key (note_id, org_id)
    references public.workboard_notes(id, org_id) on delete set null (note_id),
  constraint workboard_flags_cleared_by_fkey
    foreign key (cleared_by, org_id)
    references public.staff_profiles(id, org_id) on delete set null (cleared_by)
);

create index if not exists workboard_flags_org_active_idx
  on public.workboard_flags (org_id, active) where active;

-- "This unit keeps tripping." The memory that makes a recurring fault
-- visible as a pattern instead of four unconnected visits.
create table if not exists public.workboard_issues (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,

  target_kind   text not null default 'none'
                  check (target_kind in ('none', 'project', 'visit', 'agreement')),
  target_id     uuid,
  -- Free text rather than an FK: the unit is often named before it is ever
  -- entered as an equipment row ("the middle rooftop one").
  equipment_ref text,

  summary       text not null,
  first_seen    date not null default current_date,
  last_seen     date not null default current_date,
  occurrences   integer not null default 1,
  resolved      boolean not null default false,
  created_at    timestamptz not null default now(),

  constraint workboard_issues_id_org_uniq unique (id, org_id)
);

create index if not exists workboard_issues_org_target_idx
  on public.workboard_issues (org_id, target_kind, target_id) where not resolved;

-- Commissioning readings and dated progress bullets. One table because they
-- are the same shape — a dated line attached to a project — and telling them
-- apart is a `kind`, not a schema.
create table if not exists public.project_entries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  project_id    uuid not null,

  kind          text not null check (kind in ('progress', 'commissioning')),
  body          text not null,
  -- Which unit the reading belongs to, when the note named one.
  equipment_id  uuid,
  entry_date    date not null default current_date,
  note_id       uuid,
  created_by    uuid,
  created_at    timestamptz not null default now(),

  constraint project_entries_project_fkey
    foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade,
  constraint project_entries_note_fkey
    foreign key (note_id, org_id)
    references public.workboard_notes(id, org_id) on delete set null (note_id),
  constraint project_entries_author_fkey
    foreign key (created_by, org_id)
    references public.staff_profiles(id, org_id) on delete set null (created_by)
);

create index if not exists project_entries_org_project_idx
  on public.project_entries (org_id, project_id, kind);

alter table public.workboard_notes  enable row level security;
alter table public.workboard_flags  enable row level security;
alter table public.workboard_issues enable row level security;
alter table public.project_entries  enable row level security;
-- deliberately no policies: deny-all to the public keys (house posture)
