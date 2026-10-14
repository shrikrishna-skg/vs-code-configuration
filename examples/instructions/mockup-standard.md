# Mockup and design standard

Apply to every mockup, design preview or UI artifact made for the user, in any folder. Pass this file to delegates that build UI. A project's own design system or an explicit user instruction wins on conflict.

Canonical source: `<ABSOLUTE_PATH_TO_COMPOSER_MOCKUPS>/design-system-review.html`. Working examples beside it: `dashboard-product-order.html`, `pages-review.html`, `send-states.html`, `model-menu-mockup.html`. Read the canonical source before inventing a look.

## Scope first

- Build only what was asked. A request for one control is one control, not a redesigned screen.
- When the mockup changes an existing app that is not a Multisystems product (Codex, Kilo, a third-party tool), reproduce that app's own look for the app surface and add only the requested element in that app's style. Use the Multisystems standard for the page framing, captions and notes around it.
- When a screenshot marks a region, the marked region is the target. Inspect it before choosing a design.

## Font, mandatory

Hanken Grotesk ("Multisystems Sans"), self-hosted. Never ship on the bare system stack.

```css
@font-face {
  font-family: 'Hanken Grotesk';
  src: url('./fonts/HankenGrotesk-Variable.woff2') format('woff2');
  font-weight: 100 900; font-style: normal; font-display: swap;
}
body {
  font-family: 'Hanken Grotesk', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

Font file: `<ABSOLUTE_PATH_TO_COMPOSER_MOCKUPS>/fonts/HankenGrotesk-Variable.woff2`. Copy it into a `fonts/` folder beside a mockup that lives elsewhere and keep the relative path.

## Tokens

Light surface (product and auth):

```css
--ms-primary:#4f46e5; --ms-primary-tint:#eef2ff;
--ms-bg:#f5f7fb; --ms-card:#ffffff; --ms-line:#e3e8f0;
--ms-text:#182338; --ms-text-2:#4a5b74; --ms-label:#64748b;
--ms-success:#22c55e; --ms-danger:#ef4444; --ms-warning:#f59e0b;
--ms-lift: 0 0 0 1px rgba(24,35,56,.05), 0 18px 50px -16px rgba(24,35,56,.22);
```

Dark scope (admin console):

```css
--ms-primary:#8b93f8; --ms-primary-tint:#232a54;
--ms-bg:#0e1523; --ms-card:#151f33; --ms-line:#25324c;
--ms-text:#e9eef7; --ms-text-2:#a8b5ca; --ms-label:#93a3bf;
--ms-success:#4ade80; --ms-danger:#f87171; --ms-warning:#fbbf24;
--ms-lift: 0 0 0 1px rgba(255,255,255,.05), 0 24px 60px -24px rgba(9,13,22,.55);
color: var(--ms-text); background: var(--ms-bg); color-scheme: dark;
```

The dark scope must set `color` and `background` itself. Tokens alone do not recolour inherited text.

## Typography and shape

- Kicker and field label: 11 to 13px, weight 700, letter-spacing .12 to .14em, uppercase, `--ms-label`.
- Page title: 27 to 34px, weight 800, letter-spacing -.02em. Sub: 15 to 17px, `--ms-text-2`.
- Body and record copy: 13 to 14px, line-height 1.45 to 1.5.
- Radius: controls 6 to 8px, fields 6px, cards 14 to 18px, pills 999px.
- Depth: one soft lift per working plane or overlay. Never shadow individual rows.

## Rules

- No decorative gradients, invented palettes or colour as decoration. Indigo is action and selection; success, danger and warning are states only.
- Build a component once against `var(--ms-*)` so it renders on both surfaces.
- Inline SVG for functional symbols, stroke-width 1.8 to 2, `currentColor`.
- Keyboard: visible `:focus-visible`, Escape closes an overlay and returns focus to its trigger, arrow keys move list items, `prefers-reduced-motion` respected.
- Overlays must stay inside the viewport. A parent with `overflow: hidden` clips a dropdown; check for it.
- Before reporting done, verify in a browser: `document.fonts.check('16px "Hanken Grotesk"')` is true, text is legible on every surface used, nothing is clipped or off-screen, and the requested interaction works.
