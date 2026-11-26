# Kartpalast München – Streckenauslastung

Öffentliche Übersicht, wie voll die Grand-Prix-30-Läufe im Kartpalast München sind (heute + 7 Tage).

- Seite: `docs/` (GitHub Pages)
- Daten: `docs/data.json`, alle 15 Minuten von `.github/workflows/update.yml` aktualisiert
- Auslese: `scrape.mjs` öffnet die öffentliche Online-Buchung (SMS-Timing) in einem unsichtbaren Browser und liest die freien Plätze je Lauf. Es wird nichts gebucht.
