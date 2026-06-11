# Accessibility Re-Check Guide (WCAG 2.2 AA)

**Purpose:** The project has already passed a full accessibility pass (Tasks 1–12). This guide is the
**regression checklist** to run **whenever a developer changes an existing frontend UI section or adds a
brand-new UI** in `/frontend` or `/admin`.

Use it as a pull-request gate: do not merge UI changes until every relevant item below passes.

> Scope: this is a *targeted* re-check, not a full re-audit. Only check the screens/components you
> touched, plus anything that shares the changed component. Tasks 5 (full Lighthouse/axe sweep) and 12
> (final sign-off) are **not** part of this routine — they are run separately, by leads, before release.

---

## How to use this guide

1. Identify what changed: which page(s), which component(s), and whether new interactive elements were added.
2. Walk the **9 checks** below (C1–C9). Each maps to one of the original accessibility tasks.
3. For each check, mark Pass / Fail / N/A in the [Sign-off table](#sign-off-table) at the bottom.
4. Fix every Fail before merge. If something can't be fixed, log it under **Remaining risks**.
5. Attach the filled sign-off table to the PR description.

**Minimum tooling for a quick pass (5–10 min):**
- Keyboard only (unplug/ignore the mouse) — Tab, Shift+Tab, Enter, Space, Esc, Arrow keys.
- Browser zoom to 200% (`Ctrl` + `+`).
- One automated scan: [axe DevTools](https://www.deque.com/axe/devtools/) browser extension **or** Chrome Lighthouse (Accessibility category).
- A screen reader spot-check: NVDA (Windows) or VoiceOver (Mac).

---

## The 9 checks

### C1 — Image alternative text (Task 1)
For every image you added or changed (`<img>`, Next.js `<Image>`, inline `<svg>` used as an image, icon images, content background images):

- [ ] Meaningful images have an `alt` that describes **purpose/content**, not the filename.
- [ ] Decorative images use `alt=""` (empty).
- [ ] Icons that sit next to visible text use `alt=""` (text already conveys meaning) — avoid double announcement.
- [ ] No `alt` text starts with "image of" / "picture of".
- [ ] Inline decorative SVGs have `aria-hidden="true"` (or `role="img"` + `aria-label` if meaningful).
- [ ] No generic/placeholder alt (`"image"`, `"logo1"`, `"img_123"`).

### C2 — Text size & color contrast (Task 2)
- [ ] Body text is ≥ 16px effective (project standard leans to larger for low-literacy patients; don't shrink below the surrounding text).
- [ ] No new hardcoded tiny font sizes (e.g. `text-[10px]`, `11px`).
- [ ] Normal text contrast ≥ **4.5:1** against its background.
- [ ] Large text (≥ 24px, or ≥ 18.66px bold) contrast ≥ **3:1**.
- [ ] No light-gray-on-light text (placeholders, helper text, disabled-looking labels).
- [ ] Buttons, links, badges, error messages, placeholders all meet contrast.
- [ ] Fonts use **rem/em**, not fixed px, so they scale (matches existing convention — see commit `8c850ac`).

> Check contrast with the axe extension, Chrome DevTools color picker, or https://webaim.org/resources/contrastchecker/

### C3 — Touch target size & spacing (Task 3)
- [ ] Every interactive element (button, link, icon button, menu item, tab, dropdown trigger, custom clickable) is at least **44×44 px**.
- [ ] Icon-only buttons meet 44×44 (add padding or min-width/height — don't just size the icon).
- [ ] At least **8px** spacing between adjacent targets.
- [ ] Checked on **mobile** layout too, not just desktop.

### C4 — Form labels & controls (Task 4)
For any new/changed `input`, `textarea`, `select`, checkbox, radio, search field, or custom control:

- [ ] Every field has a **visible label**.
- [ ] Label is connected via `htmlFor` ⇄ matching `id` (or label wraps the input).
- [ ] No placeholder-only fields (placeholder is not a label).
- [ ] Required fields are clearly indicated (text/`*` + `aria-required` / `required`).
- [ ] Validation/error text is linked with `aria-describedby` and `aria-invalid` on the field.
- [ ] Icon-only controls (e.g. a search button) have an accessible name (`aria-label`).

### C5 — Keyboard navigation (Task 6)
- [ ] Every new interactive element is reachable with **Tab**.
- [ ] Tab order follows the visual order (no jumps).
- [ ] **Enter/Space** activate buttons; Enter activates links.
- [ ] Modals, dialogs, dropdowns close with **Escape**.
- [ ] Focus is **trapped** inside open modals/dialogs and returns to the trigger on close.
- [ ] No clickable `<div>`/`<span>` doing a button's job — use `<button>`/`<a>` (or add `role`, `tabIndex={0}`, and key handlers if a native element truly isn't possible).
- [ ] Custom widgets (tabs, menus, accordions) support arrow-key navigation where expected.

### C6 — 200% zoom (Task 7)
At 200% browser zoom (and spot-check 150%):

- [ ] No content is cut off, overlapping, or hidden.
- [ ] No horizontal scrolling for primary content.
- [ ] Layout reflows (uses rem/%/flex/grid, not fixed px widths that break).
- [ ] Modals, tables, nav, and forms remain usable.
- [ ] Viewport meta does **not** disable zoom (no `maximum-scale=1` / `user-scalable=no`).

### C7 — Don't rely on color alone (Task 8)
- [ ] Status/state (error, success, warning, required, online/offline, alert tiers) is conveyed by **text or icon or shape**, not color only.
- [ ] Red/yellow/green alert tiers (admin dashboard) carry a text label or icon, not just the color swatch.
- [ ] Validation states pair color with a message/icon.
- [ ] Charts/badges/tags are distinguishable without color.

### C8 — Visible focus indicators (Task 9)
- [ ] Every focusable element shows a **clearly visible focus ring** when navigated by keyboard.
- [ ] No new `outline: none` / `outline: 0` without a replacement focus style.
- [ ] Prefer `:focus-visible` for keyboard focus styling (a global rule already exists — see commit `3e3e0eb`; don't override it away).
- [ ] Focus ring has enough contrast against its background.
- [ ] Focus stays visible through the whole keyboard flow (including inside modals).

### C9 — Screen reader names & ARIA (Task 10)
Spot-check with NVDA/VoiceOver:

- [ ] Buttons, links, fields, menus, dialogs, controls all announce a **meaningful name**.
- [ ] Icon-only buttons have `aria-label`.
- [ ] Images announce correctly (ties back to C1).
- [ ] Form fields announce their label (ties back to C4).
- [ ] ARIA is correct and not conflicting (no `aria-label` that contradicts visible text; no invalid `role`).
- [ ] Dialogs have an accessible name via `aria-labelledby`/`aria-label` (pattern already in use — see commit `1957ca6`).
- [ ] Dynamic updates (toasts, async errors, live alert feed) use `aria-live` where users need to hear them.

### C-Skip — Skip-to-main-content (Task 11) *(only if you added a new page/layout)*
- [ ] New top-level page/layout includes a **"Skip to main content"** link.
- [ ] Skip link is the **first focusable element**.
- [ ] It is visually hidden until focused, then visible.
- [ ] Activating it moves focus to the main content (`id="main"` target exists — admin pattern is in commit `6c7db1a`).

---

## Quick decision guide: which checks do I run?

| What you changed | Run these checks |
|---|---|
| Added/changed an image or icon | C1, C9 |
| Changed text, colors, or spacing | C2, C7, C8 |
| Added/changed a button, link, or icon button | C3, C5, C8, C9 |
| Added/changed a form field | C2, C4, C5, C8, C9 |
| Added/changed a modal, dropdown, tabs, menu | C5, C6, C8, C9 |
| Changed page/section layout or widths | C6 |
| Added status/alert/badge/validation UI | C7, C9 |
| Added a whole new page or route layout | **All checks + C-Skip** |

When in doubt, run all nine — they take under 15 minutes for a single component.

---

## Sign-off table

Copy this into the PR description and fill it in.

| Check | Area | Result (Pass/Fail/N/A) | Notes |
|---|---|---|---|
| C1 | Image alt text | | |
| C2 | Text size & contrast | | |
| C3 | Touch targets 44×44 + spacing | | |
| C4 | Form labels | | |
| C5 | Keyboard navigation | | |
| C6 | 200% zoom | | |
| C7 | No color-only meaning | | |
| C8 | Visible focus indicators | | |
| C9 | Screen reader names & ARIA | | |
| C-Skip | Skip-to-main (new pages only) | | |

**Automated scan:** axe errors = ____  |  Lighthouse Accessibility score = ____ (target 95+)

**Remaining risks / limitations:**
- …

**Reviewed by:** ____________   **Date:** ____________

---

## Notes specific to this project

- Two frontends: **`/frontend`** (patient — Next.js 16) and **`/admin`** (provider/care-team — Next.js 16). Run checks in the app you touched.
- Patient app serves a **low-literacy audience** — never trade away large text, icon+text pairing, or audio cues for visual density. See the icon-design memory notes.
- Tailwind v4 + React 19. Prefer rem-based utilities; don't reintroduce fixed-px font/width values.
- Reuse existing accessible patterns already in the codebase rather than rolling new ones:
  - Global `:focus-visible` outline (commit `3e3e0eb`)
  - Dialog accessible names via `aria-labelledby` (commit `1957ca6`)
  - Admin skip-to-main link + focus move (commit `6c7db1a`)
  - rem fonts + zoom reflow (commit `8c850ac`)
