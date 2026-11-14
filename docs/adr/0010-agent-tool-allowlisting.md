# ADR-0010: Agents propose; humans approve; no actuation capability exists

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Solution architecture, safety, security, legal

## Context

The brief requires that agents propose maintenance tickets and data purchases
using allow-listed tools, that explicit human approval precedes any spend or
operational change, and that remote vehicle actuation is **prohibited**.

Fleet vehicles are heavy machinery operating in public. A model-initiated
actuation — even a well-intentioned one — could cause injury. The
consequences are irreversible in a way that no amount of post-hoc auditing
addresses.

## Options considered

### Option A — Prompt-based restriction

Instruct the model not to take unauthorised actions. Rejected: a prompt is a
request, not a constraint. Prompt injection via provider descriptions or
maintenance notes is a known, unsolved attack class, and the agent context
necessarily includes text the platform does not control.

### Option B — Allow-listed tools with runtime permission checks

Each tool call checked against the agent's permissions. Much better, but
still a configuration away from disaster: a misconfigured allow-list, or a
future engineer adding an actuation tool "for testing", reopens the path.

### Option C — Allow-list, **plus** a human approval gate, **plus** no
actuation capability anywhere in the codebase

Three independent barriers, the third of which cannot be reopened by
configuration.

## Decision

**Option C**, with three distinct enforcement layers:

### 1. Capability absence

**No vehicle-actuation tool exists in the codebase, in any environment.**
This is not a disabled feature or an empty allow-list. There is no code path
from the platform to a vehicle command interface. A configuration error
cannot enable what does not exist, and adding it would require a code change,
a review and a superseding ADR.

### 2. Tool classification and default deny

Tools are classified `read`, `propose` or `execute`. An agent identity can
bind only `read` and `propose`. There is no generic HTTP, shell or SQL tool.
Inputs and outputs are schema-validated in both directions, so a hallucinated
or injected tool call is a rejected call rather than a coerced one.

### 3. The approval gate holds the only credential that causes effects

An agent cannot mint an execution credential. The approval service issues a
single-use token only in response to an authenticated human action, and the
execution service re-validates budget, consent and entitlement at execution
time.

### Supporting rules

| Rule | Reason |
| --- | --- |
| Silence is rejection — proposals expire | An unattended queue must never become implicit approval |
| Approval binds to specific values, not "the agent's suggestion" | Re-planning with different values is a new proposal |
| Four-eyes above a configurable value | Separation of duties on material spend |
| Every proposal, approval, rejection and expiry is audited | "Zero actions without approval" becomes a query |
| Untrusted content is labelled in the context | Reduces, without relying on, injection success |

## Consequences

**Positive.** The worst outcome of a fully compromised model is a bad
proposal that a human declines — the blast radius is bounded by architecture
rather than by model behaviour. The actuation prohibition is structural and
survives configuration errors and staff turnover. Supervision is provable.
The design is explainable to a regulator in one sentence.

**Negative.** The assistant cannot deliver fully autonomous efficiency gains;
every action costs human attention. Approval latency becomes a product
metric (target: median under 30 minutes), and a slow approval queue makes the
assistant feel sluggish. Escalation machinery is needed so proposals reach a
human, and that machinery must still terminate in expiry rather than
approval.

**Neutral.** Expanding autonomy later is deliberately hard. Any such change
requires a new ADR, which is the correct amount of friction for a decision
of this kind.

## Non-negotiable

The actuation prohibition is not subject to the usual revisit-when clause. If
remote actuation ever becomes a product requirement, it is a different
product with a different safety case, a different regulatory posture and
almost certainly a different architecture — not an incremental change to this
one.
