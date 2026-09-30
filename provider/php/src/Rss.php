<?php
declare(strict_types=1);

namespace PodcastProvider;

use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;
use SimpleXMLElement;
use Throwable;

const MAX_FEED_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = '0815-podcast-provider/1 (+operator allowlist)';

function fetchFeed(string $url): string {
    for ($redirect = 0; $redirect <= MAX_REDIRECTS; $redirect++) {
        assertSafePublicUrl($url);
        [$status, $headers, $body] = fetchOnce($url);

        if ($status >= 300 && $status < 400) {
            if ($redirect === MAX_REDIRECTS) throw new RuntimeException('Zu viele Redirects.');
            $location = $headers['location'] ?? null;
            if (!$location) throw new RuntimeException("Redirect {$status} ohne Location.");
            $url = resolveUrl($url, $location);
            continue;
        }

        if ($status < 200 || $status >= 300) throw new RuntimeException("HTTP {$status} beim Feed-Abruf.");
        if (stripos($body, '<!DOCTYPE') !== false) throw new RuntimeException('DOCTYPE im Feed ist nicht erlaubt.');
        return $body;
    }
    throw new RuntimeException('Feed-Abruf fehlgeschlagen.');
}

function fetchOnce(string $url): array {
    $parts = parse_url($url);
    $host = (string)($parts['host'] ?? '');
    $scheme = strtolower((string)($parts['scheme'] ?? ''));
    $port = isset($parts['port']) ? (int)$parts['port'] : ($scheme === 'https' ? 443 : 80);
    $ips = resolvePublicIps($host);
    $pinnedIp = choosePinnedIp($ips);

    $headers = [];
    $body = '';
    $tooLarge = false;
    $ch = curl_init($url);
    if ($ch === false) throw new RuntimeException('cURL konnte nicht initialisiert werden.');

    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => USER_AGENT,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROXY => '',
        CURLOPT_HTTPAUTH => CURLAUTH_NONE,
        CURLOPT_RESOLVE => [sprintf('%s:%d:%s', $host, $port, formatResolveIp($pinnedIp))],
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headers): int {
            $trimmed = trim($line);
            if ($trimmed !== '' && str_contains($trimmed, ':')) {
                [$name, $value] = array_map('trim', explode(':', $trimmed, 2));
                $headers[strtolower($name)] = $value;
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$body, &$tooLarge): int {
            if (strlen($body) + strlen($chunk) > MAX_FEED_BYTES) {
                $tooLarge = true;
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);

    $ok = curl_exec($ch);
    $error = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $primaryIp = (string)curl_getinfo($ch, CURLINFO_PRIMARY_IP);
    $contentType = strtolower((string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE));
    curl_close($ch);

    if ($tooLarge) throw new RuntimeException('Feed überschreitet das Größenlimit von 2 MB.');
    if ($ok === false) throw new RuntimeException('cURL-Fehler: ' . $error);
    if (!isPublicIp($primaryIp) || !in_array(normalizeIp($primaryIp), array_map('normalizeIp', $ips), true)) {
        throw new RuntimeException('Verbindung endete auf einer nicht freigegebenen IP-Adresse.');
    }
    if ($status >= 200 && $status < 300 && $contentType !== '') {
        $allowed = ['application/xml', 'text/xml', 'application/rss+xml', 'application/rdf+xml', 'application/octet-stream'];
        $baseType = trim(explode(';', $contentType, 2)[0]);
        if (!in_array($baseType, $allowed, true) && !str_ends_with($baseType, '+xml')) {
            throw new RuntimeException("Unerwarteter Content-Type: {$contentType}");
        }
    }

    return [$status, $headers, $body];
}

function assertSafePublicUrl(string $url, bool $resolveHost = true): void {
    if ($url === '' || strlen($url) > 4096) throw new RuntimeException('Ungültige Feed-URL.');
    $parts = parse_url($url);
    if ($parts === false) throw new RuntimeException('Feed-URL konnte nicht geparst werden.');
    $scheme = strtolower((string)($parts['scheme'] ?? ''));
    if (!in_array($scheme, ['http', 'https'], true)) throw new RuntimeException('Nur http/https sind erlaubt.');
    if (isset($parts['user']) || isset($parts['pass'])) throw new RuntimeException('URL-Zugangsdaten sind nicht erlaubt.');
    $host = (string)($parts['host'] ?? '');
    if ($host === '' || strtolower($host) === 'localhost') throw new RuntimeException('Feed-Host fehlt oder ist nicht erlaubt.');
    if (isset($parts['port']) && !in_array((int)$parts['port'], [80, 443], true)) throw new RuntimeException('Nur Port 80/443 sind erlaubt.');
    if ($resolveHost) resolvePublicIps($host);
}

function resolvePublicIps(string $host): array {
    $ips = [];
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $ips[] = $host;
    } else {
        $records = @dns_get_record($host, DNS_A | DNS_AAAA);
        if (!is_array($records) || $records === []) throw new RuntimeException("DNS-Auflösung fehlgeschlagen: {$host}");
        foreach ($records as $record) {
            if (!empty($record['ip'])) $ips[] = $record['ip'];
            if (!empty($record['ipv6'])) $ips[] = $record['ipv6'];
        }
    }
    $ips = array_values(array_unique(array_filter($ips)));
    if ($ips === []) throw new RuntimeException("Keine IP-Adresse für {$host} gefunden.");
    foreach ($ips as $ip) {
        if (!isPublicIp($ip)) throw new RuntimeException("Nicht öffentliche Ziel-IP für {$host}: {$ip}");
    }
    return $ips;
}

function choosePinnedIp(array $ips): string {
    foreach ($ips as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) return $ip;
    }
    return $ips[0];
}

