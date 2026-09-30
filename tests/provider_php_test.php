<?php
declare(strict_types=1);

require dirname(__DIR__) . '/provider/php/src/bootstrap.php';

use function PodcastProvider\defaultConfig;
use function PodcastProvider\handleRequest;

function same(mixed $expected, mixed $actual, string $label): void {
    if ($expected !== $actual) {
        throw new RuntimeException($label . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function check(bool $condition, string $label): void {
    if (!$condition) throw new RuntimeException($label);
}

$demo = defaultConfig();
$demo['base_url'] = 'http://127.0.0.1:8001/';
$forbidFetch = static function (): never {
    throw new RuntimeException('Demo provider must never fetch a feed');
};
$catalog = handleRequest('catalog', 'GET', ['Origin' => 'https://player.example.org'], '', $demo, $forbidFetch);
same(200, $catalog['status'], 'demo catalog status');
same('*', $catalog['headers']['Access-Control-Allow-Origin'], 'public demo CORS');
same('0815-podcast-provider-v1', $catalog['body']['provider']['contract'], 'contract');
same('1', $catalog['body']['provider']['version'], 'version');
same('0815 Demo Provider', $catalog['body']['provider']['name'], 'provider name');
same('0815-demo', $catalog['body']['podcasts'][0]['id'], 'demo catalog ID');
check(count($catalog['body']['podcasts']) === 1, 'demo catalog has one podcast');
check(str_ends_with($catalog['body']['generatedAt'], 'Z'), 'timestamp is UTC');

$body = json_encode(['ids' => ['0815-demo']], JSON_THROW_ON_ERROR);
$demoPodcasts = handleRequest('podcasts', 'POST', ['Origin' => 'https://player.example.org'], $body, $demo, $forbidFetch);
same(200, $demoPodcasts['status'], 'demo podcasts status');
$podcast = $demoPodcasts['body']['podcasts'][0];
same('0815 Demo Podcast', $podcast['title'], 'demo title');
same(3, count($podcast['episodes']), 'three original demo episodes');
foreach ($podcast['episodes'] as $episode) {
    check(str_starts_with($episode['audioUrl'], $demo['base_url'] . 'audio/'), 'demo audio stays on own provider');
    $file = dirname(__DIR__) . '/provider/php/audio/' . basename(parse_url($episode['audioUrl'], PHP_URL_PATH));
    check(is_file($file), 'original WAV exists');
}
check(!str_contains(json_encode($demoPodcasts['body'], JSON_THROW_ON_ERROR), 'sourceFeed'), 'no RSS URL in response');

same(404, handleRequest('podcasts', 'POST', [], '{"ids":["unknown"]}', $demo, $forbidFetch)['status'], 'unknown demo ID');
same(400, handleRequest('podcasts', 'POST', [], '{broken', $demo, $forbidFetch)['status'], 'invalid JSON');
same(413, handleRequest('podcasts', 'POST', [], str_repeat('x', 16_385), $demo, $forbidFetch)['status'], 'oversized body');
same(405, handleRequest('podcasts', 'GET', [], '', $demo, $forbidFetch)['status'], 'wrong method');
same(400, handleRequest('podcasts', 'POST', [], '{"ids":["0815-demo"],"url":"https://example.org/feed.xml"}', $demo, $forbidFetch)['status'], 'arbitrary URL rejected');
same(204, handleRequest('podcasts', 'OPTIONS', [
    'Origin' => 'https://player.example.org',
    'Access-Control-Request-Method' => 'POST',
    'Access-Control-Request-Headers' => 'authorization, content-type'
], '', $demo, $forbidFetch)['status'], 'demo preflight');

$token = bin2hex(random_bytes(16));
putenv('PODCAST_PROVIDER_TEST_TOKEN=' . $token);
$private = [
    'mode' => 'private',
    'name' => 'Privater Provider',
    'base_url' => 'https://provider.example.org/',
    'allowed_origins' => ['https://username.github.io'],
    'token_env' => 'PODCAST_PROVIDER_TEST_TOKEN',
    'feeds' => [
        'mein-podcast' => [
            'feed' => 'https://example.org/feed.xml',
            'title' => 'Mein Podcast',
            'description' => 'Privat freigegeben'
        ]
    ]
];
$privateCatalog = handleRequest('catalog', 'GET', [
    'Origin' => 'https://username.github.io',
    'Authorization' => 'Bearer ' . $token
], '', $private);
same(200, $privateCatalog['status'], 'private catalog');
same('https://username.github.io', $privateCatalog['headers']['Access-Control-Allow-Origin'], 'private CORS exact origin');
same('Origin', $privateCatalog['headers']['Vary'], 'private Vary Origin');
check(!str_contains(json_encode($privateCatalog['body'], JSON_THROW_ON_ERROR), 'feed.xml'), 'catalog does not expose RSS URL');

same(401, handleRequest('catalog', 'GET', [], '', $private)['status'], 'missing token');
same(401, handleRequest('catalog', 'GET', ['Authorization' => 'Bearer wrong'], '', $private)['status'], 'wrong token');
same(403, handleRequest('catalog', 'GET', [
    'Origin' => 'https://untrusted.example.org',
    'Authorization' => 'Bearer ' . $token
], '', $private)['status'], 'disallowed origin');
$preflight = handleRequest('podcasts', 'OPTIONS', [
    'Origin' => 'https://username.github.io',
    'Access-Control-Request-Method' => 'POST',
    'Access-Control-Request-Headers' => 'authorization, content-type'
], '', $private);
same(204, $preflight['status'], 'private preflight');
check(str_contains($preflight['headers']['Access-Control-Allow-Headers'], 'Authorization'), 'preflight authorizes Authorization');
same('Origin', $preflight['headers']['Vary'], 'preflight Vary Origin');
$deniedPreflight = handleRequest('podcasts', 'OPTIONS', [
    'Origin' => 'https://untrusted.example.org',
    'Access-Control-Request-Method' => 'POST'
], '', $private);
same(403, $deniedPreflight['status'], 'disallowed preflight');
check(!isset($deniedPreflight['headers']['Access-Control-Allow-Origin']), 'no CORS grant for denied origin');

$fixture = file_get_contents(__DIR__ . '/fixtures/podcast.xml');
if ($fixture === false) throw new RuntimeException('RSS fixture missing');
$loadFixture = static function (string $url) use ($fixture): string {
    same('https://example.org/feed.xml', $url, 'server-side feed allowlist');
    return $fixture;
};
$privatePodcasts = handleRequest('podcasts', 'POST', [
    'Origin' => 'https://username.github.io',
    'Authorization' => 'Bearer ' . $token
], json_encode(['ids' => ['mein-podcast']], JSON_THROW_ON_ERROR), $private, $loadFixture);
same(200, $privatePodcasts['status'], 'private podcast fetch');
same(2, count($privatePodcasts['body']['podcasts'][0]['episodes']), 'RSS normalized from own fixture');
check(!str_contains(json_encode($privatePodcasts['body'], JSON_THROW_ON_ERROR), 'feed.xml'), 'private response hides feed URL');
check(!str_contains(json_encode($privatePodcasts['body'], JSON_THROW_ON_ERROR), $token), 'response hides token');
same(404, handleRequest('podcasts', 'POST', ['Authorization' => 'Bearer ' . $token],
    '{"ids":["not-allowlisted"]}', $private, $loadFixture)['status'], 'unknown private ID');
putenv('PODCAST_PROVIDER_TEST_TOKEN');

echo "PHP provider, auth and CORS OK\n";
