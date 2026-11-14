# ADR-0013: Pluggable model backend with a deterministic default

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, platform engineering

## Context

The supervised assistant needs language-model inference. The brief prohibits
turnkey **agent-orchestration** products while explicitly permitting
open-source libraries and models. Separately, the assistant must be
demonstrable to the customer on a managed laptop that may have no outbound
network access and no vendor account.

## Options considered

### Option A — One vendor SDK, one model

Simplest. Rejected on three counts: it adds a dependency tree against
[ADR-0003](0003-zero-runtime-dependencies.md), it makes the vendor choice
structural rather than commercial, and an acquisition arriving with a
committed Azure OpenAI estate would force a rewrite.

### Option B — An agent framework

LangChain, LlamaIndex or similar would supply the loop, tool binding and
memory. Rejected: the brief prohibits turnkey agent orchestration, and more
importantly the loop is exactly where the safety properties live. Delegating
it would mean the capability boundary is enforced by somebody else's
abstraction, which is not a position to defend to a regulator.

### Option C — Our own loop over a small adapter interface

Write the orchestration; normalise inference behind one interface with
adapters for Anthropic, OpenAI-compatible (covering Azure), and Ollama, plus
a deterministic planner that needs no model at all.

## Decision

**Option C.** One interface — `complete({ system, messages, tools })` →
`{ text, toolCalls, model }` — with four adapters, selected by
`MODEL_BACKEND`. Adapters speak plain HTTP via global `fetch`; no SDK.

**The default is `deterministic`.** A rule-based planner that follows the same
tool-call protocol and drives the identical loop, gates and audit trail.

Two reasons the deterministic default is not a testing convenience but a
design position:

1. A demonstration of a safety property must not fail because a key is
   missing, a network is blocked or a vendor is degraded.
2. It makes the architectural claim legible. If swapping the planner for an
   adversarial one changes nothing about what can happen, the guarantees
   demonstrably come from the registry and the approval gate rather than from
   the model's cooperation.

A backend failure falls back to the deterministic planner and reports the
substitution in the response's model attribution. A fallback is never silent,
because an insight whose provenance is unclear is worse than no insight.

## Consequences

**Positive.** The vendor stays a commercial decision. Local open-source models
are a first-class option where telemetry context must not leave the building.
Adapters are testable offline against stub servers that mimic each wire
format, so the request shape is verified without a key or a bill. The
zero-dependency position holds.

**Negative.** Four wire formats to maintain, and provider APIs drift —
mitigated by adapter tests that pin the request shape. Advanced
vendor-specific features (prompt caching, extended thinking, structured
outputs) are not exposed by the lowest common denominator; adding one means
extending the interface deliberately rather than inheriting it.

**Neutral.** The deterministic planner is not an AI and does not pretend to
be. It is a rule-based triage that produces honest, evidence-cited proposals,
and it is labelled as `deterministic-planner-1` everywhere it appears.

## Revisit when

A capability only available through a vendor SDK becomes necessary, or the
assistant needs streaming responses, at which point the interface grows a
streaming variant rather than being replaced.
