# Feed Provider Contract v1

Kennung: `0815-podcast-provider-v1`. Der Player kennt nur normalisiertes JSON und genau einen aktiven Provider. Die Provider Base URL endet mit `/`; der Client ruft darunter `catalog` und `podcasts` auf. In Produktion muss die URL HTTPS verwenden. Im lokalen Entwicklungsmodus ist HTTP nur für Loopback erlaubt.

## GET /catalog

```json
{
  "provider": {
    "name": "0815 Demo Provider",
    "version": "1",
    "contract": "0815-podcast-provider-v1"
  },
  "generatedAt": "2026-09-30T10:00:00Z",
  "podcasts": [
    {
      "id": "0815-demo",
      "title": "0815 Demo Podcast",
      "description": "Eigene Testdaten"
    }
  ]
}
```

Der Katalog enthält nur ID, Titel und Beschreibung für die Auswahl.

## POST /podcasts

Request mit `Content-Type: application/json`:

```json
{"ids":["0815-demo"]}
```

Response:

```json
{
  "generatedAt": "2026-09-30T10:00:00Z",
  "podcasts": [
    {
      "id": "0815-demo",
      "title": "0815 Demo Podcast",
      "description": "Eigene Testdaten",
      "author": "0815 Podcast",
      "language": "de",
      "website": "https://example.org/",
      "episodes": [
        {
          "id": "demo-episode",
          "guid": "demo-episode",
          "title": "Testfolge",
          "description": "Eigene Beschreibung",
          "author": "0815 Podcast",
          "published": "2026-09-30T10:00:00Z",
          "durationSeconds": 30,
          "pageUrl": "https://example.org/",
          "audioUrl": "https://example.org/audio.wav",
          "audioType": "audio/wav"
        }
      ]
    }
  ]
}
```

Podcast-IDs stehen ausschließlich im Request-Body, nicht in Querystrings. Der Client sendet die IDs des aktiven Katalogs, damit Abos, Playlist und Detailansichten funktionieren. Episode-IDs müssen über Abrufe stabil bleiben. Episoden stehen je Podcast in absteigender Reihenfolge des Veröffentlichungsdatums, damit „Alte Folgen ausblenden“ die neueste ungehörte Folge behält. Die PHP-Referenz begrenzt einen POST auf 50 IDs und 16 KiB Request-Body. Audio-URLs müssen HTTPS nutzen; nur im lokalen Entwicklungsmodus ist Loopback-HTTP möglich. RSS-URLs gehören nicht in Antworten.

## Authentifizierung und CORS

Private Provider können `Authorization: Bearer <token>` verlangen. Der Token wird lokal im Browser unter einem eigenen Schlüssel gespeichert und niemals in eine URL eingebaut. Die PHP-Referenz liest den Vergleichswert aus einer Environment-Variable und nutzt `hash_equals()`.

Browserzugriff benötigt CORS. Der Demo Provider darf für seine vollständig eigenen öffentlichen Daten `Access-Control-Allow-Origin: *` setzen. Private Provider definieren eine Allowlist konkreter Origins, zum Beispiel `https://username.github.io`. Preflight `OPTIONS` erlaubt `Content-Type` und `Authorization` und setzt bei dynamischem Origin `Vary: Origin`. CORS ersetzt keine Authentifizierung.

Fehlerantworten bestehen aus einem festen Code, zum Beispiel `{"error":"unauthorized"}` oder `{"error":"unknown_podcast"}`. Stacktraces, Dateipfade, Zugangsdaten und Tokens werden nicht ausgegeben.

## Private Feed-Allowlist

Der Betreiber definiert IDs und Feed-URLs serverseitig, zum Beispiel in einer Konfiguration außerhalb des Document Roots:

```php
'feeds' => [
    'mein-podcast' => [
        'feed' => 'https://example.org/feed.xml',
        'title' => 'Mein Podcast',
        'description' => 'Privat freigegeben'
    ],
]
```

Der Client darf nur IDs anfordern. `POST /podcasts` akzeptiert kein `url`-Feld; damit ist der Provider kein offener RSS-Proxy. Die PHP-Referenz prüft Feed-Zieladressen und Redirects vor dem Abruf. Ein eigenes Beispiel liegt in [config.example.php](../provider/php/config.example.php).

## Datenschutz und Verantwortung

Der Player speichert persönliche Podcastdaten lokal. Der Provider verarbeitet technisch Katalog- und Podcastdaten-Requests und kann über sein Hosting IP-Adresse und Request-Metadaten sehen; der Referenzcode protokolliert weder Hörstände noch Tokens oder Request-Bodies. Beim direkten Audioabruf sieht der Audioanbieter technisch ebenfalls einen Request.

Betreiber eines eigenen Providers sind selbst dafür verantwortlich, dass sie die eingebundenen Podcastfeeds und Inhalte in der jeweiligen Form verwenden dürfen. Diese Dokumentation gibt keine rechtliche Garantie.
