<?php
declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        buildSite();
    } catch (Throwable $error) {
        fwrite(STDERR, "BUILD FAILED: " . $error->getMessage() . "\n");
        exit(1);
    }
}

function assertImpressumReady(string $html): void {
    if (preg_match('/\[POSTANSCHRIFT|VOR EINER ÖFFENTLICHEN VERÖFFENTLICHUNG VERVOLLSTÄNDIGEN/iu', $html)) {
        throw new RuntimeException('Impressum enthält einen Veröffentlichungs-Platzhalter.');
    }
}

function buildSite(): void {
    $root = dirname(__DIR__);
    $source = $root . '/public';
    $destination = $root . '/_site';
    $impressum = @file_get_contents($source . '/impressum.html');
    if ($impressum === false) throw new RuntimeException('Impressum konnte nicht gelesen werden.');
    assertImpressumReady($impressum);

    if (is_dir($destination)) {
        $items = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($destination, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($items as $item) {
            if ($item->isDir()) rmdir($item->getPathname());
            else unlink($item->getPathname());
        }
        rmdir($destination);
    }
    if (!mkdir($destination, 0775, true) && !is_dir($destination)) {
        throw new RuntimeException('Site-Verzeichnis konnte nicht erstellt werden.');
    }
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($items as $item) {
        $target = $destination . '/' . $items->getSubPathName();
        if ($item->isDir()) {
            if (!is_dir($target)) mkdir($target, 0775, true);
        } else {
            if (!copy($item->getPathname(), $target)) {
                throw new RuntimeException('Site-Datei konnte nicht kopiert werden.');
            }
        }
    }
    fwrite(STDOUT, "BUILD OK -> " . $destination . "\n");
}
