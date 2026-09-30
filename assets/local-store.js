(() => {
  'use strict';

  class LocalStore {
    constructor(indexedDBImpl = globalThis.indexedDB) {
      this.indexedDB = indexedDBImpl;
      this.databasePromise = null;
    }

    open() {
      if (this.databasePromise) return this.databasePromise;
      if (!this.indexedDB) return Promise.reject(new Error('IndexedDB ist nicht verfügbar.'));
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open('0815podcast', 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('providerSnapshots')) {
            database.createObjectStore('providerSnapshots', { keyPath: 'providerBaseUrl' });
          }
          if (!database.objectStoreNames.contains('offlineAudio')) {
            database.createObjectStore('offlineAudio', { keyPath: 'key' });
          }
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            this.databasePromise = null;
          };
          resolve(request.result);
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB konnte nicht geöffnet werden.'));
        request.onblocked = () => reject(new Error('IndexedDB-Upgrade ist durch einen anderen Tab blockiert.'));
      }).catch(error => {
        this.databasePromise = null;
        throw error;
      });
      return this.databasePromise;
    }

    async transaction(storeName, mode, action) {
      const database = await this.open();
      return new Promise((resolve, reject) => {
        let result;
        let transaction;
        try {
          transaction = database.transaction(storeName, mode);
          const request = action(transaction.objectStore(storeName));
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => reject(request.error || new Error('IndexedDB-Anfrage fehlgeschlagen.'));
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error || new Error('IndexedDB-Transaktion fehlgeschlagen.'));
          transaction.onabort = () => reject(transaction.error || new Error('IndexedDB-Transaktion abgebrochen.'));
        } catch (error) {
          if (transaction) transaction.abort();
          reject(error);
        }
      });
    }

    getProviderSnapshot(baseUrl) {
      return this.transaction('providerSnapshots', 'readonly', store => store.get(baseUrl));
    }

    putProviderSnapshot(snapshot) {
      return this.transaction('providerSnapshots', 'readwrite', store => store.put(snapshot));
    }

    static audioKey(baseUrl, episodeKey) {
      return JSON.stringify([baseUrl, episodeKey]);
    }

    getOfflineAudio(baseUrl, episodeKey) {
      return this.transaction('offlineAudio', 'readonly', store => store.get(LocalStore.audioKey(baseUrl, episodeKey)));
    }

    putOfflineAudio(baseUrl, episodeKey, blob, audioUrl) {
      return this.transaction('offlineAudio', 'readwrite', store => store.put({
        key: LocalStore.audioKey(baseUrl, episodeKey),
        providerBaseUrl: baseUrl,
        episodeKey,
        audioUrl,
        downloadedAt: new Date().toISOString(),
        blob
      }));
    }

    deleteOfflineAudio(baseUrl, episodeKey) {
      return this.transaction('offlineAudio', 'readwrite', store => store.delete(LocalStore.audioKey(baseUrl, episodeKey)));
    }

    listOfflineAudio() {
      return this.transaction('offlineAudio', 'readonly', store => store.getAll());
    }
  }

  window.LocalStore = LocalStore;
})();
