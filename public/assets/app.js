(() => {
  'use strict';

  const STORAGE_KEY = '0815podcast:v3';
  const LEGACY_STORAGE_KEY = '0815podcast:v2';
  const PROVIDER_KEY = '0815podcast:provider:v1';
  const PROVIDER_TOKEN_KEY = '0815podcast:provider-token:v1';
  const SAVE_INTERVAL_MS = 5000;
  const INBOX_LIMIT = 10;
  const PER_PODCAST_INBOX_LIMIT = 3;
  const PLAYLIST_LIMIT = 10;
  const DETAIL_PAGE_SIZE = 10;
  const OFFLINE_GRACE_MS = 15 * 60 * 1000;

  const state = {
    catalog: [],
    podcasts: new Map(),
    subscriptions: new Set(),
    episodeStatus: {},
    heardAt: {},
    autoCleanup: true,
    offlineKeys: new Set(),
    downloading: new Set(),
    localStore: new LocalStore(),
    activeBlobUrl: null,
    episodeLoadId: 0,
    playlist: {},
    positions: {},
    sort: 'newest',
    filterPodcast: 'all',
    currentView: 'subscriptions',
    detailPodcastId: null,
    detailPage: 1,
    currentEpisode: null,
    currentPodcast: null,
    saveTimer: null,
    restoreListener: null,
    restorePending: false,
    restoreToken: 0,
    providerConfig: null,
    providerToken: '',
    providerClient: null,
    providerRequestId: 0,
    initialized: false
  };

  const el = {
    statusPanel: document.querySelector('#status-panel'),
    status: document.querySelector('#app-status'),
    providerActive: document.querySelector('#provider-active'),
    providerUrl: document.querySelector('#provider-url'),
    providerToken: document.querySelector('#provider-token'),
    providerTest: document.querySelector('#provider-test'),
    providerSave: document.querySelector('#provider-save'),
    providerDemo: document.querySelector('#provider-demo'),
    providerRefresh: document.querySelector('#provider-refresh'),
    refreshMessage: document.querySelector('#refresh-message'),
    autoCleanup: document.querySelector('#auto-cleanup'),
    cleanupNow: document.querySelector('#cleanup-now'),
    cleanupMessage: document.querySelector('#cleanup-message'),
    providerMessage: document.querySelector('#provider-message'),
    dataGeneratedAt: document.querySelector('#data-generated-at'),
    viewTabs: document.querySelector('#view-tabs'),
    tabButtons: [...document.querySelectorAll('[data-view]')],
    subscriptionsView: document.querySelector('#subscriptions-view'),
    playlistView: document.querySelector('#playlist-view'),
    playlistCount: document.querySelector('#playlist-count'),
    unheardList: document.querySelector('#unheard-list'),
    playlistList: document.querySelector('#playlist-list'),
    podcastList: document.querySelector('#podcast-list'),
    podcastFilter: document.querySelector('#podcast-filter'),
    detailSection: document.querySelector('#detail-section'),
    detail: document.querySelector('#podcast-detail'),
    detailBack: document.querySelector('#detail-back'),
    sort: document.querySelector('#sort-order'),
    notice: document.querySelector('#notice'),
    player: document.querySelector('#player'),
    audio: document.querySelector('#audio'),
    playerTitle: document.querySelector('#player-title'),
    playerPodcast: document.querySelector('#player-podcast'),
    toStart: document.querySelector('#to-start'),
    back10: document.querySelector('#back-10'),
    playPause: document.querySelector('#play-pause'),
    forward10: document.querySelector('#forward-10'),
    progress: document.querySelector('#progress'),
    currentTime: document.querySelector('#current-time'),
    duration: document.querySelector('#duration')
  };

  function loadLocalState() {
    let saved = {};
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) {
        saved = JSON.parse(current);
      } else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '{}');
        saved = {
          subscriptions: legacy.subscriptions,
          episodeStatus: Object.fromEntries(Object.keys(legacy.heard || {}).filter(id => legacy.heard[id]).map(id => [id, 'heard'])),
          positions: legacy.positions,
          sort: legacy.sort,
          initialized: legacy.initialized,
          playlist: {}
        };
      }
    } catch {
      saved = {};
    }

    state.subscriptions = new Set(Array.isArray(saved.subscriptions) ? saved.subscriptions : []);
    state.episodeStatus = saved.episodeStatus && typeof saved.episodeStatus === 'object' ? saved.episodeStatus : {};
    state.heardAt = saved.heardAt && typeof saved.heardAt === 'object' ? saved.heardAt : {};
    state.autoCleanup = saved.autoCleanup !== false;
    el.autoCleanup.checked = state.autoCleanup;
    state.playlist = saved.playlist && typeof saved.playlist === 'object' ? saved.playlist : {};
    state.positions = saved.positions && typeof saved.positions === 'object' ? saved.positions : {};
    state.sort = saved.sort === 'oldest' ? 'oldest' : 'newest';
    state.initialized = saved.initialized === true;
    el.sort.value = state.sort;
  }

  function persistLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      subscriptions: [...state.subscriptions],
      episodeStatus: state.episodeStatus,
      heardAt: state.heardAt,
      autoCleanup: state.autoCleanup,
      playlist: state.playlist,
      positions: state.positions,
      sort: state.sort,
      initialized: state.initialized
    }));
  }

  function loadProviderSettings() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(PROVIDER_KEY) || 'null');
      if (saved?.baseUrl) saved.baseUrl = ProviderClient.validateUrl(saved.baseUrl);
    } catch {
      saved = null;
    }
    state.providerConfig = saved?.baseUrl
      ? { name: typeof saved.name === 'string' ? saved.name : 'Feed Provider', baseUrl: saved.baseUrl }
      : { ...ProviderClient.DEFAULT_PROVIDER };
    state.providerToken = state.providerConfig.baseUrl === ProviderClient.DEFAULT_PROVIDER.baseUrl
      ? '' : (localStorage.getItem(PROVIDER_TOKEN_KEY) || '');
    el.providerUrl.value = state.providerConfig.baseUrl;
    el.providerToken.value = state.providerToken;
  }

  function persistProviderSettings(config, token) {
    localStorage.setItem(PROVIDER_KEY, JSON.stringify({ name: config.name, baseUrl: config.baseUrl }));
    if (token) localStorage.setItem(PROVIDER_TOKEN_KEY, token);
    else localStorage.removeItem(PROVIDER_TOKEN_KEY);
  }

  function resetPlayerForProviderChange() {
    saveCurrentPosition();
    el.audio.pause();
    stopPositionTimer();
    if (state.restoreListener) {
      el.audio.removeEventListener('loadedmetadata', state.restoreListener);
      el.audio.removeEventListener('durationchange', state.restoreListener);
      state.restoreListener = null;
    }
    state.restoreToken++;
    state.episodeLoadId++;
    state.restorePending = false;
    state.currentEpisode = null;
    state.currentPodcast = null;
    el.audio.removeAttribute('src');
    el.audio.load();
    if (state.activeBlobUrl) URL.revokeObjectURL(state.activeBlobUrl);
    state.activeBlobUrl = null;
    el.player.hidden = true;
  }

  function showGeneratedAt(value) {
    const date = new Date(value);
    el.dataGeneratedAt.hidden = Number.isNaN(date.getTime());
    if (!el.dataGeneratedAt.hidden) {
      el.dataGeneratedAt.textContent = `Stand: ${new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(date)}`;
    }
  }

  function validateStoredSnapshot(snapshot, baseUrl) {
    if (!snapshot || snapshot.providerBaseUrl !== baseUrl ||
      typeof snapshot.providerName !== 'string' || !snapshot.providerName ||
      typeof snapshot.generatedAt !== 'string' || Number.isNaN(Date.parse(snapshot.generatedAt)) ||
      !Array.isArray(snapshot.catalog) || !Array.isArray(snapshot.podcasts)) return false;
    try {
      ProviderClient.validateCatalog({
        provider: { name: snapshot.providerName, version: '1', contract: ProviderClient.CONTRACT },
        generatedAt: snapshot.generatedAt,
        podcasts: snapshot.catalog
      });
      ProviderClient.validatePodcasts({ generatedAt: snapshot.generatedAt, podcasts: snapshot.podcasts },
        snapshot.catalog.map(podcast => podcast.id));
      return true;
    } catch {
      return false;
    }
  }

  async function fetchProviderSnapshot(baseUrl, token, client = new ProviderClient(baseUrl, token)) {
    const catalog = await client.catalog();
    const data = catalog.podcasts.length
      ? await client.podcasts(catalog.podcasts.map(podcast => podcast.id))
      : { generatedAt: catalog.generatedAt, podcasts: [] };
    return {
      snapshot: {
        providerBaseUrl: baseUrl,
        providerName: catalog.provider.name,
        generatedAt: data.generatedAt,
        catalog: catalog.podcasts,
        podcasts: data.podcasts,
        storedAt: new Date().toISOString()
      }
    };
  }

  function applyProviderSnapshot(snapshot, { resetPlayer = false, token = state.providerToken, offlineKeys = state.offlineKeys } = {}) {
    if (resetPlayer) resetPlayerForProviderChange();
    state.providerConfig = { name: snapshot.providerName, baseUrl: snapshot.providerBaseUrl };
    state.providerToken = token;
    state.providerClient = new ProviderClient(snapshot.providerBaseUrl, token);
    state.catalog = snapshot.catalog;
    state.podcasts = new Map(snapshot.podcasts.map(podcast => [podcast.id, podcast]));
    state.offlineKeys = offlineKeys;
    if (state.currentPodcast && state.currentEpisode) {
      const podcast = state.podcasts.get(state.currentPodcast.id);
      const episode = podcast?.episodes.find(item => item.id === state.currentEpisode.id);
      if (episode) {
        state.currentPodcast = podcast;
        state.currentEpisode = episode;
        el.playerTitle.textContent = episode.title;
        el.playerPodcast.textContent = podcast.title;
        updateMediaSession();
      }
    }
    migrateLegacyEpisodeState();
    if (state.detailPodcastId && !state.podcasts.has(state.detailPodcastId)) {
      state.detailPodcastId = null;
      el.detailSection.hidden = true;
    }
    el.providerActive.textContent = `Aktiv: ${snapshot.providerName}`;
    showGeneratedAt(snapshot.generatedAt);
    if (!state.initialized) {
      if (state.catalog.length === 1) state.subscriptions.add(state.catalog[0].id);
      state.initialized = true;
      persistLocalState();
    }
    cleanPlaylist();
    el.statusPanel.hidden = true;
    el.viewTabs.hidden = false;
    render();
  }

  function showProviderEmptyState(message = 'Noch keine Podcastdaten geladen.') {
    el.providerActive.textContent = `Aktiv: ${state.providerConfig.name}`;
    el.status.textContent = message;
    el.statusPanel.hidden = false;
    el.viewTabs.hidden = true;
    el.dataGeneratedAt.hidden = true;
  }

  async function offlineKeysFor(baseUrl) {
    const records = await state.localStore.listOfflineAudio();
    return new Set(records.filter(record => record.providerBaseUrl === baseUrl).map(record => record.episodeKey));
  }

  async function refreshPodcasts() {
    const requestId = ++state.providerRequestId;
    const baseUrl = state.providerConfig.baseUrl;
    const token = state.providerToken;
    el.providerRefresh.disabled = true;
    el.refreshMessage.textContent = 'Podcastdaten werden geladen …';
    try {
      const { snapshot } = await fetchProviderSnapshot(baseUrl, token, state.providerClient || new ProviderClient(baseUrl, token));
      if (requestId !== state.providerRequestId) return;
      await state.localStore.putProviderSnapshot(snapshot);
      if (requestId !== state.providerRequestId) return;
      applyProviderSnapshot(snapshot);
      el.refreshMessage.textContent = 'Podcastdaten aktualisiert.';
      await cleanupOffline(false).catch(() => {});
    } catch {
      el.refreshMessage.textContent = 'Podcastdaten konnten nicht aktualisiert werden. Der bisherige Stand bleibt erhalten.';
    } finally {
      el.providerRefresh.disabled = false;
    }
  }

  async function switchProvider(config, token) {
    const requestId = ++state.providerRequestId;
    const baseUrl = ProviderClient.validateUrl(config.baseUrl);
    const effectiveToken = baseUrl === ProviderClient.DEFAULT_PROVIDER.baseUrl ? '' : token;
    const { snapshot } = await fetchProviderSnapshot(baseUrl, effectiveToken);
    if (requestId !== state.providerRequestId) return null;
    await state.localStore.putProviderSnapshot(snapshot);
    const offlineKeys = await offlineKeysFor(baseUrl);
    if (requestId !== state.providerRequestId) return null;
    const changed = baseUrl !== state.providerConfig.baseUrl;
    persistProviderSettings({ name: snapshot.providerName, baseUrl }, effectiveToken);
    applyProviderSnapshot(snapshot, { resetPlayer: changed, token: effectiveToken, offlineKeys });
    await cleanupOffline(false).catch(() => {});
    return state.providerConfig;
  }

  function providerError(error) {
    return error instanceof ProviderClient.Error ? error.message : 'Provider-Anfrage fehlgeschlagen.';
  }

  async function boot() {
    loadLocalState();
    loadProviderSettings();
    bindEvents();
    showProviderEmptyState();
    try {
      const snapshot = await state.localStore.getProviderSnapshot(state.providerConfig.baseUrl);
      const offlineKeys = await offlineKeysFor(state.providerConfig.baseUrl);
      if (validateStoredSnapshot(snapshot, state.providerConfig.baseUrl)) {
        applyProviderSnapshot(snapshot, { offlineKeys });
      }
      await cleanupOffline(false).catch(() => {});
    } catch {
      showProviderEmptyState('Lokale Podcastdaten konnten nicht geöffnet werden. Bitte prüfe den Browserspeicher.');
    }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function bindEvents() {
    el.providerUrl.addEventListener('input', () => {
      if (el.providerUrl.value.trim() !== state.providerConfig.baseUrl) el.providerToken.value = '';
    });
    el.providerTest.addEventListener('click', async () => {
      el.providerMessage.textContent = 'Verbindung wird getestet …';
      try {
        const baseUrl = ProviderClient.validateUrl(el.providerUrl.value);
        const token = baseUrl === ProviderClient.DEFAULT_PROVIDER.baseUrl ? '' : el.providerToken.value.trim();
        const catalog = await new ProviderClient(baseUrl, token).testConnection();
        el.providerMessage.textContent = `Verbindung zu ${catalog.provider.name} erfolgreich.`;
      } catch (error) {
        el.providerMessage.textContent = providerError(error);
      }
    });
    el.providerSave.addEventListener('click', async () => {
      el.providerMessage.textContent = 'Provider wird geladen …';
      try {
        const config = await switchProvider({ baseUrl: el.providerUrl.value }, el.providerToken.value.trim());
        if (!config) return;
        el.providerUrl.value = config.baseUrl;
        el.providerToken.value = state.providerToken;
        el.providerMessage.textContent = `Provider ${config.name} gespeichert.`;
      } catch (error) {
        el.providerMessage.textContent = providerError(error);
      }
    });
    el.providerDemo.addEventListener('click', async () => {
      el.providerMessage.textContent = 'Demo-Provider wird geladen …';
      try {
        const config = await switchProvider(ProviderClient.DEFAULT_PROVIDER, '');
        if (!config) return;
        el.providerUrl.value = config.baseUrl;
        el.providerToken.value = '';
        el.providerMessage.textContent = 'Demo-Provider aktiv.';
      } catch (error) {
        el.providerMessage.textContent = providerError(error);
      }
    });
    el.providerRefresh.addEventListener('click', refreshPodcasts);
    el.autoCleanup.addEventListener('change', () => {
      state.autoCleanup = el.autoCleanup.checked;
      persistLocalState();
      if (state.autoCleanup) cleanupOffline(false).catch(() => {
        el.cleanupMessage.textContent = 'Offline-Dateien konnten nicht bereinigt werden.';
      });
    });
    el.cleanupNow.addEventListener('click', async () => {
      el.cleanupNow.disabled = true;
      try {
        const count = await cleanupOffline(true);
        el.cleanupMessage.textContent = `${count} Offline-Folgen gelöscht.`;
      } catch {
        el.cleanupMessage.textContent = 'Offline-Dateien konnten nicht bereinigt werden.';
      } finally {
        el.cleanupNow.disabled = false;
      }
    });
    el.tabButtons.forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    el.detailBack.addEventListener('click', closeDetail);
    el.sort.addEventListener('change', () => {
      state.sort = el.sort.value === 'oldest' ? 'oldest' : 'newest';
      persistLocalState();
      renderInbox();
    });
    el.podcastFilter.addEventListener('change', () => {
      state.filterPodcast = el.podcastFilter.value;
      renderInbox();
      renderPlaylist();
    });

    el.toStart.addEventListener('click', () => { el.audio.currentTime = 0; });
    el.back10.addEventListener('click', () => { el.audio.currentTime = Math.max(0, el.audio.currentTime - 10); });
    el.forward10.addEventListener('click', () => {
      const end = Number.isFinite(el.audio.duration) ? el.audio.duration : el.audio.currentTime + 10;
      el.audio.currentTime = Math.min(end, el.audio.currentTime + 10);
    });
    el.playPause.addEventListener('click', togglePlay);
    el.progress.addEventListener('input', () => {
      if (!Number.isFinite(el.audio.duration) || el.audio.duration <= 0) return;
      el.audio.currentTime = (Number(el.progress.value) / 1000) * el.audio.duration;
    });

    el.audio.addEventListener('play', () => {
      el.playPause.textContent = 'Ⅱ';
      el.playPause.setAttribute('aria-label', 'Pause');
      startPositionTimer();
      updateMediaPlaybackState('playing');
    });
    el.audio.addEventListener('pause', () => {
      el.playPause.textContent = '▶';
      el.playPause.setAttribute('aria-label', 'Abspielen');
      stopPositionTimer();
      saveCurrentPosition();
      updateMediaPlaybackState('paused');
    });
    el.audio.addEventListener('timeupdate', updateProgress);
    el.audio.addEventListener('loadedmetadata', updateProgress);
    el.audio.addEventListener('durationchange', updateProgress);
    el.audio.addEventListener('ended', () => {
      if (!state.currentEpisode) return;
      setEpisodeStatus(episodeKey(state.currentPodcast, state.currentEpisode), 'heard');
      persistLocalState();
      render();
      updateProgress();
      cleanupOffline(false).catch(() => {});
      // Bewusst kein automatischer Start der nächsten Folge oder der Playlist.
    });
    window.addEventListener('pagehide', saveCurrentPosition);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveCurrentPosition();
      if (document.visibilityState === 'visible') cleanupOffline(false).catch(() => {});
    });
  }

  function render() {
    renderFilter();
    renderInbox();
    renderPlaylist();
    renderPodcasts();
    renderTabs();
    if (state.detailPodcastId) renderDetail();
  }

  function renderTabs() {
    const playlistCount = Object.keys(state.playlist).length;
    el.playlistCount.textContent = `${playlistCount}/${PLAYLIST_LIMIT}`;
    el.tabButtons.forEach(button => button.classList.toggle('is-active', button.dataset.view === state.currentView));
    if (!state.detailPodcastId) {
      el.subscriptionsView.hidden = state.currentView !== 'subscriptions';
      el.playlistView.hidden = state.currentView !== 'playlist';
    }
  }

  function showView(view) {
    if (!['subscriptions', 'playlist'].includes(view)) return;
    state.currentView = view;
    state.detailPodcastId = null;
    el.detailSection.hidden = true;
    renderTabs();
  }

  function renderFilter() {
    const previous = state.filterPodcast;
    el.podcastFilter.replaceChildren();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'Alle Abos';
    el.podcastFilter.append(all);

    for (const id of state.subscriptions) {
      const podcast = state.podcasts.get(id);
      if (!podcast) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = podcast.title;
      el.podcastFilter.append(option);
    }

    const stillValid = previous === 'all' || state.subscriptions.has(previous);
    state.filterPodcast = stillValid ? previous : 'all';
    el.podcastFilter.value = state.filterPodcast;
  }

  function episodeKey(podcast, episode) {
    return `${podcast.id}:${episode.id}`;
  }

  function migrateLegacyEpisodeState() {
    const counts = new Map();
    for (const podcast of state.podcasts.values()) {
      for (const episode of podcast.episodes) counts.set(episode.id, (counts.get(episode.id) || 0) + 1);
    }
    let changed = false;
    for (const podcast of state.podcasts.values()) {
      for (const episode of podcast.episodes) {
        if (counts.get(episode.id) !== 1) continue;
        const key = episodeKey(podcast, episode);
        for (const values of [state.episodeStatus, state.playlist, state.positions]) {
          if (Object.prototype.hasOwnProperty.call(values, episode.id)
            && !Object.prototype.hasOwnProperty.call(values, key)) {
            values[key] = values[episode.id];
            delete values[episode.id];
            changed = true;
          }
        }
      }
    }
    if (changed) persistLocalState();
  }

  function getEpisodeStatus(id) {
    const status = state.episodeStatus[id];
    return ['heard', 'ignored'].includes(status) ? status : 'unheard';
  }

  function setEpisodeStatus(id, status) {
    const previous = getEpisodeStatus(id);
    if (status === 'unheard') delete state.episodeStatus[id];
    else state.episodeStatus[id] = status;
    if (status === 'heard' && previous !== 'heard') state.heardAt[id] = new Date().toISOString();
    if (status !== 'heard') delete state.heardAt[id];

    if (status !== 'unheard') {
      delete state.playlist[id];
      delete state.positions[id];
    }
  }

  function inboxEntries() {
    const entries = [];
    const podcastIds = state.filterPodcast === 'all' ? [...state.subscriptions] : [state.filterPodcast];

    for (const id of podcastIds) {
      if (!state.subscriptions.has(id)) continue;
      const podcast = state.podcasts.get(id);
      if (!podcast) continue;
      podcast.episodes
        .filter(ep => getEpisodeStatus(episodeKey(podcast, ep)) === 'unheard')
        .slice(0, PER_PODCAST_INBOX_LIMIT)
        .forEach(episode => entries.push({ podcast, episode }));
    }

    entries.sort((a, b) => {
      const aTime = Date.parse(a.episode.published || 0) || 0;
      const bTime = Date.parse(b.episode.published || 0) || 0;
      return state.sort === 'oldest' ? aTime - bTime : bTime - aTime;
    });
    return entries.slice(0, INBOX_LIMIT);
  }

  function renderInbox() {
    el.unheardList.replaceChildren();
    const entries = inboxEntries();
    if (entries.length === 0) {
      el.unheardList.append(emptyNode('Keine ungehörten Folgen in dieser Auswahl.'));
      return;
    }
    entries.forEach(({ podcast, episode }) => el.unheardList.append(episodeNode(podcast, episode, { context: 'inbox' })));
  }

  function allPlaylistEntries() {
    const episodeIndex = new Map();
    for (const podcast of state.podcasts.values()) {
      for (const episode of podcast.episodes) episodeIndex.set(episodeKey(podcast, episode), { podcast, episode });
    }

    return Object.entries(state.playlist)
      .filter(([id]) => getEpisodeStatus(id) === 'unheard' && episodeIndex.has(id))
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .slice(0, PLAYLIST_LIMIT)
      .map(([id]) => episodeIndex.get(id));
  }

  function playlistEntries() {
    const entries = allPlaylistEntries();
    if (state.filterPodcast === 'all') return entries;
    return entries.filter(entry => entry.podcast.id === state.filterPodcast);
  }

  function cleanPlaylist() {
    let changed = false;
    for (const id of Object.keys(state.playlist)) {
      if (getEpisodeStatus(id) !== 'unheard') {
        delete state.playlist[id];
        changed = true;
      }
    }
    if (changed) persistLocalState();
  }

  function renderPlaylist() {
    cleanPlaylist();
    el.playlistList.replaceChildren();
    const entries = playlistEntries();
    if (entries.length === 0) {
      el.playlistList.append(emptyNode(Object.keys(state.playlist).length
        ? 'Playlist-Folgen sind beim aktiven Provider derzeit nicht verfügbar.'
        : 'Noch nichts ausgewählt. Füge Folgen aus einer Podcast-Detailseite hinzu.'));
    } else {
      entries.forEach(({ podcast, episode }) => el.playlistList.append(episodeNode(podcast, episode, { context: 'playlist' })));
    }
    el.playlistCount.textContent = `${Object.keys(state.playlist).length}/${PLAYLIST_LIMIT}`;
  }

  function renderPodcasts() {
    el.podcastList.replaceChildren();
    for (const item of state.catalog) {
      const podcast = state.podcasts.get(item.id);
      if (!podcast) continue;
      const row = document.createElement('article');
      row.className = 'podcast-row';

      const copy = document.createElement('div');
      const h3 = document.createElement('h3');
      const titleButton = document.createElement('button');
      titleButton.type = 'button';
      titleButton.textContent = podcast.title;
      titleButton.addEventListener('click', () => openDetail(item.id));
      h3.append(titleButton);
      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = [podcast.author || 'Podcast', `${podcast.episodes.length} Folgen im Feed`].join(' · ');
      copy.append(h3, meta);

      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = state.subscriptions.has(item.id) ? 'Abo entfernen' : 'Abonnieren';
      action.addEventListener('click', () => toggleSubscription(item.id));

      row.append(copy, action);
      el.podcastList.append(row);
    }
  }

  function toggleSubscription(id) {
    if (state.subscriptions.has(id)) state.subscriptions.delete(id);
    else state.subscriptions.add(id);
    persistLocalState();
    render();
  }

  function openDetail(id, page = 1) {
    if (!state.podcasts.has(id)) return;
    state.detailPodcastId = id;
    state.detailPage = Math.max(1, page);
    el.subscriptionsView.hidden = true;
    el.playlistView.hidden = true;
    el.detailSection.hidden = false;
    renderDetail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeDetail() {
    state.detailPodcastId = null;
    el.detailSection.hidden = true;
    renderTabs();
  }

  function renderDetail() {
    const id = state.detailPodcastId;
    const podcast = state.podcasts.get(id);
    if (!podcast) return;

    const totalPages = Math.max(1, Math.ceil(podcast.episodes.length / DETAIL_PAGE_SIZE));
    state.detailPage = Math.min(state.detailPage, totalPages);
    const start = (state.detailPage - 1) * DETAIL_PAGE_SIZE;
    const pageEpisodes = podcast.episodes.slice(start, start + DETAIL_PAGE_SIZE);

    el.detail.replaceChildren();
    const head = document.createElement('div');
    head.className = 'detail-head';
    const title = document.createElement('h2');
    title.textContent = podcast.title;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = [podcast.author, podcast.language, `${podcast.episodes.length} Folgen im Feed`].filter(Boolean).join(' · ');
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = podcast.description || '';

    const tools = document.createElement('div');
    tools.className = 'detail-tools';
    const subscribe = document.createElement('button');
    subscribe.type = 'button';
    subscribe.textContent = state.subscriptions.has(id) ? 'Abo entfernen' : 'Abonnieren';
    subscribe.addEventListener('click', () => toggleSubscription(id));

    const dismissOld = document.createElement('button');
    dismissOld.type = 'button';
    dismissOld.textContent = 'Alte Folgen ausblenden';
    dismissOld.title = 'Behält die aktuellste ungehörte Folge und blendet ältere ungehörte Folgen aus.';
    dismissOld.addEventListener('click', () => ignoreOlderUnheard(podcast));
    tools.append(subscribe, dismissOld);
    head.append(title, meta, description, tools);

    const episodesTitle = document.createElement('h3');
    episodesTitle.textContent = 'Folgen';
    const list = document.createElement('div');
    list.className = 'episode-list';
    pageEpisodes.forEach(episode => list.append(episodeNode(podcast, episode, { context: 'detail', showSummary: true })));

    const pagination = document.createElement('div');
    pagination.className = 'pagination';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.textContent = '← Neuere';
    prev.disabled = state.detailPage <= 1;
    prev.addEventListener('click', () => openDetail(id, state.detailPage - 1));
    const info = document.createElement('p');
    info.textContent = `Seite ${state.detailPage} von ${totalPages} · ${start + 1}–${Math.min(start + DETAIL_PAGE_SIZE, podcast.episodes.length)} von ${podcast.episodes.length}`;
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = 'Ältere →';
    next.disabled = state.detailPage >= totalPages;
    next.addEventListener('click', () => openDetail(id, state.detailPage + 1));
    pagination.append(prev, info, next);

    el.detail.append(head, episodesTitle, list, pagination);
  }

  function ignoreOlderUnheard(podcast) {
    const unheard = podcast.episodes.filter(ep => getEpisodeStatus(episodeKey(podcast, ep)) === 'unheard');
    if (unheard.length <= 1) {
      showNotice('Es gibt keine älteren ungehörten Folgen zum Ausblenden.');
      return;
    }
    const keepId = unheard[0].id;
    let changed = 0;
    for (const episode of unheard) {
      if (episode.id === keepId) continue;
      const key = episodeKey(podcast, episode);
      setEpisodeStatus(key, 'ignored');
      deleteOfflineAudio(key, false).catch(() => {});
      changed += 1;
    }
    persistLocalState();
    render();
    showNotice(`${changed} ältere Folgen ausgeblendet. Die aktuellste ungehörte Folge bleibt.`);
  }

  function episodeNode(podcast, episode, options = {}) {
    const key = episodeKey(podcast, episode);
    const status = getEpisodeStatus(key);
    const inPlaylist = Object.prototype.hasOwnProperty.call(state.playlist, key) && status === 'unheard';
    const article = document.createElement('article');
    article.className = 'episode';

    const copy = document.createElement('div');
    copy.className = 'episode-copy';
    const h3 = document.createElement('h3');
    h3.textContent = episode.title;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = [formatDate(episode.published), formatDuration(episode.durationSeconds), podcast.title].filter(Boolean).join(' · ');
    const statusLine = document.createElement('p');
    statusLine.className = 'meta';
    statusLine.append(statusPill(status === 'heard' ? 'Gehört' : status === 'ignored' ? 'Ausgeblendet' : 'Nicht gehört'));
    if (inPlaylist) statusLine.append(statusPill('Playlist'));
    if (state.offlineKeys.has(key)) statusLine.append(statusPill('Offline verfügbar'));
    copy.append(h3, meta, statusLine);
    if (options.showSummary && episode.description) {
      const summary = document.createElement('p');
      summary.className = 'episode-summary';
      summary.textContent = episode.description;
      copy.append(summary);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'primary';
    play.textContent = '▶ Hören';
    play.addEventListener('click', () => loadEpisode(podcast, episode, true));
    actions.append(play);

    const offlineButton = document.createElement('button');
    offlineButton.type = 'button';
    offlineButton.textContent = state.downloading.has(key) ? 'Wird gespeichert …'
      : state.offlineKeys.has(key) ? 'Offline löschen' : 'Offline speichern';
    offlineButton.disabled = state.downloading.has(key);
    offlineButton.addEventListener('click', () => {
      if (state.offlineKeys.has(key)) deleteOfflineAudio(key, true).catch(() => {});
      else downloadOfflineAudio(podcast, episode);
    });
    actions.append(offlineButton);

    if (options.context === 'detail' || options.context === 'playlist') {
      const playlistButton = document.createElement('button');
      playlistButton.type = 'button';
      playlistButton.textContent = inPlaylist ? 'Aus Playlist' : '+ Playlist';
      playlistButton.disabled = status !== 'unheard';
      playlistButton.addEventListener('click', () => togglePlaylist(key));
      actions.append(playlistButton);
    }

    const heardButton = document.createElement('button');
    heardButton.type = 'button';
    heardButton.textContent = status === 'heard' ? 'Als nicht gehört' : 'Als gehört';
    heardButton.addEventListener('click', () => {
      setEpisodeStatus(key, status === 'heard' ? 'unheard' : 'heard');
      persistLocalState();
      render();
      cleanupOffline(false).catch(() => {});
    });
    actions.append(heardButton);

    if (options.context === 'detail') {
      const ignoreButton = document.createElement('button');
      ignoreButton.type = 'button';
      ignoreButton.textContent = status === 'ignored' ? 'Wieder berücksichtigen' : 'Interessiert mich nicht';
      ignoreButton.addEventListener('click', () => {
        const nextStatus = status === 'ignored' ? 'unheard' : 'ignored';
        setEpisodeStatus(key, nextStatus);
        persistLocalState();
        render();
        if (nextStatus === 'ignored') deleteOfflineAudio(key, false).catch(() => {});
        else cleanupOffline(false).catch(() => {});
      });
      actions.append(ignoreButton);
    }

    article.append(copy, actions);
    return article;
  }

  function statusPill(text) {
    const span = document.createElement('span');
    span.className = 'status-pill';
    span.textContent = text;
    return span;
  }

  function togglePlaylist(id) {
    if (Object.prototype.hasOwnProperty.call(state.playlist, id)) {
      delete state.playlist[id];
      persistLocalState();
      render();
      return;
    }
    if (getEpisodeStatus(id) !== 'unheard') return;
    if (Object.keys(state.playlist).length >= PLAYLIST_LIMIT) {
      showNotice('Die Playlist hat 10 Folgen. Hör erst etwas weg.');
      return;
    }
    state.playlist[id] = Date.now();
    persistLocalState();
    render();
  }

  function showNotice(message) {
    el.notice.textContent = message;
    el.notice.hidden = false;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { el.notice.hidden = true; }, 3500);
  }

  async function downloadOfflineAudio(podcast, episode) {
    const key = episodeKey(podcast, episode);
    const baseUrl = state.providerConfig.baseUrl;
    if (state.downloading.has(key)) return;
    state.downloading.add(key);
    render();
    try {
      let response;
      try {
        response = await fetch(episode.audioUrl, { credentials: 'omit', mode: 'cors' });
      } catch {
        throw new Error('Diese Folge kann vom Browser nicht direkt offline gespeichert werden.');
      }
      if (!response.ok || response.type === 'opaque') throw new Error('Die Audiodatei konnte nicht geladen werden.');
      const contentType = response.headers?.get('Content-Type')?.toLowerCase() || '';
      if (/^(text\/|application\/(json|problem\+json|xml))/.test(contentType)) {
        throw new Error('Der Audioanbieter hat keine Audiodatei geliefert.');
      }
      let blob;
      try { blob = await response.blob(); } catch { throw new Error('Die Audiodatei konnte nicht vollständig geladen werden.'); }
      if (!blob || blob.size === 0) throw new Error('Die Audiodatei ist leer.');
      if (getEpisodeStatus(key) === 'ignored') return;
      await state.localStore.putOfflineAudio(baseUrl, key, blob, episode.audioUrl);
      if (state.providerConfig.baseUrl === baseUrl) {
        state.offlineKeys.add(key);
        showNotice('Offline verfügbar.');
      }
    } catch (error) {
      showNotice(error.name === 'QuotaExceededError'
        ? 'Nicht genügend lokaler Speicher für diese Folge.'
        : error.message || 'Die Folge konnte nicht offline gespeichert werden.');
    } finally {
      state.downloading.delete(key);
      render();
    }
  }

  async function deleteOfflineAudio(key, showMessage) {
    const baseUrl = state.providerConfig.baseUrl;
    try {
      await state.localStore.deleteOfflineAudio(baseUrl, key);
      if (state.providerConfig.baseUrl === baseUrl) {
        state.offlineKeys.delete(key);
        render();
        if (showMessage) showNotice('Offline-Datei gelöscht.');
      }
    } catch {
      showNotice('Offline-Datei konnte nicht gelöscht werden.');
      throw new Error('Offline-Datei konnte nicht gelöscht werden.');
    }
  }

  async function cleanupOffline(manual) {
    if (!manual && !state.autoCleanup) return 0;
    const records = await state.localStore.listOfflineAudio();
    const now = Date.now();
    let count = 0;
    for (const record of records) {
      if (getEpisodeStatus(record.episodeKey) !== 'heard') continue;
      const playing = !el.audio.paused && state.currentEpisode && state.currentPodcast &&
        record.providerBaseUrl === state.providerConfig.baseUrl &&
        record.episodeKey === episodeKey(state.currentPodcast, state.currentEpisode);
      if (playing) continue;
      const heardAt = Date.parse(state.heardAt[record.episodeKey] || '');
      if (!manual && (!Number.isFinite(heardAt) || now - heardAt < OFFLINE_GRACE_MS)) continue;
      await state.localStore.deleteOfflineAudio(record.providerBaseUrl, record.episodeKey);
      if (record.providerBaseUrl === state.providerConfig.baseUrl) state.offlineKeys.delete(record.episodeKey);
      count++;
    }
    if (count) render();
    return count;
  }

  async function loadEpisode(podcast, episode, autoplay) {
    if (!episode.audioUrl) return;
    const isSameEpisode = state.currentPodcast?.id === podcast.id && state.currentEpisode?.id === episode.id;
    if (isSameEpisode) {
      if (autoplay) el.audio.play().catch(() => {});
      return;
    }
    const loadId = ++state.episodeLoadId;
    const baseUrl = state.providerConfig.baseUrl;
    let record;
    try {
      record = await state.localStore.getOfflineAudio(baseUrl, episodeKey(podcast, episode));
    } catch {
      record = null;
    }
    if (loadId !== state.episodeLoadId || baseUrl !== state.providerConfig.baseUrl) return;
    saveCurrentPosition();
    if (state.restoreListener) {
      el.audio.removeEventListener('loadedmetadata', state.restoreListener);
      el.audio.removeEventListener('durationchange', state.restoreListener);
      state.restoreListener = null;
    }
    state.currentEpisode = episode;
    state.currentPodcast = podcast;
    const token = ++state.restoreToken;
    state.restorePending = true;
    const storedPosition = Number(state.positions[episodeKey(podcast, episode)] || 0);
    const restore = () => {
      if (token !== state.restoreToken || state.currentPodcast?.id !== podcast.id || state.currentEpisode?.id !== episode.id) return;
      if (storedPosition > 0 && (!Number.isFinite(el.audio.duration) || el.audio.duration <= 0)) return;
      if (Number.isFinite(storedPosition) && storedPosition > 0 && storedPosition < el.audio.duration - 3) {
        el.audio.currentTime = storedPosition;
      }
      el.audio.removeEventListener('loadedmetadata', restore);
      el.audio.removeEventListener('durationchange', restore);
      state.restoreListener = null;
      state.restorePending = false;
    };
    state.restoreListener = restore;
    el.audio.addEventListener('loadedmetadata', restore);
    el.audio.addEventListener('durationchange', restore);
    const previousBlobUrl = state.activeBlobUrl;
    let source = episode.audioUrl;
    state.activeBlobUrl = null;
    if (record?.blob) {
      try {
        source = URL.createObjectURL(record.blob);
        state.activeBlobUrl = source;
      } catch {
        source = episode.audioUrl;
      }
    }
    el.audio.src = source;
    if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl);
    el.player.hidden = false;
    el.playerTitle.textContent = episode.title;
    el.playerPodcast.textContent = podcast.title;
    updateMediaSession();
    if (autoplay) el.audio.play().catch(() => {});
  }

  function togglePlay() {
    if (!state.currentEpisode) return;
    if (el.audio.paused) el.audio.play().catch(() => {});
    else el.audio.pause();
  }

  function saveCurrentPosition() {
    if (!state.currentEpisode || state.restorePending || !Number.isFinite(el.audio.currentTime)) return;
    const id = episodeKey(state.currentPodcast, state.currentEpisode);
    if (el.audio.currentTime <= 1 || getEpisodeStatus(id) !== 'unheard') delete state.positions[id];
    else state.positions[id] = Math.floor(el.audio.currentTime);
    persistLocalState();
  }

  function startPositionTimer() {
    stopPositionTimer();
    state.saveTimer = window.setInterval(saveCurrentPosition, SAVE_INTERVAL_MS);
  }

  function stopPositionTimer() {
    if (state.saveTimer) window.clearInterval(state.saveTimer);
    state.saveTimer = null;
  }

  function updateProgress() {
    const current = Number.isFinite(el.audio.currentTime) ? el.audio.currentTime : 0;
    const duration = Number.isFinite(el.audio.duration) ? el.audio.duration : 0;
    el.currentTime.textContent = formatClock(current);
    el.duration.textContent = formatClock(duration);
    el.progress.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
    if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function'
      && duration > 0 && current >= 0 && current <= duration
      && Number.isFinite(el.audio.playbackRate) && el.audio.playbackRate > 0) {
      try { navigator.mediaSession.setPositionState({ duration, playbackRate: el.audio.playbackRate, position: current }); } catch {}
    }
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata !== 'function'
      || !state.currentEpisode || !state.currentPodcast) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.currentEpisode.title,
      artist: state.currentEpisode.author || state.currentPodcast.author || state.currentPodcast.title,
      album: state.currentPodcast.title
    });
    const seek = seconds => {
      const end = Number.isFinite(el.audio.duration) ? el.audio.duration : el.audio.currentTime + seconds;
      el.audio.currentTime = Math.max(0, Math.min(end, el.audio.currentTime + seconds));
    };
    const handlers = {
      play: () => el.audio.play().catch(() => {}),
      pause: () => el.audio.pause(),
      seekbackward: () => seek(-10),
      seekforward: () => seek(10),
      seekto: details => { if (Number.isFinite(details.seekTime)) el.audio.currentTime = details.seekTime; },
      previoustrack: () => { el.audio.currentTime = 0; }
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    }
  }

  function updateMediaPlaybackState(value) {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = value;
  }

  function emptyNode(text) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    return p;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return '';
    return formatClock(Number(seconds));
  }

  function formatClock(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  boot();
})();
