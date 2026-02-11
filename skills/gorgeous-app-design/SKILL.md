---
name: gorgeous-app-design
description: Create bold, production-ready app visual design direction and implementation plans for web/mobile interfaces. Use when requests mention making UI "gorgeous", polished, premium, modern, or brand-elevated; when designing/revamping app screens; when defining color, typography, spacing, and motion systems; or when translating visual direction into concrete HTML/CSS/React implementation guidance.
---

# Gorgeous App Design

Design intentionally styled interfaces with strong visual identity while keeping accessibility and implementation quality high.

## Workflow

1. Clarify design objective
- Extract product intent, audience, emotional tone, and constraints (platform, existing brand, timeline).
- If no brand system exists, choose one direction from `references/style-directions.md`.
- If an existing design system exists, preserve it and extend it instead of replacing it.

2. Define visual system before component details
- Establish a token set for color, typography, spacing, radius, elevation, and motion.
- Use `assets/design-tokens.css` as a starter and adapt values to the selected direction.
- Avoid generic defaults:
  - Do not default to Inter/Roboto/Arial unless already required by the project.
  - Avoid flat, single-color backgrounds for primary surfaces.
  - Avoid generic micro-interactions without purpose.

3. Produce concrete UI options
- Deliver 2-3 distinct directions for key screens (desktop and mobile where relevant).
- Each option must include:
  - Visual theme name and one-sentence intent
  - Color palette + type pairing
  - Layout behavior and hierarchy
  - Motion concept (load-in and interaction cues)
- Explicitly call out tradeoffs and implementation complexity.

4. Translate approved direction into buildable output
- Convert selected direction into:
  - CSS variables/tokens
  - Base component styles (buttons, inputs, cards, nav, empty states)
  - Page-level composition rules (grid, section spacing, breakpoints)
- Include responsive behavior and states: hover/focus/active/disabled/error.

5. Run quality checks
- Validate contrast and keyboard focus visibility.
- Ensure type scale and spacing rhythm are consistent.
- Verify that motion reinforces hierarchy and is not purely decorative.
- Use `references/ui-quality-checklist.md` before finalizing.

## Output format

When this skill is active, structure responses in this order:

1. `Design intent`
2. `UI directions` (2-3 options)
3. `Recommended direction` and tradeoffs
4. `Implementation system` (tokens + component rules)
5. `Quality checks`

## Reference usage

- Read `references/style-directions.md` when choosing or adapting an aesthetic direction.
- Read `references/ui-quality-checklist.md` when reviewing a proposed UI for launch readiness.
- Reuse `assets/design-tokens.css` as the starting token scaffold for implementation.
