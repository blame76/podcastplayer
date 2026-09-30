# Deployment: Strato und GitHub Pages

`main` ist der Quellbranch. Der Workflow [.github/workflows/pages.yml](../.github/workflows/pages.yml) prüft und baut den Player bei jedem Push nach `main`. Sobald `PODCAST_DEPLOY_ENABLED=true` gesetzt ist, lädt er zuerst den öffentlichen PHP Demo Provider zu Strato hoch, prüft dessen HTTPS-Endpunkte und veröffentlicht danach den Player über GitHub Pages. Er lässt sich zusätzlich unter **Actions → Test and deploy podcast player → Run workflow** manuell starten. Der bestehende `gh-pages`-Branch ist nur ein gebauter Stand; der neue Workflow verwendet ihn nicht.

## 1. Strato vorbereiten

Im Strato Kundenlogin unter **Datenbanken und Webspace → SFTP & SSH** einen separaten Zugang für dieses Deployment anlegen. Für Anmeldung mit einem Public Key beschreibt [Strato einen Zugang vom Typ SFTP + SSH und `.ssh/authorized_keys` im Startverzeichnis](https://www.strato.de/faq/hosting/so-nutzen-sie-ihren-ssh-sftp-zugang/). Den Public Key dort hinterlegen; den zugehörigen privaten OpenSSH Key nur lokal und später als GitHub Secret speichern. Für unbeaufsichtigte Actions-Läufe muss er ohne interaktive Passphrase nutzbar sein. Hostname, Benutzername und Port aus **diesem** Strato Zugang übernehmen; keine anderen SSH-Profile verwenden.

Das Zielverzeichnis im Strato Webspace so anlegen, dass es unter `https://blame76.com/0815/podcast-provider-demo/` erreichbar ist und PHP sowie `.htaccess` verarbeitet. `PODCAST_SFTP_TARGET` ist der absolute Pfad **aus Sicht dieses SFTP Zugangs**, etwa `/0815/podcast-provider-demo` oder `/webroot/0815/podcast-provider-demo`; der Pfad hängt vom konfigurierten Startverzeichnis ab. Das Verzeichnis muss bereits existieren. Den SSH Host Key vor dem ersten CI Lauf unabhängig prüfen und den passenden `known_hosts`-Eintrag speichern. Der Workflow akzeptiert keine unbekannten Host Keys automatisch.

Optional vor Ort mit dem dafür vorgesehenen Key und einem verifizierten `known_hosts`-Eintrag prüfen:

```bash
PODCAST_SFTP_HOST=... PODCAST_SFTP_USER=... PODCAST_SFTP_KEY=/absoluter/pfad/zum/key \
PODCAST_SFTP_TARGET=/.../0815/podcast-provider-demo bin/deploy-provider-demo --plan

PODCAST_SFTP_HOST=... PODCAST_SFTP_USER=... PODCAST_SFTP_KEY=/absoluter/pfad/zum/key \
PODCAST_SFTP_TARGET=/.../0815/podcast-provider-demo bin/deploy-provider-demo --check
```

`--plan` zeigt die Dateiauswahl ohne Verbindung; `--check` prüft Anmeldung und Zielpfad ohne Upload. `--upload` überträgt ausschließlich `catalog.php`, `podcasts.php`, `.htaccess`, vier PHP Dateien unter `src/` und drei eigene WAV Dateien. Private Konfigurationen, RSS Feeds und Build Werkzeuge werden nicht übertragen.

## 2. GitHub Actions konfigurieren

Unter **Repository → Settings → Environments → github-pages** die folgenden Secrets und Variablen anlegen. Der Workflow liest sie in Jobs, die diese Umgebung ausdrücklich referenzieren:

| Typ | Name | Wert |
| --- | --- | --- |
| Secret | `PODCAST_SFTP_PRIVATE_KEY` | Vollständiger privater OpenSSH Key des Strato Deploy Zugangs, mit Zeilenumbrüchen |
| Secret | `PODCAST_SFTP_KNOWN_HOSTS` | Verifizierter OpenSSH `known_hosts`-Eintrag für den Strato Host |
| Variable | `PODCAST_SFTP_HOST` | Strato SFTP Hostname aus dem Kundenlogin |
| Variable | `PODCAST_SFTP_USER` | Strato Benutzername dieses Zugangs |
| Variable | `PODCAST_SFTP_PORT` | Port, üblicherweise `22`; leer verwendet `22` |
| Variable | `PODCAST_SFTP_TARGET` | Bestehender absoluter SFTP Zielpfad mit Ende `/0815/podcast-provider-demo` |
| Variable | `PODCAST_DEPLOY_ENABLED` | `true`, **erst wenn** Strato und Pages eingerichtet sind |

[GitHub dokumentiert Repository Secrets und Variablen](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets). Weder Key noch Zugangsdaten ins Repository schreiben. Der Workflow übergibt sie direkt an OpenSSH mit `StrictHostKeyChecking=yes`.

## 3. Pages einschalten und Lauf starten

Unter **Repository → Settings → Pages → Build and deployment → Source** **GitHub Actions** wählen. [GitHubs Anleitung für einen vorhandenen eigenen Workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow) beschreibt diese Auswahl. Danach die Umgebungsvariable `PODCAST_DEPLOY_ENABLED=true` setzen und den Workflow auf `main` manuell starten. Der Build-Job liest diesen Schalter aus der Umgebung und gibt ihn als Job-Output an die Deploy-Jobs weiter. Bei Erfolg sind die Adressen:

- Provider: `https://blame76.com/0815/podcast-provider-demo/catalog`
- Player: `https://blame76.github.io/podcastplayer/`

Der Live Test `bin/verify-provider-demo` prüft Contract, CORS, drei Audio Dateien und die Sperre des PHP Quellverzeichnisses. Ein fehlgeschlagener Provider Upload oder Test verhindert die Pages Veröffentlichung. Weitere Pushes nach `main` lösen denselben Ablauf automatisch aus. Wenn die Strato PHP Laufzeit keine Apache Rewrite Regeln oder keine `.htaccess`-Verarbeitung bietet, müssen `/catalog` und `/podcasts` dort passend geroutet und `src/` gesperrt werden; der Live Test macht einen solchen Konfigurationsfehler sichtbar.
