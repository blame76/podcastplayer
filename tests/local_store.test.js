const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeDatabase {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = { contains: name => this.stores.has(name) };
  }
  createObjectStore(name, options) {
    assert.equal(options.keyPath, name === 'providerSnapshots' ? 'providerBaseUrl' : 'key');
    this.stores.set(name, new Map());
  }
  transaction(name) {
    const transaction = {
      error: null,
      objectStore: () => {
        const store = this.stores.get(name);
        const request = action => {
          const result = { result: undefined, error: null };
          queueMicrotask(() => {
            try {
              result.result = action();
              result.onsuccess?.();
              transaction.oncomplete?.();
            } catch (error) {
              result.error = error;
              transaction.error = error;
              result.onerror?.();
              transaction.onerror?.();
            }
          });
          return result;
        };
        return {
          get: key => request(() => store.get(key)),
          put: value => request(() => { store.set(value[name === 'providerSnapshots' ? 'providerBaseUrl' : 'key'], value); }),
          delete: key => request(() => { store.delete(key); }),
          getAll: () => request(() => [...store.values()])
        };
      },
      abort() { this.onabort?.(); }
    };
    return transaction;
  }
  close() {}
}

const database = new FakeDatabase();
const fakeIndexedDB = {
  open(name, version) {
    assert.equal(name, '0815podcast');
    assert.equal(version, 1);
    const request = { result: database, error: null };
    queueMicrotask(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
};
const window = {};
vm.runInNewContext(fs.readFileSync('public/assets/local-store.js', 'utf8'),
  { window, globalThis: { indexedDB: fakeIndexedDB }, Date, JSON, Promise, Error });
const LocalStore = window.LocalStore;

async function main() {
  const store = new LocalStore(fakeIndexedDB);
  const snapshot = {
    providerBaseUrl: 'https://one.example/', providerName: 'One', generatedAt: new Date().toISOString(),
    catalog: [], podcasts: [], storedAt: new Date().toISOString()
  };
  await store.putProviderSnapshot(snapshot);
  assert.equal((await store.getProviderSnapshot(snapshot.providerBaseUrl)).providerName, 'One');
  assert.equal(await store.getProviderSnapshot('https://two.example/'), undefined);
  const blob = new Blob(['audio bytes'], { type: 'audio/wav' });
  await store.putOfflineAudio(snapshot.providerBaseUrl, 'podcast:episode', blob, 'https://audio.example/a.wav');
  const record = await store.getOfflineAudio(snapshot.providerBaseUrl, 'podcast:episode');
  assert.equal(record.blob.size, blob.size);
  assert.equal(record.audioUrl, 'https://audio.example/a.wav');
  assert.equal(await store.getOfflineAudio('https://two.example/', 'podcast:episode'), undefined);
  assert.equal((await store.listOfflineAudio()).length, 1);
  await store.deleteOfflineAudio(snapshot.providerBaseUrl, 'podcast:episode');
  assert.equal((await store.listOfflineAudio()).length, 0);
  assert.equal(database.stores.size, 2, 'both object stores created on upgrade');

  const failing = new LocalStore({ open() {
    const request = { error: new Error('open failed') };
    queueMicrotask(() => request.onerror());
    return request;
  } });
  await assert.rejects(failing.getProviderSnapshot(snapshot.providerBaseUrl), /open failed/);
  await assert.rejects(new LocalStore(null).listOfflineAudio(), /nicht verfügbar/);
  console.log('IndexedDB adapter snapshot, audio CRUD and initialization errors OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
