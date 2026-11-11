-- The documents bucket must accept plain text: the phone's bugs.
--
-- WHY. lib/mobile/bugs holds a bug's number by writing its 0012.txt first
-- (when, which page, the app's version, the note), and the bucket's allowlist
-- had no text/plain, so every tap was refused and the phone said "Couldn't
-- save the bug." (Isaac, 11 November 2026: "There's literally a bug with the
-- bug"). Same trap as documents_bucket_avif.sql. video/mp4 was already in the
-- live list; it's written here too so this file is the whole list.
--
-- ALREADY APPLIED to prod 2026-11-11.

update storage.buckets
set allowed_mime_types = array[
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/jpeg',
  'video/mp4',
  'application/pdf',
  'text/plain'
]
where id = 'documents';
