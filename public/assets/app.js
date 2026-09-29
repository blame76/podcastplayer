(() => {
  'use strict';

  const STORAGE_KEY = '0815podcast:v3';
  const LEGACY_STORAGE_KEY = '0815podcast:v2';
  const SAVE_INTERVAL_MS = 5000;
  const INBOX_LIMIT = 10;
  const PER_PODCAST_INBOX_LIMIT = 3;
  const PLAYLIST_LIMIT = 10;
  const DETAIL_PAGE_SIZE = 10;

  const state = {
    catalog: [],
    podcasts: new Map(),
    subscriptions: new Set(),
    episodeStatus: {},
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
    initialized: false
  };

  const el = {
    statusPanel: document.querySelector('#status-panel'),
    status: document.querySelector('#app-status'),
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
      playlist: state.playlist,
      positions: state.positions,
      sort: state.sort,
      initialized: state.initialized
    }));
  }

  async function getJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function boot() {
    loadLocalState();
    bindEvents();

    try {
      const catalog = await getJson('./catalog.json');
      if (!Array.isArray(catalog) || catalog.length === 0) throw new Error('Katalog ist leer.');
      state.catalog = catalog;
      const results = await Promise.all(catalog.map(async item => [item.id, await getJson(item.data)]));
      state.podcasts = new Map(results);
      const generatedAt = state.podcasts.values().next().value?.generatedAt;
      const generatedDate = new Date(generatedAt);
      if (generatedAt && !Number.isNaN(generatedDate.getTime())) {
        const stamp = document.querySelector('#data-generated-at');
        stamp.textContent = `Stand: ${new Intl.DateTimeFormat('de-DE', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }).format(generatedDate)}`;
        stamp.hidden = false;
      }

      if (!state.initialized) {
        if (catalog.length === 1) state.subscriptions.add(catalog[0].id);
        state.initialized = true;
        persistLocalState();
      }

      cleanPlaylist();
      el.statusPanel.hidden = true;
      el.viewTabs.hidden = false;
      render();
    } catch (error) {
      el.status.textContent = `Podcastdaten konnten nicht geladen werden: ${error.message}`;
    }

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function bindEvents() {
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
      setEpisodeStatus(state.currentEpisode.id, 'heard');
      persistLocalState();
      render();
      updateProgress();
      // Bewusst kein automatischer Start der nächsten Folge oder der Playlist.
    });
    window.addEventListener('pagehide', saveCurrentPosition);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveCurrentPosition();
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
    const playlistCount = allPlaylistEntries().length;
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

  function getEpisodeStatus(id) {
    const status = state.episodeStatus[id];
    return ['heard', 'ignored'].includes(status) ? status : 'unheard';
  }

  function setEpisodeStatus(id, status) {
    if (status === 'unheard') delete state.episodeStatus[id];
    else state.episodeStatus[id] = status;

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
        .filter(ep => getEpisodeStatus(ep.id) === 'unheard')
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
      for (const episode of podcast.episodes) episodeIndex.set(episode.id, { podcast, episode });
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
    const known = new Set();
    for (const podcast of state.podcasts.values()) podcast.episodes.forEach(ep => known.add(ep.id));
    let changed = false;
    for (const id of Object.keys(state.playlist)) {
      if (!known.has(id) || getEpisodeStatus(id) !== 'unheard') {
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
      el.playlistList.append(emptyNode('Noch nichts ausgewählt. Füge Folgen aus einer Podcast-Detailseite hinzu.'));
    } else {
      entries.forEach(({ podcast, episode }) => el.playlistList.append(episodeNode(podcast, episode, { context: 'playlist' })));
    }
    el.playlistCount.textContent = `${allPlaylistEntries().length}/${PLAYLIST_LIMIT}`;
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
    const unheard = podcast.episodes.filter(ep => getEpisodeStatus(ep.id) === 'unheard');
    if (unheard.length <= 1) {
      showNotice('Es gibt keine älteren ungehörten Folgen zum Ausblenden.');
      return;
    }
    const keepId = unheard[0].id;
    let changed = 0;
    for (const episode of unheard) {
      if (episode.id === keepId) continue;
      setEpisodeStatus(episode.id, 'ignored');
      changed += 1;
    }
    persistLocalState();
    render();
    showNotice(`${changed} ältere Folgen ausgeblendet. Die aktuellste ungehörte Folge bleibt.`);
  }

  function episodeNode(podcast, episode, options = {}) {
    const status = getEpisodeStatus(episode.id);
    const inPlaylist = Object.prototype.hasOwnProperty.call(state.playlist, episode.id) && status === 'unheard';
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

    if (options.context === 'detail' || options.context === 'playlist') {
      const playlistButton = document.createElement('button');
      playlistButton.type = 'button';
      playlistButton.textContent = inPlaylist ? 'Aus Playlist' : '+ Playlist';
      playlistButton.disabled = status !== 'unheard';
      playlistButton.addEventListener('click', () => togglePlaylist(episode.id));
      actions.append(playlistButton);
    }

    const heardButton = document.createElement('button');
    heardButton.type = 'button';
    heardButton.textContent = status === 'heard' ? 'Als nicht gehört' : 'Als gehört';
    heardButton.addEventListener('click', () => {
      setEpisodeStatus(episode.id, status === 'heard' ? 'unheard' : 'heard');
      persistLocalState();
      render();
    });
    actions.append(heardButton);

    if (options.context === 'detail') {
      const ignoreButton = document.createElement('button');
      ignoreButton.type = 'button';
      ignoreButton.textContent = status === 'ignored' ? 'Wieder berücksichtigen' : 'Interessiert mich nicht';
      ignoreButton.addEventListener('click', () => {
        setEpisodeStatus(episode.id, status === 'ignored' ? 'unheard' : 'ignored');
        persistLocalState();
        render();
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
    if (allPlaylistEntries().length >= PLAYLIST_LIMIT) {
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

  function loadEpisode(podcast, episode, autoplay) {
    if (!episode.audioUrl) return;
    const isSameEpisode = state.currentEpisode?.id === episode.id;
    if (!isSameEpisode) saveCurrentPosition();
    if (!isSameEpisode && state.restoreListener) {
      el.audio.removeEventListener('loadedmetadata', state.restoreListener);
      el.audio.removeEventListener('durationchange', state.restoreListener);
      state.restoreListener = null;
    }
    state.currentEpisode = episode;
    state.currentPodcast = podcast;

    if (!isSameEpisode) {
      const token = ++state.restoreToken;
      state.restorePending = true;
      const storedPosition = Number(state.positions[episode.id] || 0);
      const restore = () => {
        if (token !== state.restoreToken || state.currentEpisode?.id !== episode.id) return;
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
      el.audio.src = episode.audioUrl;
    }

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
    const id = state.currentEpisode.id;
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
