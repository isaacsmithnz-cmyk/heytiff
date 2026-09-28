# Tiff's eval cases

`npm run evals:tiff` runs every `*.json` here except `example.json`. Git ignores them: they name real people and clients. Each file holds one case or a list. The shape is `EvalCase` in `src/lib/tiff/evals/score.ts`; `example.json` shows one.

A case is graded on what Tiff did (tools, moves, words or none), never on her wording. A paid run is Isaac's call: each case costs about 2 to 4c US, and the run stops at `TIFF_EVALS_MAX_USD` (default 2).
