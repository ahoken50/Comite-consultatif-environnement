# Palette's Journal

## 2024-05-22 - Initial Setup
**Learning:** Starting fresh with a new journal.
**Action:** Will document critical UX/a11y learnings here.

## 2024-05-22 - Navigation Accessibility
**Learning:** `aria-current="page"` is essential for indicating the active page in a navigation list to screen readers. Visually indicating selection (color) is not enough.
**Action:** Always add `aria-current="page"` to the active navigation item.

## 2024-05-24 - Disconnected Custom Labels
**Learning:** Detected a pattern where `Typography` is used for form labels without `htmlFor` association, decoupling the label from the input for screen readers.
**Action:** When styling custom labels, ensure `component="label"` and `htmlFor="input-id"` are applied.

## 2024-12-23 - Icon-Only Button Accessibility
**Learning:** Icon-only buttons (like Edit/Delete in lists) often lack context for screen readers if they only use generic labels. Adding specific `aria-label` attributes (e.g., "Delete Meeting: [Title]") provides necessary context.
**Action:** Always wrap `IconButton` in `Tooltip` for mouse users and provide dynamic, specific `aria-label` strings for screen readers.
