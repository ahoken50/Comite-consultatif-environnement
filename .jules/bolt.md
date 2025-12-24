## 2024-05-22 - Initial Setup
**Learning:** Initialized Bolt's journal.
**Action:** Always check for this file before starting optimizations.

## 2024-05-22 - Map Lookup vs Array.find in Loops
**Learning:** In `DocumentsPage.tsx`, nested `Array.find()` calls inside a render loop caused O(N*M) complexity. Replacing this with O(1) Map lookups reduced it to O(N+M).
**Action:** Always pre-compute lookup maps (e.g., `meetingsMap`) when linking related entities inside a list rendering loop.

## 2024-05-22 - Stable Callbacks with Refs
**Learning:** Frequent updates to a dependency (like a list from Redux) can break `React.memo` on children if passed to a `useCallback` directly. Using `useRef` to hold the latest state allows the callback to remain stable (empty dependency array) while still accessing fresh data.
**Action:** Use `useRef` inside `useCallback` when the callback depends on a rapidly changing value but the function identity needs to remain stable for `React.memo` to work.
