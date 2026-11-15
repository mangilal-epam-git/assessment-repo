# Presentation

`VectorHarbor-solution-design.pptx` — five slides for the customer session:
project managers, architect and technical lead, followed by deep technical
Q&A. About ten minutes of narration, leaving the rest for questions.

## The narrative

| # | Slide | The one message |
| --- | --- | --- |
| 1 | Prices you can prove | After a settled fraud allegation about billing and data-quality claims, the product is not "good prices" — it is prices that can be recomputed and defended |
| 2 | One platform, two things already running | The whole architecture in one view, with what is built marked apart from what is designed |
| 3 | The cheapest bundle is usually the worse deal | The quality-normalised comparison, with the brief's own fixtures as the worked example |
| 4 | The assistant proposes. A person decides | Supervision enforced by architecture, not by prompt instructions |
| 5 | What is built, what is next | Honest split, phased rollout with measured gates, and three asks to close on |

Every slide carries speaker notes with the argument to make and the
follow-up to expect.

## Regenerating it

The deck is generated, so it is reviewable as code and restyles in one place:

```bash
cd docs/presentation
node build-deck.js
```

Requires `pptxgenjs`. The palette matches the supervision console
(`src/agent/ui.js`) on purpose, so switching from the slides to the live demo
reads as one product.

## Suggested running order for the session

1. Slides 1–2 — framing and architecture.
2. Slide 3, then show `npm run demo` to prove the numbers are real.
3. Slide 4, then the live console at `npm run agent` — ask it to review the
   fleet, then press **try to make it act** and let the refusal land.
4. Slide 5 — the honest split and the asks.

Backing detail for the Q&A: [architecture](../architecture/),
[ADRs](../adr/), [worked examples](../coding-task/worked-examples.md),
[traceability](../architecture/21-requirements-traceability.md) and
[assumptions and gaps](../architecture/22-assumptions-and-gaps.md).
