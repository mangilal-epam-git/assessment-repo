# ADR-0014: Classify and block data at the model egress boundary

- **Status:** Accepted
- **Date:** 2026-11-15
- **Deciders:** Solution architecture, security, data protection

## Context

The customer's position, given in discovery: until an explicit policy is
approved, raw operational telemetry, precise driver locations and
identifiable driver records must not reach an external model endpoint. Any
integration must first be approved for specific data classes, a processing
region, a purpose, retention behaviour and contractual terms.

The platform already minimises at source — no tool returns driver identity or
precise location, so that data is not in the agent's context to begin with.
The question is whether that is sufficient.

## Options considered

### Option A — Rely on tool design alone

The data never enters the context, so it cannot leave. Clean, zero runtime
cost, and true today.

Rejected as the only control. It depends on every future tool author
remembering, and on no field quietly widening over time. The failure is
silent and the blast radius is a regulated data class crossing a boundary. A
control that depends on everyone remembering is not a control.

### Option B — Redact at the boundary

Scan the outbound payload and replace prohibited values with placeholders.
The call proceeds with less data.

Rejected as the default. Redaction is a judgement about what is safe to send,
made automatically, at the moment of sending — and a near-miss redaction
leaves a plausible-looking payload that nobody reviews. It also hides the
defect: the tool that should not have returned a coordinate keeps doing so.

### Option C — Classify and block, failing closed

Classify the outbound payload. A prohibited class blocks the call, loudly.
The turn degrades to the local planner.

### Option D — Policy engine as a separate service

A dedicated egress proxy all model traffic routes through. Right at platform
scale; disproportionate for one service, and it moves the control away from
the code it protects.

## Decision

**Option C**, implemented in `src/agent/model/egress-policy.js`.

| Aspect | Decision |
| --- | --- |
| Unit of policy | A **data class**, not a field name, so adding a field cannot widen the boundary |
| Default permitted | `OPERATIONAL` and `VEHICLE_ID` only |
| Never permittable | `SECRET` and `PAYMENT` — the service refuses to start if configured to allow them |
| Placement | At the adapter boundary, wrapping every backend, so a new adapter inherits it |
| Local planner | Not wrapped: no boundary is crossed |
| On violation | Block, fail closed, record loudly, degrade to the local planner |
| In production | Cannot be disabled; `NODE_ENV=production` with the policy off refuses to boot |

Placement matters more than the detection. Wrapping the adapter means the
guard applies to Anthropic, OpenAI, Azure and Ollama identically, and to
whatever is added next, without anyone choosing to apply it.

### Why it stays a backstop

The primary control is still minimisation at source. This guard exists for
the day that is wrong — a new tool, a new field, a well-meant change — and it
is described that way in the documentation so nobody treats the scanner as
permission to be careless upstream.

### Why blocking is loud rather than quiet

A violation is either a defect or an attack, and both deserve attention. It
produces an error-level log, a `vh_agent_egress_blocked_total` metric and a
`MODEL_EGRESS_BLOCKED` entry in the hash-chained ledger — naming the class
and where it was found, never the value. The turn then degrades to the local
planner, so an operator investigates a working service rather than an outage.

## Consequences

**Positive.** The customer's standing position is enforced in code rather
than documented as an intention, and the enforcement is testable — fourteen
tests cover location, driver identity, VIN, secrets and payment data across
the system prompt, messages, tool calls and tool schemas. The service degrades
safely instead of failing. The permitted set is visible at `/readyz`, so an
operator can confirm the active policy without reading configuration.

**Negative.** Pattern matching has both error modes. A false positive blocks a
legitimate call and silently degrades answer quality until someone reads the
log — mitigated by the metric and by findings naming exactly where they
matched. A false negative is the more serious one: these are regular
expressions, not semantic understanding, and a sufficiently unusual encoding
of a coordinate will pass. **The guard reduces risk; it does not eliminate
it, and it must not be presented as though it does.** Minimisation at source
remains the control that actually matters.

There is also a small per-call cost, scanning the payload before each model
request. Immaterial next to inference latency.

**Neutral.** Redaction is deliberately not implemented. It can be added per
class later if the customer prefers degraded calls to blocked ones, but
blocking surfaces the upstream defect and redaction hides it.

## Revisit when

The customer approves a data-use policy — the permitted set then reflects it
rather than our conservative default. Or when a second service needs model
egress, at which point Option D becomes proportionate.
