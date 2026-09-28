---
name: modern-css-workflows
description: Apply modern, production-grade CSS techniques based on Kevin Powell's architecture. Covers accessible fluid typography, OKLCH color systems, scroll-driven animations, CSS subgrid alignment, container style queries, :has() relational selectors, discrete transitions, popover anchor positioning, pure-CSS integer counters, defensive layout patterns, modern utility properties, and a modern CSS reset.
---

# Modern CSS Workflows & Utilities

A comprehensive skill for building accessible, maintainable, high-performance web interfaces using modern CSS standards.

## When to Use
- Implementing fluid responsive typography and spacing scales with `clamp()`.
- Aligning variable-height content across grid columns using CSS Subgrid.
- Building pure CSS scroll-driven animations (`animation-timeline`) or scroll progress indicators.
- Architecting color systems with OKLCH and Relative Color Syntax (`oklch(from var(...) ...)`).
- Creating component variants using Container Style Queries (`@container style(...)`).
- Applying parent or sibling conditional styling with the `:has()` pseudo-class.
- Animating elements entering/exiting `display: none` or top-layer popovers.
- Tethering tooltips or dropdowns using CSS Popovers and Anchor Positioning.
- Building JS-free animated counters using `@property` and CSS counters.
- Implementing robust full-bleed grid layouts, auto-responsive grids, or stack utilities.
- Eliminating layout shifts, orphans, or JS auto-resizing with modern utility properties.

---

## 1. Modern CSS Reset Base

```css
/* Box sizing rules */
*, *::before, *::after {
  box-sizing: border-box;
}

/* Prevent font size inflation & set body defaults */
html {
  color-scheme: light dark;
  scrollbar-gutter: stable;
}

body {
  min-height: 100vh;
  line-height: 1.5;
  margin: 0;
  -webkit-font-smoothing: antialiased;
}

/* Media defaults */
img, picture, video, canvas, svg {
  display: block;
  max-width: 100%;
}

/* Inherit fonts for form controls */
input, button, textarea, select {
  font: inherit;
}

/* Reduce motion for user accessibility settings */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 2. Accessible Fluid Typography

### Rule: Always Include rem in Preferred Values
Never use standalone `vw` units inside `clamp()`. Always mix relative units (`rem`) with viewport (`vw`) or container query (`cqw`) units so text resizes during browser zoom to satisfy WCAG 1.4.4.

- **Non-Accessible:** `font-size: clamp(1rem, 5vw, 3rem);`
- **Accessible:** `font-size: clamp(1.25rem, 0.95rem + 0.75vw, 1.75rem);`

### Formula Calculation
* **Slope** = (Font_max - Font_min) / (Viewport_max - Viewport_min)
* **Base_rem** = Font_min - (Viewport_min * Slope)
* **Formula** = `clamp(Font_min_rem, Base_rem + Slope_vw, Font_max_rem)`

---

## 3. CSS Subgrid for Card Alignment

Use `grid-template-rows: subgrid` to align card headers, bodies, and action buttons across rows even when text length varies:

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 1.5rem;
}

.card {
  display: grid;
  grid-row: span 3; /* Spans 3 rows in parent grid */
  grid-template-rows: subgrid; /* Inherits parent row track sizing */
  gap: 0.5rem;
}
```

---

## 4. Conditional Layouts with the `:has()` Selector

Style parent containers or siblings based on child state without JavaScript:

```css
/* Style form group when child input is invalid */
.form-group:has(input:invalid:not(:placeholder-shown)) {
  border-left: 3px solid oklch(0.6 0.25 25);
}

/* Dim sibling cards when one card is hovered */
.card-container:has(.card:hover) .card:not(:hover) {
  opacity: 0.6;
  scale: 0.98;
  transition: opacity 0.2s, scale 0.2s;
}
```

---

## 5. Discrete Transitions (`display: none` & Top Layer)

Animate elements entering or exiting `display: none` or top-layer popovers:

```css
.popover-menu {
  display: none;
  opacity: 0;
  translate: 0 -10px;
  transition: display 0.3s allow-discrete, opacity 0.3s, translate 0.3s;
}

.popover-menu:popover-open {
  display: block;
  opacity: 1;
  translate: 0 0;

  @starting-style {
    opacity: 0;
    translate: 0 -10px;
  }
}
```

