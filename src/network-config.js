// Public project identifiers only. Credentials belong in the cloud service.
export const NETWORK_CONFIG = Object.freeze({
  env: 'prod-d8gczi3gb667c244b',
  service: 'express-9qmf',
  publicOrigin: 'https://express-9qmf-328989-9-1507136706.sh.run.tcloudbase.com',
});

export function browserSocketURL(location = globalThis.location) {
  // Local development uses the local relay. Query strings never override the
  // production backend or route authenticated game traffic to another host.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname);
  return local ? 'ws://127.0.0.1:8787/ws' : null;
}
