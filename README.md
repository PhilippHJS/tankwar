# Tank War

Panzerschlacht für bis zu vier im Browser, jeder am eigenen Rechner und ohne Anmeldung. Drei Leben pro Runde, vier Fahrzeuge mit ganz unterschiedlichen Waffen, fünf Arenen, und wer zuletzt noch fährt, holt den Punkt.

## So wird gespielt

1. Seite öffnen, Namen eingeben, **Raum erstellen**.
2. Den Einladungslink an bis zu drei Mitspieler schicken.
3. Jeder wählt im Raum sein Fahrzeug. Der Gastgeber stellt Rundendauer und Punkte zum Sieg ein und startet das Spiel. Freie Plätze können Bots übernehmen, alleine ausprobieren geht also auch. Bots fahren nie ein Fahrzeug, das ein Spieler gewählt hat, und nie zwei dasselbe; in jedem Spiel wird neu gelost.

| Was | Tastatur | Gamepad |
| --- | --- | --- |
| Fahren | WASD | linker Stick oder Steuerkreuz |
| Zielen | Pfeiltasten | rechter Stick |
| Schießen | Leertaste, je nach Fahrzeug tippen oder halten | A, RB oder RT |

Fahren und Zielen sind getrennt: Die Wanne fährt in die gewünschte Richtung, der Turm zeigt unabhängig davon aufs Ziel. Liegt die Richtung eher hinter dem Panzer, fährt er rückwärts, statt umständlich zu wenden.

Ein Pfeil dreht den Turm in seine Richtung, bis er dort ankommt, dann bleibt er stehen. Zwei Pfeile zugleich zielen schräg dazwischen. Lässt man los, bleibt der Turm, wo er gerade ist, so lassen sich auch Winkel dazwischen einstellen. Eine gestrichelte Linie zeigt, wohin der Schuss geht, ein Balken unter dem eigenen Panzer Nachladen, Magazin oder Mana.

Das Gerät des Gastgebers führt den Spielstand. Seine Seite muss offen bleiben, solange gespielt wird. Wer neu lädt oder kurz die Verbindung verliert, landet wieder auf seinem Platz, bis dahin fährt ein Bot für ihn.

## Regeln

- Jeder hat pro Runde 3 Leben und eine Lebensleiste. Ist sie leer, ist ein Leben weg.
- Wer abgeschossen wird, ist 5 Sekunden raus und steigt dann am Startplatz wieder ein, der am weitesten von den anderen weg ist. Danach ist er 2 Sekunden unverwundbar.
- Kein Eigenbeschuss: Eigene Raketen, Schüsse und Blitze tun dem eigenen Panzer nichts. Einzige Ausnahme ist die Bombe des Böllers.
- Gespielt wird auf fünf Arenen. Zu Beginn jedes Spiels wird ihre Reihenfolge gemischt, jede Runde kommt die nächste, nach der fünften geht es von vorn los.
- Wer alle Leben verloren hat, ist nicht einfach raus: Kurz darauf fährt er als Geist auf dem Rand der Arena herum (WASD) und wirft kleine Bomben quer zur Wand nach innen. Leertaste halten wirft weiter, bis 12 Felder. Die Bombe fliegt über Wände hinweg, landet, blinkt kurz und explodiert dann (14 Schaden in der Mitte, 6 am Rand, Radius 1,1). Danach dauert es 4,5 s bis zum nächsten Wurf. Gibt ein Geist damit einem Gegner den Rest, kehrt er mit einem Leben und 30 % Lebensleiste an einem freien Startplatz zurück, kurz geschützt.
- Die Runde endet, wenn nur noch einer Leben hat. Erwischen sich die letzten beiden gleichzeitig, gewinnen beide.
- Läuft die Zeit ab, beginnt der **Sudden Death**, siehe unten. Eine Wertung nach Leben oder Lebensleiste gibt es nicht mehr.

### Sudden Death

