# objdiff API — instructions for AI agents

You are talking to a local HTTP API that diffs compiled object files for a
decompilation project. It tells you **how closely a function you wrote matches
the original**, and **exactly which instructions differ**.

Base URL: `http://localhost:3001` (override the port with `PORT`).
Every endpoint is `GET`. Every response is JSON unless stated otherwise.

## Core concepts

- **unit** — one translation unit (one `.c`/`.cpp` file and its `.o`). Listed in
  the project's `objdiff.json`. Identify it by its `name` (e.g. `src/math.c`).
- **target** (also called *left* or *expected*) — the **original** object you are
  trying to reproduce. This is the reference.
- **base** (also called *right* or *current*) — the object built from the source
  code as it is **right now**. This is your work.
- **matchPercent** — how much of the target the base reproduces, `0`–`100`.
  `100` means the function is done. It always comes from the target side; a
  symbol that exists only in the base has no percentage.

## Which endpoint should I call?

| Your question | Call |
|---|---|
| Does function `X` match yet? | `GET /api/match?unit=…&symbol=X` |
| Why doesn't it match? | `GET /api/diff.txt?unit=…&symbol=X` — **cheapest, prefer this** |
| I want to reason about rows programmatically | `GET /api/diff.json?unit=…&symbol=X` |
| Show it to a human | `GET /api/diff.html?unit=…&symbol=X` |
| I don't know the exact symbol name | `GET /api/symbols?unit=…&q=partial` |
| What's left in this file? | `GET /api/unit?unit=…` |
| What files exist? | `GET /api/units` |
| Is the server up? | `GET /api/health` |
| Rebuild before checking | `POST /api/build?unit=…` (only if `buildEnabled`) |

**Typical loop:** edit source → rebuild the project → `GET /api/match` → if
`matchPercent < 100`, `GET /api/diff.txt` to see which rows differ → edit again.

> By default the API only **reads** `.o` files from disk. Rebuild the project
> yourself between edits, or you will read stale results. If the server was
> started with `OBJDIFF_ALLOW_BUILD=1`, you can rebuild through it with
> `POST /api/build?unit=…` — check `buildEnabled` in `GET /api/health` first.

If every `matchPercent` comes back `null`, one of the two objects is missing.
Check `targetError` / `baseError` on `GET /api/unit` — they name the exact path
that could not be read.

## Endpoints

### `GET /api/match` — does this function match?

The endpoint you will use most.

```
curl "http://localhost:3001/api/match?unit=src/math.c&symbol=compute"
```

```json
{
  "unit": "src/math.c",
  "symbol": "compute",
  "demangledName": null,
  "section": ".text",
  "kind": "function",
  "matchPercent": 87.5,
  "isMatch": false,
  "target": { "found": true, "rowCount": 24, "size": 96, "address": "0x0" },
  "base":   { "found": true, "rowCount": 24, "size": 96, "address": "0x0" },
  "instructions": {
    "total": 24, "matching": 21, "opMismatch": 1, "argMismatch": 2,
    "replaced": 0, "inserted": 0, "deleted": 0
  },
  "warnings": [],
  "links": { "html": "...", "text": "...", "json": "..." }
}
```

- `isMatch` is `true` only at 100%.
- `matchPercent: null` with `target.found: false` means the symbol exists only in
  your build — usually a naming mistake, or a function that should not exist.
- `instructions` is `null` for data symbols.

### `GET /api/diff.txt` — why doesn't it match?

Returns `text/plain`: two columns, target on the left, base on the right, with a
one-character gutter between them.

```
curl "http://localhost:3001/api/diff.txt?unit=src/math.c&symbol=compute"
```

```
symbol:  compute
unit:    src/math.c
match:   87.50%

TARGET (expected)                                          BASE (current)
---------------------------------------------------------- ------------------
0:  push rbp                                                 0:  push rbp
4:  sub  rsp, 0x20                                         ! 4:  sub  rsp, 0x30
...

24 rows: 21 matching, 1 opcode mismatch, 2 argument mismatch, 0 replaced, 0 inserted, 0 deleted
gutter: ! opcode  ~ argument  | replaced  + inserted  - deleted
```

Gutter markers: `!` opcode differs, `~` an argument differs, `|` replaced,
`+` only in base, `-` only in target, blank = identical.

**Prefer this over `/api/diff.html` when reading the diff yourself** — it costs a
fraction of the tokens.

### `GET /api/diff.json` — structured rows

Functions only. Same rows as `diff.txt`, but each side is
`{ "text": "...", "diffKind": "none" | "op-mismatch" | "arg-mismatch" | "replace" | "insert" | "delete" }`,
plus the same `instructions` counts as `/api/match`.

```
curl "http://localhost:3001/api/diff.json?unit=src/math.c&symbol=compute"
```

To find just the problem rows, keep those where either side's `diffKind` is not
`"none"`.

### `GET /api/diff.html` — for humans

Returns a self-contained HTML page: the symbol name, a large match percentage
with a progress bar, both columns colored exactly like the objdiff UI, and a
summary in the footer. No external assets, so it can be saved or opened directly.

