-- What Tiff is doing this second, while a turn is under way (Isaac, 14
-- November 2026: "Just get it all built", to the streamed call: the working
-- word following her real steps and her reply typing out). Her call to the
-- model is streamed; the turn keeps here, a few times a second, the tool she
-- is on and the words of her reply so far, as {turn, tool, text, at}. The
-- thread's polls read it with the session's head; it is cleared when the turn
-- ends. Nothing else reads it, and a row without it is a turn not streaming.
-- APPLIED 14 November 2026.
alter table public.quote_sessions add column if not exists live jsonb;
