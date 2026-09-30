# 0815 Podcast

Ein kleiner statischer Podcast-Player für bewusstes Hören. Der Player spricht ausschließlich mit einem konfigurierbaren Feed Provider über normalisiertes JSON. Er enthält keine RSS-URLs, keinen XML-Parser und keine Daten eines konkreten Podcastanbieters.

## Architektur

```text
Podcast/RSS → eigener Feed Provider → normalisiertes JSON → 0815 Podcast Player
```

Der öffentliche Default ist der 0815 Demo Provider unter `https://blame76.com/0815/podcast-provider-demo/`. Er enthält ausschließlich den selbst erstellten **0815 Demo Podcast** mit drei synthetischen WAV-Dateien. Ist diese Adresse noch nicht bereitgestellt, kann derselbe Provider lokal gestartet und im Player eingetragen werden. Der Player kann statisch auf GitHub Pages oder einem anderen Host liegen; ein privater Provider darf auf einem unabhängigen Host laufen.

Der Provider Contract und eine Anleitung für private Betreiber stehen in [docs/feed-provider.md](docs/feed-provider.md). Die PHP-Referenz für klassische LAMP-Hosts steht in [provider/php/README.md](provider/php/README.md).

## Produktmodell

- „Nicht gehört“: maximal 3 ungehörte Folgen je Abo und insgesamt 10
- Playlist: manuell, global maximal 10
- Podcast-Detail: alle gelieferten Episoden, 10 pro Seite
- Status `unheard`, `heard`, `ignored`; Playlist-Zugehörigkeit separat
- Gehört oder ignoriert entfernt Folgen aus Inbox und Playlist
- „Alte Folgen ausblenden“ lässt die neueste ungehörte Folge bestehen
- Play/Pause, 10 Sekunden vor/zurück, zum Anfang, Scrubber und Media Session
- `ended` markiert als gehört; bewusst kein automatischer Start der nächsten Folge

Genau ein Provider ist gleichzeitig aktiv. Die kleine Einstellung im Player erlaubt URL, optionalen Token, Verbindungstest, Speichern und Rückkehr zum Demo Provider. Providerwechsel löschen lokale Hörstände nicht. Nicht verfügbare Podcast-IDs bleiben lokal gespeichert.

## Lokal starten

Voraussetzungen: PHP 8.x mit cURL, SimpleXML und mbstring; Node.js für die Tests. Keine Composer- oder npm-Abhängigkeiten.

```bash
bin/test
bin/build
php -S 127.0.0.1:8080 -t _site
```

In einem zweiten Terminal den lokalen Demo Provider starten:

```bash
PODCAST_PROVIDER_BASE_URL=http://127.0.0.1:8001/ php -S 127.0.0.1:8001 -t provider/php provider/php/router.php
```

Im Player die Provider URL `http://127.0.0.1:8001/` eintragen und speichern. HTTP ist nur bei lokaler Entwicklung mit localhost, 127.0.0.1 oder IPv6-Loopback erlaubt. Produktive Provider-URLs müssen HTTPS verwenden.

`bin/build` kopiert nur die statische Player-Shell nach `_site`. Es ruft keine RSS-Feeds ab. Der Pages-Workflow führt zuerst `bin/test` aus und baut erst danach das statische Artefakt. Der Demo Provider wird separat bereitgestellt.

## Datenschutz

Abos, Hörstände, Playlist, Positionen und Provider-Konfiguration bleiben im Browser. Ein optionaler Bearer Token liegt unter einem eigenen lokalen Speicherschlüssel. **Ein im Browser gespeicherter Provider-Token ist ein lokales Geheimnis und darf nie in öffentlich ausgelieferten Sourcecode eingebettet werden.** Es gibt keine Accounts, Cookies, Analytics oder Synchronisierung.

Beim Öffnen des Players werden Katalog und Podcastdaten vom aktiven Provider angefragt. Für die Podcastdaten sendet der Player die IDs des aktiven Katalogs im JSON-Body eines POST-Requests, unabhängig von der Abo-Auswahl. Hörstände, Playlist und Positionen werden nicht gesendet. Der Provider und dessen Hosting können technisch IP-Adresse und Request-Metadaten verarbeiten. Beim Abspielen fordert der Browser Audio direkt vom angegebenen Audioanbieter an; auch dieser erhält technisch einen Request. Der Provider-Code selbst protokolliert keine Hörhistorie, Tokens oder Request-Bodies.

## Nicht enthalten

Kein Offline-Audio, keine automatischen Downloads, keine RSS-Verwaltung oder Feed-Discovery im Player, keine Multi-Provider-Aggregation, keine Accounts und keine zentrale Hörhistorie.

## Lizenz

MIT für den eigenen Quellcode. Betreiber eigener Provider sind für die Zulässigkeit ihrer eingebundenen Feeds und Inhalte selbst verantwortlich.
