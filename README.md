# Historischer Kartenatlas 2.0

Ein interaktiver historischer Kartenatlas auf Basis von Leaflet mit Überlagerung und Vergleich historischer Karten, GPS-Standort und einer verwaltbaren Kartenbibliothek.

## Aktueller Stand (Version 2, erste Ausbaustufe)

- Die **44 ursprünglichen Karteneinträge** bleiben unverändert im HTML enthalten.
- Historische Karten werden weiterhin per XYZ-Kachel-URL geladen, neu auch als TMS oder WMS.
- Über **„+ Karten entdecken und verwalten“** kannst du Karten hinzufügen, bearbeiten oder ausblenden.
- Karten aus der ursprünglichen Bibliothek werden beim Entfernen **nur lokal ausgeblendet**; die Originaleinträge bleiben erhalten.
- Freie **Regionen** mit Namen, Koordinaten und Zoomstufe. Koordinatensuche über OpenStreetMap Nominatim.
- **Kartensuche** bei MapWarper nach bereits georeferenzierten Karten und ein integrierter Starterkatalog für Berlin.
- **Backup als JSON** exportieren und wieder importieren. Bitte vor Browserwechsel als Sicherung nutzen.
- Bisherige GPS-Verfolgung, Rezentrierung und historischer Kartenvergleich bleiben erhalten.

**Noch keine Konten oder geräteübergreifende Synchronisierung:** Änderungen werden aktuell mit `localStorage` **nur in diesem Browser** gesichert. Das Löschen von Website-Daten kann diese Änderungen entfernen. Ein geteiltes Karten-URL mit einer benutzerdefinierten Kartennummer funktioniert nur auf Geräten, auf denen die entsprechende Karte gespeichert ist.

## Veröffentlichung mit GitHub Pages

Im Repository unter **Settings → Pages** die Quelle **Deploy from a branch**, Branch `main`, Ordner `/ (root)` auswählen. Danach sollte die Seite unter

https://tinuviel85.github.io/Historischer-Kartenatlas-2/

erreichbar sein. Der Status der Pages-Bereitstellung ist hier nicht automatisch bestätigt.

## Technische Struktur

- `index.html`: Bestehende Leaflet-Karte, GPS, Vergleich, ursprüngliche Karten und Einbindung des Managers.
- `atlas-manager.js`: Dialog für Karten-/Regionsverwaltung, lokale Speicherung, MapWarper-Kartensuche, JSON-Import/Export.
- `supabase/schema.sql`: Datenbank- und Row-Level-Security-Vorlage für die nächste Ausbaustufe mit Benutzerkonten.

Die öffentliche MapWarper-API wird über `https://mapwarper.net/api/v1/maps.json?query=Berlin&show_warped=1` angesprochen. Browser-CORS oder Serverausfälle können die Live-Suche blockieren. In diesem Fall bleiben manuelle Übernahme und der integrierte Starterkatalog nutzbar.

## Datenschutz und Sicherheit

- Standortzugriff wird durch den Browser abgefragt und nicht in einem Benutzerkonto gespeichert.
- Region-/Kartensuche sendet Suchbegriffe an externe Anbieter (OpenStreetMap Nominatim und MapWarper).
- Kachelaufrufe werden direkt an externe Kartenserver gestellt; dort können IP-Adresse und technische Zugriffsdaten anfallen.
- Nutzerdefinierte Karten-URLs werden auf `http:`/`https:` geprüft; der Atlas ist kein Proxy für private Dienste.
- Externe Karteninhalte sind nicht automatisch gemeinfrei. Attribution und Nutzungsrechte vor einer Veröffentlichung klären.
- **Keine Supabase-API-Schlüssel mit erweiterten Rechten (service_role) in GitHub oder Browsercode hinterlegen.**

## Weiterer Ausbau