---

## 6. Native Popovers & Anchor Positioning

Tether dropdown menus or tooltips directly to trigger elements without JS positioning libraries:

```css
/* 1. Define anchor on the trigger button */
.anchor-button {
  anchor-name: --tooltip-anchor;
}

/* 2. Position target relative to the anchor */
.tooltip[popover] {
  position: absolute;
  position-anchor: --tooltip-anchor;
  position-area: bottom span-right; /* Position below and align left edges */
  margin: 0.5rem 0 0 0;
}
```

---

## 7. Bulletproof Color Systems (OKLCH & Relative Colors)

```css
:root {
  --brand: oklch(0.62 0.22 250);

  /* Relative Color Syntax: Compute derived colors dynamically */
  --brand-hover: oklch(from var(--brand) calc(l - 0.12) c h);
  --brand-surface: oklch(from var(--brand) 0.05 h);
  --brand-alpha: oklch(from var(--brand) l c h / 0.15);
}
```

---

## 8. Pure CSS Scroll-Driven Animations

```css
/* Scroll-Progress Indicator */
.progress-bar {
  scale: 0 1;
  transform-origin: left;
  animation: grow linear;
  animation-timeline: scroll(root);
}

/* Viewport Reveal Effect */
.fade-in-card {
  animation: reveal linear both;
  animation-timeline: view();
  animation-range: entry 10% cover 30%;
}

@keyframes grow { to { scale: 1 1; } }
@keyframes reveal {
  from { opacity: 0; translate: 0 30px; }
  to { opacity: 1; translate: 0 0; }
}
```

---

## 9. Container Style Queries

```css
.card-container {
  --card-theme: dark;
}

@container style(--card-theme: dark) {
  .card {
    background-color: oklch(0.2 0.02 250);
    color: oklch(0.95 0.01 250);
  }
}
```

---

## 10. Architectural Layout Patterns

```css
/* Full-Bleed Grid */
.full-bleed-grid {
  display: grid;
  grid-template-columns:
    [full-start] minmax(1rem, 1fr)
    [content-start] min(100% - 2rem, 65ch) [content-end]
    minmax(1rem, 1fr) [full-end];
}
.full-bleed-grid > * { grid-column: content; }
.full-bleed-grid > .breakout { grid-column: full; }

/* Defensive Auto-Fit Grid */
.auto-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
  gap: 1.5rem;
}

/* Stack / Flow Utility */
.flow > * + * {
  margin-block-start: var(--flow-space, 1em);
}
```

---

## 11. Pure CSS Integer Counters

```css
@property --num {
  syntax: "<integer>";
  initial-value: 0;
  inherits: false;
}

.counter {
  --num: 0;
  transition: --num 1s ease-out;
  counter-reset: count var(--num);
}

.counter::after {
  content: counter(count);
}

.counter:hover {
  --num: 100;
}
```

---

## 12. Modern Utility Properties

- **Typography Wrap Control:** `h1, h2, h3 { text-wrap: balance; }` / `p { text-wrap: pretty; }`
- **Auto-Growing Form Inputs:** `textarea { field-sizing: content; min-height: 3lh; }`
- **Layout Shift Prevention:** `html { scrollbar-gutter: stable; }`
- **Native Form Accent:** `:root { accent-color: var(--brand); }`
- **Stacking Context Isolation:** `.card { isolation: isolate; }`

---

## Common Pitfalls & Gotchas

- **Subgrid Container Dependency:** `grid-template-rows: subgrid` requires the direct parent element to be a grid item in a CSS Grid.
- **`@starting-style` Scope:** Always place `@starting-style` inside the visible/active state selector (`:popover-open` or `.is-open`), not the hidden base selector.
- **`<number>` vs `<integer>` in `@property`:** CSS `counter()` only works with `<integer>` syntax; passing fractional numbers breaks the counter output.
- **Omitting `rem` in `clamp()`:** Standalone `vw` preferred values break 200% text zoom and fail WCAG 1.4.4.
- **Scroll Timelines on Non-Scrollable Parents:** `scroll(root)` targets main page scroll; if using custom containers, ensure `overflow-y: scroll/auto` is explicitly declared on the container.
