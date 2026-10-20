-- Documents up to 50 MB a file (Isaac, 2026-10-21): an architect's tender
-- set (7 Cutler Rd, 16 MB) couldn't go on its job at 10. The app holds the
-- same number (src/lib/documents/files.ts MAX_BYTES); the bucket is the
-- second place it is held. Files go to storage on a signed upload, so no
-- server body limit stands in front of it.
--
-- The project's global Storage upload limit (Dashboard > Storage > Settings)
-- must be at least this, or storage refuses the bytes before this applies.

update storage.buckets
set file_size_limit = 52428800 -- 50 MB
where id = 'documents';
