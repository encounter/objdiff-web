# objdiff-web — notes for AI agents

This repository contains three things:

| Part | Path | What it is |
|---|---|---|
| Web UI | `webview/` | React app, also used as the VS Code webview |
| VS Code extension | `src/` | Extension host code |
| **Diff API** | `server/` | HTTP API for querying match percentages and diffs |

Diffing is done by `objdiff-wasm`, a WebAssembly build of `objdiff-core`. Nothing
in this repo computes match percentages itself.

## If you want to check whether a function matches

Use the API. Start it from the repository root:

```bash
OBJDIFF_PROJECT_ROOT=/path/to/decomp-project pnpm api:dev
```

Then read the full usage guide — it is written for you, not for humans:

```bash
curl http://localhost:3001/api/instructions
```

The short version:

```bash
curl "http://localhost:3001/api/match?unit=src/math.c&symbol=compute"
```
```bash
curl "http://localhost:3001/api/diff.txt?unit=src/math.c&symbol=compute"
```

`/api/openapi.json` describes every endpoint if you generate clients from
OpenAPI. `/llms.txt` serves the same guide as `/api/instructions`.

Like the desktop app, the API builds on demand:

| Variable | Default | Effect |
|---|---|---|
| `OBJDIFF_ALLOW_BUILD` | `1` | `POST /api/build?unit=…` runs the project's own `custom_make`/`custom_args` from `objdiff.json`. Set to `0` to make the API read-only |
| `OBJDIFF_WATCH` | `1` | Watches the project's `watch_patterns` and rebuilds the most recently queried unit on change — the same as "Rebuild on changes" in the desktop app. Set to `0` to disable |

Both run a real process from the project config, so turn them off if this port
is ever reachable by anything other than you. `GET /api/health` reports
`buildEnabled` and the current watch status.

## Working on the code

```bash
pnpm install          # once
pnpm dev              # web UI on :3000 + API on :3001, /api proxied — use this
pnpm web:dev          # web UI only (file-serving mock, no building)
pnpm api:dev          # API only
pnpm check            # Biome lint + format
pnpm extension:build  # VS Code extension
```

Set `OBJDIFF_PROJECT_ROOT` to your decomp project before any of these.

Things worth knowing before editing:

- **`shared/render/`** holds the segment→spans logic used by the React views,
  the HTML renderer and the plain-text renderer. Change it there, never in one
  consumer only, or the three outputs will drift apart.
- **`shared/` and `server/` each carry a `package.json` with `"type": "module"`.**
  That is deliberate: `objdiff-wasm` uses top-level await, so it can only be
  loaded from an ES module. Do not remove them.
- **`server/wasm.ts` must be imported before anything that touches
  `objdiff-wasm`.** It bridges `file:` URLs to the filesystem, which the WASM
  loader needs under Node.
- `package.json`'s `contributes.configuration` block is **generated** by
  `update-config.ts` from `objdiff-wasm`'s config schema. Do not hand-edit it.
- Left/target = the original object being reproduced. Right/base = the object
  built from the current source.
