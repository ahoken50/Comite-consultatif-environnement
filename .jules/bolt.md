# Bolt's Journal

## 2024-05-22 - Initial Setup
**Learning:** Initialized Bolt's journal.
**Action:** Always check for this file before starting optimizations.

## 2025-05-23 - Map Lookups for Linked Data
**Learning:** Found O(N*M) complexity in `DocumentsPage.tsx` where documents were being linked to meetings/projects via `find()` inside a loop.
**Action:** When linking relational data in the frontend (e.g. `documents` to `meetings`), always pre-compute a lookup Map keyed by ID using `useMemo` to reduce lookup time to O(1) inside the loop.
