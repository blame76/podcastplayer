const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Target {
  constructor() {
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.classList = { toggle() {} };
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener({ type });
  }
  async dispatchAsync(type) {
    await Promise.all([...(this.listeners.get(type) || [])].map(listener => listener({ type })));
  }
  append() {}
  replaceChildren() {}
  setAttribute() {}
}

class Audio extends Target {
  constructor() {
    super();
    this.currentTime = 0;
    this.duration = NaN;
    this.playbackRate = 1;
    this.paused = true;
    this.playCount = 0;
  }
  set src(value) {
    this._src = value;
    this.currentSrc = value;
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
  }
  get src() { return this._src; }
  removeAttribute(name) { if (name === 'src') this._src = ''; }
  load() {}
  play() {
    this.playCount++;
    this.paused = false;
    this.dispatch('play');
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatch('pause');
  }
}

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
window.setInterval = () => 1;
window.clearInterval = () => {};
window.setTimeout = () => 1;
window.clearTimeout = () => {};
const storage = new Map([['0815podcast:v3', JSON.stringify({ positions: { 'fixture:first': 42, 'fixture:second': 65 } })]]);
const localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};
const handlers = {};
const positions = [];
const mediaSession = {
  setActionHandler: (action, handler) => { handlers[action] = handler; },
  setPositionState: value => { positions.push(value); }
};
class FakeStore {
  constructor() {
    this.snapshots = FakeStore.snapshots;
    this.audio = FakeStore.audio;
  }
  async getProviderSnapshot(baseUrl) { return this.snapshots.get(baseUrl); }
  async putProviderSnapshot(snapshot) { this.snapshots.set(snapshot.providerBaseUrl, snapshot); }
  async getOfflineAudio(baseUrl, key) { return this.audio.get(JSON.stringify([baseUrl, key])); }
  async putOfflineAudio(baseUrl, key, blob, audioUrl) {
    this.audio.set(JSON.stringify([baseUrl, key]), { providerBaseUrl: baseUrl, episodeKey: key, blob, audioUrl });
  }
  async deleteOfflineAudio(baseUrl, key) { this.audio.delete(JSON.stringify([baseUrl, key])); }
  async listOfflineAudio() { return [...this.audio.values()]; }
}
FakeStore.snapshots = new Map();
FakeStore.audio = new Map();

const context = {
  document, window, localStorage, LocalStore: FakeStore,
  navigator: { mediaSession },
  location: { protocol: 'file:', hostname: '127.0.0.1' },
  fetch: () => new Promise(() => {}),
  MediaMetadata: class { constructor(value) { Object.assign(this, value); } },
  Intl, Date, Map, Set, Number, Object, String, URL,
  console
};
vm.runInNewContext(fs.readFileSync('public/assets/provider-client.js', 'utf8'), context, { filename: 'provider-client.js' });
context.ProviderClient = window.ProviderClient;
const source = fs.readFileSync('public/assets/app.js', 'utf8');
const instrumented = source.replace('  boot();\n})();', '  globalThis.__playerTest = { state, loadEpisode, saveCurrentPosition, updateProgress, switchProvider, inboxEntries, togglePlaylist, ignoreOlderUnheard, getEpisodeStatus, setEpisodeStatus };\n  globalThis.__playerTest.bootPromise = boot();\n})();');
assert.ok(instrumented !== source, 'player test hooks injected');
vm.runInNewContext(instrumented, context, { filename: 'app.js' });
const { state, loadEpisode, updateProgress, switchProvider, inboxEntries, togglePlaylist, ignoreOlderUnheard, getEpisodeStatus, setEpisodeStatus } = context.__playerTest;

