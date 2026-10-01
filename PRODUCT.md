# Facilities

## Platform
web

## Stack
User instructed continuation after scope confirmation. Initial implementation choice: Node.js, Express, PostgreSQL in Docker, SQLite for local development, plain browser JavaScript.

## Product Purpose
A self-hostable facilities-management application inspired by FMX, for one organization. Multiple buildings belong to that organization; no tenant switching or tenant provisioning.

## Capabilities and Constraints
Confirmed: facilities-management application, self hosting, single tenant, SSO compatibility.
Initial scope assumption: work orders, buildings, assets, preventive maintenance, role-based access. Identity provider remains undecided; configurable OpenID Connect integration.
Initial users assumed: requesters, technicians, managers and administrators. Brand name Facilities is provisional.

## Request types and notifications
User confirmed Maintenance, Schedule, and Technology as distinct request types. Only administrators enable or disable types organization-wide. Disabling hides navigation, forms, records and associated notifications without deleting data; preventive maintenance pauses while Maintenance is disabled. Existing work orders migrate to Maintenance.
Notification settings include organization-wide in-app delivery plus personal preferences for new requests, assignments, status changes and comments. Email/push delivery is outside this implementation. Schedule requests have organization-local start/end times; room conflict checks and reservation approval are not implemented.
