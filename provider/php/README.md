# PHP Feed Provider

Kleine PHP-8.x-Referenz ohne Datenbank, Sessions, Composer oder Accounts. Die Endpunkte `GET /catalog` und `POST /podcasts` liefern Contract `0815-podcast-provider-v1`. Apache leitet die Pfade über `.htaccess` auf `catalog.php` und `podcasts.php`. Bei Nginx sind entsprechende Routen und eine Sperre für `src/` und `config.php` selbst einzurichten.

## Öffentliche Demo

Ohne private Konfiguration läuft ausschließlich der eigene 0815 Demo Podcast. Es gibt keine Feed-URL, keinen RSS-Abruf und keinen Endpoint für fremde URLs. Drei synthetische WAV-Dateien unter `audio/` wurden mit `python3 tools/generate_demo_audio.py` aus der Python-Standardbibliothek erzeugt. Für die Veröffentlichung unter der vorgesehenen Adresse `https://blame76.com/0815/podcast-provider-demo/` dieses Verzeichnis auf einen PHP-fähigen Host kopieren. Der Default-`base_url`-Wert entspricht dieser Adresse; bei anderem Pfad `PODCAST_PROVIDER_BASE_URL` setzen.

Lokal:

```bash
PODCAST_PROVIDER_BASE_URL=http://127.0.0.1:8001/ php -S 127.0.0.1:8001 -t provider/php provider/php/router.php
```

## Privater Provider

`config.example.php` als Vorlage kopieren, bevorzugt **außerhalb des Document Roots**, und den absoluten Pfad per `PODCAST_PROVIDER_CONFIG` setzen. Feed-IDs, Metadaten, Origin-Allowlist und Base URL werden dort vom Betreiber festgelegt. Ein optionaler Bearer Token liegt nur in der Environment-Variable, deren Name unter `token_env` steht, zum Beispiel `PODCAST_PROVIDER_TOKEN`. Die echte Token-Zeichenfolge gehört weder in eine PHP-Datei noch ins Repository.

Falls Shared Hosting eine lokale `config.php` erfordert: Sie ist in `.gitignore` ausgeschlossen; `.htaccess` sperrt direkten Webzugriff. Für andere Webserver dieselbe Sperre ausdrücklich konfigurieren. Keine Konfigurationsdatei öffentlich als Text ausliefern.

Bei jedem privaten `POST /podcasts` ruft die Referenz die angeforderten freigegebenen Feeds live ab; sie führt keine Hintergrundsynchronisation aus. Die private Implementierung ruft ausschließlich serverseitig freigegebene Feeds ab, begrenzt Größe und Redirects, prüft öffentliche Ziel-IP-Adressen und gibt nur normalisierte JSON-Daten aus. Audio wird nicht gespiegelt. Der Provider kann IP-Adresse und Request-Metadaten über normale Hosting-Logs verarbeiten; der PHP-Code protokolliert keine Hörhistorie, Abos, Playlist, Positionen, Tokens oder Request-Bodies. Betreiber klären die Berechtigung zur Nutzung der eingebundenen Feeds und Inhalte selbst.
