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
Notification settings include organization-wide in-app delivery, optional email delivery, and personal preferences for new requests, assignments, status changes, comments and email. Push notifications are not implemented. Schedule requests have organization-local start/end times and can reserve a space, with conflict checks and optional manager approval.

## Confirmed since the first version
- Production runs self-hosted in a Proxmox LXC container behind a Cloudflare tunnel; updates install from the web app through a host agent, and the database is backed up nightly on the server.
- Visual identity: the "Work Ticket Pad" (numbered WO tickets, rubber-stamp states, ruled ledgers), chosen by the user.
- Permissions are capabilities: built-in role defaults live in permissions.js, administrators override them and create custom roles in Settings.
- Requesters get a simple report-a-problem view; QR labels open pre-filled requests for buildings, spaces and assets.
- Each request type has administrator-configured categories, required/optional/hidden built-in fields, and custom questions whose answers can be filtered.
- Tickets have their own pages; the assignee may edit a ticket's text; a calendar shows tickets by due day.
