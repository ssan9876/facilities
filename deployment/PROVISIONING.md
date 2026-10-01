# User provisioning and groups

An administrator opens Settings → Identity, People, Groups or Provisioning.
Identity changes the workspace name, welcome message and icon. The optional
provisioned-only policy prevents automatic account creation at SSO sign-in;
the configured bootstrap administrator remains eligible to sign in.

Groups organize people independently of requester, technician, manager and
administrator roles. Mark a group for automatic assignment to add users when
they are first provisioned. Existing people can be assigned manually. Provider
membership replacements preserve manual memberships. Manual removal clears
current membership sources; a subsequent provider sync may restore its assignment.

Create a named token in Provisioning. Copy it once and store it in the identity
provider's secret vault. Only its SHA-256 digest is stored in FMX. Tokens expire
after 1–365 days and can be revoked immediately. They cannot alter administrator
accounts, grant administrator roles, change branding or create other tokens.

## REST

Base: `https://YOUR-HOST/api/provisioning/v1`

Send `Authorization: Bearer YOUR_TOKEN` and `Content-Type: application/json`.

* `GET /users`: list people and stable FMX IDs.
* `POST /users`: create `{ "oidc_subject": "immutable-idp-user-id", "name": "Ada", "email": "ada@example.com", "role": "requester", "active": true, "group_ids": [] }`.
* `PATCH /users/{id}`: update name, email, role, active state or group_ids.
* `GET /groups`: obtain group IDs created in FMX.

The issuer is fixed to server `OIDC_ISSUER`; subjects are immutable. An existing
identity must be updated using its FMX ID. Accounts are never linked by email.
Disabling an account revokes stored FMX sessions and blocks subsequent SSO sign-in
until re-enabled. Request history is retained.

## Syntra SCIM

Base: `https://YOUR-HOST/api/provisioning/v1/scim`

Configure Syntra's SCIM target with this base URL and the bearer token; user and
group resource paths are `/Users` and `/Groups`. The supported protocol operations
follow [SCIM 2.0](https://www.rfc-editor.org/rfc/rfc7644).
Discovery, pagination, equality filters, user create/read/update/disable and group
read/member add/remove are supported. Create groups in FMX first. Bulk, passwords,
sorting, ETags and group creation through SCIM are not supported.

**Required identity mapping:** map the Syntra OIDC user's immutable UUID into
`urn:fmx:params:scim:schemas:extension:identity:2.0:User.subject` (nested extension),
or the compatibility attribute `oidc_subject` (Syntra forwards arbitrary mapped
attributes). The value must match the actual OIDC `sub`, not a person record UUID
unless those IDs are known to match. FMX deliberately rejects creates without it.
With the updated Syntra profile support, map `oidc_subject` to
`%person.syntraUserId%`. This resolves the single login linked to the Person;
people without a linked login, or with an ambiguous link, must not be provisioned
by substituting a different identifier.

Recommended Syntra account profile:

| Setting / target attribute | Template |
| --- | --- |
| Account name template | `%person.businessEmail%` |
| `oidc_subject` | `%person.syntraUserId%` |
| `displayName` | `%person.displayName%` |
| `name.givenName` | `%person.givenName%` |
| `name.familyName` | `%person.familyName%` |
| `emails` | `%person.businessEmail%` |

Do not add a separate `userName` attribute template: Syntra's connector sets it
from the Account name template, and a competing mapping would break create-retry
correlation. Keep the bootstrap administrator outside the selected create actions;
FMX intentionally rejects provisioning changes to that protected account.

Syntra uses `externalId` for an action provenance marker; FMX preserves that marker
without treating it as authentication identity. Map userName, displayName or
name.givenName/name.familyName, emails and active normally.

Example create:

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:fmx:params:scim:schemas:extension:identity:2.0:User"],
  "userName": "ada",
  "displayName": "Ada",
  "active": true,
  "urn:fmx:params:scim:schemas:extension:identity:2.0:User": { "subject": "immutable-idp-user-id" }
}
```

New SCIM users receive requester access. Administrators can change their role in
People; provisioned roles are retained on subsequent SSO logins. The connector
must have the identity mapping configured before enabling a production sync.
