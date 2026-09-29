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
const storage = new Map([['0815podcast:v3', JSON.stringify({ positions: { first: 42, second: 65 } })]]);
const localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};
const handlers = {};
const positions = [];
const mediaSession = {
  setActionHandler: (action, handler) => { handlers[action] = handler; },
  setPositionState: value => { positions.push(value); }
};
const context = {
  document, window, localStorage,
  navigator: { mediaSession },
  location: { protocol: 'file:' },
  fetch: () => new Promise(() => {}),
  MediaMetadata: class { constructor(value) { Object.assign(this, value); } },
  Intl, Date, Map, Set, Number, Object, String,
  console
};
const source = fs.readFileSync('public/assets/app.js', 'utf8');
const instrumented = source.replace('  boot();\n})();', '  globalThis.__playerTest = { state, loadEpisode, saveCurrentPosition, updateProgress };\n  boot();\n})();');
assert.notEqual(instrumented, source, 'player test hooks injected');
vm.runInNewContext(instrumented, context, { filename: 'app.js' });
const { state, loadEpisode, updateProgress } = context.__playerTest;

const podcast = { title: 'Fixture Podcast', author: 'Redaktion' };
const first = { id: 'first', title: 'Erste Folge', audioUrl: 'https://example.org/first.mp3' };
const second = { id: 'second', title: 'Zweite Folge', audioUrl: 'https://example.org/second.mp3' };
assert.equal(state.positions.first, 42);
assert.equal(state.positions.second, 65);

loadEpisode(podcast, first, false);
const oldRestore = state.restoreListener;
assert.equal(state.restorePending, true);
assert.equal(audio.listeners.get('loadedmetadata').size, 2);

document.visibilityState = 'hidden';
document.dispatch('visibilitychange');
assert.equal(state.positions.first, 42, 'visibilitychange before metadata preserves position');
assert.equal(JSON.parse(storage.get('0815podcast:v3')).positions.first, 42);

loadEpisode(podcast, second, false);
assert.equal(audio.listeners.get('loadedmetadata').size, 2, 'only one active restore listener');
assert.equal(audio.listeners.get('loadedmetadata').has(oldRestore), false);
assert.equal(audio.listeners.get('durationchange').has(oldRestore), false);
audio.dispatch('loadedmetadata');
document.dispatch('visibilitychange');
assert.equal(state.positions.second, 65, 'unknown duration keeps saved position');
assert.equal(state.restorePending, true);
audio.duration = 120;
audio.dispatch('durationchange');
assert.equal(audio.currentTime, 65, 'current episode restored when duration becomes valid');
assert.equal(state.restorePending, false);
oldRestore();
assert.equal(audio.currentTime, 65, 'stale callback cannot seek new episode');
assert.equal(state.positions.first, 42);

audio.currentTime = 77;
audio.dispatch('pause');
assert.equal(state.positions.second, 77, 'pause saves position');

loadEpisode(podcast, first, false);
const currentRestore = state.restoreListener;
loadEpisode(podcast, first, false);
assert.equal(state.restoreListener, currentRestore, 'reselecting pending episode keeps restore listener');
audio.duration = 120;
audio.dispatch('loadedmetadata');
assert.equal(audio.currentTime, 42);
window.dispatch('pagehide');
assert.equal(state.positions.first, 42, 'pagehide saves current position');

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
assert.equal(state.episodeStatus.first, 'heard');
assert.equal(state.positions.first, undefined);
assert.equal(audio.playCount, playsBeforeEnd, 'ended does not autoplay next episode');

console.log('player restore and Media Session OK');