- Wer noch fährt, hat ab jetzt nur noch sein letztes Leben, egal wie viele er vorher hatte. Wiedereinstiege gibt es nicht mehr. Nur wer gerade auf seinen Wiedereinstieg wartet, steigt noch einmal ein, ebenfalls mit dem letzten Leben.
- Die Geister verschwinden samt ihren Bomben. Wer raus ist, schaut nur noch zu.
- Eine Sekunde nach Beginn fallen Steine, alle 0,11 s einer (bei mittlerem Tempo), in einer Spirale von außen nach innen: Ring für Ring, jeder im Uhrzeigersinn ab der linken oberen Ecke. Sie fallen auch auf die Wände. Nach gut 26 Sekunden ist alles zu.
- Eine Sekunde, bevor ein Stein landet, zeigt ein Schatten am Boden, wo. Der Schatten wird dunkler und größer, im letzten Moment sieht man den Stein fallen.
- Landet ein Stein auf einem Panzer, ist sein Leben weg, auch mit Schutz. Ragt der Panzer nur mit dem Rand unter den Stein, wird er stattdessen weggeschoben. Raketen in dem Feld verpuffen. Liegende Steine sind Wände: Raketen prallen ab, Schüsse und Blitze kommen nicht durch, die Bombe des Böllers schon.
- Wer noch einmal einsteigt, landet möglichst nah an seinem Startplatz auf einem Feld, das noch mindestens 3 Sekunden frei bleibt. Gibt es keins mehr, ist er raus.
- Wer zuletzt noch fährt, holt den Punkt. Nur wenn es die Letzten im selben Moment erwischt, etwa unter demselben Stein, gewinnen sie gemeinsam.
- Bots fahren rechtzeitig weg, wenn ihr Feld bald dran ist, und meiden Felder, auf die gleich ein Stein fällt.
- Die Steine rechnet jedes Gerät selbst aus: Wann welcher fällt, steht fest, sobald der Sudden Death beginnt. Werte in `SUDDEN` in `js/config.js`, die Spirale in `js/stones.js`.
- Jeder Rundensieger bekommt einen Punkt. Nach einer kurzen Ehrenrunde, in der man nur noch fahren kann, beginnt die nächste Runde. Wer die eingestellten Punkte erreicht, gewinnt das Spiel.
- Wer während eines Spiels dazukommt, schaut zu und steigt mit der nächsten Runde ein. Fährt auf seinem Platz gerade ein Bot, übernimmt er dessen Panzer sofort.

## Einstellungen

Der Gastgeber stellt sie im Raum ein, die Mitspieler sehen sie. Sie gelten ab dem nächsten Spiel, und der Browser merkt sie sich für den nächsten Raum.

| Einstellung | Stufen |
| --- | --- |
| Rundendauer | 1, 2, **3** oder 5 Minuten |
| Punkte zum Sieg | 1 bis 5, normal **3** |
| Freie Plätze | leer lassen oder **mit Bots füllen** |
| Tempo | langsam, **mittel** oder schnell |

Das Tempo wirkt auf alles, was sich bewegt oder lädt: Fahren, Drehen, Raketen, Zielkreis, Nachladen, Blitze, Mana und die Geister laufen mal 0,8 (langsam) oder mal 1,25 (schnell). Reichweiten und Schaden pro Treffer bleiben gleich, die Rakete fliegt also gleich weit. Leben, Pausen nach Abschüssen und die Rundendauer ändern sich nicht.

## Fahrzeuge

Alle haben 100 Lebensleiste. Tempo in Feldern pro Sekunde bei mittlerem Tempo, die Arenen sind 22 × 14 Felder groß.

Jedes Fahrzeug hat seine eigene Form, damit man es im Getümmel erkennt: der Prellbock ist ein schwerer Kettenpanzer mit Raketenwerfer, die Kimme ein schlanker Keil mit Doppellauf, der Böller breit und achteckig mit dickem Mörser und Granaten am Heck, der Zitteraal ein runder Schweber ohne Ketten (und ohne Kettenspuren). Die Farbe zeigt, wer fährt.

