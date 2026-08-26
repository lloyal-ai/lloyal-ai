# Template integration battery

Real-model gates for scaffolded harnesses (the G3/G4 gates of the promotion
arc) — the same tier liblloyal calls `tests/integration/`.
These are NOT part of `npm test` — they need a scaffold with resident model
weights and drive it headless over the desktop ipc surface (`RR_BRIDGE=1`
fork + `{t:"command",payload}` frames; the pipe surface is emit-only).

Usage: scaffold a project (`lloyal new`), put weights in `models/`, build it,
then run a driver FROM THE SCAFFOLD's directory:

    cd <scaffold> && npm run build
    node <this dir>/drive-produce.cjs

Every driver provisions its own fixtures (temp corpus dirs, the version-2
harness.json, the yml `abilities:` block) and restores what it touched on
exit. Two caveats: `drive-refuse` refuses to run if a real `harness.json`
exists (it would clobber your state — delete or move it first), and
`drive-ymlcorpus` rewrites `harness.yml` around the run (committed scaffolds
only; it restores the original bytes on exit).

Drivers fork `dist/targets/cli/index.js` (basic, plain tsc) or
`dist/targets/cli/index.mjs` (research, esbuild) — each script hardcodes the
entry it targets.

| script | template | asserts |
|---|---|---|
| drive-produce.cjs | basic | boot → produce; `DEV_FLAG=1` adds entropy/surprisal + a trace file |
| drive-ipc.cjs | basic | full query → answer end to end |
| drive-loaded.cjs | research | `config:loaded` is the first event, with yml defaults |
| drive-origins.cjs | research | per-field origins (`yml`/`file`/`env`/`default`) |
| drive-config.cjs | research | `set_effort` → `config:updated` + persisted |
| drive-persist.cjs | research | save → real path, origin `file`; only touched keys written |
| drive-clear.cjs | research | `""` clears → the rung beneath is restored (value AND origin) |
| drive-refuse.cjs | research | a version-2 harness.json is refused byte-identical |
| drive-redact.cjs | research | ability-config values never ride the bus (key-presence only) |
| drive-appcfg.cjs | research | bad corpus path → guard, nothing saved |
| drive-rollback.cjs | research | enable-failure → full rollback, process ALIVE (hdk#110) |
| drive-reroll.cjs | research | rollback, then a GOOD config re-enables + indexes |
| drive-ymlcorpus.cjs | research | a committed yml `abilities:` corpus boots + indexes |
| serve-gate-basic.mjs | basic | at cap (MAX_SESSIONS=2): concurrent streams; mid-run disconnect releases the slot; re-admission |
| serve-gate-research.mjs | research | per-session config isolation; secrets never on the wire; #110 contained |

The serve gates import `@lloyal-labs/binding/web` — copy them into the
scaffold root before running (ESM resolves from the script's location):

    cp <this dir>/serve-gate-basic.mjs <scaffold>/ && cd <scaffold> && node serve-gate-basic.mjs
