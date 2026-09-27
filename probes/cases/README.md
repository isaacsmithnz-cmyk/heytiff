# Probe cases

`questions.json` feeds probe P1 (`TIFF_PROBE=p1 npm run probe:tiff`). Git ignores it, because a question about a job names its client.

The shape is a list of questions, each with what a good answer rests on:

```json
[{ "ask": "Who's carrying the most right now?", "expect": "open_task_load, names and counts" }]
```

The notes the probes read come straight from the database, so they are never written here.
