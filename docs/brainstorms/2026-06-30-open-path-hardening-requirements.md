# Requirements: Open Path & Lifecycle Hardening

**Date:** 2026-06-30  
**Status:** Ready for planning  
**Source ideation:** `docs/ideation/2026-06-30-runtime-perf-bugs-improvements.md` (#1–#3, #5)

---

## Problem

Opening the switcher and closing it should feel instant and correct. Today the open path does unnecessary serial I/O, auto-hide timing breaks with multiple windows, overlay teardown spams every tab, and thumbnail eviction order is wrong.

---

## What we're building

A focused hardening pass on the switcher hot path: parallel data fetch on open, per-window timeout state, surgical overlay hide, and LRU-correct thumbnail pruning. No UX or shortcut changes.

---

## Requirements

### R1 — Parallel tab resolution

When `showSwitcher` runs, resolving up to 5 MRU tabs must not await each tab sequentially. Tab metadata and thumbnails load concurrently. Thumbnail reads use one batched `session.get` call.

**Success:** Open latency scales with the slowest single tab, not the sum of five.

### R2 — Per-window auto-hide timer

The 30s auto-hide timeout is scoped per `windowId`. Timeouts in window A do not clear or replace timeouts in window B.

**Success:** Two switchers open in two windows each auto-hide independently.

### R3 — Surgical overlay hide

`hideSwitcherInWindow` sends `OVERLAY_HIDE` only to the tab recorded in `openSwitchers` for that window (if injectable). Popup close path unchanged.

**Success:** Commit/cancel/timeout does not message unrelated tabs in the same window.

### R4 — LRU thumbnail eviction

When pruning exceeds `MAX_THUMBS`, evict least-recently-captured thumbnails, not alphabetical keys.

**Success:** Frequently visited tabs retain previews under storage cap.

---

## Out of scope

- Debounced capture pipeline (separate slice)
- Permission narrowing (`activeTab`)
- Visual/CSS changes
- New features (search, pin, >5 tabs)

---

## Assumptions

- `openSwitchers` always holds the current overlay host `tabId` when switcher is visible
- Session storage remains the thumbnail store
- `SWITCHER_LIMIT` stays at 5

---

## Success criteria

1. Measurable reduction in open-path async work (5 serial → 1 parallel batch)
2. Multi-window switcher sessions behave correctly in manual test
3. No `OVERLAY_HIDE` messages to tabs that never hosted the overlay
4. Thumbnail cap evicts stale tabs first

---

## Open questions

- Should batched thumbnail fetch fall back gracefully if one key is missing? (Assume: show placeholder for that card only.)
