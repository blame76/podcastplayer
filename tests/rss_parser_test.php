<?php
declare(strict_types=1);

require dirname(__DIR__) . '/provider/php/src/Rss.php';
require dirname(__DIR__) . '/tools/build-site.php';

function expectSame(mixed $expected, mixed $actual, string $label): void {
    if ($expected !== $actual) {
        throw new RuntimeException($label . ': expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function expectTrue(bool $condition, string $label): void {
    if (!$condition) throw new RuntimeException($label);
}

$xml = file_get_contents(__DIR__ . '/fixtures/podcast.xml');
if ($xml === false) throw new RuntimeException('Fixture missing');
$entry = [
    'id' => 'fixture-podcast',
    'feed' => 'https://example.org/feed.xml',
    'homepage' => 'https://example.org/podcast'
];
$podcast = \PodcastProvider\parseRss($xml, $entry);

expectSame(
    ['id', 'title', 'description', 'author', 'language', 'website', 'episodes'],
    array_keys($podcast),
    'podcast JSON structure'
);
expectSame('fixture-podcast', $podcast['id'], 'podcast id');
expectSame('Fixture Podcast', $podcast['title'], 'podcast title');
expectSame('Ein Test & Beispiel.', $podcast['description'], 'channel HTML cleanup');
expectSame('Fixture Redaktion', $podcast['author'], 'podcast author');
expectSame(2, count($podcast['episodes']), 'missing and HTTP enclosures skipped');

$episode = $podcast['episodes'][0];
expectSame(
    ['id', 'guid', 'title', 'description', 'author', 'published', 'durationSeconds', 'pageUrl', 'audioUrl', 'audioType'],
    array_keys($episode),
    'episode JSON structure'
);
expectSame(hash('sha256', 'episode-1'), $episode['id'], 'stable episode id');
expectSame('Erste Folge', $episode['title'], 'episode title');
expectSame('Hallo Welt & mehr.', $episode['description'], 'episode HTML cleanup');
expectSame('2026-09-29T10:15:00+00:00', $episode['published'], 'UTC normalized date');
expectSame(3723, $episode['durationSeconds'], 'HH:MM:SS duration');
expectSame('https://media.example.org/episode-1.mp3', $episode['audioUrl'], 'HTTPS audio');
expectSame('audio/mpeg', $episode['audioType'], 'enclosure type');
expectSame('Zweite Folge', $podcast['episodes'][1]['title'], 'all valid episodes retained');
expectSame(1510, $podcast['episodes'][1]['durationSeconds'], 'MM:SS duration');
expectTrue(!str_contains(json_encode($podcast, JSON_THROW_ON_ERROR), 'http://media.example.org'), 'HTTP audio excluded');
expectSame($podcast, json_decode(json_encode($podcast, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR), 'JSON roundtrip');

$impressum = file_get_contents(dirname(__DIR__) . '/public/impressum.html');
if ($impressum === false) throw new RuntimeException('Impressum missing');
assertImpressumReady($impressum);
foreach (['[POSTANSCHRIFT VOR VERÖFFENTLICHUNG ERGÄNZEN]', 'Vor einer öffentlichen Veröffentlichung vervollständigen.'] as $placeholder) {
    try {
        assertImpressumReady($placeholder);
        throw new RuntimeException('Impressum placeholder accepted: ' . $placeholder);
    } catch (RuntimeException $error) {
        if (!str_contains($error->getMessage(), 'Platzhalter')) throw $error;
    }
}

echo "RSS parser and Impressum gate OK\n";
