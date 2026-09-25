/* Vokabelkasten - Offline-Unterstützung
 *
 * Strategie: zuerst das Netz, dann der Zwischenspeicher.
 * Damit siehst du online immer sofort die neueste hochgeladene Fassung,
 * und ohne Verbindung startet die zuletzt geladene aus dem Speicher.
 */

var FASSUNG = "2026-09-25-4";
var SPEICHER = "vokabelkasten-" + FASSUNG;
var GRUNDGERUEST = ["./", "./index.html", "./manifest.json", "./icon.png"];

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
      if (antwort && antwort.status === 200 && antwort.type === "basic") {
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