1. Supabase-Projekt anlegen, Datenbankschema anwenden und Auth-Anbieter einrichten.
2. Kontoregistrierung, Anmeldung, Migration aus `localStorage` in nutzergebundene Tabellen, Geräte-Synchronisierung und Wiederherstellung.
3. Weitere öffentliche Kartendienste (Geoportal Berlin, Brandenburg, WMTS/WMS) durchsuchbar machen.
4. Optionaler freigegebener öffentlicher Kartenkatalog, moderiert und mit Lizenzinformationen.

## Funktionscheck nach Veröffentlichung

- Öffnet sich die Leaflet-Grundkarte?
- Sind die ursprünglichen 44 Karten einsehbar?
- Lässt sich eine neue Region über die Koordinatensuche anlegen?
- Lässt sich eine XYZ- und eine WMS-Karte hinzufügen, bearbeiten und ausblenden?
- Bleibt die Änderung nach Neuladen erhalten?
- Öffnet „Karten entdecken“ den Berliner Katalog; meldet es verständlich, wenn MapWarper nicht erreichbar ist?
- Funktionieren Vergleichsregler, GPS und „Neu zentrieren“ unverändert?

## Benutzerkonten und Cloud-Synchronisierung (Implementierung vorhanden, Einrichtung nötig)

**Wichtig:** Die Benutzeroberfläche und die Supabase-Integration sind bereits im Code, aber ohne konfiguriertes Supabase-Projekt noch nicht aktiv. Im unkonfigurierten Zustand funktioniert die App unverändert **lokal ohne Anmeldung**.

1. Unter https://supabase.com/dashboard ein eigenes Projekt erstellen (nach Möglichkeit Region Frankfurt).
2. Unter **SQL Editor** den Inhalt von `supabase/enable-sync.sql` ausführen. Dadurch entsteht die private Tabelle `atlas_user_libraries` mit Row Level Security.
3. Unter **Authentication → Providers → Email** E-Mail-/Magic-Link-Anmeldung aktivieren.
4. Unter **Authentication → URL Configuration** als **Site URL** und als erlaubte **Redirect URL** `https://tinuviel85.github.io/Historischer-Kartenatlas-2/` eintragen.
5. Die **Project URL** (`https://<projekt>.supabase.co`) und den **Publishable Key** (`sb_publishable_...`, alternativ Legacy-Anon-Key) unter **Project Settings / Connect** finden.
6. Beide Werte in der Datei `atlas-config.js` im Repository hinterlegen. **Nie einen Secret Key, service_role-Key oder das Datenbankpasswort dort eintragen.**
7. GitHub Pages aktualisieren, dann auf **„☁ Anmelden“** klicken, die E-Mail-Adresse eingeben und den Anmeldelink aufrufen. Die bisherige lokale Bibliothek kann beim ersten Login übernommen werden.

**So arbeitet die Synchronisierung:** Der Gastmodus speichert weiterhin unter dem bisherigen Browser-Schlüssel. Angemeldete Nutzer erhalten eine getrennte lokale Kopie sowie eine private Cloud-Bibliothek. Beim Öffnen auf einem anderen Gerät wird der gespeicherte Zustand nach Anmeldung geladen. Kartenänderungen und Favoriten werden gespeichert und zur Cloud übertragen. Bei Verbindungsfehlern verbleibt eine lokale Kopie; parallele Änderungen auf mehreren Geräten verwenden derzeit die zuletzt erfolgreich geschriebene Version (noch kein Echtzeit-Abgleich/Versionskonfliktmanagement). Die Cloud-Daten werden nur durch Anmeldung geschützt; Gastkarten bleiben weiterhin gerätegebunden.

**Zusätzliche Kartenquelle:** Unter **Karten entdecken** kann eine Georeference Annotation aus https://viewer.allmaps.org/ eingegeben werden. Allmaps wandelt sie über `https://allmaps.xyz/{z}/{x}/{y}.png?url=...` in Leaflet-kompatible XYZ-Kacheln um. Dazu muss die Karte bereits georeferenziert sein; reine IIIF-Bilder reichen nicht aus. Nicht jede Kartenquelle erlaubt Weiterverwendung.
