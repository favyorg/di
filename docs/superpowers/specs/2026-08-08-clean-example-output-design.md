# Clean HKT output examples

## Goal

Keep the HKT examples focused on the value produced by the transformed module instead of adding variables whose only purpose is to assert already inferred types.

## Changes

- In the playground HKT example, keep `const output = Greeting()` for hover inspection and log `output.name` and `output.value` directly.
- Apply the same pattern to the live `transform-output` documentation example.
- Do not edit historical implementation plans.

## Verification

- Reuse the existing strict TypeScript compilation and runtime checks for the playground example; a source-text assertion would only lock wording rather than behavior.
- Run the documentation example tests, the full docs test target, and the docs production build.
