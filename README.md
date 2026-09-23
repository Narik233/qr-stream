# QR-Stream

Dateien rein optisch vom PC aufs Handy übertragen – ohne Netzwerk, ohne App.
Der PC zeigt wechselnde Codes, das Handy filmt sie mit der Kamera und setzt die Datei wieder zusammen.

Zwei Verfahren, oben auf jeder Seite umschaltbar:

| | QR-Codes | cimbar |
|---|---|---|
| Format | 1, 2 oder 4 Standard-QR-Codes | Farbiger Spezialcode ([libcimbar](https://github.com/sz3/libcimbar)) |
| Tempo | niedriger (geschätzt 5–15 KB/s, nicht gemessen) | deutlich höher (Autor: ~106 KB/s mit Android-App, Browser langsamer) |
| Robustheit | sehr robust, schwarz-weiß | empfindlicher für Farbstich, Spiegelungen, schwache Kameras |
| Browser | alle modernen | Empfänger braucht WebCodecs (aktuelle Chrome/Safari), Sender WebGL |
| Offline | Einzeldateien, laufen auch per Doppelklick | braucht http(s) (Worker + WASM) |

**Online:**

| | QR-Codes | cimbar |
|---|---|---|
| Handy (Empfänger) | https://narik233.github.io/qr-stream/ | https://narik233.github.io/qr-stream/cimbar/ |
| PC (Sender) | https://narik233.github.io/qr-stream/sender.html | https://narik233.github.io/qr-stream/cimbar/sender.html |

## Benutzung

- **PC:** `dist/sender.html` im Browser öffnen (Doppelklick genügt, läuft offline). Datei wählen.
- **Handy:** Empfängerseite (`dist/receiver.html`) über eine **HTTPS**-Adresse öffnen,
  „Kamera starten“ und auf den Bildschirm halten, bis 100 % erreicht sind. Dann „Speichern“ oder „Teilen“.

Browser erlauben die Kamera nur über HTTPS. Die Empfängerseite muss deshalb einmal
gehostet werden, z. B. auf GitHub Pages (`dist/index.html` ist eine Kopie des Empfängers).
Die Seite ist eine einzige Datei ohne externe Abhängigkeiten.

## Wie es funktioniert

- **Fountain-Code (LT-Code):** Die Datei wird in Blöcke geteilt, jeder QR-Code enthält eine
  zufällige XOR-Kombination von Blöcken. Der Empfänger braucht nur *irgendwelche* ~k Codes
  (k = Anzahl Blöcke) – verpasste Codes und der Einstiegszeitpunkt sind egal.
- **Gauß-Elimination** auf dem Handy: typischerweise genügen k bis k+2 Codes (Overhead ≈ 1,00–1,06×).
- **Base45 im QR-Alphanumerik-Modus:** nur ~3 % Kodierungs-Overhead.
- **Kompression** (deflate) wird automatisch genutzt, wenn sie sich lohnt.
- **CRC32-Prüfsumme** über die ganze Datei.
- **Scanner:** zxing-wasm (eingebettet), erkennt mehrere Codes pro Kamerabild.

## Einstellungen (Sender)

| Einstellung | Wirkung |
|---|---|
| QR-Codes gleichzeitig: 1 / 2 / 4 | Mehr Codes = mehr Durchsatz, braucht aber eine gute Kamera und Abstand, sodass alle ins Bild passen |
| Robust / Normal / Dicht | 300 / 500 / 800 Byte pro Code |
| Wechsel pro Sekunde | Wenn das Handy nicht mitkommt (Codes/s beim Empfänger deutlich unter Sender-Rate): reduzieren |

## cimbar-Modus

`vendor/cimbar/` enthält die **unveränderten** Dateien aus dem libcimbar-Release v0.6.8
(MPL-2.0, Herkunft und Prüfsummen in `vendor/cimbar/README.md`). Die deutschen Seiten
`src/cimbar-sender.html` und `src/cimbar-receiver.html` binden sie ein und passen nur von außen an:

- eigene Skalierung ohne Drehung (sonst wird Modus Bm in schmalen Bereichen verzerrt)
- Datei wird komplett gelesen und synchron kodiert (sonst vermischen sich schnell nacheinander gewählte Dateien)
- Empfänger zeigt „Speichern/Teilen“ statt automatischem Download und fällt nach Moduswechsel auf Auto-Erkennung zurück
- Service Worker von libcimbar werden nicht genutzt (absolute Pfade passen nicht unter /qr-stream/)

## Entwicklung

```
npm install
npm test           # Codec, Fountain-Code, QR-Erzeugung/-Erkennung, 4-Code-Erkennung
npm run build      # dist/ (QR-Seiten als Einzeldateien, dist/cimbar/ mit libcimbar)
npm run test:e2e   # headless Chrome: echte Sender-Bilder -> echter Empfänger, Datei bitgenau prüfen
```

Die E2E-Tests (`test/e2e.html`, `test/cimbar-e2e.html`) speisen die vom Sender gezeichneten Bilder
statt einer Kamera in den Empfänger ein – das prüft die komplette Kette, ersetzt aber keinen Test
mit echter Handykamera.
