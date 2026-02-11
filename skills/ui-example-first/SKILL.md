---
name: ui-example-first
description: Enforce a UI-first delivery workflow for product and feature requests. Use when a task includes frontend/UI work, user flows, screens, interaction design, or visual structure and the team wants to review mockups/examples before implementing backend or production functionality.
---

# UI Example First

## Goal

Force a visible UI checkpoint before implementation. Produce concrete UI examples, get explicit user approval, then build functionality.

## Workflow

1. Extract scope
- Identify the requested user outcomes, target screens, key interactions, and constraints.
- List assumptions when requirements are ambiguous.

2. Produce UI examples first
- Create one to three concrete UI options before implementing functional logic.
- Prefer fast prototypes: static HTML/CSS, lightweight React views, wireframes, or screenshot-level mocks.
- Show responsive behavior for desktop and mobile when relevant.

3. Explain tradeoffs
- Compare options with concise tradeoffs (clarity, density, implementation complexity, accessibility risk).
- Recommend one option.

4. Gate implementation
- Ask for explicit approval of a selected option before building backend integration or feature logic.
- If approval is not explicit, continue iterating on UI examples only.

5. Implement after approval
- Build functionality aligned to the approved UI.
- Keep visual structure stable unless the user requests a design change.

## Output Contract

When this skill is active, structure responses in this order:

1. `UI options` with concrete examples
2. `Recommendation` with rationale
3. `Approval request` that asks which option to implement
4. `Implementation` only after approval

## Example Trigger Phrases

- "Show me a couple UI directions before you build it."
- "I want to see the screen design first."
- "Mock it up before wiring any logic."
- "Let's lock the UX before implementation."

## Guardrails

- Do not skip straight to data models or backend implementation when UI expectations are central.
- Do not treat a single rough sketch as approval; request confirmation.
- Do not over-polish early prototypes; optimize for decision speed.
