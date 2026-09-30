<?php
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (is_string($path) && (str_starts_with($path, '/src/') || in_array($path, ['/config.php', '/config.example.php', '/router.php'], true))) {
    http_response_code(403);
    return true;
}
if ($path === '/catalog') {
    require __DIR__ . '/catalog.php';
    return true;
}
if ($path === '/podcasts') {
    require __DIR__ . '/podcasts.php';
    return true;
}
return false;
