<?php
declare(strict_types=1);

namespace PodcastProvider;

function demoPodcast(string $baseUrl): array {
    $episodes = [
        ['demo-willkommen', 'Willkommen bei 0815 Podcast', 'Ein kurzer synthetischer Ton zum Testen von Play, Pause und Ende.', 'willkommen.wav', 14, '2026-09-30T10:00:00Z'],
        ['demo-zehn-sekunden', 'Zehn Sekunden vor', 'Ein selbst erzeugtes Testsignal für den Sprung um zehn Sekunden.', 'zehn-sekunden.wav', 18, '2026-09-29T10:00:00Z'],
        ['demo-bewusst-hoeren', 'Bewusst hören', 'Stille und ein einfacher Ton zum Testen der gespeicherten Position.', 'bewusst-hoeren.wav', 24, '2026-09-28T10:00:00Z'],
    ];
    return [
        'id' => '0815-demo',
        'title' => '0815 Demo Podcast',
        'description' => 'Drei vollständig selbst erzeugte Testfolgen für den 0815 Podcast Player.',
        'author' => '0815 Podcast',
        'language' => 'de',
        'website' => $baseUrl,
        'episodes' => array_map(static fn(array $item): array => [
            'id' => $item[0],
            'guid' => $item[0],
            'title' => $item[1],
            'description' => $item[2],
            'author' => '0815 Podcast',
            'published' => $item[5],
            'durationSeconds' => $item[4],
            'pageUrl' => $baseUrl,
            'audioUrl' => $baseUrl . 'audio/' . $item[3],
            'audioType' => 'audio/wav',
        ], $episodes),
    ];
}
