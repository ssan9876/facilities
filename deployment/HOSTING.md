# Choose where Facilities runs

One installation manages one organization. Choose its server location and access mode at installation time; switching a mode does not move the database to another server.

| Mode | Where the application runs | Browser address and certificate |
|---|---|---|
| LAN | Your Linux server, VM or Proxmox guest | Internal HTTPS hostname or IP; certificate trusted by your users |
| Cloud | Your Linux cloud VM | Public HTTPS hostname; publicly trusted origin certificate |
| Tunnel | Either LAN or cloud Linux server | Public hostname through Cloudflare; Cloudflare manages browser HTTPS |

All modes use the same PostgreSQL volume, OIDC SSO, request settings and GitHub release updater. The app remains bound to `127.0.0.1:3000`; PostgreSQL is not published. Hosting is a server configuration choice, not a user-facing button that moves data between machines.

## LAN

Install Docker with its Compose plugin, Python 3.12+, curl, nginx and OpenSSL on your server. Follow the README production installation steps and run the release updater. Reserve the server's DHCP address or assign an address outside the DHCP pool; optionally configure an internal DNS hostname.

Place a certificate covering the chosen hostname/IP at `/etc/nginx/tls/facilities.crt` and its matching private key at `/etc/nginx/tls/facilities.key` (mode 600). Use your organization's trusted certificate authority or a public certificate for a domain you control. A self-signed certificate also works if clients explicitly trust it. Cloudflare Origin CA certificates are intended for Cloudflare-to-origin connections, not direct LAN browsers.

Register the exact OIDC callback with your provider, then preview and apply:

```sh
sudo python3 /opt/facilities/current/deployment/hosting.py lan https://facilities.example.internal
sudo python3 /opt/facilities/current/deployment/hosting.py lan https://facilities.example.internal --apply
```

The hostname can be an IPv4 LAN address instead. The selector verifies certificate coverage, expiry, and matching key, validates nginx, retains a private environment backup, and restarts only the app. LAN SSO needs a reachable identity provider; a public Syntra issuer still requires Internet connectivity.

## Cloud VM

Install the same release on a Linux cloud VM, using a fresh `.env` with new secrets and your OIDC registration. Point your domain's DNS at the VM, obtain its HTTPS certificate and install the certificate/key at the same paths as LAN mode. Allow inbound HTTPS at your cloud firewall; do not publish ports 3000 or 5432. Allow port 80 if your certificate issuance/renewal method requires it. Configure renewal using your certificate provider's tooling and reload nginx after renewal.

```sh
sudo python3 /opt/facilities/current/deployment/hosting.py cloud https://facilities.example.com
sudo python3 /opt/facilities/current/deployment/hosting.py cloud https://facilities.example.com --apply
```

Migrating an existing installation to a cloud VM requires copying configuration securely and restoring a PostgreSQL backup. Do not point two active installations at the same data during migration. Selecting `cloud` alone does not provision a VM, purchase hosting, configure its DNS or transfer its database.

## Cloudflare Tunnel

Your app can remain on your LAN, with a public HTTPS address and no inbound router port forwarding. Cloudflare terminates browser HTTPS; the connector runs on the same Linux host as Facilities and reaches `http://127.0.0.1:3000`. The connector-to-Cloudflare connection is encrypted. No separate origin certificate is needed for this local HTTP hop. This does not install a Cloudflare certificate into your LAN nginx instance.

1. Add/activate your domain in Cloudflare. Check that Universal SSL is active for the chosen hostname.
2. Create a remotely-managed Cloudflare Tunnel and use its Docker connector token. Save the token directly on the server in a root-owned file, mode 600. Do not commit it, put it in an issue, or paste it into chat.
3. Add a published application route for your hostname (for example `fmx.ssander.xyz`) with service **HTTP → `127.0.0.1:3000`**. This address applies to this project's same-host connector, which uses Linux host networking. Do not point the route at nginx port 80, where HTTP redirects can cause a loop, or at the public hostname itself.
4. Bypass Cloudflare caching for this application hostname; authenticated pages and `/api/*` responses must not be cached. Keep HTTPS redirects enabled for browser requests. Do not add Cloudflare Access in front of the callback unless you deliberately configure and test that additional sign-in layer.
5. Add `https://YOUR_HOST/auth/callback` to the Facilities OIDC client at Syntra or your provider before changing the app URL. Keep the previous callback until the new sign-in is confirmed.
6. Preview, then apply:

```sh
sudo python3 /opt/facilities/current/deployment/hosting.py tunnel https://fmx.ssander.xyz
sudo python3 /opt/facilities/current/deployment/hosting.py tunnel https://fmx.ssander.xyz \
  --token-file /root/facilities-tunnel-token --apply
```

The connector uses pinned `cloudflare/cloudflared:2026.9.3`, a read-only filesystem, no Linux capabilities, a token file mounted read-only, and no Docker socket. It runs as root inside the restricted container to read the root-only token. Its readiness endpoint is loopback-only at `127.0.0.1:49312/ready`. The selector waits for the connector before changing the app's canonical URL. Its independent Compose project is `facilities-edge`, so application release updates retain it.

Verify `https://YOUR_HOST/health`, check its browser certificate and complete SSO. The app redirects alternate browser hosts to its configured `APP_URL` so the sign-in state cookie and callback share an origin. Continue using the canonical public hostname from the LAN as well. For direct LAN access without passing through Cloudflare, use LAN mode with a trusted origin certificate and internal DNS; the Cloudflare edge certificate alone does not provide direct LAN TLS.

Switching back to LAN/cloud stops the connector managed by this selector. Remove/disable any Cloudflare route or connector you configured elsewhere yourself. Updating the hostname also requires updating your IdP callback, DNS and certificate as applicable.

Cloudflare dashboard access and a domain you control are required to publish a permanent hostname. Quick tunnels do not provide a stable SSO callback. The hosting script configures the server; it does not create Cloudflare accounts, DNS records or tunnels for you.

### Reuse a connector already on your LAN

If Cloudflare already has a working connector on another trusted LAN machine, keep that connector. Point the published route at **HTTP → the Facilities server's IP, port 80**, then use its source LAN address:

```sh
sudo python3 /opt/facilities/current/deployment/hosting.py tunnel https://fmx.ssander.xyz \
  --connector-address 192.168.88.200 --apply
```

This adds a hostname-specific nginx ingress that accepts only that connector's IPv4 address and sets the expected HTTPS forwarded scheme. It avoids the LAN listener's redirect while keeping the application and database on loopback. No new tunnel token or connector is created. The hop from an external connector across your trusted LAN to nginx is HTTP; Cloudflare's public browser certificate does not encrypt that LAN hop. Use the same-host connector above to keep that hop on loopback, or configure and verify HTTPS at the origin if you need LAN-hop encryption. Switching to LAN/cloud mode removes this selector-managed ingress; remove the published Cloudflare route separately.

Official references: [Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/), [run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/), [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/), [HTTPS origin troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/https-origins/).
