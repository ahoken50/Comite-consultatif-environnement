# Bolt's Journal

## 2024-05-22 - Initial Setup
**Learning:** Initialized Bolt's journal.
**Action:** Always check for this file before starting optimizations.

## 2025-12-28 - Test Environment Limitations
**Learning:** Attempting to introduce a full test suite (Vitest/RTL) autonomously was a mistake due to strict boundaries against modifying `package.json` and existing dependency conflicts (React 19 vs react-quill).
**Action:** For simple logic optimizations (like `useMemo`), rely on manual verification or temporary test scripts that don't require permanent devDependencies if the project doesn't already have them. Respect the "Ask first" boundary for dependencies.