| Fahrzeug | Tempo | Waffe |
| --- | --- | --- |
| Prellbock | 2,2 | **Rakete**: fliegt 5 Felder/s, prallt von jeder Wand ab und verpufft nach 3,8 s. 34 Schaden, 1,5 s Nachladen. |
| Kimme | 2,2 | **Pistole**: trifft sofort, bis zur ersten Wand, höchstens 8 Felder weit. 12 Schaden, alle 0,3 s ein Schuss, 6 Schuss pro Magazin, dann 2 s Nachladen. |
| Böller | 2,0 | **Bombe**: Beim Drücken der Leertaste werden Startpunkt und Richtung festgehalten. Selbst drehen lässt sich der Turm dann nicht, er zeigt von allein immer auf den Zielkreis. Solange man hält, wandert der Zielkreis mit 4 Feldern/s geradeaus hinaus, bis 9 Felder weit oder bis zum Rand. Fahren ändert daran nichts. Loslassen sprengt dort sofort, auch hinter Wänden. 50 Schaden in der Mitte, 20 am Rand (Radius 1,3), trifft auch den eigenen Panzer. 2,5 s Nachladen. Den Zielkreis sehen alle. |
| Zitteraal | 3,0 | **Blitze**: Leertaste halten trifft alle Gegner im Umkreis von 2,2 Feldern, die nicht hinter einer Wand stehen, sechsmal pro Sekunde mit je 6 Schaden. Volles Mana reicht für 3 s. Ist es leer, erst loslassen. Aufgeladen wird nach einer halben Sekunde Pause, von leer auf voll in 6 s. |

Gedacht ist ein Kreislauf: Der Zitteraal schlägt den Böller aus der Nähe, der Böller holt alle hinter Deckung hervor, die Kimme erwischt den Zitteraal beim Anfahren, und der Prellbock schlägt die Kimme mit Schüssen über die Bande. Alle Werte stehen in `VEHICLES` in `js/config.js`, neue Fahrzeuge kommen dort dazu.

## Arenen

Klassik, Säulen, Bunker, Gassen und Festung, jede mit vier Startplätzen in den Ecken. Neue Arenen sind ein Raster in `js/arenas.js`.

## Technik

Eine statische Seite ohne Server und ohne Build-Schritt, aufgebaut wie Hatz.

- `js/config.js`: alle Stellschrauben, Fahrzeuge, Farben und Einstellungen
- `js/arenas.js`: die Arenen als Raster aus Wänden, Boden und Startplätzen
- `js/physics.js`, `js/sim.js`, `js/stones.js`, `js/bots.js`: Bewegung, Regeln, Steine im Sudden Death und Bots, ohne Browser-Abhängigkeiten
- `js/host.js`, `js/client.js`: Gastgeber und die Sicht eines Geräts auf das Spiel
- `js/net.js`: Verbindung zwischen den Geräten und Verschlüsselung
- `js/render.js`, `js/input.js`, `js/app.js`: Darstellung, Steuerung, Oberfläche
- `js/sound.js`, `js/sfx.js`, `js/music.js`: Ton, Geräusche, Musik

### Warum sich die Steuerung direkt anfühlt

Der eigene Panzer wird bei jeder Eingabe sofort im eigenen Browser bewegt, ohne auf den Gastgeber zu warten. Dessen gültiger Stand kommt 60-mal pro Sekunde zurück und wird mit den noch unbestätigten Eingaben abgeglichen. Beide rechnen mit demselben Code, deshalb stimmt die Vorhersage praktisch immer.

Eigene Schüsse gehen sofort los: Raketen fliegen, die Pistole zieht ihre Spur, die Bombe explodiert, der Zielkreis und das Mana laufen ohne Verzögerung mit. Ob getroffen wurde, entscheidet der Gastgeber. Sobald er eine Rakete bestätigt, übernimmt seine, ohne Sprung. Raketen prallen nur an festen Wänden ab, deshalb rechnet jedes Gerät ihren Flug bis in die Gegenwart weiter. Die anderen Panzer laufen mit einer kleinen Verzögerung zwischen zwei bekannten Ständen, damit sie auch bei unruhiger Verbindung flüssig fahren.

