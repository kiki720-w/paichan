# Miora UI Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan in this session.

**Goal:** Replace every old APS page with the approved Miora design while preserving real business behavior.

**Architecture:** Keep the React scheduler controller and server contracts. Render shared Miora layout, styles and page components from live state; keep UI-specific presentation out of the domain algorithms.

**Tech Stack:** React, TypeScript, Vinext, existing SheetJS and APS persistence.

**Spec:** `docs/superpowers/specs/2026-11-09-miora-ui-replacement-design.md`

## Global Constraints

- Use the extracted Miora ZIP as the visual source; no parallel legacy UI or fake data/actions in production.
- Total managers switch factories on the dashboard only. Factory managers never see a switch.
- Keep real login, server-side scope checks, storage and scheduling. No production writes, deploy, or new MES connection.
- Keep source worktree's overlapping uncommitted changes intact.

## Review Focus

- Account scope cannot be widened by navigation or URL parameters (shell and existing state API tests).
- Previous factory selection must not bleed into the next factory (scope-reset test).
- A valid upload and export must use actual spreadsheet handlers (local functional exercise).
- Failed saves must not show a misleading success; plan and order states must remain distinct (existing workflow tests and review).
- Missing quota, zero allocation, and insufficient capacity must remain visible and actionable (result view tests).

### Task 1: Miora shell and navigation

**Files:** `app/scheduler-app.tsx`, `app/miora-shell.tsx`, `app/globals.css`, `tests/miora-ui.test.mjs`.

**Interfaces:** `MioraShell` consumes current page, account role, factory, authorized switch callback, navigation and slots. Login consumes the existing authenticated flow, never prototype URL-based role simulation.

- [x] Test server-rendered shell for dashboard-only and role-scoped factory controls, current navigation, and actual login form.
- [x] Observe RED; port prototype shell, account controls, palette, local fonts/icon treatment, responsive navigation and shared styles.
- [x] Run the new tests and commit on the isolated feature branch.

### Task 2: Live business pages

**Files:** `app/scheduler-app.tsx`, `app/globals.css`, Miora page components, and `tests/miora-ui.test.mjs`.

**Interfaces:** Existing real app state, calculations, persistence and mutations. Reusable page masthead/table/action primitives use typed props.

- [x] Test empty and populated schedules, shortages, actionable exceptions, and scope reset.
- [x] Observe RED; replace dashboard, import, orders, schedule, tasks, alerts, capacity, quota, rules, history, guide and product map views. Retain real handlers and distinguish plan vs order states.
- [x] Run UI and domain tests; review removal of unreachable old UI and commit on feature branch.

### Task 3: Local integration verification

- [x] Build with Vinext; run business, state API and rendered UI tests. Replace obsolete starter-page assertions with APS route rendering tests.
- [x] Verify real Excel import, priority, assignment, schedule, confirmation, publication, export, completion and factory separation using isolated D1 and a DOM integration harness.
- [ ] Inspect visual fidelity against the Miora ZIP at the same viewport. Blocked: browser control could not initialize; the DOM harness does not verify layout or appearance.
- [x] Record verified behavior and open blockers. Do not merge, deploy or modify the official service.

## Execution notes

- Ruling: The desktop worktree tool did not complete; Git created a sibling worktree on `codex/miora-ui` to keep the dirty main checkout untouched.
- Ruling: Reuse locally installed dependency packages through worktree links. The npm lock was missing SheetJS entries; the isolated checkout used no installation changes to main or shared lockfiles.
- Ruling: Historical snapshots keep independent status; only the snapshot tied to the current plan can update its status. Reimport clears invalidated current allocations and state, not historical snapshots.
- Independent review found overlapping refresh/switch, historical status cross-talk, and invisible modal errors. The local DOM/HTTP regression checks were rerun after fixing all three.