function isPublicIp(string $ip): bool {
    if (!filter_var($ip, FILTER_VALIDATE_IP)) return false;
    if (str_starts_with(strtolower($ip), '::ffff:')) {
        $mapped = substr($ip, 7);
        return isPublicIp($mapped);
    }
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

function normalizeIp(string $ip): string {
    $packed = @inet_pton($ip);
    return $packed === false ? strtolower($ip) : bin2hex($packed);
}

function formatResolveIp(string $ip): string {
    return str_contains($ip, ':') ? '[' . $ip . ']' : $ip;
}

function resolveUrl(string $base, string $location): string {
    $location = trim($location);
    if (preg_match('#^https?://#i', $location)) return $location;
    $parts = parse_url($base);
    if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) throw new RuntimeException('Redirect-Basis ungültig.');
    $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    if (str_starts_with($location, '//')) return $parts['scheme'] . ':' . $location;
    if (str_starts_with($location, '/')) return $origin . $location;
    $path = (string)($parts['path'] ?? '/');
    $dir = preg_replace('#/[^/]*$#', '/', $path) ?: '/';
    return $origin . $dir . $location;
}

function parseRss(string $xml, array $entry): array {
    libxml_use_internal_errors(true);
    $rss = simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET | LIBXML_NOCDATA);
    if ($rss === false) throw new RuntimeException('Feed ist kein lesbares XML/RSS.');
    if (!isset($rss->channel)) throw new RuntimeException('RSS channel fehlt.');

    $channel = $rss->channel;
    $itunesNs = $rss->getNamespaces(true)['itunes'] ?? null;
    $dcNs = $rss->getNamespaces(true)['dc'] ?? null;
    $channelItunes = $itunesNs ? $channel->children($itunesNs) : null;

    $title = cleanText((string)$channel->title, 300);
    if ($title === '') throw new RuntimeException('Podcasttitel fehlt.');
    $description = cleanText((string)$channel->description, 4000);
    $homepage = safeHttpUrl((string)$channel->link) ?: ($entry['homepage'] ?? '');
    $author = $channelItunes ? cleanText((string)$channelItunes->author, 300) : '';
    $language = cleanText((string)$channel->language, 32);

    $episodes = [];
    foreach ($channel->item as $item) {
        $enclosure = $item->enclosure;
        $rawAudioUrl = trim((string)($enclosure['url'] ?? ''));
        $audioUrl = safeAudioUrl($rawAudioUrl);
        if ($audioUrl === '') {
            continue;
        }

        $itemItunes = $itunesNs ? $item->children($itunesNs) : null;
        $itemDc = $dcNs ? $item->children($dcNs) : null;
        $episodeTitle = cleanText((string)$item->title, 500);
        if ($episodeTitle === '') continue;
        $guid = cleanText((string)$item->guid, 1000);
        $published = parseDate((string)$item->pubDate);
        $link = safeHttpUrl((string)$item->link);
        $episodeAuthor = $itemItunes ? cleanText((string)$itemItunes->author, 300) : '';
        if ($episodeAuthor === '' && $itemDc) $episodeAuthor = cleanText((string)$itemDc->creator, 300);
        $duration = $itemItunes ? parseDuration((string)$itemItunes->duration) : null;
        $summary = $itemItunes ? cleanText((string)$itemItunes->summary, 5000) : '';
        if ($summary === '') $summary = cleanText((string)$item->description, 5000);

        $idSource = $guid !== '' ? $guid : implode('|', [$episodeTitle, $published ?? '', $audioUrl]);
        $episodes[] = [
            'id' => hash('sha256', $idSource),
            'guid' => $guid,
            'title' => $episodeTitle,
            'description' => $summary,
            'author' => $episodeAuthor,
            'published' => $published,
            'durationSeconds' => $duration,
            'pageUrl' => $link,
            'audioUrl' => $audioUrl,
            'audioType' => cleanText((string)($enclosure['type'] ?? ''), 100),
        ];
    }

    if ($episodes === []) throw new RuntimeException('Keine abspielbaren Episoden mit enclosure gefunden.');
    usort($episodes, static fn(array $a, array $b): int => strcmp((string)$b['published'], (string)$a['published']));

    return [
        'id' => $entry['id'],
        'title' => $title,
        'description' => $description,
        'author' => $author,
        'language' => $language,
        'website' => $homepage,
        'episodes' => $episodes,
    ];
}

function parseDate(string $value): ?string {
    $value = trim($value);
    if ($value === '') return null;
    try { return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('UTC'))->format(DATE_ATOM); }
    catch (Throwable) { return null; }
}

function parseDuration(string $value): ?int {
    $value = trim($value);
    if ($value === '') return null;
    if (ctype_digit($value)) return (int)$value;
    $parts = array_map('intval', explode(':', $value));
    if (count($parts) === 2) return $parts[0] * 60 + $parts[1];
    if (count($parts) === 3) return $parts[0] * 3600 + $parts[1] * 60 + $parts[2];
    return null;
}

function cleanText(string $value, int $maxLength): string {
    $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
    $value = trim($value);
    return mb_substr($value, 0, $maxLength, 'UTF-8');
}

function safeHttpUrl(string $value): string {
    $value = trim($value);
    if ($value === '' || strlen($value) > 4096) return '';
    $parts = parse_url($value);
    if ($parts === false) return '';
    if (!in_array(strtolower((string)($parts['scheme'] ?? '')), ['http', 'https'], true)) return '';
    if (empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) return '';
    return $value;
}

function safeAudioUrl(string $value): string {
    if (safeHttpUrl($value) === '') return '';
    $parts = parse_url($value);
    return strtolower((string)($parts['scheme'] ?? '')) === 'https' ? trim($value) : '';
}
