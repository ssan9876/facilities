#!/usr/bin/env python3
"""Prepare hosting configuration without moving data or changing IdP registration."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit


def canonical_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or
            parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/') or
            parsed.port not in (None, 443)):
        raise ValueError('Use a root HTTPS URL on port 443, such as https://facilities.example.com.')
    host = parsed.hostname
    try:
        address = ipaddress.ip_address(host)
        if address.version != 4:
            raise ValueError('Use an IPv4 address or DNS hostname.')
    except ValueError:
        if not re.fullmatch(r'(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host):
            raise ValueError('Invalid hostname.')
        if any(not part or len(part) > 63 or part.startswith('-') or part.endswith('-') for part in host.split('.')):
            raise ValueError('Invalid hostname.')
    return 'https://' + host


def update_environment(text, values):
    lines = text.splitlines()
    for key, value in values.items():
        found = False
        updated = []
        for line in lines:
            if re.match(r'^\s*' + re.escape(key) + r'\s*=', line):
                if not found:
                    updated.append(key + '=' + value)
                found = True
            else:
                updated.append(line)
        lines = updated
        if not found:
            lines.append(key + '=' + value)
    return '\n'.join(lines) + '\n'


def proxy_config(url):
    host = urlsplit(url).hostname
    return f'''server {{
  listen 80 default_server;
  server_name _;
  return 301 {url}$request_uri;
}}
server {{
  listen 443 ssl default_server;
  server_name {host};
  ssl_certificate /etc/nginx/tls/facilities.crt;
  ssl_certificate_key /etc/nginx/tls/facilities.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  if ($host != "{host}") {{ return 301 {url}$request_uri; }}
  # Keep above ATTACHMENT_MAX_MB; metrics stay off the public interface.
  client_max_body_size 12m;
  location = /metrics {{ deny all; }}
  location / {{
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
  }}
}}
'''


def connector_address(value):
    address = ipaddress.ip_address(value)
    if (address.version != 4 or not address.is_private or address.is_loopback or
            address.is_unspecified or address.is_link_local or address.is_multicast):
        raise ValueError('Use the existing connector\'s private IPv4 LAN address.')
    return str(address)


def external_tunnel_config(url, connector):
    host = urlsplit(url).hostname
    return f'''# Managed by Facilities hosting selector
server {{
  listen 80;
  server_name {host};
  allow {connector};
  deny all;
  client_max_body_size 12m;
  location = /metrics {{ deny all; }}
  location / {{
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host {host};
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
  }}
}}
'''


def private_write(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        os.fchmod(handle, mode)
        with os.fdopen(handle, 'w') as stream:
            stream.write(content)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def wait_ready(url, version=None):
    for attempt in range(30):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    if version is None:
                        return
                    result = json.load(response)
                    if result.get('ok') and result.get('version') == version:
                        return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('Service did not become healthy: ' + url)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['lan', 'cloud', 'tunnel'])
    parser.add_argument('url', type=canonical_url)
    parser.add_argument('--home', type=Path, default=Path('/opt/facilities'))
    tunnel = parser.add_mutually_exclusive_group()
    tunnel.add_argument('--token-file', type=Path)
    tunnel.add_argument('--connector-address', type=connector_address, help='Reuse a connector already running on this LAN.')
    parser.add_argument('--apply', action='store_true', help='Apply after registering the callback at your IdP.')
    args = parser.parse_args()
    if args.mode != 'tunnel' and (args.token_file or args.connector_address):
        parser.error('Connector options apply only to tunnel mode.')
    home = args.home.resolve()
    print(json.dumps({'mode': args.mode, 'url': args.url, 'oidcCallback': args.url + '/auth/callback',
                      'origin': 'http://127.0.0.1:3000', 'apply': args.apply}, indent=2))
    if not args.apply:
        print('Plan only. Register the exact callback at your IdP before applying.')
        return
    if os.geteuid() != 0:
        parser.error('Run --apply with sudo.')
    import fcntl
    lock = open(home / 'update.lock', 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error('Another update or hosting configuration is running.')
    current = home / 'current'
    if not (current / 'package.json').is_file() or not (home / '.env').is_file():
        parser.error('Install Facilities and configure its .env first.')
    env = home / '.env'
    env_text = env.read_text()
    env_new = update_environment(env_text, {'APP_URL': args.url, 'HOSTING_MODE': args.mode})
    rollback_proxy = lambda: None
    if args.mode == 'tunnel' and args.connector_address:
        config = Path('/etc/nginx/sites-available/facilities-tunnel')
        link = Path('/etc/nginx/sites-enabled/facilities-tunnel')
        old_config = config.read_text() if config.is_file() else None
        old_link = os.readlink(link) if link.is_symlink() else None
        if (old_config and not old_config.startswith('# Managed by Facilities hosting selector')) or (link.exists() and not link.is_symlink()):
            parser.error('A custom facilities-tunnel nginx configuration already exists; inspect it first.')
        def restore_external_proxy():
            if link.is_symlink():
                link.unlink()
            if old_link:
                link.symlink_to(old_link)
            if old_config is not None:
                private_write(config, old_config, 0o644)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=False)
        rollback_proxy = restore_external_proxy
        private_write(config, external_tunnel_config(args.url, args.connector_address), 0o644)
        if link.is_symlink():
            link.unlink()
        link.symlink_to(config)
        try:
            subprocess.run(['nginx', '-t'], check=True)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        except Exception:
            restore_external_proxy()
            raise
    elif args.mode == 'tunnel':
        if not args.token_file or not args.token_file.is_file():
            parser.error('Supply --token-file containing a remotely-managed Cloudflare Tunnel token.')
        token = args.token_file.read_text().strip()
        if not re.fullmatch(r'[A-Za-z0-9_+/=-]{40,}', token):
            parser.error('Tunnel token file is invalid.')
        private_write(home / 'cloudflare-token', token + '\n')
        edge = ['docker', 'compose', '--project-name', 'facilities-edge', '-f', str(current / 'deployment/tunnel.yaml')]
        edge_env = {**os.environ, 'CLOUDFLARE_TUNNEL_TOKEN_FILE': str(home / 'cloudflare-token')}
        # The independent connector does not modify the database or application.
        subprocess.run(edge + ['up', '-d'], env=edge_env, check=True)
        wait_ready('http://127.0.0.1:49312/ready')
    else:
        certificate = Path('/etc/nginx/tls/facilities.crt')
        key = Path('/etc/nginx/tls/facilities.key')
        if not certificate.is_file() or not key.is_file():
            parser.error('Install your TLS certificate and key under /etc/nginx/tls first.')
        host = urlsplit(args.url).hostname
        check = '-checkip' if re.fullmatch(r'[0-9.]+', host) else '-checkhost'
        match = subprocess.run(['openssl', 'x509', '-in', str(certificate), '-noout', check, host], check=True, capture_output=True, text=True)
        if 'does match certificate' not in match.stdout:
            parser.error('The TLS certificate does not cover this hostname.')
        subprocess.run(['openssl', 'x509', '-in', str(certificate), '-noout', '-checkend', '0'], check=True)
        cert_public = subprocess.check_output(['openssl', 'x509', '-in', str(certificate), '-noout', '-pubkey'])
        key_public = subprocess.check_output(['openssl', 'pkey', '-in', str(key), '-pubout'])
        if cert_public != key_public:
            parser.error('TLS certificate and private key do not match.')
        config = Path('/etc/nginx/sites-available/facilities')
        old_config = config.read_text() if config.is_file() else None
        link = Path('/etc/nginx/sites-enabled/default')
        old_link = os.readlink(link) if link.is_symlink() else None
        if link.exists() and not link.is_symlink():
            parser.error('sites-enabled/default is a regular file; configure nginx manually to preserve it.')
        def restore_proxy():
            if link.is_symlink():
                link.unlink()
            if old_link:
                link.symlink_to(old_link)
            if old_config is not None:
                private_write(config, old_config, 0o644)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=False)
        rollback_proxy = restore_proxy
        private_write(config, proxy_config(args.url), 0o644)
        if link.is_symlink():
            link.unlink()
        link.symlink_to(config)
        try:
            subprocess.run(['nginx', '-t'], check=True)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        except Exception:
            restore_proxy()
            raise
    # Retain the previous environment privately for an explicit rollback.
    private_write(home / '.env.before-hosting', env_text)
    private_write(env, env_new)
    version = json.loads((current / 'package.json').read_text())['version']
    command = ['docker', 'compose', '--project-name', 'facilities', '--env-file', str(env),
               '-f', str(current / 'compose.yaml'), '-f', str(current / 'deployment/image.yaml')]
    try:
        subprocess.run(command + ['up', '-d', '--no-deps', '--no-build', 'app'],
                       env={**os.environ, 'FACILITIES_IMAGE': 'facilities:' + version}, check=True)
        wait_ready('http://127.0.0.1:3000/health', version)
    except Exception:
        private_write(env, env_text)
        rollback_proxy()
        subprocess.run(command + ['up', '-d', '--no-deps', '--no-build', 'app'],
                       env={**os.environ, 'FACILITIES_IMAGE': 'facilities:' + version}, check=False)
        raise
    if args.mode != 'tunnel' and (home / 'cloudflare-token').is_file():
        subprocess.run(['docker', 'compose', '--project-name', 'facilities-edge', '-f', str(current / 'deployment/tunnel.yaml'), 'stop', 'cloudflared'],
                       env={**os.environ, 'CLOUDFLARE_TUNNEL_TOKEN_FILE': str(home / 'cloudflare-token')}, check=True)
    if args.mode != 'tunnel' or not args.connector_address:
        external_link = Path('/etc/nginx/sites-enabled/facilities-tunnel')
        external_config = Path('/etc/nginx/sites-available/facilities-tunnel')
        if external_link.is_symlink() and external_config.is_file() and external_config.read_text().startswith('# Managed by Facilities hosting selector'):
            external_link.unlink()
            subprocess.run(['nginx', '-t'], check=True)
            subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    print('Applied. Verify HTTPS /health and complete a real SSO sign-in. Data remains in the existing database volume.')


if __name__ == '__main__':
    main()
