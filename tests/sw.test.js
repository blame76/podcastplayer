const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const handlers = {};
const deleted = [];
const caches = {
  open: async () => ({ addAll: async files => { assert.ok(files.includes('./assets/local-store.js')); }, put: async () => {} }),
  keys: async () => ['0815-podcast-shell-v5', '0815-podcast-shell-v6', 'another-app-cache'],
  delete: async key => { deleted.push(key); },
  match: async () => null
};
const self = {
  registration: { scope: 'https://player.example/app/' },
  location: { origin: 'https://player.example' },
  clients: { claim: async () => {} },
  skipWaiting() {},
  addEventListener: (name, handler) => { handlers[name] = handler; }
};
vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), { self, caches, URL, Promise,
  fetch: async () => ({ ok: true, clone() { return this; } }) });
const event = (url, method = 'GET', mode = 'cors') => {
  let responded = false;
  handlers.fetch({ request: { url, method, mode }, respondWith() { responded = true; } });
  return responded;
};
assert.equal(event('https://player.example/app/provider/catalog'), false, 'same-origin provider bypasses shell worker');
assert.equal(event('https://player.example/app/audio.wav'), false, 'audio bypasses shell worker');
assert.equal(event('https://other.example/catalog'), false);
assert.equal(event('https://player.example/app/podcasts', 'POST'), false);
assert.equal(event('https://player.example/app/assets/local-store.js'), true, 'storage script belongs to shell');
handlers.activate({ waitUntil: promise => promise.then(() => {
  assert.deepEqual(deleted, ['0815-podcast-shell-v5'], 'only old shell cache deleted');
}) });
console.log('service worker shell-only routing and cache cleanup OK');
