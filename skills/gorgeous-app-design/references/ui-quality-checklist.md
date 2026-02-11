# UI Quality Checklist

Use this checklist before finalizing a design recommendation or implementation.

## Visual cohesion

- Confirm one clear art direction across screens.
- Confirm heading, body, and metadata text follow a consistent type scale.
- Confirm spacing increments are consistent (example: 4/8/12/16/24/32).
- Confirm border radius and shadow language are consistent across components.

## Accessibility

- Confirm text and interactive contrast ratios are acceptable.
- Confirm focus states are visible and distinct from hover-only states.
- Confirm tap targets are large enough for mobile interaction.
- Confirm color is not the only cue for status/error/success.

## Interaction quality

- Confirm motion has purpose (hierarchy, continuity, feedback).
- Confirm entry animations do not delay primary actions.
- Confirm empty/loading/error states are designed and legible.
- Confirm destructive actions are visually differentiated and confirmed.

## Responsiveness

- Confirm layout adapts for narrow mobile widths and wide desktop widths.
- Confirm cards, tables, and nav patterns remain usable at all breakpoints.
- Confirm text wraps without collisions or clipped controls.
- Confirm sticky/fixed elements do not obscure critical content.

## Implementation readiness

- Confirm token values are defined for color/type/spacing/radius/elevation/motion.
- Confirm component states are specified (default/hover/focus/active/disabled).
- Confirm page sections use repeatable layout rules rather than ad hoc spacing.
- Confirm any custom font usage includes fallbacks and loading strategy.
