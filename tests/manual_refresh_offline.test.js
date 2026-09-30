const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const demoUrl = 'https://blame76.com/0815/podcast-provider-demo/';
const privateUrl = 'https://private.example.org/';
const timestamp = '2026-09-30T10:00:00Z';
const episode = (id, title = id) => ({ id, title, published: timestamp, audioUrl: `https://audio.example/${id}.wav` });
const podcast = (title = 'Podcast', episodes = [episode('first'), episode('second')]) => ({
  id: 'demo-podcast', title, description: '', author: 'Redaktion', episodes
});
const catalog = title => ({
  provider: { name: title, version: '1', contract: '0815-podcast-provider-v1' },
  generatedAt: timestamp,
  podcasts: [{ id: 'demo-podcast', title, description: '' }]
});
const snapshot = (baseUrl = demoUrl) => ({
  providerBaseUrl: baseUrl, providerName: 'Podcast', generatedAt: timestamp,
  catalog: catalog('Podcast').podcasts, podcasts: [podcast()], storedAt: timestamp
});

class Target {
  constructor() {
    this.listeners = new Map();
    this.children = [];
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = true;
    this.classList = { toggle() {} };
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ type }); }
  async dispatchAsync(type) { await Promise.all([...(this.listeners.get(type) || [])].map(listener => listener({ type }))); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  removeAttribute() {}
}
class Audio extends Target {
  constructor() { super(); this.currentTime = 0; this.duration = NaN; this.paused = true; this.pauseCount = 0; this.srcCount = 0; this.playbackRate = 1; }
  set src(value) { this._src = value; this.srcCount++; this.currentTime = 0; this.paused = true; }
  get src() { return this._src; }
  play() { this.paused = false; this.dispatch('play'); return Promise.resolve(); }
  pause() { this.pauseCount++; this.paused = true; this.dispatch('pause'); }
  load() {}
}
function harness(db, storage, initialFetch = () => { throw new Error('unexpected network'); }) {
  const elements = new Map();
  const audio = new Audio();
  elements.set('#audio', audio);
  const getElement = selector => {
    if (!elements.has(selector)) elements.set(selector, new Target());
    return elements.get(selector);
  };
  const document = new Target();
  document.querySelector = getElement;
  document.querySelectorAll = () => [];
  document.createElement = () => new Target();
  document.visibilityState = 'visible';
  const window = new Target();
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  const revoked = [];
  let nextBlobUrl = 0;
  class TestURL extends URL {
    static createObjectURL(blob) { assert.ok(blob.size > 0); return `blob:test-${++nextBlobUrl}`; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class FakeStore {
    async getProviderSnapshot(baseUrl) { return db.snapshots.get(baseUrl); }
    async putProviderSnapshot(value) {
      if (db.failSnapshotPut) throw new Error('snapshot storage failed');
      db.snapshots.set(value.providerBaseUrl, value);
    }
    async getOfflineAudio(baseUrl, key) { return db.audio.get(JSON.stringify([baseUrl, key])); }
    async putOfflineAudio(baseUrl, key, blob, audioUrl) {
      if (db.failAudioPut) { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; }
      db.audio.set(JSON.stringify([baseUrl, key]), { providerBaseUrl: baseUrl, episodeKey: key, audioUrl, blob });
    }
    async deleteOfflineAudio(baseUrl, key) { db.audio.delete(JSON.stringify([baseUrl, key])); }
    async listOfflineAudio() { return [...db.audio.values()]; }
  }
  const requests = [];
  let fetchImpl = initialFetch;
  const context = {
    document, window, LocalStore: FakeStore, URL: TestURL, Blob, Date, Intl, Map, Set, Number, Object, String,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    navigator: { mediaSession: { setActionHandler() {} } },
    location: { protocol: 'file:', hostname: '127.0.0.1' },
    MediaMetadata: class { constructor(value) { Object.assign(this, value); } },
    fetch: (...args) => { requests.push(args); return fetchImpl(...args); },
    console
  };
  vm.runInNewContext(fs.readFileSync('public/assets/provider-client.js', 'utf8'), context);
  context.ProviderClient = window.ProviderClient;
  const source = fs.readFileSync('public/assets/app.js', 'utf8');
  const instrumented = source.replace('  boot();\n})();', `  globalThis.testApi = {
    state, refreshPodcasts, switchProvider, loadEpisode, downloadOfflineAudio, deleteOfflineAudio,
    cleanupOffline, setEpisodeStatus, episodeNode, bootPromise: boot()
  };\n})();`);
  assert.ok(instrumented !== source);
  vm.runInNewContext(instrumented, context);
  return { ...context.testApi, audio, document, requests, revoked, getElement, setFetch: value => { fetchImpl = value; } };
}
const database = () => ({ snapshots: new Map(), audio: new Map() });
const audioRecordKey = (baseUrl, key) => JSON.stringify([baseUrl, key]);
const ok = value => ({ ok: true, status: 200, json: async () => value });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  const db = database();
  const storage = new Map([['0815podcast:v3', JSON.stringify({
    subscriptions: ['saved-subscription'], episodeStatus: { 'old:heard': 'heard' },
    playlist: { 'old:playlist': 42 }, positions: { 'old:position': 17 }, initialized: true
  })]]);
  const app = harness(db, storage);
  await app.bootPromise;
  assert.equal(app.requests.length, 0, 'first start does not fetch');
  assert.equal(app.getElement('#app-status').textContent, 'Noch keine Podcastdaten geladen.');
  assert.equal(app.getElement('#provider-refresh').hidden, false);

  let version = 1;
  app.setFetch(async url => {
    if (url.endsWith('/catalog')) return ok(catalog('Podcast ' + version));
    if (url.endsWith('/podcasts')) return ok({ generatedAt: timestamp, podcasts: [podcast('Podcast ' + version,
      version === 3 ? [episode('second')] : [episode('first', 'Folge ' + version), episode('second')])] });
    throw new Error('unexpected audio request');
  });
  await app.refreshPodcasts();
  assert.equal(app.requests.length, 2, 'manual refresh uses ProviderClient GET and POST');
  assert.equal(app.requests[0][1].method, 'GET');
  assert.equal(app.requests[1][1].method, 'POST');
  assert.equal(db.snapshots.get(demoUrl).providerName, 'Podcast 1');
  assert.equal(app.state.podcasts.get('demo-podcast').title, 'Podcast 1');
  assert.ok(app.state.subscriptions.has('saved-subscription'));
  assert.equal(app.state.episodeStatus['old:heard'], 'heard');
  assert.equal(app.state.playlist['old:playlist'], 42);
  assert.equal(app.state.positions['old:position'], 17);

  await app.loadEpisode(app.state.podcasts.get('demo-podcast'), app.state.podcasts.get('demo-podcast').episodes[0], true);
  app.audio.duration = 120;
  app.audio.dispatch('loadedmetadata');
  app.audio.currentTime = 31;
  const originalSrc = app.audio.src;
  const pauseCount = app.audio.pauseCount;
  const srcCount = app.audio.srcCount;
  const restoreToken = app.state.restoreToken;
  version = 2;
  await app.refreshPodcasts();
  assert.equal(app.audio.pauseCount, pauseCount, 'refresh does not pause audio');
  assert.equal(app.audio.srcCount, srcCount, 'refresh does not replace source');
  assert.equal(app.audio.src, originalSrc);
  assert.equal(app.audio.currentTime, 31);
  assert.equal(app.state.restoreToken, restoreToken, 'refresh does not restart restore');
  assert.equal(app.state.currentEpisode.title, 'Folge 2', 'current metadata updated');
  version = 3;
  await app.refreshPodcasts();
  assert.equal(app.audio.src, originalSrc, 'orphan episode continues');
  assert.equal(app.state.currentEpisode.id, 'first');

  const beforeFailure = db.snapshots.get(demoUrl);
  app.setFetch(async () => { throw new Error('network down'); });
  await app.refreshPodcasts();
  assert.equal(db.snapshots.get(demoUrl), beforeFailure, 'failed refresh retains snapshot');
  assert.equal(app.audio.src, originalSrc, 'failed refresh retains playback');
  assert.match(app.getElement('#refresh-message').textContent, /bisherige Stand bleibt erhalten/);
  db.failSnapshotPut = true;
  app.setFetch(async url => url.endsWith('/catalog') ? ok(catalog('New')) : ok({ generatedAt: timestamp, podcasts: [podcast('New')] }));
  await app.refreshPodcasts();
  assert.equal(db.snapshots.get(demoUrl), beforeFailure, 'failed IDB commit retains snapshot');
  db.failSnapshotPut = false;

  const restarted = harness(db, storage);
  await restarted.bootPromise;
  assert.equal(restarted.requests.length, 0, 'restart with snapshot does not fetch');
  restarted.document.dispatch('visibilitychange');
  await flush();
  assert.equal(restarted.requests.length, 0, 'visibility change does not fetch provider');
  assert.equal(restarted.state.podcasts.get('demo-podcast').episodes.length, 1);
  assert.equal(restarted.getElement('#status-panel').hidden, true);
  const corrupted = database();
  corrupted.snapshots.set(demoUrl, { ...snapshot(), providerBaseUrl: privateUrl });
  const invalid = harness(corrupted, new Map());
  await invalid.bootPromise;
  assert.equal(invalid.state.catalog.length, 0, 'wrong-provider snapshot ignored');
  assert.equal(invalid.requests.length, 0);

  app.setFetch(async url => url.endsWith('/catalog') ? ok(catalog('Private')) : ok({ generatedAt: timestamp, podcasts: [podcast('Private')] }));
  const switched = await app.switchProvider({ baseUrl: privateUrl }, 'test-token');
  assert.equal(switched.baseUrl, privateUrl);
  assert.ok(app.audio.pauseCount > pauseCount, 'actual provider switch resets player');
  assert.ok(db.snapshots.has(privateUrl), 'new snapshot bound to new provider');
  assert.ok(db.snapshots.has(demoUrl), 'old snapshot retained');
  assert.equal(JSON.parse(storage.get('0815podcast:provider:v1')).baseUrl, privateUrl);

  const offlineDb = database();
  offlineDb.snapshots.set(demoUrl, snapshot());
  const offlineStorage = new Map();
  const offline = harness(offlineDb, offlineStorage);
  await offline.bootPromise;
  let audioFetchFail = false;
  offline.setFetch(async (url, options) => {
    assert.equal(options.mode, 'cors');
    assert.equal(options.credentials, 'omit');
    if (audioFetchFail) throw new TypeError('CORS blocked');
    return { ok: true, type: 'cors', headers: { get: () => 'audio/wav' }, blob: async () => new Blob(['complete audio'], { type: 'audio/wav' }) };
  });
  const currentPodcast = offline.state.podcasts.get('demo-podcast');
  await offline.downloadOfflineAudio(currentPodcast, currentPodcast.episodes[0]);
  assert.equal(offlineDb.audio.get(audioRecordKey(demoUrl, 'demo-podcast:first')).blob.size, 14);
  assert.ok(offline.state.offlineKeys.has('demo-podcast:first'));
  await offline.loadEpisode(currentPodcast, currentPodcast.episodes[0], false);
  assert.match(offline.audio.src, /^blob:test-/);
  offline.audio.duration = 120;
  offline.audio.dispatch('loadedmetadata');
  offline.audio.currentTime = 55;
  assert.equal(offline.audio.currentTime, 55, 'offline seek works through audio element');
  const firstBlobUrl = offline.audio.src;
  await offline.loadEpisode(currentPodcast, currentPodcast.episodes[1], false);
  assert.ok(offline.revoked.includes(firstBlobUrl), 'old Blob URL revoked');
  audioFetchFail = true;
  await offline.downloadOfflineAudio(currentPodcast, currentPodcast.episodes[1]);
  assert.equal(offlineDb.audio.has(audioRecordKey(demoUrl, 'demo-podcast:second')), false);
  assert.match(offline.getElement('#notice').textContent, /nicht direkt offline gespeichert/);
  assert.equal(offline.requests.at(-1)[1].mode, 'cors');
  offline.setFetch(async () => ({ ok: true, type: 'cors', headers: { get: () => 'text/html' },
    blob: async () => new Blob(['<html>error</html>'], { type: 'text/html' }) }));
  await offline.downloadOfflineAudio(currentPodcast, currentPodcast.episodes[1]);
  assert.equal(offlineDb.audio.has(audioRecordKey(demoUrl, 'demo-podcast:second')), false, 'HTML error is not saved as audio');
  assert.match(offline.getElement('#notice').textContent, /keine Audiodatei/);
  offline.setFetch(async () => ({ ok: true, type: 'cors', headers: { get: () => 'audio/wav' },
    blob: async () => new Blob(['complete audio'], { type: 'audio/wav' }) }));
  offlineDb.failAudioPut = true;
  await offline.downloadOfflineAudio(currentPodcast, currentPodcast.episodes[1]);
  assert.match(offline.getElement('#notice').textContent, /Nicht genügend lokaler Speicher/);
  assert.ok(offlineDb.audio.has(audioRecordKey(demoUrl, 'demo-podcast:first')), 'existing download survives quota failure');
  offlineDb.failAudioPut = false;

  const reopened = harness(offlineDb, offlineStorage);
  await reopened.bootPromise;
  assert.equal(reopened.requests.length, 0, 'offline restart does not fetch provider');
  assert.ok(reopened.state.offlineKeys.has('demo-podcast:first'));
  await reopened.loadEpisode(reopened.state.podcasts.get('demo-podcast'), reopened.state.podcasts.get('demo-podcast').episodes[0], false);
  assert.match(reopened.audio.src, /^blob:test-/);
  reopened.audio.duration = 120;
  reopened.audio.dispatch('loadedmetadata');
  reopened.audio.currentTime = 60;
  assert.equal(reopened.audio.currentTime, 60);
  const firstNode = reopened.episodeNode(reopened.state.podcasts.get('demo-podcast'),
    reopened.state.podcasts.get('demo-podcast').episodes[0]);
  firstNode.children[1].children.find(button => button.textContent === 'Als gehört').dispatch('click');
  assert.ok(reopened.state.heardAt['demo-podcast:first'], 'manual mark records heardAt');
  await reopened.cleanupOffline(false);
  assert.ok(offlineDb.audio.has(audioRecordKey(demoUrl, 'demo-podcast:first')), 'grace period keeps recent heard episode');
  reopened.state.heardAt['demo-podcast:first'] = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  reopened.audio.play();
  await reopened.cleanupOffline(false);
  assert.ok(offlineDb.audio.has(audioRecordKey(demoUrl, 'demo-podcast:first')), 'currently playing episode protected');
  reopened.audio.pause();
  reopened.getElement('#auto-cleanup').checked = false;
  reopened.getElement('#auto-cleanup').dispatch('change');
  await reopened.cleanupOffline(false);
  assert.ok(offlineDb.audio.has(audioRecordKey(demoUrl, 'demo-podcast:first')), 'disabled auto cleanup retains audio');
  await reopened.getElement('#cleanup-now').dispatchAsync('click');
  assert.match(reopened.getElement('#cleanup-message').textContent, /1 Offline-Folgen gelöscht/);
  assert.equal(offlineDb.audio.has(audioRecordKey(demoUrl, 'demo-podcast:first')), false);
  assert.equal(reopened.state.episodeStatus['demo-podcast:first'], 'heard', 'cleanup keeps status');
  const heardNode = reopened.episodeNode(reopened.state.podcasts.get('demo-podcast'),
    reopened.state.podcasts.get('demo-podcast').episodes[0]);
  heardNode.children[1].children.find(button => button.textContent === 'Als nicht gehört').dispatch('click');
  assert.equal(reopened.state.heardAt['demo-podcast:first'], undefined);
  await reopened.state.localStore.putOfflineAudio(demoUrl, 'demo-podcast:second', new Blob(['audio']), 'https://audio.example/second.wav');
  reopened.state.offlineKeys.add('demo-podcast:second');
  const node = reopened.episodeNode(reopened.state.podcasts.get('demo-podcast'), reopened.state.podcasts.get('demo-podcast').episodes[1], { context: 'detail' });
  const actions = node.children[1];
  const ignore = actions.children.find(button => button.textContent === 'Interessiert mich nicht');
  ignore.dispatch('click');
  await flush();
  assert.equal(offlineDb.audio.has(audioRecordKey(demoUrl, 'demo-podcast:second')), false, 'ignored deletes audio immediately');
  assert.equal(reopened.state.heardAt['demo-podcast:second'], undefined);
  console.log('manual refresh, offline playback, restart and cleanup OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
