# Facilities

A working first version of an FMX-inspired facilities-management application, built for **one organization**, with multiple buildings and users. Independent implementation and provisional branding; no FMX source code or private product access is used.

## Included

- Overview with live counts, search and status filters; the request register is paged and filtered on the server
- Work orders: create, edit details, assign, change status, reopen, delete, comment (authors edit/delete their comments); each ticket has its own page at `/tickets/WO-0042`, and the assignee can edit its title and description
- Photo and file attachments on requests (JPEG, PNG, GIF, WebP, HEIC, PDF, text, CSV, Word, Excel)
- Activity history on every request and an organization-wide audit log with CSV export
- Separate Maintenance, Schedule and Technology request queues
- Admin-only request-type switches: hide disabled types and preserve their records
- Schedule requests with start/end times in the organization's timezone, optional space reservations, conflict checks and manager approval
- Notifications from a dropdown on the bell (and a full inbox page), optional email delivery linking to the ticket page, and personal event and email preferences
- Building, space and equipment registers with edit, archive/restore and delete
- Recurring preventive-maintenance plans (edit, pause, resume, delete) and work-order generation
- Spare-parts inventory with stock adjustments, usage on requests and low-stock alerts
- Reports (workload, completion time, maintenance compliance, parts cost) and CSV exports
- OpenID Connect SSO with PKCE, state and nonce validation
- Capability-based permissions: built-in requester, technician, manager and administrator roles defined in `permissions.js`, per-workspace overrides and custom roles in Settings → Roles, all enforced by the API
- A focused requester view to report problems and follow their own tickets, and printable QR labels that open a pre-filled request for a building, space or asset
- Persistent server-side sessions; CSRF-protected writes
- PostgreSQL deployment and SQLite local development
- Work Ticket Pad interface: numbered WO tickets, stamped states and ruled ledgers, with a phone dock and stacked registers; Archivo bundled locally
- Admin settings for workspace name, welcome message, icon and provisioned-only sign-in
- People management, manual and automatic groups, expiring provisioning tokens
- REST provisioning and a SCIM endpoint for Syntra user lifecycle and group memberships
- OpenID Connect back-channel logout and Microsoft Graph lookup for Entra ID group overage
- Versioned database migrations, structured JSON logs, Prometheus metrics and rate limiting

See [provisioning setup](deployment/PROVISIONING.md) for endpoints and the required immutable SSO identity mapping.

This is not full FMX feature parity. Purchasing, vendor management, mobile apps, push notifications, recurring reservations and custom request forms are not implemented.

## Local development

Requires Node.js 24 or newer.

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

Open http://localhost:3000 and select **Enter demo workspace**. Demo access is an administrator login; seeded records are clearly labeled as illustrative. Data persists in `data/facilities.db`. Set `SEED_DEMO=false` for an empty local database. Demo authentication is rejected in production.

```powershell
npm test
```

For isolated browser checks, install Chromium with `npx playwright install chromium`, then run `npm run test:browser`. The checks use an in-memory database and do not edit your running workspace. Dates use `ORG_TIMEZONE` (default `America/Phoenix`); set this to your organization's IANA timezone.

## Request configuration and notifications

Administrators open **Settings → Request types** to enable or disable Maintenance, Schedule, and Technology. Switches take effect after **Save settings**. All types start enabled. Existing work orders migrate to Maintenance without deleting data. Disabled types disappear from navigation, creation forms, normal data responses, and the inbox; direct API access is rejected. Re-enabling restores the preserved records. Disabling Maintenance also pauses preventive-maintenance generation; missed intervals consolidate when it resumes. Settings are stored in the database and survive restarts. Managers cannot change organization settings.

**Settings → Notifications** controls in-app delivery for the organization. Each member uses **Notifications → Preferences** to select new-request, assignment, status, and comment updates. New requests notify managers/admins; assignments notify the assigned user; status and comment updates notify the requester and assigned user. Your own actions never notify you. Scheduled maintenance creation can notify managers/admins. Disabling delivery pauses new notifications and retains history and personal preferences. Email and push delivery are not implemented.

