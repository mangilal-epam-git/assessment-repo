# Endpoint reference

Every URL across the three services. Ports are the defaults; each is
overridable (`MOCK_PORT`, `PORT`, `AGENT_PORT`).

| Service | Port | Started with |
| --- | --- | --- |
| Mock telemetry providers | 8081 | `node src/mock-providers/server.js` |
| Best offers | 8080 | `node src/best-offers/server.js` |
| Fleet assistant | 8082 | `node src/agent/server.js` |

Each service answers at `/` with its own endpoint list, so a wrong guess
leads somewhere useful.

---

## 8081 — mock telemetry providers

The brief's `https://<host>/provider/telemetry1`. A **separate service** from
the one that ranks offers: that separation is what makes provider identity a
property of the configured endpoint rather than of a field in a row.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | <http://localhost:8081/> | Index: routes and fault-injection options |
| GET | <http://localhost:8081/provider/telemetry1> | **Raw feed, provider 1** — five offers |
| GET | <http://localhost:8081/provider/telemetry2> | **Raw feed, provider 2** — five offers |
| GET | <http://localhost:8081/healthz> | Liveness |
| POST | `/admin/reset` | Reset the `failFirst` counters |

Fault injection, for testing the consumer's resilience:

| Query | Effect |
| --- | --- |
| `?fail=500` / `?fail=404` | HTTP error |
| `?fail=invalid-json` | 200 with a malformed body |
| `?fail=not-array` | 200 with an object instead of an array |
| `?fail=empty-body` | 200 with nothing |
| `?delayMs=2000` | Delay the response |
| `?failFirst=1` | Fail the first N requests, then succeed |

```bash
curl "http://localhost:8081/provider/telemetry1?fail=500"
curl "http://localhost:8081/provider/telemetry2?delayMs=3000"
```

---

## 8080 — best offers

| Method | Path | Purpose |
| --- | --- | --- |
| GET | <http://localhost:8080/> | Index, with the live FX and margin versions |
| GET | <http://localhost:8080/best-offers> | **The ranked result** — one winner per product |
| GET | <http://localhost:8080/healthz> | Liveness |
| GET | <http://localhost:8080/readyz> | Readiness, plus active config versions |
| GET | <http://localhost:8080/metrics> | Prometheus metrics |
| POST | `/admin/config/reload` | Reload FX and markup. Bearer token required |

```bash
curl http://localhost:8080/best-offers

curl -X POST http://localhost:8080/admin/config/reload \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

`/admin/*` returns 404 at the public edge in both clouds; it is reachable
only from inside the network.

---

## 8082 — fleet assistant

| Method | Path | Purpose |
| --- | --- | --- |
| GET | <http://localhost:8082/> | **The supervision console** |
| POST | `/agent/ask` | Ask the assistant. May create proposals |
| GET | <http://localhost:8082/agent/proposals> | Proposals for the tenant |
| GET | `/agent/proposals/{id}` | One proposal |
| POST | `/agent/proposals/{id}/approve` | Human approval. Returns a single-use token |
| POST | `/agent/proposals/{id}/reject` | Decline, with a reason |
| POST | `/agent/execute` | Carry out an approved proposal. Token required |
| GET | <http://localhost:8082/agent/audit> | The hash-chained ledger |
| GET | <http://localhost:8082/agent/audit/verify> | Chain integrity and the supervision invariant |
| GET | <http://localhost:8082/agent/tools> | The allow-list, exactly as the agent sees it |
| GET | <http://localhost:8082/agent/fleet> | Demo fleet and any raised work orders |
| GET | <http://localhost:8082/healthz> | Liveness |
| GET | <http://localhost:8082/readyz> | Readiness, model backend and egress policy |
| GET | <http://localhost:8082/metrics> | Prometheus metrics |

The full propose → approve → execute flow:

```bash
BASE=http://localhost:8082

PID=$(curl -s -X POST $BASE/agent/ask -H 'content-type: application/json' \
  -d '{"message":"Review the fleet and recommend any maintenance."}' \
  | jq -r '.proposals[0].proposalId')

DIGEST=$(curl -s $BASE/agent/proposals/$PID | jq -r .proposal.valuesDigest)

TOKEN=$(curl -s -X POST $BASE/agent/proposals/$PID/approve \
  -H 'content-type: application/json' \
  -d "{\"approver\":\"m.lindqvist\",\"valuesDigest\":\"$DIGEST\"}" | jq -r .approvalToken)

curl -s -X POST $BASE/agent/execute -H 'content-type: application/json' \
  -d "{\"approvalToken\":\"$TOKEN\",\"actor\":\"m.lindqvist\"}" | jq .proposal.status

curl -s $BASE/agent/audit/verify | jq
```

Try the token twice: the second attempt returns `TOKEN_ALREADY_USED`.

---

## Browser order for a demo

1. <http://localhost:8081/provider/telemetry1> — the inputs
2. <http://localhost:8081/provider/telemetry2>
3. <http://localhost:8080/best-offers> — what the platform concluded
4. <http://localhost:8082/> — the supervised agent

Firefox renders JSON with a collapsible viewer and is the easiest to read.

## Common mistakes

| Symptom | Cause |
| --- | --- |
| `NOT_FOUND` on `:8080/provider/telemetry1` | The feeds are on **8081**. 8080 consumes them |
| `/best-offers` returns `"offers":[]` | `FIXED_CLOCK` not set; the fixtures are correctly judged stale |
| `503 ALL_PROVIDERS_UNAVAILABLE` | The provider service on 8081 is not running |
| 401 on `/admin/config/reload` | `ADMIN_TOKEN` not set, or the bearer value does not match |
| 409 on approve | Wrong `valuesDigest`, or the agent tried to approve its own proposal |
| 409 on execute | Token already used, or no valid token supplied |
