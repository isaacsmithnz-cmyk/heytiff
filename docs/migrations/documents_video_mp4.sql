-- A job's video from the phone's own camera (Isaac, 10 November 2026: video
-- "up to a minute", approved 11 November). The documents bucket's allowlist
-- gains video/mp4 beside the photos and PDFs; the app only lets a job photo
-- be one (lib/documents/files VIDEO_TYPES). 720p at 4 Mbps keeps a minute
-- near 30 MB, under the bucket's 50 MB.
update storage.buckets
   set allowed_mime_types = array(select distinct unnest(allowed_mime_types || array['video/mp4']))
 where id = 'documents';
