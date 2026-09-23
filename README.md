# QR-Stream

Dateien rein optisch vom PC aufs Handy übertragen – ohne Netzwerk, ohne App.
Der PC zeigt wechselnde QR-Codes (1, 2 oder 4 gleichzeitig), das Handy filmt sie
mit der Kamera und setzt die Datei wieder zusammen.

**Online:**
- Empfänger (Handy): https://narik233.github.io/qr-stream/
- Sender (PC): https://narik233.github.io/qr-stream/sender.html

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

## Entwicklung

```
npm install
npm test        # Codec, Fountain-Code, QR-Erzeugung/-Erkennung, 4-Code-Erkennung
npm run build   # erzeugt dist/sender.html, dist/receiver.html, dist/index.html
```

`test/e2e.html` (über einen lokalen Webserver öffnen) speist die echten Sender-Bilder
simuliert als Kamerabild in den Empfänger ein und prüft die Datei bitgenau.
