-- ── Tiff's name for a conversation (2026-11-22) ──
-- Isaac, 22 November 2026: "can we also give chats a better title?". A thread
-- was named by its first words, cut short. Once she has answered, Tiff names
-- it in a few words (lib/tiff/thread-title, thread-name), kept here apart from
-- `title`, which the phone and the browser keep sending as the first words, so
-- they never write over hers. A title somebody typed (Rename) wins over it.
-- Adds a column and nothing else.
alter table public.tiff_threads add column if not exists named text check (named is null or char_length(named) between 1 and 60);
