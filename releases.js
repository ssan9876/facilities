import {readFileSync, promises as fs, constants} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {audit} from './audit.js';

export const installedVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;
export function compareVersions(a, b) {
  if (!/^\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+$/.test(b)) throw new Error('Invalid stable version.');
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export function setupReleases(app, env, db) {
  const repository = env.RELEASE_REPOSITORY || 'ssan9876/facilities';
  let cache;
  app.get('/api/releases', async (req, res) => {
    if (!req.user.capabilities?.includes('admin'))
      return res.status(403).json({error: 'An administrator must check releases.'});
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
      return res.status(503).json({error: 'Release repository is invalid.'});
    if (cache && Date.now() - cache.at < 60000) return res.json(cache.body);
    try {
      const get = url =>
        fetch(url, {
          headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'Facilities-release-check'},
          signal: AbortSignal.timeout(8000),
          redirect: 'manual',
        });
      let response = await get(`https://api.github.com/repos/${repository}/releases/latest`);
      // A renamed repository answers with a redirect; follow it once, and only within the GitHub API.
      if ([301, 302, 307, 308].includes(response.status)) {
        const next = new URL(response.headers.get('location') || '', 'https://api.github.com');
        if (next.protocol !== 'https:' || next.host !== 'api.github.com') throw new Error('Unexpected redirect.');
        response = await get(next.href);
      }
      const base = {
        installed: installedVersion,
        repository,
        updateCommand: 'sudo /opt/facilities/bin/facilities-update --latest',
      };
      if (response.status === 404) return res.json({...base, latest: null, available: false});
      if (!response.ok) throw new Error('GitHub release check failed.');
      const release = await response.json(),
        version = release.tag_name?.replace(/^v/, '');
      const available = !release.prerelease && !release.draft && compareVersions(version, installedVersion) > 0;
      const body = {
        ...base,
        latest: version,
        available,
        url: `https://github.com/${repository}/releases/tag/v${version}`,
        checkedAt: new Date().toISOString(),
      };
      cache = {at: Date.now(), body};
      res.json(body);
    } catch {
      res.status(503).json({error: 'Could not check GitHub releases. Try again shortly.'});
    }
  });

  // In-app updates hand a request to the host update agent through UPDATE_DIR; the agent
  // (sudo facilities-update --install-agent) runs the verified updater as root.
  const dir = env.UPDATE_DIR;
  const readJson = async name => {
    try {
      return JSON.parse(await fs.readFile(join(dir, name), 'utf8'));
    } catch {
      return null;
    }
  };
  const updateState = async () => {
    if (!dir) return {agent: false, reason: 'not-configured'};
    try {
      await fs.access(dir, constants.W_OK);
    } catch {
      return {agent: false, reason: 'not-writable'};
    }
    const [status, request] = await Promise.all([readJson('status.json'), readJson('request.json')]);
    // A request nobody picked up for a minute means the systemd agent is not installed.
    const stalled = request && Date.now() - Date.parse(request.at) > 60000;
    return {agent: true, installed: installedVersion, status, pending: !!request, stalled};
  };
  const admin = (req, res, next) =>
    req.user.capabilities?.includes('admin')
      ? next()
      : res.status(403).json({error: 'An administrator must manage updates.'});
  app.get('/api/admin/update', admin, async (req, res) => res.json(await updateState()));
  app.post('/api/admin/update', admin, async (req, res) => {
    const version = req.body?.version ?? 'latest';
    if (typeof version !== 'string' || !(version === 'latest' || /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)))
      return res.status(400).json({error: 'Choose latest or a version such as v0.2.1.'});
    const state = await updateState();
    if (!state.agent)
      return res.status(503).json({
        error:
          'In-app updates are not set up on this server. Run sudo /opt/facilities/bin/facilities-update --install-agent once.',
      });
    if (state.pending || state.status?.state === 'running')
      return res.status(409).json({error: 'An update is already in progress.'});
    const request = {id: randomUUID(), version, requested_by: req.user.name, at: new Date().toISOString()};
    const tmp = join(dir, `.request-${request.id}.json`);
    await fs.writeFile(tmp, JSON.stringify(request), {mode: 0o640});
    await fs.rename(tmp, join(dir, 'request.json'));
    await fs.writeFile(
      join(dir, 'status.json'),
      JSON.stringify({
        state: 'requested',
        version,
        message: 'Waiting for the server to start the update.',
        at: request.at,
      }),
    );
    if (db) await audit(db, req.user, 'update.request', 'settings', 'updates', `Requested an update to ${version}`);
    res.status(202).json(await updateState());
  });
}
