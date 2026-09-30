<?php
declare(strict_types=1);

// Copy outside the web document root and set PODCAST_PROVIDER_CONFIG to its path.
return [
    'mode' => 'private',
    'name' => 'Mein Podcast Provider',
    'base_url' => 'https://example.org/podcast-provider/',
    'allowed_origins' => ['https://username.github.io'],
    'token_env' => 'PODCAST_PROVIDER_TOKEN',
    'feeds' => [
        'mein-podcast' => [
            'feed' => 'https://example.org/feed.xml',
            'title' => 'Mein Podcast',
            'description' => 'Ein privat freigegebener Podcast.',
        ],
    ],
];
