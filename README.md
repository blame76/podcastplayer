# 0815 Podcast

Ein kleiner statischer Podcast-Player für bewusstes Hören. Für Podcastdaten spricht der Player ausschließlich mit einem konfigurierbaren Feed Provider über normalisiertes JSON. Er enthält keine RSS-URLs, keinen XML-Parser und keine Daten eines konkreten Podcastanbieters.

## Architektur

```text
Podcast/RSS → eigener Feed Provider → normalisiertes JSON → 0815 Podcast Player
```

Der öffentliche Default ist der 0815 Demo Provider unter `https://blame76.com/0815/podcast-provider-demo/`. Er enthält ausschließlich den selbst erstellten **0815 Demo Podcast** mit drei synthetischen WAV-Dateien. Ist diese Adresse noch nicht bereitgestellt, kann derselbe Provider lokal gestartet und im Player eingetragen werden. Der Player kann statisch auf GitHub Pages oder einem anderen Host liegen; ein privater Provider darf auf einem unabhängigen Host laufen.

Der Provider Contract und eine Anleitung für private Betreiber stehen in [docs/feed-provider.md](docs/feed-provider.md). Die PHP-Referenz für klassische LAMP-Hosts steht in [provider/php/README.md](provider/php/README.md).

## Podcastdaten und Offline-Hören

Beim Start verwendet die App ausschließlich den letzten lokal gespeicherten Provider-Snapshot aus IndexedDB. Der erste Start ohne Snapshot zeigt einen normalen Leerzustand. Neue Podcastdaten werden nur durch „Podcasts neu laden“ oder einen ausdrücklich gewählten Providerwechsel angefordert. Der Provider bleibt gemäß [Provider-Contract](docs/feed-provider.md) austauschbar. Ein Refresh desselben Providers lässt laufende Wiedergabe und persönliche Daten bestehen.

Episoden werden nur nach Klick auf „Offline speichern“ als Blob in IndexedDB abgelegt. Offline-Audio wird gegenüber der Netzwerk-URL bevorzugt; die App-Shell liegt getrennt im Service-Worker-Cache. Gehörte Offline-Folgen werden standardmäßig nach 15 Minuten bei natürlichen App-Ereignissen gelöscht; diese Automatik lässt sich abschalten. Manuelles Löschen gehörter Offline-Folgen bleibt möglich. Es gibt keine automatischen Downloads.

Nicht jeder Audioanbieter erlaubt dem Browser einen JavaScript-Download per CORS. Dann bleibt Streaming möglich, Offline-Speichern aber nicht. Der Player verwendet dafür weder einen Audio-Proxy noch `no-cors`.

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

Nur bei „Podcasts neu laden“, Verbindungstest oder explizitem Providerwechsel werden Katalog und Podcastdaten vom aktiven Provider angefragt. Für die Podcastdaten sendet der Player die IDs des aktiven Katalogs im JSON-Body eines POST-Requests, unabhängig von der Abo-Auswahl. Hörstände, Playlist und Positionen werden nicht gesendet. Der Provider und dessen Hosting können technisch IP-Adresse und Request-Metadaten verarbeiten. Beim Abspielen fordert der Browser Audio direkt vom angegebenen Audioanbieter an; auch dieser erhält technisch einen Request. Der Provider-Code selbst protokolliert keine Hörhistorie, Tokens oder Request-Bodies.

## Nicht enthalten

Keine automatischen Downloads, keine RSS-Verwaltung oder Feed-Discovery im Player, keine Multi-Provider-Aggregation, keine Accounts und keine zentrale Hörhistorie.

## Manueller Browser-Testplan

Die folgenden Schritte sind für einen Browser-/PWA-Test vorgesehen; sie sind keine Aussage über bereits ausgeführte manuelle Tests.

1. Nach einem erfolgreichen Refresh App schließen und ohne Netzwerk neu öffnen: Snapshot und Podcastdaten müssen sichtbar sein.
2. Folge weiterhören; danach „Podcasts neu laden“ bei erreichbarem Provider auslösen: Wiedergabe und Position müssen erhalten bleiben.
3. Eine CORS-fähige Demo-Folge ausdrücklich offline speichern. „Offline verfügbar“ muss erscheinen.
4. Netzwerk abschalten, Folge vollständig starten und zum Anfang sowie in die Mitte seeken.
5. App schließen und neu öffnen; die Folge offline erneut abspielen und seeken.
6. Folge als gehört markieren: vor Ablauf von 15 Minuten muss die Datei bleiben. Mit einem lokal simulierten `heardAt` älter als 15 Minuten die App neu öffnen: Datei wird entfernt, Hörstatus bleibt.
7. Automatische Bereinigung deaktivieren und manuelle Bereinigung auslösen: gehörte, nicht laufende Dateien werden entfernt.

## Lizenz

MIT für den eigenen Quellcode. Betreiber eigener Provider sind für die Zulässigkeit ihrer eingebundenen Feeds und Inhalte selbst verantwortlich.