The inbox shows the most recent 100 notifications eligible for your access. Use **Mark all as read** to mark the displayed updates. The workspace checks for fresh data every 30 seconds while visible, except during forms, typing, or settings/preference screens. Reload those screens to fetch changes made elsewhere.

## Records, attachments and inventory

Managers edit buildings, spaces, assets and maintenance plans from their registers. Records with history (requests, plans, reservations or parts that refer to them) cannot be deleted; **Archive** hides them from new forms while keeping them on existing requests and in reports, and **Restore** brings them back. Delete is for records entered by mistake. Assets with requests or plans cannot move to another building. Paused maintenance plans are skipped by generation.

Attachments are stored in the database, so the PostgreSQL backup below includes them. Each file is checked against its type's file signature; SVG and HTML are refused. Images open inline, other files download. Limits: `ATTACHMENT_MAX_MB` (default 10) per file and `ATTACHMENT_MAX_PER_REQUEST` (default 20). Keep the proxy's `client_max_body_size` above the file limit; the supplied nginx configurations allow 12 MB.

**Inventory** lists parts with an optional building, storage location, reorder level and unit cost. Managers adjust stock with a reason; managers and the assigned technician record parts used on a request, which deducts stock atomically and refuses to go below zero. Returning a part restores the quantity. Parts at or below their reorder level are flagged on the overview and inventory pages. Administrators can turn inventory off under **Settings → Features**.

## Requesters and QR report labels

People whose role cannot see every request get a short workspace: **Your requests** with a report form on the page (type, what needs attention, building, optional asset, details and photos) and a register of their own tickets. Booking a space opens the full request sheet.

On **Buildings**, **QR labels** opens a printable sheet for that building, its spaces and its assets. Each QR code links to `APP_URL/report?building=…&asset=…`; scanning it signs the person in if needed and opens a new request with the location filled in. Set `APP_URL` to the address people's phones can reach before printing.

## Reservations

Managers add spaces (rooms or areas) to buildings under **Buildings → Spaces**, optionally requiring approval. A schedule request can reserve one space. Overlapping reservations for the same space are refused, including ones still awaiting approval; back-to-back bookings are allowed. Requests for approval-required spaces stay **Awaiting approval** until a manager approves or declines them; declined and cancelled reservations free the time. The request form shows the space's existing bookings for the chosen day; requesters see busy times without other people's titles.

## Reports and audit log