async function playerRegressionTests() {
  await context.__playerTest.bootPromise;
const podcast = { id: 'fixture', title: 'Fixture Podcast', author: 'Redaktion' };
const first = { id: 'first', title: 'Erste Folge', audioUrl: 'https://example.org/first.mp3' };
const second = { id: 'second', title: 'Zweite Folge', audioUrl: 'https://example.org/second.mp3' };
assert.equal(state.positions['fixture:first'], 42);
assert.equal(state.positions['fixture:second'], 65);

await loadEpisode(podcast, first, false);
const oldRestore = state.restoreListener;
assert.equal(state.restorePending, true);
assert.equal(audio.listeners.get('loadedmetadata').size, 2);

document.visibilityState = 'hidden';
document.dispatch('visibilitychange');
assert.equal(state.positions['fixture:first'], 42, 'visibilitychange before metadata preserves position');
assert.equal(JSON.parse(storage.get('0815podcast:v3')).positions['fixture:first'], 42);

await loadEpisode(podcast, second, false);
assert.equal(audio.listeners.get('loadedmetadata').size, 2, 'only one active restore listener');
assert.equal(audio.listeners.get('loadedmetadata').has(oldRestore), false);
assert.equal(audio.listeners.get('durationchange').has(oldRestore), false);
audio.dispatch('loadedmetadata');
document.dispatch('visibilitychange');
assert.equal(state.positions['fixture:second'], 65, 'unknown duration keeps saved position');
assert.equal(state.restorePending, true);
audio.duration = 120;
audio.dispatch('durationchange');
assert.equal(audio.currentTime, 65, 'current episode restored when duration becomes valid');
assert.equal(state.restorePending, false);
oldRestore();
assert.equal(audio.currentTime, 65, 'stale callback cannot seek new episode');
assert.equal(state.positions['fixture:first'], 42);

audio.currentTime = 77;
audio.dispatch('pause');
assert.equal(state.positions['fixture:second'], 77, 'pause saves position');

await loadEpisode(podcast, first, false);
const currentRestore = state.restoreListener;
await loadEpisode(podcast, first, false);
assert.equal(state.restoreListener, currentRestore, 'reselecting pending episode keeps restore listener');
audio.duration = 120;
audio.dispatch('loadedmetadata');
assert.equal(audio.currentTime, 42);
window.dispatch('pagehide');
assert.equal(state.positions['fixture:first'], 42, 'pagehide saves current position');

assert.equal(mediaSession.metadata.title, 'Erste Folge');
assert.equal(mediaSession.metadata.album, 'Fixture Podcast');
handlers.seekbackward({ seekOffset: 30 });
assert.equal(audio.currentTime, 32, 'Media Session seeks backward 10 seconds');
handlers.seekforward({ seekOffset: 30 });
assert.equal(audio.currentTime, 42, 'Media Session seeks forward 10 seconds');
handlers.play();
assert.equal(audio.playCount, 1);
handlers.pause();
assert.equal(audio.paused, true);
updateProgress();
assert.equal(positions.at(-1).position, 42);
const positionCount = positions.length;
audio.duration = Infinity;
updateProgress();
assert.equal(positions.length, positionCount, 'invalid duration does not set position');
delete mediaSession.setPositionState;
audio.duration = 120;
updateProgress();
assert.equal(positions.length, positionCount, 'unsupported position API is skipped');

const playsBeforeEnd = audio.playCount;
audio.dispatch('ended');
assert.equal(state.episodeStatus['fixture:first'], 'heard');
assert.ok(state.heardAt['fixture:first'], 'ended records heardAt');
assert.equal(state.positions['fixture:first'], undefined);
assert.equal(audio.playCount, playsBeforeEnd, 'ended does not autoplay next episode');

}

