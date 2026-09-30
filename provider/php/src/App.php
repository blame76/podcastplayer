<?php
declare(strict_types=1);

namespace PodcastProvider;

const CONTRACT = '0815-podcast-provider-v1';
const MAX_REQUEST_BYTES = 16_384;

function defaultConfig(): array {
    return [
        'mode' => 'demo',
        'name' => '0815 Demo Provider',
        'base_url' => getenv('PODCAST_PROVIDER_BASE_URL') ?: 'https://blame76.com/0815/podcast-provider-demo/',
        'allowed_origins' => ['*'],
        'feeds' => [],
        'token_env' => null,
    ];
}

function loadConfig(): array {
    $path = getenv('PODCAST_PROVIDER_CONFIG');
    if ($path === false || $path === '') {
        $local = dirname(__DIR__) . '/config.php';
        if (!is_file($local)) return defaultConfig();
        $path = $local;
    }
    $config = require $path;
    if (!is_array($config)) throw new \RuntimeException('Invalid provider configuration');
    return array_replace(defaultConfig(), $config);
}

function normalizeHeaders(array $headers): array {
    $normalized = [];
    foreach ($headers as $key => $value) $normalized[strtolower((string)$key)] = (string)$value;
    return $normalized;
}

function reply(int $status, ?array $body, array $headers): array {
    return ['status' => $status, 'headers' => $headers, 'body' => $body];
}

function errorReply(int $status, string $code, array $headers): array {
    return reply($status, ['error' => $code], $headers);
}

function providerBaseUrl(array $config): string {
    $value = (string)($config['base_url'] ?? '');
    $parts = parse_url($value);
    if ($parts === false || !isset($parts['scheme'], $parts['host']) ||
        isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
        throw new \RuntimeException('Invalid provider base URL');
    }
    $host = strtolower($parts['host']);
    $local = in_array($host, ['localhost', '127.0.0.1', '::1', '[::1]'], true);
    if ($parts['scheme'] !== 'https' && !($parts['scheme'] === 'http' && $local)) {
        throw new \RuntimeException('Invalid provider base URL scheme');
    }
    return rtrim($value, '/') . '/';
}

function feedEntry(string $id, mixed $value): array {
    if (!preg_match('/^[a-z0-9][a-z0-9-]{1,63}$/', $id)) {
        throw new \RuntimeException('Invalid feed ID');
    }
    if (is_string($value)) $value = ['feed' => $value, 'title' => $id, 'description' => ''];
    if (!is_array($value) || empty($value['feed']) || !is_string($value['feed'])) {
        throw new \RuntimeException('Invalid feed configuration');
    }
    assertSafePublicUrl($value['feed'], false);
    return [
        'id' => $id,
        'feed' => $value['feed'],
        'title' => (string)($value['title'] ?? $id),
        'description' => (string)($value['description'] ?? ''),
        'homepage' => (string)($value['homepage'] ?? ''),
    ];
}

function dataTimestamp(array $config): string {
    $time = ($config['mode'] ?? '') === 'demo' ? filemtime(__DIR__ . '/Demo.php') : time();
    return gmdate('Y-m-d\TH:i:s\Z', $time === false ? time() : $time);
}

