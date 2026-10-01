import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('hosting', Path(__file__).resolve().parents[1] / 'deployment/hosting.py')
hosting = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosting)


class HostingTests(unittest.TestCase):
    def test_hostnames_and_lan_addresses(self):
        self.assertEqual(hosting.canonical_url('https://fmx.ssander.xyz/'), 'https://fmx.ssander.xyz')
        self.assertEqual(hosting.canonical_url('https://192.168.88.193'), 'https://192.168.88.193')

    def test_reject_urls_that_change_origin_or_inject_configuration(self):
        for url in ['http://app.example.com', 'https://user:pass@app.example.com', 'https://app.example.com/path',
                    'https://app.example.com:3000', 'https://app.example.com/?secret=1', 'https://app..example.com',
                    'https://app.example.com;evil', 'https://app.example.com/#fragment']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                hosting.canonical_url(url)

    def test_switching_modes_preserves_credentials_and_removes_duplicate_url(self):
        source = '# settings\nAPP_URL=https://old.example.com\nSESSION_SECRET=keep-secret\nPOSTGRES_PASSWORD=keep-db\nAPP_URL=https://duplicate.example.com\n'
        updated = hosting.update_environment(source, {'APP_URL': 'https://fmx.ssander.xyz', 'HOSTING_MODE': 'tunnel'})
        self.assertIn('SESSION_SECRET=keep-secret\n', updated)
        self.assertIn('POSTGRES_PASSWORD=keep-db\n', updated)
        self.assertEqual(updated.count('APP_URL='), 1)
        self.assertIn('HOSTING_MODE=tunnel\n', updated)
        self.assertEqual(hosting.update_environment(updated, {'APP_URL': 'https://fmx.ssander.xyz', 'HOSTING_MODE': 'tunnel'}), updated)

    def test_proxy_overwrites_forwarded_scheme_and_redirects_to_canonical_host(self):
        config = hosting.proxy_config('https://fmx.ssander.xyz')
        self.assertIn('proxy_set_header X-Forwarded-Proto $scheme;', config)
        self.assertIn('return 301 https://fmx.ssander.xyz$request_uri;', config)
        self.assertIn('proxy_pass http://127.0.0.1:3000;', config)

    def test_existing_connector_ingress_is_scoped_to_its_address(self):
        self.assertEqual(hosting.connector_address('192.168.88.200'), '192.168.88.200')
        for address in ['8.8.8.8', '0.0.0.0', '127.0.0.1', '192.168.88.0/24', '::1']:
            with self.subTest(address=address), self.assertRaises(ValueError):
                hosting.connector_address(address)
        config = hosting.external_tunnel_config('https://fmx.ssander.xyz', '192.168.88.200')
        self.assertIn('allow 192.168.88.200;\n  deny all;', config)
        self.assertIn('proxy_set_header X-Forwarded-Proto https;', config)
        self.assertIn('server_name fmx.ssander.xyz;', config)


if __name__ == '__main__':
    unittest.main()