async function providerSwitchTests() {
  const demoUrl = 'https://blame76.com/0815/podcast-provider-demo/';
  const privateUrl = 'https://private.example.org/podcast-provider/';
  const timestamp = '2026-09-30T10:00:00Z';
  const demoCatalog = {
    provider: { name: '0815 Demo Provider', version: '1', contract: '0815-podcast-provider-v1' },
    generatedAt: timestamp,
    podcasts: [{ id: '0815-demo', title: '0815 Demo Podcast', description: 'Eigene Testdaten' }]
  };
  const privateCatalog = {
    provider: { name: 'Privater Provider', version: '1', contract: '0815-podcast-provider-v1' },
    generatedAt: timestamp,
    podcasts: [{ id: 'private-podcast', title: 'Privater Podcast', description: 'Eigene Testdaten' }]
  };
  const fullPodcast = (id, title, episodeId) => ({
    id, title, description: 'Eigene Testdaten', author: '0815', language: 'de',
    website: 'https://example.org/',
    episodes: [{
      id: episodeId, title: 'Testfolge', description: '', author: '0815',
      published: timestamp, durationSeconds: 30, audioUrl: 'https://example.org/audio.wav'
    }]
  });
  const requests = [];
  context.fetch = async (url, options) => {
    requests.push({ url, options });
    const privateRequest = url.startsWith(privateUrl);
    const catalog = privateRequest ? privateCatalog : demoCatalog;
    const podcast = privateRequest
      ? fullPodcast('private-podcast', 'Privater Podcast', 'demo-episode')
      : fullPodcast('0815-demo', '0815 Demo Podcast', 'demo-episode');
    return { ok: true, status: 200, json: async () => url.endsWith('/catalog')
      ? catalog : { generatedAt: timestamp, podcasts: [podcast] } };
  };

  state.episodeStatus['old-heard'] = 'heard';
  state.episodeStatus['demo-episode'] = 'heard';
  state.positions['old-position'] = 37;
  state.playlist['old-position'] = 123;
  state.subscriptions.add('old-podcast');
  await switchProvider({ baseUrl: demoUrl }, '');
  assert.equal(state.catalog[0].id, '0815-demo', 'demo provider loaded');
  assert.equal(state.episodeStatus['0815-demo:demo-episode'], 'heard', 'known legacy status migrated');
  assert.equal(state.episodeStatus['demo-episode'], undefined);
  assert.equal(state.episodeStatus['old-heard'], 'heard');
  assert.equal(state.positions['old-position'], 37);
  assert.equal(state.playlist['old-position'], 123, 'unavailable playlist entry preserved');

  const privateToken = 'test-' + Math.random().toString(36).slice(2);
  getElement('#provider-url').value = privateUrl;
  getElement('#provider-token').value = privateToken;
  await getElement('#provider-save').dispatchAsync('click');
  assert.equal(state.catalog[0].id, 'private-podcast', 'private provider loaded');
  assert.equal(state.episodeStatus['private-podcast:demo-episode'], undefined, 'same episode ID does not inherit another podcast status');
  assert.equal(state.providerToken, privateToken);
  assert.equal(JSON.parse(storage.get('0815podcast:provider:v1')).baseUrl, privateUrl);
  assert.ok(!storage.get('0815podcast:provider:v1').includes(privateToken), 'token stored separately');
  assert.equal(storage.get('0815podcast:provider-token:v1'), privateToken);
  assert.ok(requests.filter(request => request.url.startsWith(privateUrl))
    .every(request => request.options.headers.Authorization === 'Bearer ' + privateToken));
  assert.equal(state.episodeStatus['old-heard'], 'heard', 'heard state retained on private provider');
  assert.equal(state.positions['old-position'], 37);
  assert.equal(state.playlist['old-position'], 123);
  getElement('#provider-url').value = 'https://another.example.org/';
  getElement('#provider-url').dispatch('input');
  assert.equal(getElement('#provider-token').value, '', 'editing provider URL clears previous token');

  await getElement('#provider-demo').dispatchAsync('click');
  assert.equal(state.catalog[0].id, '0815-demo', 'demo provider restored');
  assert.equal(state.providerToken, '', 'demo reset clears active token');
  assert.equal(storage.has('0815podcast:provider-token:v1'), false, 'demo reset removes stored token');
  assert.ok(requests.filter(request => request.url.startsWith(demoUrl))
    .every(request => !request.options.headers.Authorization), 'demo requests carry no token');
  assert.equal(state.episodeStatus['old-heard'], 'heard');
  assert.equal(state.positions['old-position'], 37);
  assert.equal(state.playlist['old-position'], 123);
  assert.equal(state.subscriptions.has('old-podcast'), true);

  state.episodeStatus = {};
  state.playlist = {};
  state.positions = {};
  const podcasts = [...Array(4)].map((_, number) => {
    const id = `podcast-${number + 1}`;
    return {
      id, title: id, author: '0815', description: '',
      episodes: [...Array(4)].map((__, index) => ({
        id: `episode-${index + 1}`, title: `Folge ${index + 1}`,
        published: new Date(Date.UTC(2026, 8, 30 - index)).toISOString(),
        durationSeconds: 30, audioUrl: 'https://example.org/audio.wav'
      }))
    };
  });
  state.catalog = podcasts.map(({ id, title }) => ({ id, title, description: '' }));
  state.podcasts = new Map(podcasts.map(podcast => [podcast.id, podcast]));
  state.subscriptions = new Set(podcasts.map(podcast => podcast.id));
  const inbox = inboxEntries();
  assert.equal(inbox.length, 10, 'global inbox limit');
  for (const podcast of podcasts) {
    assert.ok(inbox.filter(entry => entry.podcast.id === podcast.id).length <= 3, 'per-podcast inbox limit');
  }
  ignoreOlderUnheard(podcasts[0]);
  assert.equal(getEpisodeStatus('podcast-1:episode-1'), 'unheard', 'newest unheard stays');
  assert.equal(getEpisodeStatus('podcast-1:episode-2'), 'ignored', 'older episode ignored');
  const availableKeys = podcasts.flatMap(podcast => podcast.episodes.map(episode =>
    `${podcast.id}:${episode.id}`)).filter(key => getEpisodeStatus(key) === 'unheard');
  availableKeys.slice(0, 10).forEach(togglePlaylist);
  assert.equal(Object.keys(state.playlist).length, 10, 'playlist limit');
  togglePlaylist(availableKeys[10]);
  assert.equal(Object.keys(state.playlist).length, 10, 'eleventh playlist item rejected');
  setEpisodeStatus(availableKeys[0], 'heard');
  assert.equal(state.playlist[availableKeys[0]], undefined, 'heard removes playlist entry');
  assert.equal(getEpisodeStatus(availableKeys[0]), 'heard');

  console.log('player restore, Media Session, provider switching and product limits OK');
}

playerRegressionTests().then(providerSwitchTests).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
