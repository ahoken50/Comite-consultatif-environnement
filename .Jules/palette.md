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
