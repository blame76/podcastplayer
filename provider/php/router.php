<?php
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($path === '/catalog') {
    require __DIR__ . '/catalog.php';
    return true;
}
if ($path === '/podcasts') {
    require __DIR__ . '/podcasts.php';
    return true;
}
return false;
