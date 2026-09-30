const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
const location = { hostname: '127.0.0.1' };
vm.runInNewContext(fs.readFileSync('public/assets/provider-client.js', 'utf8'),
  { window, location, URL, Date, Number, Set, fetch: () => { throw new Error('unexpected network'); } },
  { filename: 'provider-client.js' });
const ProviderClient = window.ProviderClient;
const catalog = {
  provider: { name: '0815 Demo Provider', version: '1', contract: '0815-podcast-provider-v1' },
  generatedAt: '2026-09-30T10:00:00Z',
  podcasts: [{ id: '0815-demo', title: '0815 Demo Podcast', description: 'Eigene Testdaten' }]
};
const podcastResponse = {
  generatedAt: catalog.generatedAt,
  podcasts: [{
    id: '0815-demo', title: '0815 Demo Podcast', description: 'Eigene Testdaten',
    episodes: [{ id: 'demo-1', title: 'Willkommen', audioUrl: 'https://example.org/audio/demo.wav' }]
  }]
};
const ok = value => ({ ok: true, status: 200, json: async () => value });
const failure = status => ({ ok: false, status, json: async () => ({ error: 'ignored' }) });

async function main() {
  const calls = [];
  const client = new ProviderClient('https://example.org/provider/', '', async (url, options) => {
    calls.push({ url, options });
    return ok(url.endsWith('/catalog') ? catalog : podcastResponse);
  });
  const tested = await client.testConnection();
  assert.equal(tested.provider.name, '0815 Demo Provider', 'demo catalog loads');
  const data = await client.podcasts(['0815-demo']);
  assert.equal(data.podcasts[0].episodes[0].title, 'Willkommen', 'podcast data loads');
  assert.equal(calls[0].url, 'https://example.org/provider/catalog');
  assert.equal(calls[1].url, 'https://example.org/provider/podcasts');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, '{"ids":["0815-demo"]}');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.referrerPolicy, 'no-referrer');
  assert.ok(calls.every(call => !call.url.includes('?')), 'no podcast IDs in query strings');

  const unknown = new ProviderClient('https://example.org/', '', async () => failure(404));
  await assert.rejects(unknown.podcasts(['0815-demo']), error => error.code === 'unknown_podcast');
  const unreachable = new ProviderClient('https://example.org/', '', async () => { throw new Error('secret network details'); });
  await assert.rejects(unreachable.catalog(), error =>
    error.code === 'provider_unreachable' && !error.message.includes('secret'));
  const invalidJson = new ProviderClient('https://example.org/', '', async () => ({
    ok: true, status: 200, json: async () => { throw new SyntaxError('invalid'); }
  }));
  await assert.rejects(invalidJson.catalog(), error => error.code === 'invalid_json');
  const wrongFormat = new ProviderClient('https://example.org/', '', async () =>
    ok({ ...catalog, provider: { name: 'Wrong', version: '2' } }));
  await assert.rejects(wrongFormat.catalog(), error => error.code === 'invalid_contract');

  const token = 'local-test-' + Math.random().toString(36).slice(2);
  let tokenRequest;
  const privateClient = new ProviderClient('https://private.example.org/podcast/', token, async (url, options) => {
    tokenRequest = { url, options };
    return ok(catalog);
  });
  await privateClient.catalog();
  assert.equal(tokenRequest.options.headers.Authorization, 'Bearer ' + token);
  assert.ok(!tokenRequest.url.includes(token), 'token never enters URL');
  assert.ok(!JSON.stringify(tokenRequest.options.body || '').includes(token), 'token never enters body');

  for (const value of ['file:///tmp/demo', 'javascript:alert(1)', 'data:text/plain,x',
    'ftp://example.org/', 'http://example.org/', 'https://user:pass@example.org/',
    'https://example.org/path?token=x']) {
    assert.throws(() => ProviderClient.validateUrl(value), error => error.code === 'invalid_provider_url', value);
  }
  assert.equal(ProviderClient.validateUrl('http://localhost:8001/demo'), 'http://localhost:8001/demo/');
  assert.throws(() => ProviderClient.validateUrl('http://localhost:8001/', 'player.example.org'),
    error => error.code === 'invalid_provider_url');

  console.log('ProviderClient contract, errors, URL and token handling OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