**Reports** (managers and administrators) summarizes a date range: requests opened and completed, average time to complete, open and overdue work, breakdowns by type, status, priority, building and assignee, preventive-maintenance compliance and parts cost. CSV exports cover requests (matching the register's current filters), assets, maintenance plans and parts. Cells that a spreadsheet would treat as formulas are neutralized.

Every change to requests, comments, attachments, buildings, spaces, assets, plans, parts, people, groups, provisioning tokens and settings is written to an append-only audit log with the acting user or connection (for example `Provisioning · Syntra` or `Identity provider`), a summary and field-level before/after values. Sign-ins and sign-outs are recorded too. Each request shows its own history under **Activity**; administrators search and export the full log in **Settings → Audit log**.

## Email notifications

Email is optional and off by default. Configure SMTP with `SMTP_URL` (for example `smtps://user:password@mail.example.org:465`) or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, plus `SMTP_FROM`. Port 465 uses implicit TLS; other ports require STARTTLS unless `SMTP_REQUIRE_TLS=false`. Then turn on **Settings → Notifications → Email notifications** and use **Send test email**. Each in-app notification is also emailed to recipients who keep **Also send by email** on in their preferences. Messages go through a database outbox and are retried after 1, 5, 30 and 120 minutes; the settings page shows sent, waiting and failed counts and the last error. Links in emails open the request at `APP_URL`.

## Operations

- **Migrations.** Schema changes are numbered migrations in `migrations.js`, applied once each at startup inside a transaction and recorded in `schema_migrations`. A PostgreSQL advisory lock prevents two starting containers from migrating at once. A failed migration rolls back and stops startup with its number and name. Installations from 0.2.0 adopt the versioned scheme automatically. `/health` reports the application version and schema number.
- **Logs.** One JSON object per line on stdout (`docker compose logs app`), with a request ID (also returned as `X-Request-Id`), route, status, duration and user ID. Query strings are not logged. Set `LOG_LEVEL` to `debug`, `info`, `warn`, `error` or `silent`.
- **Metrics.** Set `METRICS_TOKEN` and scrape `GET /metrics` with `Authorization: Bearer <token>` from the host (`127.0.0.1:3000`). It reports request counts and latency by route, open requests, the email outbox and process memory. The supplied nginx configurations block `/metrics` from outside.
- **Rate limits.** Per minute: sign-in 30 per client address, provisioning 600 per address, writes 300 per account and uploads 30 per account. Adjust with `RATE_LIMIT_AUTH`, `RATE_LIMIT_PROVISIONING`, `RATE_LIMIT_WRITES` and `RATE_LIMIT_UPLOADS` (0 disables one). Limits are held in memory by the single application process.
- **Sessions.** Expired sessions are removed hourly.

## Self hosting

Choose **LAN**, **cloud VM**, or **Cloudflare Tunnel** access using the [hosting guide](deployment/HOSTING.md). All modes remain self hosted and single organization. The guide includes a server-side selector, certificate requirements, SSO callback changes, and a same-host Cloudflare connector for managed public HTTPS.

1. Copy `.env.example` to `.env`. Set `AUTH_MODE=oidc`, `SEED_DEMO=false`, an HTTPS `APP_URL` (no path prefix), your organization name, the OIDC variables, `POSTGRES_PASSWORD`, and a random `SESSION_SECRET` with at least 32 characters. Generate secrets with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Use a hexadecimal database password so it works unescaped in the database URL.
2. Configure your reverse proxy to terminate TLS and forward to `127.0.0.1:3000`. It must **overwrite** `X-Forwarded-Proto` with the actual scheme; do not expose the backend port directly. Production trusts one proxy hop. For a proxy in a container, adjust networking deliberately rather than exposing port 3000 publicly.
3. Register an OIDC confidential web application at your identity provider with the exact redirect URI `https://your-host/auth/callback`. Use client-secret authentication and authorization code flow. Configure the ID token to contain the `groups` claim if using group-based authorization.
4. Run `docker compose up -d --build`. The application starts with an empty PostgreSQL database. An administrator signs in, creates buildings and assets, and adds maintenance plans.

Docker Compose exposes the application only on loopback. The database has no published port and persists in a named volume. The health check is `/health`.

### Identity providers

- Microsoft Entra ID: use the **tenant-specific** issuer `https://login.microsoftonline.com/YOUR_DIRECTORY_ID/v2.0`. Configure the app as single tenant; restrict enterprise application assignments. Use group **object IDs** in the role variables and configure group claims. For users in many groups, set `OIDC_GROUPS_OVERAGE=graph` (see below) or assign groups to the app to keep the token claim within limits.
- Keycloak / Authentik / Okta: use the provider's exact issuer and configure a groups claim mapper. Provider-specific deployment still needs a live sign-in test.
- Google Workspace: an OIDC issuer can be configured, but Google ID tokens do not normally include group membership. Restrict access at the IdP or an identity broker, and use `OIDC_ADMIN_SUBJECT` for initial admin access. Workspace domain validation/group lookup is not implemented. For controlled group access, use an identity broker such as Keycloak or Authentik.
- SAML is not implemented directly. A SAML-to-OIDC broker can supply the OIDC connection.

### Group overage (Microsoft Entra ID)

When a user belongs to too many groups, Entra ID leaves the `groups` claim out of the token. Set `OIDC_GROUPS_OVERAGE=graph` to read that user's memberships from Microsoft Graph (`/me/getMemberObjects`) at sign-in. This uses the delegated `User.Read` permission that the sign-in token already carries; no extra consent is required. The Graph endpoint is fixed, never taken from the token. Without the setting, an overage user signs in with no groups (a requester unless `OIDC_ADMIN_SUBJECT` applies, and refused when `OIDC_ALLOWED_GROUPS` is set), and the server logs a warning.

### Back-channel logout

Register `https://your-host/auth/backchannel-logout` as the client's back-channel logout URI. When a user signs out at the identity provider or is disabled there, the provider posts a signed logout token and Facilities ends the matching sessions immediately (by session ID, or every session for the subject). Tokens are verified against the provider's published keys, issuer and client ID; replays are refused. The provider must be able to reach this URL, so it works with cloud and tunnel hosting but not with a LAN-only installation that the provider cannot reach.

Role variables: `OIDC_ADMIN_GROUP`, `OIDC_MANAGER_GROUP`, `OIDC_TECHNICIAN_GROUP`. Users with no role match become requesters. Optionally set `OIDC_ALLOWED_GROUPS` to a space-separated allowlist of exact group claim values; this applies even to administrators. `OIDC_ADMIN_SUBJECT` is an exact `sub` claim for administrator bootstrap. User identity is keyed by issuer plus subject, not by mutable email.

Roles are synchronized on each login, not continuously while a session is active. Sessions last eight hours with activity. Sign out clears this application's session; it does not log out of the IdP. Signing out at the IdP ends Facilities sessions when back-channel logout is configured. Provider access restrictions remain essential, especially when `OIDC_ALLOWED_GROUPS` is empty.

### Permissions and roles

Every API check asks for a named capability (for example `requests.assign` or `inventory.manage`), never for a role name. `permissions.js` lists the capabilities and the defaults for the four built-in roles:

| Capability | Requester | Technician | Manager | Administrator |
|---|---|---|---|---|
| Submit requests, follow and comment on their own, edit their own while Open | Yes | Yes | Yes | Yes |
| See every request (`requests.view_all`) | — | Yes | Yes | Yes |
| Update work assigned to them, edit its title and description, be assigned work | — | Yes | Yes | Yes |
| Edit, update, assign and delete any request; approve reservations; moderate comments and files | — | — | Yes | Yes |
| See maintenance plans and inventory; download exports | — | Yes | Yes | Yes |
| Manage buildings, spaces, assets, maintenance plans, parts; reports | — | — | Yes | Yes |
| Administer the workspace (`admin`) | — | — | — | Yes |

To change the defaults for an installation, edit `builtinRoles` in `permissions.js` (or add capabilities to `capabilityCatalog` and check them with `can(user, '...')` / `requireCap('...')`). Administrators can also adjust any built-in role in **Settings → Roles** (stored in the database, audited, and resettable to the file's defaults) and create custom roles such as "Custodian", starting from an existing role's permissions. Assign custom roles under **Settings → People**. The administrator role always keeps every capability, and no other role can be granted `admin`. Role changes apply on each person's next request. SSO group mapping assigns only the built-in roles; give custom roles to people from Settings → People (which makes the account administrator-managed so sign-in no longer overwrites it).

### Maintenance scheduling

In production the process checks due plans on startup and hourly. One order is generated per due plan, then the next date advances to the next future occurrence. Missed intervals are consolidated, not backfilled individually. Deterministic order IDs and a unique occurrence constraint prevent duplicates. Demo mode generates only when a manager clicks **Generate due work orders**.

### Backups and updates

```sh
docker compose exec -T db pg_dump -U facilities facilities > facilities-backup.sql
```

For restore, first stop the application and restore into an empty `facilities` database:

```sh
docker compose exec -T db psql -U facilities facilities < facilities-backup.sql
```

Verify restoration in a separate deployment before relying on backups. Store encrypted copies outside the host. Never run `docker compose down -v` unless intentionally deleting the database. For local SQLite backups, stop the server before copying the database file. Before updates, take a backup, then rebuild with `docker compose up -d --build`. Version 0.2.1 introduces versioned migrations (see Operations); upgrading from 0.2.0 adds the audit log, attachments, email outbox, inventory, spaces, ticket numbers, roles and session identity tables and columns without changing existing records. Attachments make the database larger, so check backup storage.

## GitHub releases and updates

Public repository: https://github.com/ssan9876/go-fmx-clone. CI runs SQLite and PostgreSQL API tests, browser checks, and a Docker build on main and pull requests. Pushing a `vMAJOR.MINOR.PATCH` tag matching `package.json` runs the same checks and publishes `facilities.tar.gz` and `SHA256SUMS` as a GitHub release. Release downloads contain source; the installation builds its own Docker image. No GitHub token is needed to download public releases.

Administrators use **Settings → Updates → Check for updates** for stable-release status and release notes, and **Install** to update the server from the browser. The button needs the host update agent, installed once on the server:

```sh
sudo /opt/facilities/bin/facilities-update --install-agent
```

The agent is a root systemd path unit watching `/opt/facilities/run`, a folder shared with the app container. Pressing **Install** writes `request.json` there; the agent runs the same verified updater as the command below (checksum, backup, health check, rollback) and writes `status.json`, which the page shows until the new version answers and the page reloads. The request can only name `latest` or a published `vMAJOR.MINOR.PATCH` newer than the installed one; the app never gets Docker access. The full log is in `/opt/facilities/run/update.log`. Every successful update reinstalls the agent, so it stays current. Without the agent, the page shows the command to run instead.

You can still update from the server:

```sh
sudo /opt/facilities/bin/facilities-update --check
sudo /opt/facilities/bin/facilities-update --latest
# Or pin a particular published stable release:
sudo /opt/facilities/bin/facilities-update v0.1.0
```

The updater verifies SHA-256, validates archive paths, builds before downtime, stops the app, writes a PostgreSQL backup with restricted permissions, replaces only the application container, and checks the installed version and database health. Configuration remains in `/opt/facilities/.env`; PostgreSQL remains in the `facilities_postgres_data` volume. Successful source releases live in `/opt/facilities/releases` with a `current` symlink. A failed update restarts the previous application image, retaining the backup. Database restore is deliberately manual: a future release with incompatible migrations must supply a tested migration/restore plan. The current migrations are additive. Updates are administrator initiated; there is no unattended update timer or Docker socket exposed to the app.

For a fresh Linux installation, install Docker with the Compose plugin, curl, Python 3.12+, and nginx (or another TLS proxy). Create `/opt/facilities/.env` using the production variables above, set mode 600, install `deployment/facilities-update.sh` as `/opt/facilities/bin/facilities-update` with mode 755, and run `--latest`. Configure your HTTPS proxy using `deployment/nginx.conf` as a starting point. Configure a stable hostname or DHCP reservation before changing the callback registered at your IdP. Store database backups off-host as well.

### Syntra SSO

Syntra can act as the OIDC provider. Use its exact discovery issuer, register a confidential authorization-code client with PKCE and `client_secret_post`, and register the exact Facilities `/auth/callback` URL. Assign the application to a Syntra access group and map email under the `email` scope. Facilities validates signed ID tokens and UserInfo subjects. Use an immutable Syntra user ID as `OIDC_ADMIN_SUBJECT` for administrator bootstrap.

The current Syntra provider advertises standard profile/email claims but does not advertise or release a groups scope. Application assignment at Syntra controls who can sign in; the bootstrap subject becomes administrator and other assigned users become requesters. Facilities supports group-based roles when the IdP actually releases a `groups` claim, including scalar single-group values. Do not assume a Syntra claim mapping alone causes a custom group claim to appear in its tokens.

## Verification status

`npm test` runs 38 tests covering persistence, versioned and legacy migrations and transactions, organization dates, role mapping, production guards, the full role permission matrix, CSRF, session expiry and revocation, server-side paging/filtering/search, record lifecycle, request editing/deletion and comment ownership, attachments (type checks, limits, access), space conflicts and approval, inventory stock rules, reports and CSV safety, email outbox delivery and retries, SCIM discovery/paging/filters/patch paths/errors, audit attribution, Graph group overage, back-channel logout validation and replay, metrics, request IDs and rate limits. Two PostgreSQL tests run when `TEST_DATABASE_URL` is set. `npm run lint` and `npm run format:check` run ESLint and Prettier. Browser checks pass for creating/completing/commenting on requests, editing records and requests, reservations and conflicts, attachments, parts, inventory, reports, the audit log, schedule times, module switches, notification preferences, navigation, and mobile overflow. GitHub CI passes against PostgreSQL 17 and SQLite, browser checks, and a Docker image build. A Linux container deployment and release upgrade were verified on Proxmox. Live Syntra discovery, client registration, PKCE authorization and the login-page redirect were verified; completing the credentialed sign-in still requires a user login. Email delivery, Graph overage lookup and back-channel logout are verified with test doubles; confirm them against your mail server and identity provider after deployment.
