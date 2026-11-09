# Lathe workflow and MES read-only boundary implementation plan

> **For agentic workers:** Use superpowers:executing-plans. The user confirmed local execution of the previously proposed design.

**Goal:** Finish the agreed Miora lathe workflow and make the future read-only MES connector executable against simulated data.

**Architecture:** Keep the existing React pages, Excel importer, persistence and authorization. Add small pure modules for template generation, gap preview and work intervals, plus a server-side MES ingestion service with explicit source and transactional state-store contracts.

**Tech Stack:** TypeScript, React, SheetJS, Vinext, Node test runner.

## Global constraints

- Work only in `codex/miora-ui` in the isolated local checkout. No production, deployment, public repo, real MES credentials, network database connection or MES writes.
- Continue to support the independent Excel workflow and factory isolation.
- Never represent standard workload units as clock hours. Time intervals are opt-in, based on operator-supplied working hours and real duration. Day-only tasks remain day-only.
- Preserve history snapshots. Batch preview must not move existing dispatches, silently authorize overtime or apply against an obsolete state.
- MES is pull-only. Cursor and order changes must commit together. No browser secrets or enabled live route.

## Tests and implementation

- [x] Excel: generate a real workbook with importer-compatible Chinese headers and an instructions sheet, bind it on Data Import, round-trip with SheetJS.
- [x] Gap batch: preview selected gaps against existing normal-capacity reservations, preserve unselected work, show residuals and reject stale previews before saving.
- [x] Timed tasks: validate working windows and explicit start/end, reject overlaps and shifts out of a work window, persist ±60 minute changes, keep time out of inconsistent transfers.
- [x] MES: simulate source polling, version checks, factory isolation, manual completion conflicts, read/write failures and optimistic concurrency; preserve dispatches, history and confirmed/published state. Document the actual adapter seam and cloud work still required.
- [x] Run build, the whole suite and isolated workflow smoke checks; leave the branch local.

Local verification: the application build and all 68 tests passed. An isolated UI and HTTP integration run exercised the template download and reimport, gap preview and save, an hourly movement, the daily Excel export, and factory isolation. It used simulated data and did not cover browser visual rendering or a real MES connection.