### Verbindung

Wie bei Hatz: Die Geräte finden sich über vier öffentliche, kostenlose MQTT-Vermittler und bauen dann eine direkte Leitung (WebRTC) auf. Klappt das nicht, läuft das Spiel über die Vermittler weiter, nur etwas träger. Dort ist alles verschlüsselt (AES-GCM), Schlüssel und Kanalname entstehen aus dem Raumcode.

## Kleine Extras

- **Wiedergeburt:** Kehrt ein Geist zurück, leuchtet er auf und fliegt mit einer Funkenspur zum Startplatz. Dort erscheint der Panzer in einer Lichtsäule, sobald der Geist ankommt, etwa eine halbe Sekunde später.
- **Abschuss:** Wer als Panzer jemanden erwischt, bekommt kurz ein Abzeichen über dem Panzer, und nur er hört einen hellen Bestätigungston.
- **Trefferrichtung:** Wird der eigene Panzer getroffen, leuchtet kurz ein roter Bogen aus der Richtung des Treffers.
- **Rauch:** Unter 30 % Lebensleiste qualmt der eigene Panzer.
- **Rundenende:** Konfetti in der Farbe der Sieger, ihr Panzer glüht, solange das Ergebnis steht. In den letzten 10 Sekunden einer Runde tickt es leise.
- **Sudden Death:** groß in der Mitte angekündigt, mit zwei tiefen Tönen und einem Grollen. Oben steht statt der Zeit „Sudden Death“. Jeder Stein landet mit einer kleinen Staubwolke und einem dumpfen Schlag.

## Geräusche

Alle Geräusche entstehen im Browser, ohne Dateien, und sind bewusst sparsam: Schüsse, Treffer, Treffer auf den Schutz, Explosionen, Blitze, verpuffende Raketen, Wiedereinstieg, der Countdown, ein kurzes Signal am Rundenende und im Sudden Death ein Signal zum Beginn und ein dumpfer Schlag je Stein. Für den eigenen Panzer kommen ein Summen beim Aufladen der Bombe, ein Knistern beim Blitzen und ein leises Klicken dazu, wenn wieder nachgeladen ist. Was weiter weg passiert, ist leiser und kommt etwas mehr von links oder rechts. Unten rechts im Spiel lassen sie sich abschalten, der Browser merkt sich das.

## Musik

Liegt `audio/menu.mp3` im Repository, läuft sie auf der Startseite und im Raum, `audio/game.mp3` während des Spiels, leiser, damit die Geräusche durchkommen. Beide laufen in einer nahtlosen Schleife, beim Wechsel wird übergeblendet. Der Schalter „Musik“ steht oben rechts im Menü und unten rechts im Spiel, der Browser merkt sich die Einstellung. Fehlt eine Datei, bleibt es an dieser Stelle still. Das Repository und die Seite sind öffentlich, dort sollte also nur Musik liegen, die öffentlich weitergegeben werden darf.

## Online stellen

GitHub Pages reicht: in den Einstellungen des Repositorys unter **Pages** als Quelle den Branch `main` und den Ordner `/ (root)` wählen. Das Spiel liegt dann unter `https://philipphjs.github.io/tankwar/`.

## Entwickeln

```
npm install
npm test            # Bewegung, Waffen, Arenen, Regeln, Bots, Steuerung, Abgleich über schlechte Leitungen
npm run test:e2e    # vier Browser spielen über lokale Vermittler, braucht Chrome
```

Zum Ausprobieren reicht ein beliebiger statischer Server im Projektordner, zum Beispiel `python3 -m http.server`.

## Fremde Bestandteile

- MQTT.js, MIT-Lizenz (`vendor/`)
- Schriften Bungee und Barlow, SIL Open Font License (`fonts/`)
