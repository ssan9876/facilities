# Facilities

A working first version of an FMX-inspired facilities-management application, built for **one organization**, with multiple buildings and users. Independent implementation and provisional branding; no FMX source code or private product access is used.

## Included

- Overview with live counts, search and status filters
- Work orders: create, assign, change status, reopen, comment
- Separate Maintenance, Schedule and Technology request queues
- Admin-only request-type switches: hide disabled types and preserve their records
- Schedule requests with start/end times in the organization's timezone (no conflict/reservation checks)
- In-app notification inbox and personal event preferences; organization-wide delivery switch
- Building and equipment registers
- Recurring preventive-maintenance plans and work-order generation
- OpenID Connect SSO with PKCE, state and nonce validation
- Requester, technician, manager and administrator permissions enforced by the API
- Persistent server-side sessions; CSRF-protected writes
- PostgreSQL deployment and SQLite local development
- Responsive UI with all fonts bundled locally
- Admin settings for workspace name, welcome message, icon and provisioned-only sign-in
- People management, manual and automatic groups, expiring provisioning tokens
- REST provisioning and a SCIM endpoint for Syntra user lifecycle and group memberships

See [provisioning setup](deployment/PROVISIONING.md) for endpoints and the required immutable SSO identity mapping.

This is an initial application, not full FMX feature parity. Attachments, inventory, facility reservations, email notifications, editing/deleting buildings and assets, reporting exports and an audit history are not implemented yet.

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

## Self hosting

Choose **LAN**, **cloud VM**, or **Cloudflare Tunnel** access using the [hosting guide](deployment/HOSTING.md). All modes remain self hosted and single organization. The guide includes a server-side selector, certificate requirements, SSO callback changes, and a same-host Cloudflare connector for managed public HTTPS.

1. Copy `.env.example` to `.env`. Set `AUTH_MODE=oidc`, `SEED_DEMO=false`, an HTTPS `APP_URL` (no path prefix), your organization name, the OIDC variables, `POSTGRES_PASSWORD`, and a random `SESSION_SECRET` with at least 32 characters. Generate secrets with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Use a hexadecimal database password so it works unescaped in the database URL.
2. Configure your reverse proxy to terminate TLS and forward to `127.0.0.1:3000`. It must **overwrite** `X-Forwarded-Proto` with the actual scheme; do not expose the backend port directly. Production trusts one proxy hop. For a proxy in a container, adjust networking deliberately rather than exposing port 3000 publicly.
3. Register an OIDC confidential web application at your identity provider with the exact redirect URI `https://your-host/auth/callback`. Use client-secret authentication and authorization code flow. Configure the ID token to contain the `groups` claim if using group-based authorization.
4. Run `docker compose up -d --build`. The application starts with an empty PostgreSQL database. An administrator signs in, creates buildings and assets, and adds maintenance plans.

Docker Compose exposes the application only on loopback. The database has no published port and persists in a named volume. The health check is `/health`.

### Identity providers

- Microsoft Entra ID: use the **tenant-specific** issuer `https://login.microsoftonline.com/YOUR_DIRECTORY_ID/v2.0`. Configure the app as single tenant; restrict enterprise application assignments. Use group **object IDs** in the role variables and configure group claims. Group-overage/Graph lookup is not implemented; use groups assigned to the app to keep the token claim within limits.
- Keycloak / Authentik / Okta: use the provider's exact issuer and configure a groups claim mapper. Provider-specific deployment still needs a live sign-in test.
- Google Workspace: an OIDC issuer can be configured, but Google ID tokens do not normally include group membership. Restrict access at the IdP or an identity broker, and use `OIDC_ADMIN_SUBJECT` for initial admin access. Workspace domain validation/group lookup is not implemented. For controlled group access, use an identity broker such as Keycloak or Authentik.
- SAML is not implemented directly. A SAML-to-OIDC broker can supply the OIDC connection.

Role variables: `OIDC_ADMIN_GROUP`, `OIDC_MANAGER_GROUP`, `OIDC_TECHNICIAN_GROUP`. Users with no role match become requesters. Optionally set `OIDC_ALLOWED_GROUPS` to a space-separated allowlist of exact group claim values; this applies even to administrators. `OIDC_ADMIN_SUBJECT` is an exact `sub` claim for administrator bootstrap. User identity is keyed by issuer plus subject, not by mutable email.

Roles are synchronized on each login, not continuously while a session is active. Sessions last eight hours with activity. Sign out clears this application's session; it does not log out of the IdP. Provider access restrictions remain essential, especially when `OIDC_ALLOWED_GROUPS` is empty.

### Permissions

| Action | Requester | Technician | Manager / Admin |
|---|---|---|---|
| Create work orders | Yes | Yes | Yes |
| View / comment on orders | Own requests | All | All |
| Change order status | No | Assigned to self | All |
| Assign work | No | No | Yes |
| Create buildings / assets / PM plans | No | No | Yes |

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

Verify restoration in a separate deployment before relying on backups. Store encrypted copies outside the host. Never run `docker compose down -v` unless intentionally deleting the database. For local SQLite backups, stop the server before copying the database file. Before updates, take a backup, then rebuild with `docker compose up -d --build`. This version adds request-type and schedule columns by checking existing schema metadata and creates settings/notification tables idempotently. Existing requests default to Maintenance. Future schema changes will need explicit migrations.

## GitHub releases and updates

Public repository: https://github.com/ssan9876/go-fmx-clone. CI runs SQLite and PostgreSQL API tests, browser checks, and a Docker build on main and pull requests. Pushing a `vMAJOR.MINOR.PATCH` tag matching `package.json` runs the same checks and publishes `facilities.tar.gz` and `SHA256SUMS` as a GitHub release. Release downloads contain source; the installation builds its own Docker image. No GitHub token is needed to download public releases.

Administrators use **Settings → Updates → Check for updates** for stable-release status and release notes. Applying updates requires server access:

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

Ten automated tests cover persistence, legacy migration, organization dates, role mapping, production guards, core flows, CSRF, request-type visibility and enforcement, admin-only settings, personal notification preferences/delivery and maintenance idempotency. Browser checks pass for creating/completing/commenting on requests, schedule times, module switches, notification preferences, navigation, and mobile overflow. GitHub CI passes against PostgreSQL 17 and SQLite, browser checks, and a Docker image build. A Linux container deployment and release upgrade were verified on Proxmox. Live Syntra discovery, client registration, PKCE authorization and the login-page redirect were verified; completing the credentialed sign-in still requires a user login. The application does not yet provide production observability, IdP backchannel logout, or automated migration tooling.
