(() => {
  'use strict';

  const CONTRACT = '0815-podcast-provider-v1';
  const DEFAULT_PROVIDER = Object.freeze({
    name: '0815 Demo Provider',
    baseUrl: 'https://blame76.com/0815/podcast-provider-demo/'
  });
  const ERROR_MESSAGES = {
    invalid_provider_url: 'Ungültige Provider-URL.',
    provider_unreachable: 'Provider nicht erreichbar.',
    unauthorized: 'Provider-Zugriff verweigert.',
    unknown_podcast: 'Podcast beim Provider nicht verfügbar.',
    invalid_json: 'Provider liefert kein gültiges JSON.',
    invalid_contract: 'Provider liefert kein gültiges Podcastformat.',
    provider_error: 'Provider-Anfrage fehlgeschlagen.'
  };

  class ProviderClientError extends Error {
    constructor(code) {
      super(ERROR_MESSAGES[code] || ERROR_MESSAGES.provider_error);
      this.name = 'ProviderClientError';
      this.code = code;
    }
  }

  function isLocalHost(hostname) {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
  }

  function validateProviderUrl(value, pageHostname = location.hostname) {
    let url;
    try {
      url = new URL(String(value).trim());
    } catch {
      throw new ProviderClientError('invalid_provider_url');
    }
    const isHttps = url.protocol === 'https:';
    const localHttp = url.protocol === 'http:' && isLocalHost(pageHostname) && isLocalHost(url.hostname);
    if ((!isHttps && !localHttp) || !url.hostname || url.username || url.password || url.search || url.hash) {
      throw new ProviderClientError('invalid_provider_url');
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  }

  function validTimestamp(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  }

  function validPodcastId(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
  }

  function validAudioUrl(value) {
    try {
      const url = new URL(value);
      return !url.username && !url.password &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && isLocalHost(location.hostname) && isLocalHost(url.hostname)));
    } catch {
      return false;
    }
  }

  function validateCatalog(data) {
    if (!data || typeof data !== 'object' || !data.provider ||
      typeof data.provider.name !== 'string' || !data.provider.name ||
      data.provider.version !== '1' || data.provider.contract !== CONTRACT ||
      !validTimestamp(data.generatedAt) || !Array.isArray(data.podcasts) ||
      !data.podcasts.every(item => item && validPodcastId(item.id) &&
        typeof item.title === 'string' && typeof item.description === 'string') ||
      new Set(data.podcasts.map(item => item.id)).size !== data.podcasts.length) {
      throw new ProviderClientError('invalid_contract');
    }
    return data;
  }

  function validatePodcasts(data, requestedIds) {
    if (!data || typeof data !== 'object' || !validTimestamp(data.generatedAt) ||
      !Array.isArray(data.podcasts) || data.podcasts.length !== requestedIds.length) {
      throw new ProviderClientError('invalid_contract');
    }
    const returned = new Set();
    for (const podcast of data.podcasts) {
      if (!podcast || !requestedIds.includes(podcast.id) || returned.has(podcast.id) ||
        typeof podcast.title !== 'string' || typeof podcast.description !== 'string' ||
        !Array.isArray(podcast.episodes)) {
        throw new ProviderClientError('invalid_contract');
      }
      returned.add(podcast.id);
      const episodeIds = new Set();
      for (const episode of podcast.episodes) {
        if (!episode || typeof episode.id !== 'string' || !episode.id || episodeIds.has(episode.id) ||
          typeof episode.title !== 'string' || !validAudioUrl(episode.audioUrl)) {
          throw new ProviderClientError('invalid_contract');
        }
        episodeIds.add(episode.id);
      }
    }
    return data;
  }

  class ProviderClient {
    constructor(baseUrl, token = '', fetchImpl = (...args) => fetch(...args)) {
      this.baseUrl = validateProviderUrl(baseUrl);
      this.token = token;
      this.fetchImpl = fetchImpl;
    }

    async request(endpoint, method, body) {
      const url = new URL(endpoint, this.baseUrl);
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      let response;
      try {
        response = await this.fetchImpl(url.href, {
          method, headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer'
        });
      } catch {
        throw new ProviderClientError('provider_unreachable');
      }
      if (!response.ok) {
        if (response.status === 401) throw new ProviderClientError('unauthorized');
        if (response.status === 404) throw new ProviderClientError('unknown_podcast');
        throw new ProviderClientError('provider_error');
      }
      try {
        return await response.json();
      } catch {
        throw new ProviderClientError('invalid_json');
      }
    }

    async catalog() {
      return validateCatalog(await this.request('catalog', 'GET'));
    }

    async podcasts(ids) {
      if (!Array.isArray(ids) || !ids.every(validPodcastId) || new Set(ids).size !== ids.length) {
        throw new ProviderClientError('invalid_contract');
      }
      if (ids.length === 0) return { generatedAt: new Date().toISOString(), podcasts: [] };
      return validatePodcasts(await this.request('podcasts', 'POST', { ids }), ids);
    }

    async testConnection() {
      const catalog = await this.catalog();
      if (catalog.podcasts.length) await this.podcasts([catalog.podcasts[0].id]);
      return catalog;
    }
  }

  ProviderClient.DEFAULT_PROVIDER = DEFAULT_PROVIDER;
  ProviderClient.CONTRACT = CONTRACT;
  ProviderClient.validateCatalog = validateCatalog;
  ProviderClient.validatePodcasts = validatePodcasts;
  ProviderClient.Error = ProviderClientError;
  ProviderClient.validateUrl = validateProviderUrl;
  window.ProviderClient = ProviderClient;
})();
