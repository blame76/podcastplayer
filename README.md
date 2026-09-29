# 0815 Podcast v0.3 — achtsam, static-first

Ein bewusst kleiner Podcast-Player für einen **kuratierten Katalog**. Der Player soll nicht möglichst viel zum Hören anbieten, sondern helfen, weniger und bewusster zu hören.

Der Player selbst ist vollständig statisch. RSS wird beim Build geladen, validiert und als statisches JSON für GitHub Pages oder beliebiges statisches Hosting erzeugt.

## Testfeed

Aktuell ist genau ein Feed freigegeben:

- Der KI-Podcast (BR): `https://feeds.br.de/der-ki-podcast/feed.xml`

## Produktmodell

### Deine Abos → Nicht gehört

- maximal 3 aktuelle ungehörte Folgen je Abo
- insgesamt maximal 10 Folgen
- sortierbar neueste / älteste zuerst
- schneller Filter auf ein einzelnes abonniertes Podcast
- gehört oder ausgeblendet verschwindet; dann rückt eine ältere ungehörte Folge nach

> Hier ist nur Platz für 10 Titel. Hör was weg, dann wird aufgefüllt.

### Playlist

- bewusst manuell aus der Podcast-Detailseite befüllt
- maximal 10 Folgen
- Reihenfolge: zuerst hinzugefügt, zuerst angezeigt
- gehört oder ausgeblendet verschwindet automatisch
- keine zweite Playlist, keine Prioritäten, kein Drag & Drop

### Podcast-Detail

- alle Episoden, die der RSS-Feed liefert
- 10 Folgen pro Seite
- Podcastinformationen aus dem Feed
- pro Folge: hören, Playlist, gehört/nicht gehört, „interessiert mich nicht“
- „Alte Folgen ausblenden“ behält die aktuellste ungehörte Folge und setzt ältere ungehörte Folgen auf `ignored`

Lokale Episodenzustände:

- `unheard`
- `heard`
- `ignored`
- Playlist-Mitgliedschaft separat

## Player

- Play/Pause
- 10 Sekunden zurück / vor
- zum Anfang
- Scrubber
- Abspielposition alle 5 Sekunden sowie bei Pause/Verlassen lokal gespeichert
- `ended` markiert automatisch als gehört; danach startet bewusst weder die nächste Folge noch die Playlist
- Media Session API für Sperrbildschirm/Kopfhörer, soweit unterstützt

## Architektur

```text
catalog.json
    ↓
GitHub Action / lokaler Build
    ↓
RSS abrufen + validieren + normalisieren
    ↓
_site/catalog.json
_site/data/<podcast>.json
    ↓
statischer PWA-Player
    ↓
localStorage: Abos, Status, Playlist, Position, Sortierung
```

Audio wird nicht gespiegelt. Beim Abspielen lädt der Browser die Audiodatei direkt vom Podcast-Anbieter.

## Nicht enthalten

Keine Suche, Empfehlungen, Accounts, Sync, öffentliche Feed-Eingabe, Kategorien, mehrere Playlists, Playlist-Reihenfolge per Drag & Drop, Geschwindigkeit, Sleep-Timer oder Offline-Audio.

## Build-Voraussetzungen

- PHP CLI
- ext-curl
- ext-libxml / SimpleXML
- ext-mbstring

Unter Debian/Ubuntu z. B.:

```bash
sudo apt install php-cli php-curl php-xml php-mbstring
```

## Lokal testen

```bash
./bin/test
./bin/build
php -S 127.0.0.1:8080 -t _site
```

Dann `http://127.0.0.1:8080/` öffnen.

`./bin/build` benötigt Internetzugriff zu den kuratierten RSS-Feeds. Scheitert Feed-Abruf oder Validierung, wird der Build abgebrochen. Für einen lokalen Build ohne Netzwerk: `./bin/build --fixture tests/fixtures/podcast.xml`. Der Build verwirft HTTP-Audio mit Warnung und erzeugt nur HTTPS-Audio-URLs.

## GitHub Pages

`.github/workflows/pages.yml` baut bei Push auf `main`, manuell und alle 3 Stunden. Podcastdaten entstehen nur im Build-Artefakt; es gibt keine automatischen Feed-Commits.

Unter **Settings → Pages → Build and deployment → Source** `GitHub Actions` wählen.

## Feed-Sicherheit

Der Build akzeptiert nur kuratierte URLs aus `catalog.json`, nur HTTP(S), nur Port 80/443 und keine lokalen/privaten/reservierten Ziel-IP-Adressen. Redirects werden einzeln erneut geprüft. Feed-Größe ist auf 2 MB begrenzt, DOCTYPE ist gesperrt und XML wird mit `LIBXML_NONET` geparst.

Der Fetcher läuft nur während eines kontrollierten Builds und besitzt keine öffentliche URL-Eingabe.

## Datenschutzmodell

**Static Host:** öffentlicher Katalog und normalisierte Podcast-Metadaten.

**Browser lokal:** Abos, Episodenstatus, Playlist, Abspielposition und Sortierung.

Beim Abspielen kontaktiert der Browser den Podcast-Anbieter direkt. Hosting- und Podcast-Anbieter sehen dabei technisch übliche Verbindungsdaten.

## Lizenz

MIT für den eigenen Quellcode. Podcast-Metadaten und Audiodateien bleiben Inhalte der jeweiligen Anbieter.
