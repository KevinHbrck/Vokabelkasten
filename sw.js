/* Vokabelkasten - Offline-Unterstützung
 *
 * Strategie: zuerst das Netz (höchstens 2,5 s, wenn eine gespeicherte Fassung da ist), dann der Zwischenspeicher.
 * Damit siehst du online immer sofort die neueste hochgeladene Fassung,
 * und ohne Verbindung startet die zuletzt geladene aus dem Speicher.
 */

/* Einzige Stelle für die Fassung - die App fragt sie per postMessage ab (Einstellungen, ganz unten) */
var FASSUNG = "2026-10-02-3";
var NETZ_WARTEN = 2500;   // ms - so lange wartet der Start höchstens aufs Netz, wenn es eine gespeicherte Fassung gibt
var SPEICHER = "vokabelkasten-" + FASSUNG;
var GRUNDGERUEST = ["./", "./index.html", "./daten.js", "./ts-fsrs.js", "./lernen.js", "./app.js", "./app.css", "./privacy.html", "./manifest.json", "./icon.png", "./icon-180.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SPEICHER)
      .then(function (c) { return c.addAll(GRUNDGERUEST); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (namen) {
      return Promise.all(namen.map(function (n) {
        if (n !== SPEICHER) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Anfrage der App nach der Fassung: Antwort über den mitgeschickten Kanal (sonst an den Absender) */
self.addEventListener("message", function (e) {
  if (!e.data || e.data.frage !== "fassung") return;
  var antwort = { fassung: FASSUNG };
  if (e.ports && e.ports[0]) e.ports[0].postMessage(antwort);
  else if (e.source) e.source.postMessage(antwort);
});

self.addEventListener("fetch", function (e) {
  var anfrage = e.request;
  if (anfrage.method !== "GET") return;

  var ziel;
  try { ziel = new URL(anfrage.url); } catch (err) { return; }
  if (ziel.origin !== self.location.origin) return;

  // "no-cache": immer beim Server nachfragen - GitHub Pages erlaubt Browsern sonst,
  // bis zu 10 Minuten lang die alte Fassung aus dem HTTP-Zwischenspeicher zu zeigen.
  // Unverändertes kommt trotzdem schnell zurück (304).
  var frisch = anfrage.mode === "navigate"
    ? new Request(anfrage.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(anfrage, { cache: "no-cache" });

  function speichern(antwort) {
    // geteilte Wörter kommen als ./?text=… - die nicht einzeln in den Speicher legen
    return antwort && antwort.status === 200 && antwort.type === "basic" && !(anfrage.mode === "navigate" && ziel.search);
  }
  // Netz zuerst - aber höchstens NETZ_WARTEN lang, wenn eine gespeicherte Fassung da ist (Keller-Gym, Funkloch):
  // dann startet die App aus dem Speicher, und die frische Fassung landet im Hintergrund trotzdem im Speicher.
  var ausDemNetz = fetch(frisch).then(function (antwort) {
    if (speichern(antwort)) {
      var kopie = antwort.clone();
      return caches.open(SPEICHER).then(function (c) { return c.put(anfrage, kopie); }).then(function () { return antwort; }, function () { return antwort; });
    }
    return antwort;
  });
  // locker = offline: dann notfalls auch eine andere Fassung (app.js?v=…). Beim bloßen Zeitlimit nur genau diese,
  // damit nie eine alte app.js zu einer neuen index.html kommt
  function ausSpeicher(locker) {
    return caches.match(anfrage, { ignoreSearch: !!locker && anfrage.mode !== "navigate" }).then(function (treffer) {
      if (treffer || anfrage.mode !== "navigate") return treffer || null;
      return caches.match("./index.html").then(function (t) { return t || caches.match("./"); });
    });
  }
  e.respondWith(new Promise(function (fertig) {
    var erledigt = false;
    function nimm(a) { if (!erledigt && a) { erledigt = true; fertig(a); } }
    var uhr = setTimeout(function () { ausSpeicher().then(nimm, function () {}); }, NETZ_WARTEN);
    ausDemNetz.then(function (a) { clearTimeout(uhr); nimm(a); }, function () {
      clearTimeout(uhr);
      ausSpeicher(true).then(function (t) { nimm(t || new Response("", { status: 504, statusText: "offline" })); },
                         function () { nimm(new Response("", { status: 504, statusText: "offline" })); });
    });
  }));
  e.waitUntil(ausDemNetz.catch(function () {}));   // Hintergrund-Aktualisierung zu Ende bringen
});
