# Wiki home

Welcome to the VectorHarbor Mobility solution documentation. This wiki describes a proposed target architecture and the implementation path for the assessment. The branch currently contains an initial ranking/access scaffold; docs identify planned work and must not be interpreted as proof that infrastructure or production controls exist.

## Start here

- [End-to-end solution design](../design/solution-design.md)
- [Architecture diagrams and ADR index](../design/README.md)
- [Terraform onboarding design](../design/iac.md)
- [Development and testing guide](../development.md)
- [User access and payment controls](User-Access-and-Payment-Controls.md)

## Audience guide

- **Project managers:** read rollout gates, open questions, and targets in the solution design.
- **Architects:** review system boundaries, data residency, identity, offer contract, DR, and the ADRs.
- **Developers:** follow the development guide and test acceptance cases.
- **Platform/IaC operators:** use the Terraform onboarding guide and checklist; Terraform resources remain to be implemented.
- **Auditors and data governance:** focus on provenance, consent, quality verification, pricing reproducibility, and append-only evidence.

## Glossary

- **Canonical product:** a versioned definition fixing region, consent scope, schema, observation window, and permitted purpose.
- **Valid event:** distinct, schema-valid, consented event under the exercise contract.
- **Provider adapter:** independently deployable integration translating a provider's systems to the published platform API contract.
- **Quality-normalised cost:** customer price divided by eligible valid-event count, scaled to 1,000 valid events.
- **Snapshot version:** immutable FX or margin configuration identifier used to calculate a particular response.
- **Human approval:** explicit authenticated approval of a proposed purchase or operational ticket after the platform rechecks its validity.

## Support and change process

Architecture changes should be proposed as a pull request with an ADR when they change a system boundary, security/privacy property, cloud service, data contract, or reliability target. Provider contract changes require a version, compatibility note, contract tests, and rollout/rollback plan. Production incidents must preserve evidence, respect jurisdiction rules, and be recorded without copying secrets or payment data into documentation.
