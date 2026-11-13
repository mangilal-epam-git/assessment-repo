# Azure Terraform platform foundation

This directory contains Terraform for a parameterized **Azure regional foundation**. It provisions an Azure resource group, virtual network and private subnets, private DNS for Blob Storage, one private StorageV2 account/container per data domain, storage lifecycle and soft-delete policies, private endpoints, and team-scoped Entra ID blob data role assignments. Adding an approved team or data domain is done through input maps rather than copied resources.

This is an infrastructure foundation, not the complete VectorHarbor platform. It does **not** create application compute, an API gateway, database, event streaming, an identity provider, payment integration, telemetry ingestion, or AI services. No user payment blocks are managed by Terraform. Workload subnets are created but have no compute or generic internet egress. Private endpoints provide access to the provisioned blob accounts; add reviewed service endpoints/NAT/firewall routes as needed by future workloads.

## Prerequisites

- Terraform >= 1.5 and < 2.0.
- Azure CLI authenticated with `az login`, or workload identity/OIDC in CI.
- Subscription permissions to create resource groups, VNets, private DNS, private endpoints, Storage accounts, and role assignments.
- An approved Azure location and storage redundancy choice confirmed for residency.
- Entra ID object IDs for approved team principals; do not use display names or broad groups without review.

## Initialize, plan, and apply

The checked-in `backend.tf` enables the AzureRM remote backend. First bootstrap a state storage account and private blob container in a separately governed state resource group, then set the backend values in an ignored `backend.hcl` copied from the example. State storage must have versioning/soft delete, restricted network access, encryption, and limited CI identity permissions.

```bash
cd infra/terraform
terraform fmt -recursive
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
# Edit both files with real subscription, approved region, Entra IDs, and backend details.
terraform init -backend-config=backend.hcl
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

Use a local backend only for disposable development: temporarily remove or rename `backend.tf` before `terraform init`; do not commit that change. Never commit state, plans, credentials, populated `terraform.tfvars`, or `backend.hcl`. Production apply must be through a protected CI workflow with short-lived federated credentials and reviewed plan.

## Onboard teams and domains

Each `teams` entry declares the responsible owner, cost center, domain grants, and Entra principal object IDs. Each `data_domains` entry declares jurisdiction, classification, retention, and an owning team. Terraform creates one private storage account/container per domain and grants the listed team principals `Storage Blob Data Contributor` on only the domain account. Invalid domain names, undeclared domain grants, undeclared owners, and unapproved locations fail closed.

Example values are illustrative only. Replace the example principal IDs with actual approved Entra object IDs. Do not use wildcard identities. A team may be granted multiple domains by adding those domain keys to `data_domains`; review all access changes. The sample role is read/write/delete—production may need split reader/writer roles and separate deletion authority.

## Security and operations

- Storage public network access is disabled, shared account-key auth is disabled, TLS 1.2+ is required, containers are private, and data is encrypted at rest by Azure Storage. The example uses platform-managed encryption keys; use a customer-managed-key design only after key access, rotation, recovery, and region requirements are specified.
- Blob private endpoints use a private DNS zone linked to the VNet. Workloads must use the private network and resolve the private endpoint hostname.
- Storage redundancy defaults to ZRS; validate region availability and legal residency. Avoid GRS/RAGRS unless cross-region replication is explicitly approved.
- Lifecycle expiration deletes blobs after the configured retention measured from last modification. Align lifecycle, soft-delete, version retention, legal holds, and deletion rights before production.
- Terraform state is sensitive. Use a separate state account/container per environment and jurisdiction with Entra authentication, locking, restricted access, and recovery testing.
- Apply policy-as-code checks for location, public access, identities, network exposure, retention, tags, and destruction. The current directory is a foundation, not a complete security landing zone.

## Input parameters

- `subscription_id`, `environment`, `project_name`, `location`, `approved_locations` — subscription and residency boundary.
- `vnet_address_space`, `workload_subnet_prefix`, `private_endpoint_subnet_prefix` — regional network.
- `teams` — ownership, cost center, approved domain grants, Entra principal object IDs.
- `data_domains` — jurisdiction, classification, retention, and owning team.
- `storage_replication_type`, soft-delete and version retention — storage continuity/lifecycle choices.
- `tags` — additional cost and governance tags.

See `terraform.tfvars.example` and `backend.hcl.example`.