- `theme=auto|light|dark` (default `auto`, follows the viewer's OS setting)
- `embed=1` returns only the fragment plus its `<style>`, for embedding in
  another page.

### `GET /api/symbols` — search

```
curl "http://localhost:3001/api/symbols?unit=src/math.c&q=comp&limit=10"
```

| Parameter | Default | Meaning |
|---|---|---|
| `unit` | all units | Unit name. Omit it or pass `*` to search the whole project (slow — every unit is parsed and diffed) |
| `q` | `""` | The query. Empty lists everything |
| `mode` | `fuzzy` | `fuzzy`, `substring` or `regex` |
| `caseSensitive` | `false` | |
| `section` | all | Exact section name, e.g. `.text` |
| `minPercent` / `maxPercent` | none | Bounds on `matchPercent`. **`maxPercent=99.99` finds unfinished work** — symbols with no percentage (no target counterpart) pass `maxPercent` but never `minPercent` |
| `limit` / `offset` | `50` / `0` | Pagination. `total` is the count before slicing |

Results are ranked by fuzzy score when `mode=fuzzy` and a query is given;
otherwise least-matched first, which is usually the useful order.

Both mangled and demangled names are searched.

### `GET /api/unit` — progress for one file

Overall size-weighted `matchPercent`, then every section with its own percentage
and its symbols. Use `maxPercent` on `/api/symbols` instead if you only want the
unfinished ones — this response can be large.

### `GET /api/units` — list files

Names, paths and completion flags from `objdiff.json`.

### `POST /api/build` — rebuild a unit

**POST, not GET.** Disabled unless the server was started with
`OBJDIFF_ALLOW_BUILD=1`; otherwise it returns `BUILD_DISABLED` (403).

Runs the project's own build command — `[custom_make] [custom_args] <object path>`
from `objdiff.json`, with the project root as the working directory — exactly as
the objdiff desktop app and the VS Code extension do. Only paths already listed
in `objdiff.json` are passed through, so you cannot build an arbitrary file.

```
curl -X POST "http://localhost:3001/api/build?unit=src/math.c"
```

```json
{
  "unit": "src/math.c",
  "ok": true,
  "steps": [
    { "side": "base", "command": "py", "args": ["tools/build_obj.py", "..."],
      "exitCode": 0, "stdout": "", "stderr": "", "durationMs": 1840 }
  ],
  "next": "/api/match?unit=src%2Fmath.c&symbol=…"
}
```

On a compiler error you get HTTP 422, `ok: false`, and the failing step's
`stderr` — that is where the actual error message is. Times out after two
minutes (`OBJDIFF_BUILD_TIMEOUT_MS`).

The diff cache keys on each object's mtime and size, so the next `/api/match`
after a successful build automatically sees the new object.

**Watch mode.** If the server was also started with `OBJDIFF_WATCH=1`, it watches
the project's `watch_patterns` and rebuilds the most recently queried unit
whenever a source file changes — so after editing you can often go straight to
`/api/match` without calling `/api/build` at all. `GET /api/health` reports
`watch.lastTrigger` and `watch.lastBuild`, which tell you whether the rebuild
that matters to you has already happened.

### `GET /api/health`

```json
{ "ok": true, "objdiffVersion": "3.7.3", "projectRoot": "…", "unitCount": 42 }
```

`ok: false` with a `configError` means the project root is wrong — the server
could not find `objdiff.json`.

## Disassembly options

Any endpoint that parses objects accepts objdiff config properties as query
parameters, for example `?x86.formatter=gas`, `?functionRelocDiffs=all`,
`?demangler=none`, `?analyzeDataFlow=true`. Unknown values are rejected with
`INVALID_CONFIG`. Leave them alone unless you know you need them — the defaults
match what the UI shows.

## Errors

Every failure is JSON with the same shape and a matching HTTP status:

```json
{ "error": { "code": "SYMBOL_NOT_FOUND", "message": "…", "hint": "…" } }
```

| Code | Status | What to do |
|---|---|---|
| `MISSING_PARAMETER` | 400 | Add the named query parameter |
| `INVALID_PARAMETER`, `INVALID_MODE`, `INVALID_REGEX`, `INVALID_CONFIG` | 400 | Fix the value; the message says what is accepted |
| `NOT_A_FUNCTION` | 400 | Use `/api/diff.txt` or `/api/diff.html` for data symbols |
| `PATH_OUTSIDE_PROJECT` | 403 | The path escaped the project root |
| `UNIT_NOT_FOUND` | 404 | Call `/api/units` and use one of those names |
| `SYMBOL_NOT_FOUND` | 404 | Call `/api/symbols?q=…` to find the real name |
| `NO_OBJECTS` | 404 | Neither object is built — run the project's build |
| `NO_PROJECT_CONFIG` | 500 | `OBJDIFF_PROJECT_ROOT` points somewhere without `objdiff.json` |
| `PARSE_FAILED` | 422 | Both object files are unreadable or corrupt |

Always read `hint` — it usually names the exact next call to make.

## Cost guidance

- `/api/match` is small. Call it freely.
- `/api/diff.txt` scales with function length. Fine for one function.
- `/api/diff.html` is several times larger than `.txt`. Only fetch it when a
  human will look at it; otherwise just hand over the URL.
- `/api/unit` on a large object, and `/api/symbols` without `unit`, are the two
  expensive calls. Use `limit` and `maxPercent` to narrow them.
