/* Vokabelkasten - Offline-Unterstützung
 *
 * Strategie: zuerst das Netz, dann der Zwischenspeicher.
 * Damit siehst du online immer sofort die neueste hochgeladene Fassung,
 * und ohne Verbindung startet die zuletzt geladene aus dem Speicher.
 */

/* Einzige Stelle für die Fassung - die App fragt sie per postMessage ab (Einstellungen, ganz unten) */
var FASSUNG = "2026-09-28-14";
var SPEICHER = "vokabelkasten-" + FASSUNG;
var GRUNDGERUEST = ["./", "./index.html", "./daten.js", "./privacy.html", "./manifest.json", "./icon.png"];

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

  e.respondWith(
    fetch(frisch).then(function (antwort) {
      // geteilte Wörter kommen als ./?text=… - die nicht einzeln in den Speicher legen
      if (antwort && antwort.status === 200 && antwort.type === "basic" && !(anfrage.mode === "navigate" && ziel.search)) {
        var kopie = antwort.clone();
        caches.open(SPEICHER).then(function (c) { c.put(anfrage, kopie); });
      }
      return antwort;
    }).catch(function () {
      return caches.match(anfrage).then(function (treffer) {
        if (treffer) return treffer;
        if (anfrage.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "offline" });
      });
    })
  );
});
