# SWA config file location

**Canonical file:** `public/staticwebapp.config.json`

## Why not the repo root?

Vite copies everything under `public/` verbatim into the build output (`dist/`).
The Azure Static Web App action uploads `dist/` as `app_location`, so the file
that Azure actually reads is `public/staticwebapp.config.json` — not any file at
the repo root.

**Do not add a `staticwebapp.config.json` at the repo root.**
The CI `guard:swa-config` step will fail the build if one appears. Removing the
guard is a one-line change; please don't unless you also update the deploy
pipeline to actually copy the root file into `dist/`.

## Incident that motivated this

On 2026-08-05 the dev SWA appeared stuck in an auth-redirect loop. Several PRs
edited `staticwebapp.config.json` at the repo root trying to change the auth
behavior. None of them had any effect because Vite silently overwrote the root
file with the `public/` version at build time. See `memory/2026-08-06-0127.md`
in the ATLAS workspace for the full incident notes.

## How to change auth or route rules

Edit **`public/staticwebapp.config.json` only**. Push. The deploy will use it.
