# Ideation: Runtime Performance, Bugs & Extension Improvements

**Date:** 2026-06-30  
**Subject:** Ctrl+Q MRU Switcher — speed, correctness, polish  
**Mode:** Repo-grounded  
**Axes:** Open-path latency · Thumbnail pipeline · State & lifecycle · Permissions & footprint · UX edge cases

---

## Grounding Context

Small MV3 extension (~400 LOC TypeScript): service worker (`service-worker.ts`), injected overlay (`overlay.ts`), popup fallback (`fallback.ts`), MRU stack (`mru.ts`), session-storage thumbnails (`thumbnails.ts`). Opens on `Ctrl+Q`, shows up to 5 MRU tabs with JPEG previews, commits on Ctrl/Meta release.

**Topic axes:** open-path latency · thumbnail capture/storage · multi-window & lifecycle · bundle/injection cost · edge-case UX

---

## Top Ideas (survivors)

### 1. Batch the switcher open path (latency) — **P0**

**Idea:** Parallelize `resolveSwitcherTabs` (`Promise.all` for tab metadata) and fetch all thumbnail keys in one `chrome.storage.session.get(...keys)` instead of 5 sequential round-trips.

**Basis:** `service-worker.ts:77-97` awaits `tabs.get` and `getThumbnail` per tab serially; `thumbnails.ts:50-54` does one `get` per tab.

**Rejected alternatives:** Caching full `SwitcherPayload` in memory (stale titles/thumbs); skipping thumbs entirely (hurts core UX).

**Risk:** Low. Straightforward refactor.

---

### 2. Fix global `switcherTimeout` for multi-window (bug) — **P0**

**Idea:** Store auto-hide timeout per `windowId` (or a `Map<number, Timeout>`), not a single module-level variable.

**Basis:** `service-worker.ts:100-107` — one `switcherTimeout` shared across all windows; opening switchers in two windows causes cross-window timeout clobbering and premature hide.

**Risk:** Low. Real correctness bug for power users.

---

### 3. Targeted overlay hide instead of tab broadcast (perf) — **P1**

**Idea:** `hideSwitcherInWindow` should message only `openSwitchers.get(windowId).tabId`, not every injectable tab in the window.

**Basis:** `service-worker.ts:303-312` queries all tabs and sends `OVERLAY_HIDE` to each — O(n tabs) messaging on every commit/cancel/timeout.

**Risk:** Low. `openSwitchers` already tracks the host tab.

---

### 4. Debounce + smarter thumbnail capture (runtime perf) — **P1**

**Idea:** Debounce `captureTabThumbnail` (300–500ms) on rapid tab switching; skip capture when tab is discarded, chrome://, or not visible; optionally skip resize when capture width ≤ `THUMB_WIDTH`.

**Basis:** `service-worker.ts:372-374` fires capture 200ms after every activation; `thumbnails.ts:26-38` does fetch → ImageBitmap → OffscreenCanvas → FileReader on the service worker — expensive on fast tab cycling.

**Risk:** Medium. Must not leave MRU cards permanently thumb-less.

---

### 5. Fix thumbnail prune eviction order (bug) — **P1**

**Idea:** Track `lastCapturedAt` per tab (or maintain an LRU key list) instead of pruning by alphabetical key order.

**Basis:** `thumbnails.ts:61-66` — `keys.slice(0, keys.length - MAX_THUMBS)` evicts lexicographically first keys, not oldest captures.

**Risk:** Low. Wrong thumbs may disappear today.

---

### 6. Guard popup `onUpdated` listener against leaks (bug) — **P2**

**Idea:** Add timeout fallback and always `removeListener` if popup closes before `status === "complete"`.

**Basis:** `service-worker.ts:206-214` — listener never removed if load stalls or window closes early.

**Risk:** Low. Rare but leaks in long sessions.

---

### 7. Narrow permissions: `activeTab` + optional host (footprint) — **P2**

**Idea:** Replace `<all_urls>` host permission with `activeTab` where possible; document that previews require prior activation (already how capture works).

**Basis:** `manifest.json:7` — broad host permission for injection; many users hesitate to install.

**Risk:** Medium. Must verify injection still works on first `Ctrl+Q` without prior gesture on all target pages.

---

## Rejected (with reasons)

| Idea | Why rejected |
|------|----------------|
| Pre-inject overlay on every page load | High carrying cost, most tabs never open switcher |
| Web Workers for thumbnail resize | SW already has OffscreenCanvas; added complexity |
| Replace DOM overlay with chrome.sidePanel | Changes product shape; not MRU switcher UX |
| IndexedDB for thumbs | Session storage is correct lifecycle; migration cost |
| Remove popup fallback | Required for chrome:// / NTP per README |

---

## Recommended next step

Brainstorm **#1 + #2 + #3** as a single "open path & lifecycle hardening" slice — they're independent, low-risk, and directly felt on every `Ctrl+Q`.