function handleRequest(string $endpoint, string $method, array $rawHeaders, string $body, array $config, ?callable $loadFeed = null): array {
    $headers = normalizeHeaders($rawHeaders);
    $origin = $headers['origin'] ?? null;
    $mode = $config['mode'] ?? null;
    $allowed = $config['allowed_origins'] ?? [];
    $responseHeaders = ['Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store'];
    if (!is_array($allowed) || !in_array($mode, ['demo', 'private'], true)) {
        return errorReply(503, 'provider_unavailable', $responseHeaders);
    }
    $wildcard = $mode === 'demo' && in_array('*', $allowed, true);
    if (!$wildcard) $responseHeaders['Vary'] = 'Origin';
    $originAllowed = $origin === null || $wildcard || in_array($origin, $allowed, true);
    if ($origin !== null && $originAllowed) {
        $responseHeaders['Access-Control-Allow-Origin'] = $wildcard ? '*' : $origin;
    }
    if (!$originAllowed) return errorReply(403, 'forbidden_origin', $responseHeaders);
    if ($mode === 'private' && in_array('*', $allowed, true)) {
        return errorReply(503, 'provider_unavailable', $responseHeaders);
    }
    if (!in_array($endpoint, ['catalog', 'podcasts'], true)) {
        return errorReply(404, 'not_found', $responseHeaders);
    }

    $expectedMethod = $endpoint === 'catalog' ? 'GET' : 'POST';
    if ($method === 'OPTIONS') {
        if ($origin === null || ($headers['access-control-request-method'] ?? '') !== $expectedMethod) {
            return errorReply(405, 'method_not_allowed', $responseHeaders);
        }
        $responseHeaders['Access-Control-Allow-Methods'] = $expectedMethod . ', OPTIONS';
        $responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
        $responseHeaders['Access-Control-Max-Age'] = '600';
        return reply(204, null, $responseHeaders);
    }
    if ($method !== $expectedMethod) return errorReply(405, 'method_not_allowed', $responseHeaders);

    $tokenEnv = $config['token_env'] ?? null;
    if ($mode === 'private' && is_string($tokenEnv) && $tokenEnv !== '') {
        $expectedToken = getenv($tokenEnv);
        if ($expectedToken === false || $expectedToken === '') {
            return errorReply(503, 'provider_unavailable', $responseHeaders);
        }
        $authorization = $headers['authorization'] ?? '';
        if (!str_starts_with($authorization, 'Bearer ') ||
            !hash_equals($expectedToken, substr($authorization, 7))) {
            return errorReply(401, 'unauthorized', $responseHeaders);
        }
    }

    try {
        $baseUrl = providerBaseUrl($config);
        if ($endpoint === 'catalog') {
            if ($mode === 'demo') {
                $demo = demoPodcast($baseUrl);
                $podcasts = [[
                    'id' => $demo['id'],
                    'title' => $demo['title'],
                    'description' => $demo['description'],
                ]];
            } else {
                $podcasts = [];
                foreach (($config['feeds'] ?? []) as $id => $value) {
                    $entry = feedEntry((string)$id, $value);
                    $podcasts[] = [
                        'id' => $entry['id'],
                        'title' => $entry['title'],
                        'description' => $entry['description'],
                    ];
                }
            }
            return reply(200, [
                'provider' => ['name' => (string)$config['name'], 'version' => '1', 'contract' => CONTRACT],
                'generatedAt' => dataTimestamp($config),
                'podcasts' => $podcasts,
            ], $responseHeaders);
        }

        if (strlen($body) > MAX_REQUEST_BYTES) return errorReply(413, 'request_too_large', $responseHeaders);
        try {
            $request = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return errorReply(400, 'invalid_json', $responseHeaders);
        }
        if (!is_array($request) || array_keys($request) !== ['ids']) {
            return errorReply(400, 'invalid_request', $responseHeaders);
        }
        $ids = $request['ids'];
        if (!is_array($ids) || $ids === [] || count($ids) > 50) {
            return errorReply(400, 'invalid_request', $responseHeaders);
        }
        foreach ($ids as $id) {
            if (!is_string($id) || !preg_match('/^[a-z0-9][a-z0-9-]{1,63}$/', $id)) {
                return errorReply(400, 'invalid_request', $responseHeaders);
            }
        }
        if (count($ids) !== count(array_unique($ids))) {
            return errorReply(400, 'invalid_request', $responseHeaders);
        }
        foreach ($ids as $id) {
            if ($mode === 'demo' ? $id !== '0815-demo' : !array_key_exists($id, $config['feeds'] ?? [])) {
                return errorReply(404, 'unknown_podcast', $responseHeaders);
            }
        }

        $podcasts = [];
        foreach ($ids as $id) {
            if ($mode === 'demo') {
                $podcasts[] = demoPodcast($baseUrl);
                continue;
            }
            $entry = feedEntry($id, $config['feeds'][$id]);
            $xml = $loadFeed ? $loadFeed($entry['feed']) : fetchFeed($entry['feed']);
            $podcasts[] = parseRss($xml, $entry);
        }
        return reply(200, ['generatedAt' => dataTimestamp($config), 'podcasts' => $podcasts], $responseHeaders);
    } catch (\Throwable) {
        return errorReply(502, 'provider_error', $responseHeaders);
    }
}

function serve(string $endpoint): void {
    ini_set('display_errors', '0');
    try {
        $headers = function_exists('getallheaders') ? getallheaders() : [];
        if (!is_array($headers)) $headers = [];
        foreach (['HTTP_AUTHORIZATION' => 'Authorization', 'HTTP_ORIGIN' => 'Origin',
                  'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'Access-Control-Request-Method'] as $key => $name) {
            if (isset($_SERVER[$key])) $headers[$name] = $_SERVER[$key];
        }
        $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        $body = $length > MAX_REQUEST_BYTES
            ? str_repeat('x', MAX_REQUEST_BYTES + 1)
            : (file_get_contents('php://input', false, null, 0, MAX_REQUEST_BYTES + 1) ?: '');
        $result = handleRequest($endpoint, $_SERVER['REQUEST_METHOD'] ?? 'GET', $headers, $body, loadConfig());
    } catch (\Throwable) {
        $result = reply(503, ['error' => 'provider_unavailable'], [
            'Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-store'
        ]);
    }
    http_response_code($result['status']);
    foreach ($result['headers'] as $name => $value) header($name . ': ' . $value);
    if ($result['body'] !== null) {
        echo json_encode($result['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}
