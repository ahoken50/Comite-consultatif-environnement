# Bolt's Journal

## 2024-05-22 - Initial Setup
**Learning:** Initialized Bolt's journal.
**Action:** Always check for this file before starting optimizations.

## 2025-12-28 - Test Environment Limitations
**Learning:** Attempting to introduce a full test suite (Vitest/RTL) autonomously was a mistake due to strict boundaries against modifying `package.json` and existing dependency conflicts (React 19 vs react-quill).
**Action:** For simple logic optimizations (like `useMemo`), rely on manual verification or temporary test scripts that don't require permanent devDependencies if the project doesn't already have them. Respect the "Ask first" boundary for dependencies.

## 2025-12-30 - Verification with Firebase Dependencies
**Learning:** The application's core slices import `firebase.ts` which initializes the app immediately. Without valid environment variables, the app crashes even in a test harness.
**Action:** When creating a temporary verification entry point (like `main-verify.tsx`), either mock the slices entirely (avoiding imports that touch firebase) or provide dummy `VITE_FIREBASE_` environment variables when running `npm run dev` to bypass the crash. The latter is often easier if the slices are needed.
