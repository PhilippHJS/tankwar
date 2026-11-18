# Tank War

Panzerschlacht für bis zu vier im Browser, jeder am eigenen Rechner und ohne Anmeldung. Drei Leben pro Runde, Raketen prallen von jeder Wand ab, und wer zuletzt noch fährt, holt den Punkt.

Bisher gibt es ein Fahrzeug und eine Arena. Die Auswahl im Raum ist schon für mehr ausgelegt.

## So wird gespielt

1. Seite öffnen, Namen eingeben, **Raum erstellen**.
2. Den Einladungslink an bis zu drei Mitspieler schicken.
3. Der Gastgeber stellt Rundendauer und Punkte zum Sieg ein und startet das Spiel. Freie Plätze können Bots übernehmen, alleine ausprobieren geht also auch.

| Was | Tastatur und Maus | Gamepad |
| --- | --- | --- |
| Fahren | WASD | linker Stick oder Steuerkreuz |
| Zielen | Maus, ohne Maus Pfeiltasten links/rechts oder Q/E | rechter Stick |
| Schießen | Linksklick oder Leertaste, gedrückt halten feuert dauernd | A, RB oder RT |

Fahren und Zielen sind getrennt: Die Wanne fährt in die gewünschte Richtung, der Turm zeigt unabhängig davon aufs Ziel. Liegt die Richtung eher hinter dem Panzer, fährt er rückwärts, statt umständlich zu wenden. Eine gestrichelte Linie zeigt die Flugbahn bis zum ersten Abpraller.

Das Gerät des Gastgebers führt den Spielstand. Seine Seite muss offen bleiben, solange gespielt wird. Wer neu lädt oder kurz die Verbindung verliert, landet wieder auf seinem Platz, bis dahin fährt ein Bot für ihn.

## Regeln

- Jeder hat pro Runde 3 Leben und eine Lebensleiste. Drei Treffer kosten ein Leben.
- Wer abgeschossen wird, ist 5 Sekunden raus und steigt dann am Startplatz wieder ein, der am weitesten von den anderen weg ist. Danach ist er 2 Sekunden unverwundbar.
- Raketen fliegen mittelschnell, prallen von jeder Wand ab und verpuffen nach gut 3 Sekunden. Zwischen zwei Schüssen muss nachgeladen werden.
- Kein Eigenbeschuss: Die eigenen Raketen tun dem eigenen Panzer nichts, auch nach einem Abpraller nicht.
- Die Runde endet, wenn nur noch einer Leben hat. Erwischen sich die letzten beiden gleichzeitig, gewinnen beide.
- Läuft die Zeit ab, gewinnt, wer die meisten Leben hat, bei Gleichstand, wer mehr Lebensleiste hat. Ist es dann immer noch gleich, gewinnen mehrere.
- Jeder Rundensieger bekommt einen Punkt. Nach einer kurzen Ehrenrunde, in der man nur noch fahren kann, beginnt die nächste Runde. Wer die eingestellten Punkte erreicht, gewinnt das Spiel.
- Wer während eines Spiels dazukommt, schaut zu und steigt mit der nächsten Runde ein. Fährt auf seinem Platz gerade ein Bot, übernimmt er dessen Panzer sofort.

## Einstellungen

Der Gastgeber stellt sie im Raum ein, die Mitspieler sehen sie. Sie gelten ab dem nächsten Spiel, und der Browser merkt sie sich für den nächsten Raum.

| Einstellung | Stufen |
| --- | --- |
| Rundendauer | 1, 2, **3** oder 5 Minuten |
| Punkte zum Sieg | 1 bis 5, normal **3** |
| Arena | **Klassik** |
| Freie Plätze | leer lassen oder **mit Bots füllen** |

## Fahrzeuge

| Fahrzeug | Waffe | Tempo | Leben | Schaden | Nachladen |
| --- | --- | --- | --- | --- | --- |
| Prellbock | Rakete, prallt ab | 2,2 Felder/s | 100 | 34 | 0,7 s |

Neue Fahrzeuge kommen als Eintrag in `VEHICLES` in `js/config.js` dazu, neue Arenen als Raster in `js/arenas.js`.

## Technik

Eine statische Seite ohne Server und ohne Build-Schritt, aufgebaut wie Hatz.

- `js/config.js`: alle Stellschrauben, Fahrzeuge, Farben und Einstellungen
- `js/arenas.js`: die Arenen als Raster aus Wänden, Boden und Startplätzen
- `js/physics.js`, `js/sim.js`, `js/bots.js`: Bewegung, Regeln und Bots, ohne Browser-Abhängigkeiten
- `js/host.js`, `js/client.js`: Gastgeber und die Sicht eines Geräts auf das Spiel
- `js/net.js`: Verbindung zwischen den Geräten und Verschlüsselung
- `js/render.js`, `js/input.js`, `js/app.js`: Darstellung, Steuerung, Oberfläche

### Warum sich die Steuerung direkt anfühlt

Der eigene Panzer wird bei jeder Eingabe sofort im eigenen Browser bewegt, ohne auf den Gastgeber zu warten. Dessen gültiger Stand kommt 60-mal pro Sekunde zurück und wird mit den noch unbestätigten Eingaben abgeglichen. Beide rechnen mit demselben Code, deshalb stimmt die Vorhersage praktisch immer.

Eigene Schüsse fliegen sofort los. Sobald der Gastgeber die Rakete bestätigt, übernimmt seine Rakete, ohne Sprung. Raketen prallen nur an festen Wänden ab, deshalb rechnet jedes Gerät ihren Flug bis in die Gegenwart weiter. Die anderen Panzer laufen mit einer kleinen Verzögerung zwischen zwei bekannten Ständen, damit sie auch bei unruhiger Verbindung flüssig fahren.

### Verbindung

Wie bei Hatz: Die Geräte finden sich über vier öffentliche, kostenlose MQTT-Vermittler und bauen dann eine direkte Leitung (WebRTC) auf. Klappt das nicht, läuft das Spiel über die Vermittler weiter, nur etwas träger. Dort ist alles verschlüsselt (AES-GCM), Schlüssel und Kanalname entstehen aus dem Raumcode.

## Online stellen

GitHub Pages reicht: in den Einstellungen des Repositorys unter **Pages** als Quelle den Branch `main` und den Ordner `/ (root)` wählen. Das Spiel liegt dann unter `https://philipphjs.github.io/tankwar/`.

## Entwickeln

```
npm install
npm test            # Bewegung, Abpraller, Regeln, Bots, Abgleich über schlechte Leitungen
npm run test:e2e    # vier Browser spielen über lokale Vermittler, braucht Chrome
```

Zum Ausprobieren reicht ein beliebiger statischer Server im Projektordner, zum Beispiel `python3 -m http.server`.

## Fremde Bestandteile

- MQTT.js, MIT-Lizenz (`vendor/`)
- Schriften Bungee und Barlow, SIL Open Font License (`fonts/`)
