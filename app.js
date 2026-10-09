/* Vokabelkasten - Programmlogik (ausgelagert aus index.html, 2026-09-29). Braucht daten.js davor. */
(function () {
  "use strict";
  /* Eigene Einblend-Meldung unten über der Leiste (statt alert: der wird in installierten Web-Apps teils gar nicht gezeigt).
     Bleibt einige Sekunden stehen, antippen schließt sie. art: "ok" mit Häkchen, sonst Hinweis. */
  var meldeUhr = null;
  function melde(text, art) {
    var el = document.getElementById("meldung-leiste");
    if (!el) return;
    el.className = "meldung-leiste an" + (art === "ok" ? " ok" : "");
    el.innerHTML = "";
    var ico = document.createElement("b"); ico.textContent = art === "ok" ? "✓" : "!"; ico.setAttribute("aria-hidden", "true");
    var t = document.createElement("span"); t.textContent = text;
    el.appendChild(ico); el.appendChild(t);
    el.hidden = false;
    clearTimeout(meldeUhr);
    meldeUhr = setTimeout(function () { el.classList.remove("an"); setTimeout(function () { if (!el.classList.contains("an")) el.hidden = true; }, 250); },
                          Math.max(3500, Math.min(8000, text.length * 70)));
  }
  function meldeOk(text) { melde(text, "ok"); }
  document.addEventListener("click", function (e) {
    var el = document.getElementById("meldung-leiste");
    if (el && e.target.closest && e.target.closest("#meldung-leiste")) { el.classList.remove("an"); el.hidden = true; }
  });

  /* Inhaltsdaten (Startliste, Änderungen, Vorlagen) stehen in daten.js - hier unter den gewohnten Namen */
  var VK_DATEN = window.VK_DATEN;
  var SEED = VK_DATEN.SEED, SEED_STAND = VK_DATEN.SEED_STAND, SEED_NEU_AB = VK_DATEN.SEED_NEU_AB,
      SEED_AENDERUNG = VK_DATEN.SEED_AENDERUNG, SEED_ZUSAMMEN = VK_DATEN.SEED_ZUSAMMEN, VORLAGEN = VK_DATEN.VORLAGEN;
  /* Lernverfahren (Rechenregeln je Antwort) stehen in lernen.js - hier unter kurzen Namen */
  var VK_LERNEN = window.VK_LERNEN;
  var BEWERTUNG = VK_LERNEN.BEWERTUNG, LEITNER = VK_LERNEN.LeitnerScheduler, FSRS_PLAN = VK_LERNEN.FsrsScheduler;
  /* ---------- Kästen ----------
     Mehrere Karteikästen nebeneinander. Englisch ist der ursprüngliche Kasten und bleibt technisch genau wie er war
     (Schlüssel vokabelkasten.v2, Startliste, Stimmen). Jeder weitere Kasten ist ein „Wissenskasten“ (Begriff → Bedeutung)
     mit eigenem Speicher vokabelkasten.kasten.<id> - gleiche Funktionen, nur ohne Englisch-Startliste und -Stimmen.
     Verzeichnis: vokabelkasten.kaesten = { aktiv, liste:[{ id, name, farbe, art }] }. Wechseln geht ohne Neuladen:
     kastenOeffnen() sichert den alten Stand, setzt alles auf Anfang und liest den neuen Kasten wie beim Start ein. */
  var KASTEN_REG = "vokabelkasten.kaesten";
  /* Erster Start auf diesem Gerät: noch kein Kasten gespeichert. Nur dann kommt die Einführung von selbst;
     wer den Vokabelkasten schon nutzt, findet sie in den Einstellungen. Nicht, wenn die App per „Teilen“ geöffnet wurde. */
  var EINF_KEY = "vokabelkasten.einfuehrung";
  var ERSTER_START = (function () {
    try { return !["vokabelkasten.v2", "vokabelkasten.v1", KASTEN_REG, EINF_KEY].some(function (k) { return window.localStorage.getItem(k); }); }
    catch (e) { return false; }
  })();
  var GEOEFFNET_PER_TEILEN = /[?&](text|title)=/.test(location.search);
  var KASTEN_FARBEN = ["#ef7b17", "#2b78e4", "#7b4fd6", "#1f9d63", "#d6453d", "#c28a00", "#0e9aa7"];
  function kaestenLesen() {
    try {
      var r = JSON.parse(window.localStorage.getItem(KASTEN_REG));
      if (r && Array.isArray(r.liste) && r.liste.length && r.liste[0].id === "en") return r;
    } catch (e) {}
    return { aktiv: "en", liste: [{ id: "en", name: "Englisch", farbe: 0, art: "vokabel" }] };
  }
  function kaestenSichern() { try { window.localStorage.setItem(KASTEN_REG, JSON.stringify(KAESTEN)); } catch (e) {} }
  var KAESTEN = kaestenLesen();
  var KASTEN = KAESTEN.liste.filter(function (k) { return k.id === KAESTEN.aktiv; })[0] || KAESTEN.liste[0];
  var WISSEN = KASTEN.art === "wissen";
  function kastenKey(id) { return id === "en" ? "vokabelkasten.v2" : "vokabelkasten.kasten." + id; }
  // „Wirtschaft“ -> „Wirtschaftskasten“, Englisch bleibt der „Vokabelkasten“
  function kastenTitel(k) {
    if (k.id === "en") return "Vokabelkasten";
    var n = String(k.name || "").trim();
    return /kasten$/i.test(n) ? n : n + "kasten";
  }
  function kastenKats() { return WISSEN ? ["Begriffe", "Abkürzungen", "Zusammenhänge", "Sonstiges"] : SEED.kats; }
  var KATS = kastenKats();
  var KEY = kastenKey(KASTEN.id);
  var ALT_KEY = "vokabelkasten.v1";
  var VOR_V3 = "vokabelkasten.vor-v3.";   // + Kasten-id: Stand vor dem Umbau auf Schema 3 (FSRS), siehe laden()
  // Index = Fach. Fach 1 wird nie angesteuert, eine richtige Antwort
  // hebt die Karte immer mindestens auf Fach 2.
  var TAGE = [0, 1, 1, 3, 7, 16];

  /* Lernverfahren: "leitner" (feste Abstände je Fach) oder "fsrs" (Abstand je Karte nach ihrem Gedächtnisstand).
     Jede Antwort schreibt beide Stände fort (k.box/k.due und k.fsrs, siehe lernen.js); die Einstellung bestimmt nur,
     welcher Stand über Fälligkeit, Reihenfolge und angezeigtes Fach entscheidet - so geht beim Umschalten nichts
     verloren. Früher gab es hier SM-2 (Felder iv/ez/rep); dessen Stand wurde beim Umbau auf Schema 3 nach FSRS übernommen. */
  var MODUS = "leitner";
  var RETENTION = 0.9;   // gewünschte Behaltensquote bei FSRS (0,80 bis 0,95): höher = sicherer, aber mehr Wiederholungen
  var KNOEPFE = 2;       // Antwortknöpfe: 2 (Nochmal, Gewusst) oder 4 (Nochmal, Schwer, Gut, Leicht) - in beiden Verfahren

  // angezeigtes Fach: bei Leitner das echte Fach, bei FSRS nach dem Abstand (<1 Tag, <1 Woche, <1 Monat, <3 Monate, länger)
  function fachVon(c) {
    return MODUS === "fsrs" ? VK_LERNEN.fachAusIntervall(VK_LERNEN.intervallTage(c.fsrs)) : c.box;
  }
  // ist die Karte heute dran - nach dem gewählten Verfahren
  function istDran(c, jetzt) {
    return MODUS === "fsrs" ? FSRS_PLAN.isDue(c, jetzt) : LEITNER.isDue(c, jetzt);
  }
  // nächster Termin der Karte (Tagesbeginn in ms), für „wieder in … Tagen“
  function termin(c) {
    return MODUS === "fsrs" && c.fsrs ? VK_LERNEN.tagesBeginn(c.fsrs.due) : c.due;
  }

  function setzeAbstaende(vier) {
    var sauber = vier.map(function (n) {
      n = parseInt(n, 10);
      if (!n || n < 1) n = 1;
      if (n > 365) n = 365;
      return n;
    });
    TAGE = [0, 1].concat(sauber);
    daten.abstaende = sauber;
    return sauber;
  }

  function vorlagenName(vier) {
    var s = vier.join(",");
    for (var k in VORLAGEN) {
      if (VORLAGEN[k].join(",") === s) return k;
    }
    return "eigen";
  }

  var daten = { v: 3, seeded: false, cards: [], reviews: [] };
  var geladen = false;   // erst nach laden() wird gespeichert (siehe sichern)
  var speicherOk = true;
  var filterKat = "alle";
  var richtung = "de";
  var nurMerk = false;
  var nurKasten = false;
  var filterFach = 0; // 0 = alle Fächer
  var paket = 15;
  var abdeck = "aus";
  var bearbeiteId = null;   // Karte, deren Zeile in der Liste gerade zum Bearbeiten aufgeklappt ist
  var frischId = null;      // gerade gespeicherte Karte, ihre Zeile leuchtet kurz auf
  var frischSet = {};       // gerade aufgenommene Karten, ihre Zeilen leuchten ebenfalls kurz auf
  var fokusNach = null;     // nach dem Zuklappen den Stift dieser Zeile wieder fokussieren
  var saetze = true;

  /* ---------- Speicher ---------- */
  function laden() {
    var roh = null;
    try { roh = window.localStorage.getItem(KEY); }
    catch (e) { speicherOk = false; }

    if (roh) {
      try {
        var p = JSON.parse(roh);
        if (p && Array.isArray(p.cards)) daten = p;
      } catch (e) { /* kaputter Eintrag: Startdatensatz nehmen */ }
    }
    /* Schema 3 (FSRS-Stand je Karte, Antwortprotokoll): vorher den alten Stand unverändert zur Seite legen, einmal
       je Kasten - gleich hier, denn ab jetzt baut jedes sichern() um (siehe migriereV3 in lernen.js). Der Umbau
       ergänzt nur und löscht nichts; ist der Speicher für die Sicherung zu voll, geht es darum auch ohne sie weiter. */
    if (roh && daten.cards.length && !(daten.v >= 3)) {
      try { if (!window.localStorage.getItem(VOR_V3 + KASTEN.id)) window.localStorage.setItem(VOR_V3 + KASTEN.id, roh); }
      catch (e) { /* kein Platz für die Sicherung */ }
    }
    geladen = true;   // ab hier darf gespeichert werden
    if (!daten.seeded) {
      if (!WISSEN) { saeen(); uebernehmeAlteVersion(); }   // Wissenskästen starten leer
      daten.seeded = true;
      sichern();
    }
    gemeinsamHolen();
    if (typeof daten.richtung === "string") richtung = daten.richtung;
    if (!daten.start) daten.start = Date.now();
    if (typeof daten.paket === "number") paket = daten.paket;
    // Frühere Fassungen hatten 30 voreingestellt, bevor es 15 gab.
    if (!daten.paket15 && paket > 15) { paket = 15; daten.paket15 = true; }
    daten.paket15 = true;
    if (typeof daten.abdeck === "string") abdeck = daten.abdeck;
    if (typeof daten.saetze === "boolean") saetze = daten.saetze;
    if (typeof daten.thema === "string") thema = daten.thema;
    if (["retro", "tapedeck", "klar"].indexOf(thema) > -1) thema = "auto";   // diese Designs gibt es nicht mehr (2026-09)
    if (typeof daten.listKat === "string") listKat = daten.listKat;
    if (["nr", "de", "en"].indexOf(daten.listSort) > -1) listSort = daten.listSort;
    /* Lernverfahren unter eigenem Namen "verfahren": daten.modus gehört der Übungsart (Karten/Hören) und hat eine
       frühere SM-2-Wahl beim nächsten Start überschrieben. Wer sie trotzdem noch gespeichert hat, lernt jetzt mit FSRS. */
    if (daten.verfahren !== "fsrs" && daten.verfahren !== "leitner") daten.verfahren = daten.modus === "sm2" ? "fsrs" : "leitner";
    MODUS = daten.verfahren;
    if (typeof daten.retention === "number") RETENTION = Math.min(0.95, Math.max(0.8, daten.retention));
    KNOEPFE = daten.knoepfe === 4 ? 4 : 2;
    if (Array.isArray(daten.abstaende) && daten.abstaende.length === 4) {
      setzeAbstaende(daten.abstaende);
    } else {
      setzeAbstaende(VORLAGEN.normal);
    }
    if (!WISSEN) ordNachtragen();
    aktivNachtragen();
    if (!WISSEN) seedAktualisieren();
    // Umbau auf Schema 3 (die Sicherung dafür steht oben); am Schluss, damit auch frisch dazugekommene Startkarten ihn bekommen
    if (VK_LERNEN.migriereV3(daten, TAGE, Date.now())) sichern();
  }

  /* Einmalige Umstellung auf die neue Startliste. Geändert wird nur, was noch genau so dasteht
     wie in der alten Liste - selbst bearbeitete Karten bleiben, wie sie sind. */
  function vergleichsText(t) { return String(t || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/^to /, ""); }
  var paketHinweis = 0;
  function seedAktualisieren() {
    if ((daten.seedStand || 1) >= SEED_STAND) return;
    var nachId = {};
    daten.cards.forEach(function (c) { nachId[c.id] = c; });
    // 1. Varianten, „to“, Tippfehler, Kategorie
    SEED_AENDERUNG.forEach(function (a) {
      var c = nachId["s" + a[0]];
      if (!c || c.front !== a[1] || c.back !== a[2]) return;
      c.front = a[3]; c.back = a[4];
      if (a[5] !== null) c.kat = a[5];
    });
    // 2. wirklich gleichbedeutende Karten zusammenlegen: der bessere Lernstand bleibt
    var weg = {};
    SEED_ZUSAMMEN.forEach(function (z) {
      var bleibt = nachId["s" + z[0]], geht = nachId["s" + z[1]], soll = SEED.rows[z[0]];
      if (!bleibt || !geht || geht.front !== z[2] || geht.back !== z[3]) return;
      if (bleibt.front !== soll[0] || bleibt.back !== soll[1]) return;
      if (geht.box > bleibt.box || (geht.box === bleibt.box && geht.due < bleibt.due)) { bleibt.box = geht.box; bleibt.due = geht.due; if (geht.fsrs) bleibt.fsrs = geht.fsrs; }
      bleibt.aktiv = !!(bleibt.aktiv || geht.aktiv);
      bleibt.merk = !!(bleibt.merk || geht.merk);
      if (!bleibt.bsp && geht.bsp) bleibt.bsp = geht.bsp;
      weg[geht.id] = true;
    });
    daten.cards = daten.cards.filter(function (c) { return !weg[c.id]; });
    // 3. Ergänzungspaket hinten anhängen (noch nicht im Kasten), außer es ist schon da
    var da = {};
    daten.cards.forEach(function (c) { da[vergleichsText(c.front) + "\u0000" + vergleichsText(c.back)] = true; });
    var t = heute(), neu = 0;
    for (var i = SEED_NEU_AB; i < SEED.rows.length; i++) {
      var r = SEED.rows[i];
      if (!r || nachId["s" + i] || da[vergleichsText(r[0]) + "\u0000" + vergleichsText(r[1])]) continue;
      daten.cards.push({ id: "s" + i, front: r[0], back: r[1], bsp: r[2], kat: r[3], ord: naechsteOrd(),
                         aktiv: false, merk: false, box: 1, due: t, created: Date.now() + i });
      neu++;
    }
    daten.seedStand = SEED_STAND;
    if (neu) paketHinweis = neu;   // einmaliger Hinweis in der Liste (nur in dieser Sitzung)
    sichern();
  }

  // Karten aus einer aelteren Fassung kennen den Kasten noch nicht.
  // Was schon geuebt oder gemerkt wurde, bleibt drin, der Rest wartet.
  function aktivNachtragen() {
    var t = heute(), geaendert = false;
    daten.cards.forEach(function (c) {
      if (typeof c.aktiv !== "boolean") {
        c.aktiv = (c.box > 1) || (c.due > t) || !!c.merk;
        geaendert = true;
      }
    });
    if (geaendert) sichern();
  }

  function naechsteOffene(n) {
    return daten.cards.filter(function (c) { return !c.aktiv; })
      .sort(function (a, b) { return a.ord - b.ord; }).slice(0, n);
  }

  // Ab Fach 4 hat eine Karte drei richtige Antworten hinter sich
  // und meldet sich erst in einer Woche wieder.
  function sitzen() {
    return daten.cards.filter(function (c) { return c.aktiv && fachVon(c) >= 4; }).length;
  }

  function imKasten() {
    return daten.cards.filter(function (c) { return c.aktiv; });
  }

  // Legt die naechsten n noch nicht aufgenommenen Karten in den Kasten.
  function aufnehmen(liste) {
    var t = heute(), dazu = [];
    liste.forEach(function (c) {
      if (c.aktiv) return;
      c.aktiv = true;
      if (c.due < t) c.due = t;
      if (imFilter(c)) dazu.push(c);
    });
    if (aktuell && dazu.length) runde = mische(runde.concat(dazu));
    sichern();
  }

  // Karten aus einer aelteren Fassung kennen die Reihenfolge noch nicht.
  function ordNachtragen() {
    var pos = {};
    SEED.rows.forEach(function (r, i) { if (r) pos[r[0] + "\u0000" + r[1]] = i; });
    var frei = SEED.rows.length;
    var fehlt = daten.cards.filter(function (c) { return typeof c.ord !== "number"; });
    if (!fehlt.length) return;
    daten.cards.forEach(function (c) {
      if (typeof c.ord === "number") { if (c.ord >= frei) frei = c.ord + 1; }
    });
    fehlt.forEach(function (c) {
      var p = pos[c.front + "\u0000" + c.back];
      c.ord = (typeof p === "number") ? p : frei++;
    });
    sichern();
  }

  function naechsteOrd() {
    return daten.cards.reduce(function (m, c) {
      return (typeof c.ord === "number" && c.ord >= m) ? c.ord + 1 : m;
    }, SEED.rows.length);
  }

  function saeen() {
    var t = heute();
    daten.seedStand = SEED_STAND;
    SEED.rows.forEach(function (r, i) {
      if (!r) return;   // in einer anderen Zeile aufgegangen
      daten.cards.push({
        id: "s" + i, front: r[0], back: r[1], bsp: r[2], kat: r[3],
        ord: i, aktiv: false, merk: false, box: 1, due: t, created: Date.now() + i
      });
    });
  }

  function uebernehmeAlteVersion() {
    var alt = null;
    try { alt = window.localStorage.getItem(ALT_KEY); } catch (e) { return; }
    if (!alt) return;
    try {
      var p = JSON.parse(alt);
      if (!p || !Array.isArray(p.cards)) return;
      var da = {};
      daten.cards.forEach(function (c) { da[c.front + "\u0000" + c.back] = true; });
      p.cards.forEach(function (c) {
        if (typeof c.front !== "string" || typeof c.back !== "string") return;
        if (da[c.front + "\u0000" + c.back]) return;
        daten.cards.push({
          id: neueId(), front: c.front, back: c.back, bsp: "",
          kat: KATS.length - 1, ord: naechsteOrd(), aktiv: true, box: c.box || 1,
          due: c.due || heute(), created: c.created || Date.now()
        });
      });
    } catch (e) { /* ignorieren */ }
  }

  function sichern() {
    /* Schutz: vor dem Laden gibt es nichts zu speichern - sonst überschriebe der leere Anfangsstand
       den echten Lernstand (so geschehen, als beim Start geprüft wurde, ob Teilen geht). */
    if (!geladen) return;
    daten.richtung = richtung;
    daten.paket = paket;
    daten.abdeck = abdeck;
    daten.saetze = saetze;
    daten.thema = thema;
    daten.listKat = listKat;
    daten.listSort = listSort;
    daten.verfahren = MODUS;
    daten.retention = RETENTION;
    daten.knoepfe = KNOEPFE;
    // neue, eingelesene oder zurückgesetzte Karten bekommen hier ihren FSRS-Stand (aus dem Fach), bevor sie gespeichert werden
    VK_LERNEN.migriereV3(daten, TAGE, Date.now());
    try { window.localStorage.setItem(KEY, JSON.stringify(daten)); }
    catch (e) { speicherOk = false; zeigeWarnung(); }
    gemeinsamAblegen();
  }

  /* Einstellungen, die für alle Kästen gelten, liegen im Englisch-Kasten (vokabelkasten.v2):
     ein anderer Kasten übernimmt sie beim Laden und schreibt Änderungen dorthin zurück.
     Pro Kasten bleiben Karten, Fächer, Liste, Richtung und Tagesverlauf. */
  var GEMEINSAM = ["thema", "wischen", "eingabe", "ziel", "deStimme", "deTempo", "enTempo", "unterwegs", "abstaende", "modus", "verfahren", "retention", "knoepfe", "letzteSicherung"];
  function gemeinsamHolen() {
    if (KASTEN.id === "en") return;
    try {
      var en = JSON.parse(window.localStorage.getItem(kastenKey("en")));
      if (!en) return;
      GEMEINSAM.forEach(function (k) { if (en[k] !== undefined) daten[k] = en[k]; });
    } catch (e) {}
  }
  function gemeinsamAblegen() {
    if (KASTEN.id === "en") return;
    try {
      var en = JSON.parse(window.localStorage.getItem(kastenKey("en")));
      if (!en || !Array.isArray(en.cards)) return;
      var anders = false;
      GEMEINSAM.forEach(function (k) {
        if (daten[k] !== undefined && JSON.stringify(en[k]) !== JSON.stringify(daten[k])) { en[k] = daten[k]; anders = true; }
      });
      if (anders) window.localStorage.setItem(kastenKey("en"), JSON.stringify(en));
    } catch (e) {}
  }
  /* Tagesziel und Lernserie zählen über alle Kästen: gelernt ist gelernt, egal in welchem Kasten.
     Die Tagesverläufe der anderen Kästen werden beim Start einmal gelesen (sie ändern sich nur, wenn sie offen sind). */
  function fremdeLogsLesen() {
    return KAESTEN.liste.filter(function (k) { return k.id !== KASTEN.id; }).map(function (k) {
      try { var d = JSON.parse(window.localStorage.getItem(kastenKey(k.id))); return (d && d.log) || {}; } catch (e) { return {}; }
    });
  }
  var fremdeLogs = fremdeLogsLesen();

  function zeigeWarnung() {
    var w = document.getElementById("warnbox");
    if (speicherOk) { w.hidden = true; return; }
    w.hidden = false;
    w.textContent = "Dieser Browser speichert hier nichts dauerhaft. Üben geht, aber beim Schließen ist der Lernstand weg. Speichere die Datei aufs Gerät und öffne sie von dort.";
  }

  /* ---------- Hilfen ---------- */
  function heute() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function neueId() { return String(Date.now()) + "-" + Math.floor(Math.random() * 1e6); }
  // Kategorie beziehungsweise Sternfilter
  function imKat(c) {
    if (filterKat === "alle") return true;
    if (filterKat === "merk") return schwierig(c);
    return c.kat === Number(filterKat);
  }
  /* Schwierig = per Stern markiert ODER automatisch erkannt: im Kasten und schon mindestens PROBLEM_AB-mal vergessen
     (FSRS-Zähler lapses, nichts Neues gespeichert) */
  var PROBLEM_AB = 2;
  function problemfall(c) { return !!(c.aktiv && c.fsrs && c.fsrs.lapses >= PROBLEM_AB); }
  function schwierig(c) { return !!c.merk || problemfall(c); }
  function anzahlSchwierige() { return daten.cards.filter(function (c) { return c.aktiv && schwierig(c); }).length; }
  // Kategorie und zusaetzlich das gewaehlte Fach
  function imFilter(c) {
    return imKat(c) && (!filterFach || fachVon(c) === filterFach);
  }
  function anzahlMerk() {
    return daten.cards.filter(function (c) { return c.merk; }).length;
  }
  function faellig() {
    var t = heute();
    return daten.cards.filter(function (c) { return c.aktiv && imFilter(c) && istDran(c, t); });
  }
  // Bei "gemischt" wird pro vorgelegter Karte einmal gewuerfelt,
  // damit die Rueckseite beim Aufdecken zur Vorderseite passt.
  var wurf = "de";

  function seiten(c) {
    var r = (richtung === "mix") ? wurf : richtung;
    return r === "de" ? [c.front, c.back] : [c.back, c.front];
  }

  /* ---------- Runde ---------- */
  var runde = [], aktuell = null, aufgedeckt = false;
  var rundeBilanz = [0, 0];   // gewusst, nochmal - nur für die Anzeige am Rundenende

  function mische(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function rundeStarten(alle) {
    meldung = null;
    rundeBilanz = [0, 0];
    verlauf = [];
    extraOffen = {}; extraGehabt = {};
    runde = mische((alle || filterKat === "merk")
      ? daten.cards.filter(function (c) { return c.aktiv && imFilter(c); })
      : faellig());
    naechsteKarte();
  }
  function naechsteKarte() {
    aufgedeckt = false;
    wurf = Math.random() < 0.5 ? "de" : "en";
    aktuell = runde.shift() || null;
    sitzungMerken();
    zeichneUeben();
  }

  /* ---------- Weitermachen, wo man aufgehört hat ----------
     Beendet das Handy die App im Hintergrund, geht beim nächsten Öffnen am selben Tag
     dieselbe Runde weiter (gleiche Karten, gleiche Auswahl) statt neu gemischt. */
  function sitzungMerken() {
    daten.sitzung = {
      tag: heute(), kat: filterKat, fach: filterFach,
      aktuell: aktuell ? aktuell.id : null,
      ids: runde.map(function (c) { return c.id; }),
      extra: Object.keys(extraOffen), gehabt: Object.keys(extraGehabt)
    };
    sichern();
  }
  function sitzungFortsetzen() {
    var s = daten.sitzung;
    if (!s || s.tag !== heute() || (!s.aktuell && !(s.ids || []).length)) return false;
    var nachId = {};
    daten.cards.forEach(function (c) { nachId[c.id] = c; });
    var karte = s.aktuell && nachId[s.aktuell];
    var rest = (s.ids || []).map(function (id) { return nachId[id]; })
      .filter(function (c) { return c && c.aktiv; });
    if (!(karte && karte.aktiv) && !rest.length) return false;
    filterKat = s.kat || "alle";
    filterFach = s.fach || 0;
    document.getElementById("sel-kat").value = String(filterKat);
    if (document.getElementById("sel-kat").value !== String(filterKat)) { filterKat = "alle"; document.getElementById("sel-kat").value = "alle"; }
    runde = rest;
    verlauf = [];
    meldung = null;
    extraOffen = {}; extraGehabt = {};
    (s.extra || []).forEach(function (id) { extraOffen[id] = true; });
    (s.gehabt || []).forEach(function (id) { extraGehabt[id] = true; });
    aufgedeckt = false;
    aktuell = (karte && karte.aktiv) ? karte : runde.shift();
    zeichneUeben();
    return true;
  }

  /* ---------- Tagesziel, Lernserie und Verlauf ----------
     daten.log["2026-9-25"] = Anzahl bewerteter Karten an diesem Tag */
  function tagSchluessel(ms) { var d = new Date(ms); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function tagesZiel() { return [10, 20, 30, 50, 80].indexOf(daten.ziel) > -1 ? daten.ziel : 20; }
  function geuebtAm(ms) {
    var k = tagSchluessel(ms);
    return fremdeLogs.reduce(function (s, log) { return s + (log[k] || 0); }, (daten.log || {})[k] || 0);
  }
  function zaehleKarte(delta, ms) {
    if (!daten.log) daten.log = {};
    var k = tagSchluessel(ms || Date.now());
    daten.log[k] = Math.max(0, (daten.log[k] || 0) + delta);
    if (!daten.log[k]) delete daten.log[k];
  }
  function lernSerie() {
    var d = new Date(heute()), n = 0;
    if (!geuebtAm(d.getTime())) d.setDate(d.getDate() - 1);   // heute noch nichts: die Serie von gestern zählt noch
    while (geuebtAm(d.getTime())) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function wochenStart(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); }
  function summeAb(startMs, tage) {
    var s = 0, d = new Date(startMs);
    for (var i = 0; i < tage; i++) { s += geuebtAm(d.getTime()); d.setDate(d.getDate() + 1); }
    return s;
  }
  function zeichneTagesziel() {
    var ziel = tagesZiel(), h = geuebtAm(Date.now()), serie = lernSerie();
    document.getElementById("tz-fuell").style.width = Math.min(100, Math.round(h / ziel * 100)) + "%";
    document.getElementById("tagesziel").classList.toggle("erreicht", h >= ziel);
    var t = "Heute " + h + " / " + ziel + (h >= ziel ? " ✓" : "");
    if (serie) t += " · " + serie + (serie === 1 ? " Tag" : " Tage") + " in Folge";
    document.getElementById("tz-text").textContent = t;
    var oben = document.getElementById("kopf-ziel");
    oben.textContent = "Heute " + h + " / " + ziel + (h >= ziel ? " ✓" : "");
    oben.classList.toggle("erreicht", h >= ziel);
  }
  var meldung = null;
  var verlauf = [];

  // Merkt sich den Zustand vor einer Aktion, damit "Zurück" ihn wiederherstellen kann.
  function merkeSchritt(k, art) {
    // beide Stände (Leitner und FSRS), damit "Zurück" alles genau zurückdreht
    verlauf.push({ karte: k, box: k.box, due: k.due, fsrs: k.fsrs ? JSON.parse(JSON.stringify(k.fsrs)) : k.fsrs, zuletzt: k.zuletzt,
      art: art, zeit: Date.now(), zusatz: !!extraOffen[k.id] });
    if (verlauf.length > 50) verlauf.shift();
  }

  function schrittZurueck() {
    if (!verlauf.length) return;
    var e = verlauf.pop();
    if (e.art === "bewertung") zaehleKarte(-1, e.zeit);
    e.karte.box = e.box;
    e.karte.due = e.due;
    e.karte.fsrs = e.fsrs;
    e.karte.zuletzt = e.zuletzt;
    // genau den Protokolleintrag dieser Antwort entfernen (nicht einfach den letzten: eine zwischendurch
    // eingelesene Sicherung sortiert das Protokoll neu)
    if (e.eintrag && daten.reviews && daten.reviews.indexOf(e.eintrag) > -1) daten.reviews.splice(daten.reviews.indexOf(e.eintrag), 1);
    if (e.art === "bewertung") {
      if (e.zusatz) extraOffen[e.karte.id] = true;
      else { delete extraOffen[e.karte.id]; delete extraGehabt[e.karte.id]; }
    }
    runde = runde.filter(function (x) { return x.id !== e.karte.id; });
    if (aktuell) runde.unshift(aktuell);
    aktuell = e.karte;
    aufgedeckt = false;
    wurf = Math.random() < 0.5 ? "de" : "en";
    meldung = { wort: e.karte.front, art: "zurueck" };
    sichern();
    zeichneUeben();
  }

  function schrittWeiter() {
    if (!aktuell || !runde.length) return;
    merkeSchritt(aktuell, "sprung");
    runde.push(aktuell);
    meldung = { wort: aktuell.front, art: "sprung" };
    naechsteKarte();
  }

  // Schiebt eine Karte ohne Bewertung um genau ein Fach zurueck.
  function einFachRunter(k) {
    var vorher = fachVon(k);
    if (vorher <= 1) return false;
    merkeSchritt(k, "hand");
    fachSetzen(k, vorher - 1);
    meldung = { wort: k.front, vorher: vorher, nachher: fachVon(k) };
    sichern();
    return true;
  }

  // Legt eine Karte in ein frei gewaehltes Fach.
  function inFach(k, neu) {
    neu = Math.min(5, Math.max(1, neu));
    if (neu === fachVon(k)) return false;
    fachSetzen(k, neu);
    meldung = { wort: k.front, vorher: 0, nachher: neu };
    sichern();
    return true;
  }

  /* Fach von Hand: die Karte liegt danach in beiden Verfahren in diesem Fach und ist heute dran. Unter FSRS bekommt
     sie den Abstand, der in der Fächer-Ansicht zu diesem Fach gehört (fsrsFuerFach in lernen.js); unter Leitner
     bleibt der FSRS-Stand, wie er ist - er zählt dort ja nicht, und so geht beim Zurückschalten nichts verloren. */
  function fachSetzen(k, neu) {
    k.box = neu;
    k.due = heute();
    if (MODUS === "fsrs") k.fsrs = VK_LERNEN.fsrsFuerFach(neu, Date.now());
  }

  /* Schwierige Karten (Stern) kommen etwas häufiger: Nach einer richtigen Antwort kommt die Karte
     in derselben Runde einmal wieder, ein paar Karten später. Diese Zusatzrunde verschiebt die Karte
     nicht noch ein Fach weiter (sonst wäre sie nach einem Tag schon zwei Fächer höher); weiß man sie
     dann nicht, geht sie wie üblich zurück in Fach 1. Ab Fach 4 gibt es keine Zusatzrunde mehr. */
  var extraOffen = {};   // Karten-IDs, deren Zusatzwiederholung noch ansteht
  var extraGehabt = {};  // in dieser Runde schon einmal zusätzlich gezeigt
  /* bewertung: true/false (gewusst/nicht gewusst, = Gut/Nochmal) oder eine Stufe aus BEWERTUNG (1 bis 4).
     Jede gewertete Antwort geht an beide Verfahren und ins Antwortprotokoll daten.reviews - so bleibt das jeweils
     andere Verfahren auf dem Laufenden, und später lassen sich die FSRS-Parameter aus dem Protokoll anpassen. */
  function bewerten(bewertung) {
    if (!aktuell) return;
    var stufe = bewertung === true ? BEWERTUNG.GUT : bewertung === false ? BEWERTUNG.NOCHMAL : bewertung;
    var gewusst = stufe >= BEWERTUNG.SCHWER;
    var k = aktuell, jetzt = Date.now();
    var vorher = fachVon(k);
    var zusatz = !!extraOffen[k.id];
    delete extraOffen[k.id];
    merkeSchritt(k, "bewertung");
    zaehleKarte(1);
    if (gewusst && zusatz) {
      // Zusatzwiederholung bestanden: Fach und Termin bleiben, wie sie sind - in beiden Verfahren, darum auch kein Protokolleintrag
    } else {
      LEITNER.review(k, stufe, jetzt, { tage: TAGE });
      FSRS_PLAN.review(k, stufe, jetzt, { retention: RETENTION });
      k.zuletzt = jetzt;
      var eintrag = { cardId: k.id, timestamp: jetzt, rating: stufe, scheduler: MODUS };
      daten.reviews.push(eintrag);
      verlauf[verlauf.length - 1].eintrag = eintrag;   // für "Zurück"
      if (gewusst) {
        if (k.merk && fachVon(k) < 4 && !extraGehabt[k.id] && imFilter(k) && runde.length >= 2) {
          extraGehabt[k.id] = true;
          extraOffen[k.id] = true;
          runde.splice(Math.min(3, runde.length), 0, k);
        }
      } else if (imFilter(k) && runde.length > 0 && istDran(k, jetzt)) {
        // Wieder einreihen nur, wenn die Karte zur Auswahl passt, heute noch dran ist (bei FSRS erst morgen wieder)
        // und noch etwas anderes ansteht. Sonst saehe man sofort dieselbe Karte.
        runde.push(k);
      }
    }
    meldung = {
      wort: k.front,
      vorher: vorher,
      nachher: fachVon(k),
      falsch: !gewusst,
      due: termin(k)      // nur für die Anzeige „wieder in … Tagen“
    };
    rundeBilanz[gewusst ? 0 : 1]++;
    sichern();
    naechsteKarte();
  }

  /* Antwortknöpfe: 2 oder 4 (Einstellung), darunter, wohin die Karte je Antwort geht - unter Leitner das Fach,
     unter FSRS der nächste Termin aus der Vorschau (die Fächer sind dort nur Gruppen nach Abstand). */
  function knoepfeZeigen(k) {
    var vier = KNOEPFE === 4, ziel = {};
    document.getElementById("bewertung").classList.toggle("vier", vier);
    document.getElementById("btn-schwer").hidden = !vier;
    document.getElementById("btn-leicht").hidden = !vier;
    document.querySelector("#btn-gewusst .haupt").textContent = vier ? "Gut" : "Gewusst";
    document.getElementById("st-gewusst").textContent = vier ? "Gut" : "Gewusst";   // Stempel beim Wischen nach rechts
    if (MODUS === "fsrs") {
      var v = FSRS_PLAN.vorschau(k, Date.now(), { retention: RETENTION });
      [BEWERTUNG.NOCHMAL, BEWERTUNG.SCHWER, BEWERTUNG.GUT, BEWERTUNG.LEICHT].forEach(function (b) { ziel[b] = wannKurz(v[b]); });
    } else {
      // Leitner kennt nur richtig und falsch: Schwer, Gut und Leicht führen ins selbe Fach; bei 4 Knöpfen kurz, sonst passt es nicht
      ziel[BEWERTUNG.NOCHMAL] = vier ? "→ Fach 1" : (k.box > 1 ? "zurück in Fach 1" : "bleibt in Fach 1");
      ziel[BEWERTUNG.GUT] = vier ? "→ Fach " + Math.min(5, k.box + 1) : (k.box < 5 ? "weiter in Fach " + (k.box + 1) : "bleibt in Fach 5");
      ziel[BEWERTUNG.SCHWER] = ziel[BEWERTUNG.LEICHT] = ziel[BEWERTUNG.GUT];
    }
    document.getElementById("ziel-nochmal").textContent = ziel[BEWERTUNG.NOCHMAL];
    document.getElementById("ziel-schwer").textContent = ziel[BEWERTUNG.SCHWER];
    document.getElementById("ziel-gewusst").textContent = ziel[BEWERTUNG.GUT];
    document.getElementById("ziel-leicht").textContent = ziel[BEWERTUNG.LEICHT];
  }
  // "morgen", "in 2 Tagen", "≈ 12 Tage", "≈ 3 Monate" - ab 3 Tagen ungefähr, weil FSRS die Abstände leicht streut
  function wannKurz(tage) {
    if (tage <= 0) return "heute";
    if (tage === 1) return "morgen";
    if (tage < 3) return "in " + tage + " Tagen";
    if (tage < 45) return "≈ " + tage + " Tage";
    if (tage < 365) return "≈ " + Math.round(tage / 30) + " Monate";
    var jahre = Math.round(tage / 36.5) / 10;
    return "≈ " + String(jahre).replace(".", ",") + (jahre === 1 ? " Jahr" : " Jahre");
  }

  function zeichneMeldung() {
    var el = document.getElementById("meldung");
    if (!meldung) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = "";
    var b = document.createElement("b");
    b.textContent = meldung.wort;
    el.appendChild(b);
    if (meldung.art === "zurueck") {
      el.appendChild(document.createTextNode(" zurückgeholt, letzte Änderung rückgängig"));
      return;
    }
    if (meldung.art === "sprung") {
      el.appendChild(document.createTextNode(" übersprungen, kommt später nochmal"));
      return;
    }
    el.appendChild(document.createTextNode(
      meldung.vorher === 0
        ? " von Hand in Fach " + meldung.nachher + " gelegt"
        : (meldung.falsch && MODUS === "fsrs"
            ? " nicht gewusst"   // bei FSRS sagt das Fach nach einem Fehler wenig, der Termin dahinter umso mehr
            : meldung.vorher === meldung.nachher
            ? " bleibt in Fach " + meldung.nachher
            : " \u2192 Fach " + meldung.nachher)
    ));
    // der Abstand macht das Leitner-Prinzip sichtbar: je sicherer, desto später kommt die Karte wieder
    if (typeof meldung.due === "number" && meldung.vorher !== 0) {
      var tage = Math.round((meldung.due - heute()) / 86400000);
      var w = document.createElement("span");
      w.className = "meldung-wann";
      w.textContent = tage <= 0 ? " \u00b7 heute nochmal" : tage === 1 ? " \u00b7 wieder morgen" : " \u00b7 wieder in " + tage + " Tagen";
      el.appendChild(w);
    }
  }

  /* ---------- Walzenzähler für die Fächer (Vintage-Designs) ----------
     Jede Stelle ist eine 3D-Walze mit rundum aufgedruckten Ziffern 0-9, gedreht per rotateX.
     Die Mechanik folgt einem echten Kilometerzähler:
     - Der Zählerstand läuft stetig vom alten zum neuen Wert. Die Einer-Walze dreht mit,
       jede höhere Walze bewegt sich nur beim Übertrag, also während die Walze darunter
       von 9 auf 0 wechselt (bei 099 -> 100 drehen alle drei gemeinsam).
     - Hochzählen: die neue Ziffer kommt von unten; herunterzählen: von oben.
     - Kleine Schritte rasten mit leichtem Überschwingen ein, größere Sprünge spulen durch.
     - Jede Walze sitzt minimal schief (Getriebespiel).
     - Wandert eine Karte weiter, zählt das alte Fach sofort herunter und das neue einen
       Augenblick später hoch; das neue leuchtet dabei kurz auf.
     - Beim Öffnen drehen die Zähler von 0 auf ihren Stand, Fach für Fach. */
  var ZW_FLAECHE = 1.1;                                    // Höhe einer Ziffernfläche (em)
  var ZW_RADIUS = ZW_FLAECHE / 2 / Math.tan(Math.PI / 10); // Flächen schließen lückenlos an
  var ZW_SPIEL = [0, 0.018, -0.022, 0.012, -0.015];       // Versatz je Stelle, von rechts
  var zaehlwerk = null;
  var zwLaeuft = false;
  var wenigBewegung = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function walzenHTML(stellen) {
    var h = "";
    for (var s = 0; s < stellen; s++) {
      var flaechen = "";
      for (var i = 0; i < 10; i++) {
        flaechen += '<span class="zw-face" style="transform:rotateX(' + (-i * 36) + 'deg) translateZ(' +
          ZW_RADIUS.toFixed(4) + 'em)">' + i + '</span>';
      }
      h += '<span class="zw"><span class="zw-drum">' + flaechen + '</span></span>';
    }
    return h;
  }

  function mod10(x) { return ((x % 10) + 10) % 10; }

  // Stellung aller Walzen für einen (auch gebrochenen) Zählerstand, von rechts nach links
  function walzenStellung(wert, stellen) {
    var stellung = [];
    var einer = mod10(wert);
    stellung.push(einer);
    var uebertrag = Math.max(0, einer - 9);   // Anteil des Übertrags, während die Einer von 9 auf 0 laufen
    for (var s = 1; s < stellen; s++) {
      var ziffer = mod10(Math.floor(wert / Math.pow(10, s)));
      stellung.push(ziffer + uebertrag);
      if (ziffer !== 9) uebertrag = 0;         // nur eine 9 reicht den Übertrag weiter nach links
    }
    return stellung;
  }

  function walzenZeigen(k, stellung) {
    k.stellung = stellung;
    k.walzen.forEach(function (walze, s) {
      var v = stellung[s] + (ZW_SPIEL[s] || 0);
      walze.style.transform = "translateZ(-" + ZW_RADIUS.toFixed(4) + "em) rotateX(" + (v * 36).toFixed(2) + "deg)";
    });
  }
  function walzenSetzen(k) { walzenZeigen(k, walzenStellung(k.wert, k.walzen.length)); }

  function einrasten(x) { var c = 1.1; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function durchspulen(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  // Kürzester Drehweg zwischen zwei Walzenstellungen, Ergebnis in [-5, 5)
  function kuerzester(d) { return ((d % 10) + 15) % 10 - 5; }

  function zaehlerDrehen(k, ziel, verzug) {
    var weg = Math.abs(ziel - k.wert);
    var start = performance.now() + (verzug || 0);
    if (weg > 20 || (k.anim && k.anim.art === "direkt")) {
      // Großer Sprung: jede Walze dreht auf kürzestem Weg zu ihrer Ziffer, leicht versetzt -
      // wie beim Nullstellen. Echtes Durchzählen wäre so schnell, dass die Walzen nur flimmern.
      k.anim = { art: "direkt", von: k.stellung.slice(), nach: walzenStellung(ziel, k.walzen.length),
                 ziel: ziel, start: start, dauer: 900 };
    } else {
      if (weg < 0.001) return;
      // Durchzählen: der Stand läuft stetig, die Walzen folgen mit echtem Übertrag
      k.anim = { art: "zaehlen", von: k.wert, nach: ziel, start: start,
                 dauer: weg <= 1 ? 560 : Math.min(1600, 650 + weg * 45),
                 kurve: weg <= 3 ? einrasten : durchspulen };
    }
    if (!zwLaeuft) { zwLaeuft = true; requestAnimationFrame(zaehlerBild); }
  }

  function zaehlerBild() {
    var jetzt = performance.now(), weiter = false;
    zaehlwerk.kacheln.forEach(function (k) {
      var a = k.anim;
      if (!a) return;
      if (a.art === "direkt") {
        var fertig = true;
        walzenZeigen(k, a.von.map(function (v, s) {
          var p = Math.min(1, Math.max(0, (jetzt - a.start - s * 70) / a.dauer));
          if (p < 1) fertig = false;
          return v + kuerzester(a.nach[s] - v) * durchspulen(p);
        }));
        if (fertig) { k.wert = a.ziel; k.anim = null; walzenSetzen(k); } else weiter = true;
        return;
      }
      var p = Math.min(1, Math.max(0, (jetzt - a.start) / a.dauer));
      k.wert = a.von + (a.nach - a.von) * a.kurve(p);
      if (p >= 1) { k.wert = a.nach; k.anim = null; } else weiter = true;
      walzenSetzen(k);
    });
    if (weiter) requestAnimationFrame(zaehlerBild); else zwLaeuft = false;
  }

  function baueFaecher(el, stellen) {
    el.textContent = "";
    zaehlwerk = { stellen: stellen, kacheln: [] };
    for (var b = 1; b <= 5; b++) {
      (function (fach) {
        var d = document.createElement("button");
        d.type = "button";
        var z = document.createElement("b");
        z.className = "zahl";
        var w = document.createElement("span");
        w.className = "zaehler";
        w.setAttribute("aria-hidden", "true");
        w.innerHTML = walzenHTML(stellen);
        d.appendChild(z);
        d.appendChild(w);
        d.appendChild(document.createTextNode("Fach " + fach));
        d.addEventListener("click", function () {
          filterFach = (filterFach === fach) ? 0 : fach;
          rundeStarten(!!filterFach);
        });
        el.appendChild(d);
        // Walzen von rechts nach links ablegen: [Einer, Zehner, Hunderter …]
        var trommeln = w.querySelectorAll(".zw-drum"), walzen = [];
        for (var s = trommeln.length - 1; s >= 0; s--) walzen.push(trommeln[s]);
        var k = { btn: d, zahl: z, walzen: walzen, wert: 0, ziel: null, anim: null, zugangBis: 0 };
        walzenSetzen(k);
        zaehlwerk.kacheln.push(k);
      })(b);
    }
  }

  /* ---------- Zeichnen ---------- */
  function zeichneFaecher() {
    var el = document.getElementById("boxes");
    var stellen = Math.max(2, String(daten.cards.length).length);
    if (!zaehlwerk || zaehlwerk.stellen !== stellen || !el.firstChild) baueFaecher(el, stellen);
    var walzenSichtbar = document.documentElement.hasAttribute("data-vintage") && !wenigBewegung;
    var jetzt = performance.now();
    zaehlwerk.kacheln.forEach(function (k, i) {
      var fach = i + 1;
      var n = daten.cards.filter(function (c) {
        return c.aktiv && imKat(c) && fachVon(c) === fach;
      }).length;
      if (k.ziel !== n) {
        var alt = k.ziel;
        k.ziel = n;
        if (!walzenSichtbar) {
          k.anim = null; k.wert = n; walzenSetzen(k);
        } else if (alt === null) {
          zaehlerDrehen(k, n, 150 + i * 90);           // beim Öffnen: Fach für Fach hochdrehen
        } else {
          if (n > alt) k.zugangBis = jetzt + 900;
          zaehlerDrehen(k, n, n > alt ? 160 : 0);      // Zugang dreht einen Augenblick nach dem Abgang
        }
      }
      k.btn.className = "box" + (n ? " filled" : "") + (filterFach === fach ? " gewaehlt" : "") +
        (k.zugangBis > jetzt ? " zugang" : "");
      k.btn.setAttribute("aria-pressed", filterFach === fach ? "true" : "false");
      k.btn.setAttribute("aria-label", "Fach " + fach + ", " + n + " Karten" +
        (filterFach === fach ? ", Auswahl aufheben" : ", nur dieses Fach üben"));
      k.zahl.textContent = String(n);
    });
    var sf = document.getElementById("sel-fach");
    if (sf.value !== String(filterFach)) sf.value = String(filterFach);
  }

  // „ 20 gewusst · 5 nochmal – die kommen gleich noch einmal dran“ (nur wenn in dieser Runde gewertet wurde)
  function bilanzText() {
    var g = rundeBilanz[0], n = rundeBilanz[1];
    if (!g && !n) return "";
    return " " + g + " gewusst \u00b7 " + n + " nochmal.";
  }
  /* Beispielsatz: die englische Vokabel darin fett hervorheben (auch mit Endung: complain -> complained) */
  function bspSetzen(el, satz, en) {
    el.textContent = "";
    if (!satz) return;
    var varianten = String(en || "").split(/\s*[\/;]\s*/).map(function (v) {
      return v.replace(/\([^)]*\)/g, " ").replace(/^to\s+/i, "").replace(/\b(sth|sb)\b\.?/gi, " ").replace(/\s+/g, " ").trim();
    }).filter(function (v) { return v.length > 1; }).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < varianten.length; i++) {
      var v = varianten[i], einzeln = v.indexOf(" ") < 0;
      var stamm = einzeln && v.length > 4 ? v.replace(/(e|y)$/i, "") : v;
      var muster = stamm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
      var m = new RegExp("\\b" + muster + (einzeln ? "\\w*" : ""), "i").exec(satz);
      if (m) {
        el.appendChild(document.createTextNode(satz.slice(0, m.index)));
        var b = document.createElement("b");
        b.textContent = m[0];
        el.appendChild(b);
        el.appendChild(document.createTextNode(satz.slice(m.index + m[0].length)));
        return;
      }
    }
    el.textContent = satz;
  }

  /* Neue Karten direkt auf der Lernseite in den Kasten legen (wie „Nächste … aufnehmen“ in der Liste) */
  var nachschubMeldung = "", nachschubAuf = false;   // die Leiste bleibt zu, bis man oben auf das Karten-Symbol tippt
  function zeichneNachschub() {
    var box = document.getElementById("nachschub"), umschalter = document.getElementById("ns-toggle");
    var offen = daten.cards.filter(function (c) { return !c.aktiv; }).length;
    umschalter.hidden = !offen;
    umschalter.setAttribute("aria-expanded", nachschubAuf ? "true" : "false");
    box.hidden = !offen || !(nachschubAuf || nachschubMeldung);
    if (!offen) return;
    document.getElementById("nachschub-txt").textContent = nachschubMeldung || (offen + (offen === 1 ? " neue Karte" : " neue Karten"));
    Array.prototype.forEach.call(box.querySelectorAll("[data-nachschub]"), function (b) {
      var n = Number(b.dataset.nachschub);
      b.textContent = "+" + Math.min(n, offen);
      b.hidden = n > 10 && offen <= n - 10;   // „+ 20“ nur, wenn mehr als 10 warten usw.
    });
  }
  document.getElementById("ns-toggle").addEventListener("click", function () {
    nachschubAuf = !nachschubAuf;
    zeichneNachschub();
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-nachschub]"), function (b) {
    b.addEventListener("click", function () {
      var liste = naechsteOffene(Number(b.dataset.nachschub));
      if (!liste.length) return;
      aufnehmen(liste);
      nachschubAuf = false;   // nach dem Aufnehmen klappt die Leiste von selbst zu (die Meldung bleibt kurz stehen)
      nachschubMeldung = liste.length + (liste.length === 1 ? " Karte" : " Karten") + " aufgenommen";
      setTimeout(function () { nachschubMeldung = ""; if (ansicht === "ueben") zeichneNachschub(); }, 4000);
      if (!aktuell) rundeStarten(false); else zeichneUeben();
    });
  });
  function zeichneUeben() {
    if (modus === "hoeren") hoerInfo();   // z.B. nach Wechsel der Kategorie
    zeichneNachschub();
    uwLautOben();
    zeichneTagesziel();
    zeichneAuswahlText();
    zeichneFaecher();
    zeichneMeldung();
    zeigeWarnung();
    var trainer = document.getElementById("trainer");
    var leer = document.getElementById("leer");
    var status = document.getElementById("status");

    var merkBtn = document.getElementById("btn-merk");
    if (aktuell) {
      var s = seiten(aktuell);
      trainer.hidden = false;
      leer.hidden = true;
      merkBtn.className = "karten-eck links" + (aktuell.merk ? " on" : "");
      merkBtn.textContent = aktuell.merk ? "★" : "☆";
      merkBtn.setAttribute("aria-pressed", aktuell.merk ? "true" : "false");
      merkBtn.setAttribute("aria-label", aktuell.merk ? "Schwierig – Stern entfernen" : "Als schwierig markieren");
      merkBtn.title = aktuell.merk ? "Schwierig" : "Als schwierig markieren";
      document.getElementById("btn-zurueck").disabled = !verlauf.length;
      document.getElementById("btn-weiter").disabled = !runde.length;
      var sprichBtn = document.getElementById("btn-sprich");
      sprichBtn.hidden = !sprache;
      var enSichtbar = englischSichtbar();
      sprichBtn.setAttribute("aria-label", enSichtbar ? "Englisch vorlesen" : "Deutsch vorlesen");
      sprichBtn.title = enSichtbar ? "Englisch vorlesen" : "Deutsch vorlesen";
      document.getElementById("k-kat").textContent =
        (KATS[aktuell.kat] || "") + " \u00b7 Fach " + fachVon(aktuell);
      knoepfeZeigen(aktuell);
      // Für die Vintage-Designs: Vorderseite = Seite A, aufgedeckt = Seite B
      document.getElementById("karte").classList.toggle("offen", aufgedeckt);
      document.getElementById("vorne").textContent = s[0];
      document.getElementById("hinten").textContent = s[1];
      bspSetzen(document.getElementById("bsp"), aktuell.bsp, aktuell.back);
      document.getElementById("hinten").hidden = !aufgedeckt;
      document.getElementById("strich").hidden = !aufgedeckt;
      document.getElementById("bsp").hidden = !aufgedeckt || !aktuell.bsp;
      bildAufKarte();
      document.getElementById("tipp").hidden = aufgedeckt && !wischen;
      document.getElementById("tipp").textContent = aufgedeckt ? "\u2190 Nochmal \u00b7 " + (KNOEPFE === 4 ? "Gut" : "Gewusst") + " \u2192" : "Zum Aufdecken tippen";
      trainer.classList.toggle("wischbar", wischen);
      document.getElementById("bewertung").hidden = !aufgedeckt;
      if (eingabeModus === "tippen" && !aufgedeckt) document.getElementById("tipp").textContent = "Antwort unten eintippen – oder zum Aufdecken tippen";
      eingabeZeichnen();
      status.textContent = (runde.length + 1) + " offen" + (filterFach ? " · Fach " + filterFach : "");
      return;
    }

    trainer.hidden = true;
    eingabeZeichnen();
    leer.hidden = false;
    leer.textContent = "";
    var kasten = imKasten().length;
    status.textContent = kasten + " im Kasten";

    var imFach = daten.cards.filter(function (c) { return c.aktiv && imFilter(c); });
    var p = document.createElement("p");
    var btn = document.createElement("button");
    var btn2 = null;

    if (!kasten) {
      p.textContent = "Dein Kasten ist noch leer. Such dir in der Liste aus, was du lernen willst, oder fang einfach vorne an.";
      btn.textContent = "Die ersten " + Math.min(paket, daten.cards.length) + " aufnehmen";
      btn.addEventListener("click", function () {
        aufnehmen(naechsteOffene(paket));
        rundeStarten(false);
      });
      btn2 = document.createElement("button");
      btn2.className = "ghost";
      btn2.textContent = "Zur Liste";
      btn2.addEventListener("click", function () { wechsle("liste"); });
    } else if (!imFach.length) {
      p.textContent = filterFach
        ? "Fach " + filterFach + " ist durch. Die Karten sind weitergewandert, schau in die Leiste oben."
        : (filterKat === "merk"
            ? "In deinem Kasten liegt nichts Schwieriges."
            : "Aus dieser Kategorie liegt nichts im Kasten.");
      btn.className = "ghost";
      btn.textContent = filterFach ? "Fachauswahl aufheben" : "Alle Kategorien zeigen";
      btn.addEventListener("click", function () {
        if (filterFach) { filterFach = 0; }
        else { filterKat = "alle"; document.getElementById("sel-kat").value = "alle"; }
        rundeStarten(false);
      });
    } else if (filterKat === "merk" && !filterFach) {
      p.textContent = "Schwierige einmal durch." + bilanzText();
      btn.textContent = "Nochmal üben";
      btn.addEventListener("click", function () { rundeStarten(false); });
    } else if (filterFach) {
      p.textContent = "Fach " + filterFach + " einmal durch. Die Karten sind dabei weitergewandert, schau in die Leiste oben.";
      btn.className = "ghost";
      btn.textContent = "Fachauswahl aufheben";
      btn.addEventListener("click", function () { filterFach = 0; rundeStarten(false); });
    } else if (faellig().length) {
      p.textContent = "Runde geschafft." + bilanzText();
      btn.textContent = "Weiter üben";
      btn.addEventListener("click", function () { rundeStarten(false); });
    } else {
      var n = imFach.reduce(function (m, c) { return termin(c) < m ? termin(c) : m; }, Infinity);
      var d = Math.round((n - heute()) / 86400000);
      var offen = daten.cards.filter(function (c) { return !c.aktiv; }).length;
      p.textContent = (d <= 0
        ? "Für heute ist alles durch."
        : "Für heute ist alles durch. Wieder fällig in " + d + (d === 1 ? " Tag." : " Tagen.")) + bilanzText() +
        " Von deinen " + kasten + " im Kasten sitzen " + sitzen() + "." +
        (offen ? " Draußen warten noch " + offen + "." : "");
      if (offen) {
        btn.className = "ghost";
        btn.textContent = "Nächste " + Math.min(paket, offen) + " aufnehmen";
        btn.addEventListener("click", function () {
          aufnehmen(naechsteOffene(paket));
          rundeStarten(false);
        });
        btn2 = document.createElement("button");
        btn2.className = "ghost";
        btn2.textContent = "Trotzdem alles wiederholen";
        btn2.addEventListener("click", function () { rundeStarten(true); });
      } else {
        btn.className = "ghost";
        btn.textContent = "Trotzdem alles wiederholen";
        btn.addEventListener("click", function () { rundeStarten(true); });
      }
    }
    leer.appendChild(p);
    leer.appendChild(btn);
    if (btn2) {
      var abstand = document.createElement("div");
      abstand.style.marginTop = "10px";
      abstand.appendChild(btn2);
      leer.appendChild(abstand);
    }
    // Auch nach der letzten Karte soll sich die Bewertung noch zurücknehmen lassen.
    if (verlauf.length) {
      var zurueck = document.createElement("div");
      zurueck.style.marginTop = "16px";
      var zb = document.createElement("button");
      zb.type = "button";
      zb.className = "leise";
      zb.textContent = "← Letzte Änderung rückgängig";
      zb.addEventListener("click", schrittZurueck);
      zurueck.appendChild(zb);
      leer.appendChild(zurueck);
    }
  }

  function schreibeInfo(sichtbar, gesamt, q) {
    var info = document.getElementById("listinfo");
    var kasten = imKasten().length;
    var teil = (q || nurMerk || nurKasten || listKat !== "alle") ? sichtbar + " von " + gesamt + " gezeigt" : gesamt + " Vokabeln";
    info.textContent = teil + " \u00b7 " + kasten + " im Kasten \u00b7 " + anzahlMerk() + " schwierig";
    if (paketHinweis) {
      info.textContent += " \u00b7 " + paketHinweis + " neue Vokabeln aus dem Ergänzungspaket stehen hinten in der Liste";
    }
  }

  var listeTreffer = [];   // was die Liste gerade zeigt, für „Liste anhören“
  var listKat = "alle", listSort = "nr";
  /* Sortierschlüssel: beim Englischen zählt das Hauptwort, nicht das „to“ davor
     (to complain → complain); beim Deutschen entsprechend „sich“, „etw.“ und „jmdm.“ */
  function sortSchluessel(text, en) {
    var t = String(text || "").toLowerCase().trim();
    t = en ? t.replace(/^to\s+/, "") : t.replace(/^(sich|etw\.|jmdm\.)\s+/, "");
    return t.replace(/^[(\[„“"'…\s]+/, "");
  }
  function fuelleListKat() {
    var sel = document.getElementById("sel-listkat");
    var n = {};
    daten.cards.forEach(function (c) { n[c.kat] = (n[c.kat] || 0) + 1; });
    var html = '<option value="alle">Alle Kategorien (' + daten.cards.length + ')</option>';
    KATS.forEach(function (k, i) { html += '<option value="' + i + '">' + k + ' (' + (n[i] || 0) + ')</option>'; });
    sel.innerHTML = html;
    if (listKat !== "alle" && !n[listKat]) listKat = "alle";
    sel.value = String(listKat);
    document.getElementById("sel-sort").value = listSort;
  }
  function zeichneListe() {
    var q = document.getElementById("suche").value.trim().toLowerCase();
    var ol = document.getElementById("liste");
    fuelleListKat();

    var alle = daten.cards.slice().sort(function (a, b) { return a.ord - b.ord; });
    var platz = {};
    alle.forEach(function (c, i) { platz[c.id] = i + 1; });
    var gesamt = alle.length;
    if (listKat !== "alle") alle = alle.filter(function (c) { return c.kat === Number(listKat); });
    if (listSort !== "nr") {
      var en = listSort === "en", sprachCode = en ? "en" : "de";
      alle.sort(function (a, b) {
        return sortSchluessel(en ? a.back : a.front, en).localeCompare(sortSchluessel(en ? b.back : b.front, en), sprachCode, { sensitivity: "base" }) ||
               a.ord - b.ord;
      });
    }

    var treffer = alle.filter(function (c) {
      if (nurMerk && !schwierig(c)) return false;
      if (nurKasten && !c.aktiv) return false;
      if (!q) return true;
      return c.front.toLowerCase().indexOf(q) > -1 ||
             c.back.toLowerCase().indexOf(q) > -1 ||
             (c.bsp || "").toLowerCase().indexOf(q) > -1;
    });

    schreibeInfo(treffer.length, gesamt, q);
    listeTreffer = treffer;
    document.getElementById("btn-liste-hoeren").disabled = !treffer.length;

    var tb = document.getElementById("btn-treffer");
    var offeneTreffer = treffer.filter(function (c) { return !c.aktiv; });
    if ((q || nurMerk) && offeneTreffer.length) {
      tb.hidden = false;
      tb.textContent = offeneTreffer.length === 1
        ? "Diese eine aufnehmen"
        : "Alle " + offeneTreffer.length + " Treffer aufnehmen";
      tb.onclick = function () {
        var n = offeneTreffer.length;
        aufnehmen(offeneTreffer);
        listeAufgenommen(offeneTreffer, n === 1 ? "1 Treffer" : n + " Treffer");
      };
    } else {
      tb.hidden = true;
      tb.onclick = null;
    }
    var lb = document.getElementById("btn-leeren");
    var drin = imKasten().length;
    lb.hidden = !drin;
    lb.textContent = "Kasten leeren (" + drin + ")";
    // steht nur einer der beiden Knöpfe da, nimmt er die ganze Breite
    tb.classList.toggle("voll", lb.hidden);
    lb.classList.toggle("voll", tb.hidden);

    var nb = document.getElementById("btn-next10");
    var offenGesamt = daten.cards.filter(function (c) { return !c.aktiv; }).length;
    nb.hidden = !offenGesamt;
    document.getElementById("sel-paket").hidden = !offenGesamt;
    nb.textContent = "Nächste " + Math.min(paket, offenGesamt) + " aufnehmen";

    var frag = document.createDocumentFragment();
    treffer.forEach(function (c) {
      if (c.id === bearbeiteId) { frag.appendChild(bearbeitenZeile(c, platz[c.id])); return; }
      var li = document.createElement("li");

      var nr = document.createElement("span");
      nr.className = "num";
      nr.textContent = String(platz[c.id]);

      var de = document.createElement("div");
      de.className = "zelle de serif" + (abdeck === "de" ? " verdeckt" : "");
      de.textContent = c.front;

      var en = document.createElement("div");
      en.className = "zelle en" + (abdeck === "en" ? " verdeckt" : "") + (sprache ? " hoerbar" : "");
      en.lang = "en";   // englische Silbentrennung für die englische Spalte
      en.textContent = c.back;
      if (sprache) {
        // Tipp aufs englische Wort liest es vor; das kleine Symbol dahinter zeigt, dass das geht.
        // Ohne eigenen Knopf, weil rechts in der Zeile kein Platz mehr ist.
        var ohr = document.createElement("span");
        ohr.className = "hoer-mini";
        ohr.setAttribute("aria-hidden", "true");
        ohr.innerHTML = LAUTSPRECHER;
        en.appendChild(ohr);
        en.setAttribute("role", "button");
        en.tabIndex = 0;
        en.setAttribute("aria-label", c.back + " – anhören");
      }

      de.addEventListener("click", function () {
        if (de.className.indexOf("verdeckt") > -1) de.classList.toggle("auf");
      });
      function enTipp() {
        // abgedeckt: erster Tipp deckt auf, danach wird vorgelesen
        if (en.classList.contains("verdeckt") && !en.classList.contains("auf")) { en.classList.add("auf"); return; }
        if (sprache) sprichText(c.back, "en-GB", en);
        else if (en.classList.contains("verdeckt")) en.classList.remove("auf");
      }
      en.addEventListener("click", enTipp);
      en.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enTipp(); }
      });

      var fach = document.createElement("select");
      fach.className = "fachsel";
      for (var fb = 1; fb <= 5; fb++) {
        var fo = document.createElement("option");
        fo.value = String(fb);
        fo.textContent = "F" + fb;
        fach.appendChild(fo);
      }
      fach.value = String(fachVon(c));
      fach.hidden = !c.aktiv;
      fach.title = "Fach wechseln";
      fach.setAttribute("aria-label", "Fach von " + c.front);
      fach.addEventListener("change", function () {
        if (!inFach(c, Number(fach.value))) return;
        runde = runde.filter(function (x) { return x.id !== c.id; });
        if (aktuell && aktuell.id === c.id) naechsteKarte();
        zeichneListe();
      });

      var stern = document.createElement("button");
      stern.type = "button";
      var auto = !c.merk && problemfall(c);   // nicht markiert, aber schon mehrfach vergessen: Stern zart gef\u00e4rbt
      stern.className = "star" + (c.merk ? " on" : "") + (auto ? " auto" : "");
      stern.textContent = c.merk ? "\u2605" : "\u2606";
      stern.setAttribute("aria-pressed", c.merk ? "true" : "false");
      stern.setAttribute("aria-label", (c.merk ? "Nicht mehr schwierig: " : "Als schwierig markieren: ") + c.front);
      stern.title = c.merk ? "Schwierig" : auto ? c.fsrs.lapses + "-mal vergessen \u2013 antippen, um dauerhaft zu markieren" : "Als schwierig markieren";
      stern.addEventListener("click", function () {
        c.merk = !c.merk;
        sichern();
        if (nurMerk && !schwierig(c)) { zeichneListe(); return; }
        stern.className = "star" + (c.merk ? " on" : "");
        stern.textContent = c.merk ? "\u2605" : "\u2606";
        stern.setAttribute("aria-pressed", c.merk ? "true" : "false");
        schreibeInfo(treffer.length, gesamt, q);
      });

      var haken = document.createElement("input");
      haken.type = "checkbox";
      haken.className = "haken";
      haken.checked = !!c.aktiv;
      haken.setAttribute("aria-label", "In den Kasten legen: " + c.front);
      haken.addEventListener("change", function () {
        c.aktiv = haken.checked;
        if (c.aktiv && c.due < heute()) c.due = heute();
        if (!c.aktiv) {
          runde = runde.filter(function (x) { return x.id !== c.id; });
          if (aktuell && aktuell.id === c.id) naechsteKarte();
        }
        sichern();
        if (nurKasten && !c.aktiv) { zeichneListe(); return; }
        li.className = c.aktiv ? "" : "ruht";
        fach.hidden = !c.aktiv;
        fach.value = String(fachVon(c));
        
        schreibeInfo(treffer.length, gesamt, q);
      });

      // Bearbeiten statt direkt löschen: Löschen sitzt jetzt im aufgeklappten Formular, mit Rückfrage
      var stift = document.createElement("button");
      stift.type = "button";
      stift.className = "edit-btn";
      stift.title = "Bearbeiten";
      stift.setAttribute("data-edit", c.id);
      stift.setAttribute("aria-label", "Vokabel bearbeiten: " + c.front);
      stift.innerHTML = STIFT;
      stift.addEventListener("click", function () {
        bearbeiteId = c.id;
        zeichneListe();
      });

      var steuer = document.createElement("div");
      steuer.className = "steuer";
      steuer.appendChild(fach);
      steuer.appendChild(stern);
      steuer.appendChild(haken);
      steuer.appendChild(stift);
      // Auf dem Handy bleiben von den Bedienelementen nur kleine Anzeigen (Fach, Stern); bedient wird über das Menü beim langen Drücken
      var stat = document.createElement("span");
      stat.className = "stat";
      stat.setAttribute("aria-hidden", "true");
      if (schwierig(c)) { var sz = document.createElement("i"); sz.className = "stat-stern"; sz.textContent = "★"; stat.appendChild(sz); }
      if (c.aktiv) { var fz = document.createElement("i"); fz.className = "stat-fach"; fz.textContent = "Fach " + fachVon(c); stat.appendChild(fz); }
      steuer.appendChild(stat);

      li.className = (c.aktiv ? "" : "ruht") + (c.id === frischId || frischSet[c.id] ? " frisch" : "");
      li.appendChild(nr);
      li.appendChild(de);
      li.appendChild(en);
      li.appendChild(steuer);
      if (c.bsp && saetze) {
        var bz = document.createElement("div");
        bz.className = "bsp-zeile";
        bz.textContent = c.bsp;
        li.appendChild(bz);
      }
      kachelDruck(li, c, platz[c.id]);
      frag.appendChild(li);
    });
    langDruckHinweis();

    ol.textContent = "";
    ol.appendChild(frag);
    frischId = null;
    frischSet = {};
    if (fokusNach) {
      var zurueck = ol.querySelector('[data-edit="' + fokusNach + '"]');
      if (zurueck) zurueck.focus({ preventScroll: true });
      fokusNach = null;
    }
  }

  var LAUTSPRECHER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/>' +
    '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var STIFT = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
    '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  // Klappt eine Zeile der Liste zum Bearbeiten auf. Geändert wird nur der Text und die
  // Kategorie; Fach, Termine, Stern und Kasten-Häkchen bleiben unberührt.
  function bearbeitenZeile(c, nummer) {
    var li = document.createElement("li");
    li.className = "bearbeiten";
    var kopf = document.createElement("p");
    kopf.className = "edit-kopf";
    kopf.textContent = "Nr. " + nummer + " bearbeiten";
    li.appendChild(kopf);

    function feld(id, text, wert) {
      var l = document.createElement("label");
      l.htmlFor = id;
      l.textContent = text;
      var i = document.createElement("input");
      i.type = "text"; i.id = id; i.value = wert || ""; i.autocomplete = "off";
      li.appendChild(l);
      li.appendChild(i);
      return i;
    }
    var eVorne = feld("ed-vorne", WISSEN ? "Begriff" : "Deutsch", c.front);
    var eHinten = feld("ed-hinten", WISSEN ? "Bedeutung" : "English", c.back);
    var eBsp = feld("ed-bsp", "Beispielsatz (optional)", c.bsp);

    var kl = document.createElement("label");
    kl.htmlFor = "ed-kat";
    kl.textContent = "Kategorie";
    var kat = document.createElement("select");
    kat.id = "ed-kat";
    KATS.forEach(function (k, i) {
      var o = document.createElement("option");
      o.value = String(i); o.textContent = k;
      kat.appendChild(o);
    });
    kat.value = String(c.kat);
    li.appendChild(kl);
    li.appendChild(kat);

    // Foto für die Rückseite
    var bz = document.createElement("div");
    bz.className = "ed-bild";
    var vorschau = document.createElement("img");
    vorschau.alt = ""; vorschau.hidden = true;
    var bAdd = document.createElement("button");
    bAdd.type = "button"; bAdd.className = "ghost";
    var bWeg = document.createElement("button");
    bWeg.type = "button"; bWeg.className = "ghost"; bWeg.textContent = "Foto entfernen";
    bz.appendChild(vorschau); bz.appendChild(bAdd); bz.appendChild(bWeg);
    li.appendChild(bz);
    function bildZeigen() {
      bAdd.textContent = c.bild ? "📷 Foto ändern" : "📷 Foto für die Rückseite";
      bWeg.hidden = !c.bild;
      if (!c.bild) { vorschau.hidden = true; return; }
      bildUrl(c.id).then(function (u) { if (u) { vorschau.src = u; vorschau.hidden = false; } });
    }
    bAdd.addEventListener("click", function () {
      bildWaehlen(function (blob) {
        bildSetzen(c.id, blob).then(function () { c.bild = true; sichern(); bildZeigen(); });
      });
    });
    bWeg.addEventListener("click", function () {
      bildSetzen(c.id, null).then(function () { delete c.bild; sichern(); bildZeigen(); });
    });
    bildZeigen();

    var knoepfe = document.createElement("div");
    knoepfe.className = "edit-knoepfe";
    var ok = document.createElement("button");
    ok.type = "button"; ok.textContent = "Speichern";
    var ab = document.createElement("button");
    ab.type = "button"; ab.className = "ghost"; ab.textContent = "Abbrechen";
    knoepfe.appendChild(ok);
    knoepfe.appendChild(ab);
    li.appendChild(knoepfe);

    var note = document.createElement("p");
    note.className = "note";
    note.textContent = "Fach, Termine und Stern bleiben erhalten.";
    li.appendChild(note);

    var loeschZeile = document.createElement("div");
    loeschZeile.className = "rauszeile";
    var weg = document.createElement("button");
    weg.type = "button"; weg.className = "leise"; weg.textContent = "Vokabel löschen";
    loeschZeile.appendChild(weg);
    li.appendChild(loeschZeile);

    function schliessen() {
      bearbeiteId = null;
      fokusNach = c.id;
      zeichneListe();
    }
    function speichern() {
      var vorne = eVorne.value.trim(), hinten = eHinten.value.trim();
      if (!vorne || !hinten) { (vorne ? eHinten : eVorne).focus(); return; }
      c.front = vorne;
      c.back = hinten;
      c.bsp = eBsp.value.trim();
      c.kat = Number(kat.value) || 0;
      // Passt die Karte nicht mehr zur Auswahl beim Üben, fällt sie aus der laufenden Runde.
      if (!imFilter(c)) {
        runde = runde.filter(function (x) { return x.id !== c.id; });
        if (aktuell && aktuell.id === c.id) naechsteKarte();
      }
      sichern();
      frischId = c.id;
      schliessen();
    }
    ok.addEventListener("click", speichern);
    ab.addEventListener("click", schliessen);
    [eVorne, eHinten, eBsp].forEach(function (i) {
      i.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); speichern(); }
        else if (e.key === "Escape") schliessen();
      });
    });
    weg.addEventListener("click", function () { karteLoeschenFragen(c); });
    // erst fokussieren, wenn die Zeile im Dokument steht
    setTimeout(function () { eVorne.focus(); }, 0);
    return li;
  }

  // Löschen mit Rückfrage – gilt für das Bearbeiten-Formular und für das Menü beim langen Drücken
  function karteLoeschenFragen(c) {
    frage("„" + c.front + "“ wirklich löschen? Fach und Lernstand dieser Vokabel gehen dabei verloren.", "Löschen", function () {
      daten.cards = daten.cards.filter(function (x) { return x.id !== c.id; });
      if (c.bild) bildSetzen(c.id, null);
      runde = runde.filter(function (x) { return x.id !== c.id; });
      if (aktuell && aktuell.id === c.id) naechsteKarte();
      sichern();
      bearbeiteId = null;
      zeichneListe();
    }, true);
  }

  /* Lange auf eine Kachel der Liste drücken: unten klappt ein Menü auf – bearbeiten, in ein Fach legen oder löschen.
     Tippen auf Knöpfe, Häkchen und Fach-Auswahl in der Zeile löst nichts aus; wer wegwischt (scrollt), bricht ab. */
  var menueKarte = null, langDruckGesehen = null;   // null: noch nicht nachgesehen
  function langDruckHinweis() {
    if (langDruckGesehen === null) {
      langDruckGesehen = false;
      try { langDruckGesehen = localStorage.getItem("vokabelkasten.langdruck") === "1"; } catch (e) {}
    }
    var h = document.getElementById("lang-hinweis");
    if (h) h.hidden = langDruckGesehen;
  }
  function kartenMenueAuf(c, nr) {
    menueKarte = c;
    document.getElementById("kmn-titel").textContent = c.front;
    document.getElementById("kmn-info").textContent = "Nr. " + nr + " · " + c.back + (c.aktiv ? " · Fach " + fachVon(c) : " · noch nicht im Kasten");
    Array.prototype.forEach.call(document.querySelectorAll("#kmn-faecher button"), function (b) {
      var an = c.aktiv && Number(b.dataset.fach) === fachVon(c);
      b.setAttribute("aria-pressed", an ? "true" : "false");
    });
    var mb = document.getElementById("kmn-merk");
    mb.setAttribute("aria-pressed", c.merk ? "true" : "false");
    mb.querySelector("span").textContent = c.merk ? "Schwierig" : "Als schwierig";
    mb.querySelector("b").textContent = c.merk ? "★" : "☆";
    document.getElementById("kmn-kasten").textContent = c.aktiv ? "Aus dem Kasten" : "In den Kasten";
    document.getElementById("karten-menue").hidden = false;
    if (!langDruckGesehen) {
      langDruckGesehen = true;
      try { localStorage.setItem("vokabelkasten.langdruck", "1"); } catch (e) {}
      langDruckHinweis();
    }
  }
  function kartenMenueZu() { document.getElementById("karten-menue").hidden = true; menueKarte = null; }
  function kachelDruck(li, c, nr) {
    var timer = null, x0 = 0, y0 = 0, ausgeloest = false;
    function ab() { if (timer) { clearTimeout(timer); timer = null; } li.classList.remove("gedrueckt"); }
    li.addEventListener("pointerdown", function (e) {
      if (e.button > 0 || e.target.closest("select, input, button, textarea")) return;
      ausgeloest = false; x0 = e.clientX; y0 = e.clientY;
      ab();
      li.classList.add("gedrueckt");   // die Kachel gibt sofort nach, damit man merkt, dass gleich etwas passiert
      timer = setTimeout(function () {
        timer = null; ausgeloest = true; li.classList.remove("gedrueckt");
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (x) {} }
        kartenMenueAuf(c, nr);
      }, 480);
    });
    li.addEventListener("pointermove", function (e) {
      if (timer && (Math.abs(e.clientX - x0) > 9 || Math.abs(e.clientY - y0) > 9)) ab();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { li.addEventListener(n, ab); });
    // der Tipp, der das Menü geöffnet hat, soll nicht auch noch das Wort vorlesen
    li.addEventListener("click", function (e) { if (ausgeloest) { ausgeloest = false; e.stopPropagation(); e.preventDefault(); } }, true);
    // Android öffnet beim langen Drücken sonst sein eigenes Textmenü; am Computer: Rechtsklick
    li.addEventListener("contextmenu", function (e) {
      if (e.target.closest("select, input, textarea")) return;
      e.preventDefault();
      if (!ausgeloest) kartenMenueAuf(c, nr);
    });
  }
  document.getElementById("kmn-abbruch").addEventListener("click", kartenMenueZu);
  document.getElementById("karten-menue").addEventListener("click", function (e) { if (e.target.id === "karten-menue") kartenMenueZu(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !document.getElementById("karten-menue").hidden) kartenMenueZu();
  });
  document.getElementById("kmn-edit").addEventListener("click", function () {
    var c = menueKarte; kartenMenueZu();
    if (!c) return;
    bearbeiteId = c.id;
    zeichneListe();
  });
  document.getElementById("kmn-merk").addEventListener("click", function () {
    var c = menueKarte; kartenMenueZu();
    if (!c) return;
    c.merk = !c.merk;
    sichern();
    frischId = c.id;
    zeichneListe();
  });
  document.getElementById("kmn-kasten").addEventListener("click", function () {
    var c = menueKarte; kartenMenueZu();
    if (!c) return;
    c.aktiv = !c.aktiv;
    if (c.aktiv && c.due < heute()) c.due = heute();
    if (!c.aktiv) {
      runde = runde.filter(function (x) { return x.id !== c.id; });
      if (aktuell && aktuell.id === c.id) naechsteKarte();
    }
    sichern();
    frischId = c.id;
    zeichneListe();
  });
  document.getElementById("kmn-weg").addEventListener("click", function () {
    var c = menueKarte; kartenMenueZu();
    if (c) karteLoeschenFragen(c);
  });
  Array.prototype.forEach.call(document.querySelectorAll("#kmn-faecher button"), function (b) {
    b.addEventListener("click", function () {
      var c = menueKarte, neu = Number(b.dataset.fach);
      kartenMenueZu();
      if (!c) return;
      if (!c.aktiv) { c.aktiv = true; fachSetzen(c, neu); sichern(); }   // noch draußen: kommt dabei gleich in den Kasten
      else if (!inFach(c, neu)) return;
      runde = runde.filter(function (x) { return x.id !== c.id; });
      if (aktuell && aktuell.id === c.id) naechsteKarte();
      frischId = c.id;
      zeichneListe();
    });
  });

  /* Die Fassung steht nur in sw.js: die App fragt den Service Worker danach.
     Keine Antwort (als Datei geöffnet, Service Worker noch nicht aktiv): Zeile bleibt leer. */
  var appFassung = "";
  function fassungZeigen() {
    var el = document.getElementById("fassung");
    if (appFassung) { el.textContent = "Fassung " + appFassung; return; }
    var sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw || !window.MessageChannel) return;
    var kanal = new MessageChannel();
    kanal.port1.onmessage = function (e) {
      if (!e.data || !e.data.fassung) return;
      appFassung = String(e.data.fassung);
      document.getElementById("fassung").textContent = "Fassung " + appFassung;
    };
    try { sw.postMessage({ frage: "fassung" }, [kanal.port2]); } catch (x) {}
  }

  function zeichneStats() {
    fassungZeigen();
    zeichneTempo();
    wichtigListe();
    var n = daten.cards.length;
    var gelernt = daten.cards.filter(function (c) { return c.aktiv && fachVon(c) >= 4; }).length;
    var f = daten.cards.filter(function (c) { return c.aktiv && istDran(c, Date.now()); }).length;
    document.getElementById("stats").textContent =
      n + " Vokabeln insgesamt, " + imKasten().length + " davon im Kasten. " +
      gelernt + " in Fach 4 oder 5, heute fällig: " + f + ", schwierig: " + anzahlMerk() + ".";
  }

  /* ---------- Schnappschuss ----------
     Alle 7 Tage eine vollständige Kopie von daten in IndexedDB (nicht in localStorage - dort liegen die
     eigentlichen Daten). Immer nur einer, der alte wird überschrieben. Klappt das Speichern nicht
     (voll, gesperrt), wird still beim nächsten Start neu versucht. */
  var SNAP_TAGE = 7, SNAP_DB = "vokabelkasten-sicherung", SNAP_STORE = "stand", SNAP_KEY = snapKey();
  function snapKey() { return KASTEN.id === "en" ? "schnappschuss" : "schnappschuss." + KASTEN.id; }
  var snapZeit = null;   // null = noch nicht nachgesehen, 0 = keiner, sonst Zeitpunkt (ms)
  function snapOeffnen() {
    return new Promise(function (ok, fehler) {
      if (!window.indexedDB) { fehler(); return; }
      var req;
      try { req = indexedDB.open(SNAP_DB, 1); } catch (e) { fehler(e); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore(SNAP_STORE); };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { fehler(req.error); };
      req.onblocked = function () { fehler(); };
    });
  }
  function snapLesen() {
    return snapOeffnen().then(function (db) {
      return new Promise(function (ok, fehler) {
        try {
          var q = db.transaction(SNAP_STORE, "readonly").objectStore(SNAP_STORE).get(SNAP_KEY);
          q.onsuccess = function () { ok(q.result || null); };
          q.onerror = function () { fehler(q.error); };
        } catch (e) { fehler(e); }
      });
    });
  }
  function snapSchreiben(wert) {
    return snapOeffnen().then(function (db) {
      return new Promise(function (ok, fehler) {
        try {
          var tx = db.transaction(SNAP_STORE, "readwrite");
          tx.objectStore(SNAP_STORE).put(wert, SNAP_KEY);
          tx.oncomplete = function () { ok(); };
          tx.onerror = tx.onabort = function () { fehler(tx.error); };
        } catch (e) { fehler(e); }
      });
    });
  }
  // hat ein Stand einen Lernstand (Karten im Kasten oder schon höher als Fach 1)?
  function hatLernstand(d) {
    return !!(d && Array.isArray(d.cards) && d.cards.some(function (c) { return c.aktiv || c.box > 1; }));
  }
  /* Beim Start: älter als 7 Tage (oder keiner) -> neuen ablegen. Nur wenn der gespeicherte Stand lesbar
     ist - und ein Stand ohne Lernstand überschreibt nie einen Schnappschuss mit Lernstand (sonst wäre nach
     versehentlichem Zurücksetzen eine Woche später auch die Kopie weg). */
  function snapPruefen() {
    var lesbar = false;
    try {
      var roh = window.localStorage.getItem(KEY);
      var p = roh ? JSON.parse(roh) : null;
      lesbar = !!(p && Array.isArray(p.cards));
    } catch (e) { lesbar = false; }
    snapLesen().then(function (alt) {
      snapZeit = alt ? alt.zeit : 0;
      if (!lesbar) return;
      if (alt && Date.now() - alt.zeit < SNAP_TAGE * 86400000) return;
      if (alt && hatLernstand(alt.daten) && !hatLernstand(daten)) return;
      var neu = { zeit: Date.now(), daten: JSON.parse(JSON.stringify(daten)) };
      return snapSchreiben(neu).then(function () { snapZeit = neu.zeit; });
    }).catch(function () {}).then(zeichneSnap);
  }
  function snapDatum(zeit) {
    return new Date(zeit).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function zeichneSnap() {
    var st = document.getElementById("snap-status"), b = document.getElementById("btn-snap");
    if (!snapZeit) {
      st.textContent = "Letzter Schnappschuss: noch keiner";
      b.hidden = true;
      return;
    }
    var t = tageSeit(snapZeit);
    st.textContent = "Letzter Schnappschuss: " + (t <= 0 ? "heute" : t === 1 ? "gestern" : "vor " + t + " Tagen");
    b.textContent = "Stand vom " + snapDatum(snapZeit) + " wiederherstellen";
    b.hidden = false;
  }
  /* Wiederherstellen nimmt denselben Weg wie ein normaler Start: der Stand kommt unter KEY in den Speicher
     und wird mit laden() eingelesen - Einstellungen, Abstände und Migrationen genau wie sonst auch
     (der Schnappschuss enthält seedStand, die Umstellungen greifen also nicht erneut). */
  document.getElementById("btn-snap").addEventListener("click", function () {
    snapLesen().then(function (snap) {
      if (!snap || !snap.daten || !Array.isArray(snap.daten.cards)) return;
      frage("Lernstand vom " + snapDatum(snap.zeit) + " wiederherstellen? Dein aktueller Stand auf diesem Gerät wird dabei ersetzt.", "Wiederherstellen", function () {
        try { window.localStorage.setItem(KEY, JSON.stringify(snap.daten)); }
        catch (e) { melde("Das hat nicht geklappt: Der Speicher dieses Browsers ist voll oder gesperrt."); return; }
        daten = { v: 3, seeded: false, cards: [], reviews: [] };
        laden();
        document.getElementById("sel-paket").value = String(paket);
        document.getElementById("sel-abdeck").value = abdeck;
        setzeThema(thema);
        setzeModus(daten.modus);
        setzeWischen(daten.wischen);
        setzeEingabe(daten.eingabe);
        document.getElementById("btn-saetze").textContent = saetze ? "Sätze aus" : "Sätze ein";
        document.getElementById("sel-richtung").value = richtung;
        sichern();
        zeichneListe();
        zeichneStats();
        rundeStarten(false);
        zeichneHinweis();
      }, true);
    }).catch(function () {});
  });

  /* ---------- Hinweise zum Datenverlust ---------- */

  function istApple() {
    var ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) ||
           (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function amStartbildschirm() {
    if (window.navigator.standalone === true) return true;
    return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  // Daten dauerhaft behalten: der Browser soll sie auch bei knappem Speicher nicht von sich aus löschen
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(function (ja) { if (!ja) return navigator.storage.persist(); }).catch(function () {});
  } catch (e) {}

  function tageSeit(zeit) {
    if (!zeit) return null;
    return Math.floor((Date.now() - zeit) / 86400000);
  }

  function sicherungsText() {
    var t = tageSeit(daten.letzteSicherung);
    if (t === null) return "Du hast noch nie gesichert.";
    if (t === 0) return "Zuletzt gesichert: heute.";
    if (t === 1) return "Zuletzt gesichert: gestern.";
    return "Zuletzt gesichert vor " + t + " Tagen.";
  }

  function sicherungFaellig() {
    var t = tageSeit(daten.letzteSicherung);
    if (t !== null) return t >= 7;
    var seitStart = tageSeit(daten.start);
    return seitStart !== null && seitStart >= 7 && imKasten().length > 0;
  }

  var thema = "auto";

  var THEMAFARBE = {
    hell: "#f6f7f9", dunkel: "#15181c", nacht: "#17120e",
    kodak: "#f5f2ea"
  };
  // Diese Designs teilen sich Streifen, Tasten, Zählwerk usw. (CSS: html[data-vintage])
  var VINTAGE = ["kodak"];

  function setzeThema(neu) {
    thema = neu;
    document.documentElement.setAttribute("data-thema", neu);
    if (VINTAGE.indexOf(neu) > -1) document.documentElement.setAttribute("data-vintage", "");
    else document.documentElement.removeAttribute("data-vintage");
    var farbe = THEMAFARBE[neu];
    if (!farbe) {
      var dunkel = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      farbe = dunkel ? THEMAFARBE.dunkel : THEMAFARBE.hell;
    }
    var m = document.getElementById("theme-color");
    if (m) m.setAttribute("content", farbe);
    Array.prototype.forEach.call(
      document.querySelectorAll(".themawahl button"),
      function (b) { b.setAttribute("aria-pressed", b.dataset.thema === neu ? "true" : "false"); }
    );
  }

  function zeichneTempo() {
    document.getElementById("sel-modus").value = MODUS;
    document.getElementById("tempo-block").hidden = MODUS === "fsrs";
    document.getElementById("modus-info").textContent = MODUS === "fsrs"
      ? "FSRS rechnet für jede Karte aus, wann du sie gerade noch weißt, und fragt sie genau dann ab – weniger Wiederholungen für dasselbe Ergebnis. Die Fächer ordnen die Karten nach Abstand: unter 1 Tag, 1 Woche, 1 Monat, 3 Monaten, länger."
      : "Feste Abstände je Fach – einfach und gut zu überblicken.";
    document.getElementById("retention-block").hidden = MODUS !== "fsrs";
    document.getElementById("sel-retention").value = String(RETENTION);
    document.getElementById("sel-knoepfe").value = String(KNOEPFE);
    document.getElementById("knoepfe-info").textContent = KNOEPFE === 2
      ? "Gewusst oder nicht – mehr braucht es nicht. Wischen geht auch: rechts = Gewusst, links = Nochmal."
      : MODUS === "fsrs"
        ? "Schwer holt die Karte etwas früher zurück, Leicht schiebt sie weiter hinaus. Wischen: rechts = Gut, links = Nochmal."
        : "Leitner zählt Schwer, Gut und Leicht gleich als gewusst – die Abstufung merkt sich FSRS im Hintergrund.";
    var vier = TAGE.slice(2);
    var art = vorlagenName(vier);
    document.getElementById("sel-tempo").value = art;
    document.getElementById("tempofelder").hidden = art !== "eigen";
    ["t2", "t3", "t4", "t5"].forEach(function (id, i) {
      document.getElementById(id).value = String(vier[i]);
    });
    document.getElementById("tempo-info").textContent =
      "Aktuell: " + vier.join(", ") + " Tage. Gilt für künftige Antworten.";
  }

  var hinweisArt = null;
  var hinweisPause = false;

  function zeichneHinweis() {
    var bar = document.getElementById("hinweisbar");
    var txt = document.getElementById("hinweistext");
    var tun = document.getElementById("hinweis-tun");

    // Der Hinweis zum Installieren steht bewusst nur in den Einstellungen.
    // Ein Balken bei jedem Öffnen nervt mehr, als er nützt.
    // nur auf Start und in den Einstellungen - beim Üben und in der Liste stört er nicht; rot erst nach 21 Tagen
    if (sicherungFaellig() && !hinweisPause && (ansicht === "start" || ansicht === "sichern")) {
      hinweisArt = "sicherung";
      bar.hidden = false;
      var tg = tageSeit(daten.letzteSicherung);
      bar.className = (tg === null ? tageSeit(daten.start) : tg) >= 21 ? "rot" : "";
      txt.textContent = "";
      var s2 = document.createElement("strong");
      s2.textContent = sicherungsText();
      txt.appendChild(s2);
      txt.appendChild(document.createTextNode(" Ein Tipp genügt, dann ist dein Stand in Sicherheit."));
      tun.textContent = "Jetzt sichern";
      return;
    }
    hinweisArt = null;
    bar.hidden = true;
  }

  function istAndroid() {
    return /Android/.test(navigator.userAgent || "");
  }

  function appleKasten() {
    var apple = istApple();
    var drin = amStartbildschirm();
    var android = istAndroid();

    // Die zum Gerät passende Anleitung hervorheben
    var welche = apple ? "pf-apple" : (android ? "pf-android" : "pf-desktop");
    ["pf-apple", "pf-android", "pf-desktop"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.className = "plattform" + (id === welche ? " hier" : " blass");
    });
    var k = document.getElementById("applekasten");
    var status = document.getElementById("applestatus");
    var warum = document.getElementById("applewarum");
    var note = document.getElementById("applenote");

    var det = document.getElementById("ab-apple");
    if (det) {
      det.className = "abschnitt" + ((apple && !drin) ? " warnt" : "");
      if (apple && !drin && !det.dataset.auf) { det.open = true; det.dataset.auf = "1"; }
    }
    if (apple && !drin) {
      k.className = "applekasten dringend";
      status.textContent = "Noch offen: Dein Fortschritt ist gefährdet.";
      warum.textContent = "Safari löscht den Speicher nach 7 Tagen ohne Besuch – eine installierte App nicht.";
      note.textContent = "Dein Fortschritt bleibt beim Installieren erhalten.";
      return;
    }
    if (apple && drin) {
      k.className = "applekasten erledigt";
      status.textContent = "Erledigt: Die App ist installiert.";
      warum.textContent = "Die 7-Tage-Löschregel von Safari gilt damit nicht mehr.";
      note.textContent = "Die Anleitungen stehen hier weiter, falls du die App auf einem zweiten Gerät einrichten willst.";
      return;
    }
    k.className = "applekasten";
    status.textContent = drin ? "Erledigt: Die App ist installiert." : "Noch nicht installiert.";
    warum.textContent = drin
      ? "Sie läuft in einem eigenen Fenster. Unten stehen die Anleitungen für weitere Geräte."
      : "Auf diesem Gerät ist das freiwillig: Die App startet schneller, bekommt ein eigenes Fenster " +
        "und der Speicher ist besser geschützt. Nur bei iPhone und iPad ist es Pflicht, sonst löscht " +
        "Safari den Fortschritt nach sieben Tagen ohne Besuch.";
    note.textContent = "Beim Weitergeben des Links: Sag Apple-Nutzern unbedingt, dass sie die App auf den " +
      "Startbildschirm legen müssen. Ohne das ist ihr Lernstand nach einer Woche Pause weg.";
  }

  function wichtigListe() {
    appleKasten();
    var punkte = [];
    var drin2 = amStartbildschirm();
    punkte.push(drin2
      ? "Erledigt: Die App ist installiert und läuft in einem eigenen Fenster."
      : (istApple()
          ? "Zuerst: Leg die App auf den Startbildschirm. Ohne das löscht Safari deinen Fortschritt nach sieben Tagen ohne Besuch. Die Anleitung steht oben unter „App installieren“."
          : "Empfohlen: Installier die App über den Abschnitt „App installieren“. Sie startet dann schneller und der Speicher ist besser geschützt."));
    punkte.push("Lade dir etwa alle zwei Wochen eine Sicherungsdatei herunter. " + sicherungsText());
    punkte.push("Lösch nicht die Browserdaten für diese Seite und nutze kein privates Fenster. Beides löscht deinen Lernstand sofort.");
    punkte.push("Der Stand gilt nur für dieses Gerät und diesen Browser. Auf ein zweites Gerät kommst du nur über die Sicherungsdatei.");

    document.getElementById("sicher-status").textContent = sicherungsText();
  }

  /* ---------- Einfuegen aus der Zwischenablage ---------- */

  // Zerlegt eingefuegten Text in Zeilen mit zwei bis drei Spalten.
  /* Eine Zeile in Vorder- und Rückseite (und Beispiel) teilen. Tab und | wie aus Excel; sonst gewinnt das erste
     der Zeichen „ = “, „;“, „ – “ (auch - und —, nur mit Leerzeichen, damit „E-Mail“ ganz bleibt) und „: “ -
     so wird „Haus – house; home“ zu Haus | house; home. tauschen: die Liste steht andersherum (Englisch vorn). */
  function trennen(z) {   // Teile einer Zeile oder null, wenn kein Trennzeichen darin steht
      var teile;
      if (z.indexOf("\t") > -1) teile = z.split("\t");
      else if (z.indexOf("|") > -1) teile = z.split("|");
      else {
        // einmal: nur am ersten Vorkommen teilen (Erklärungen dürfen selbst „=“ oder „:“ enthalten); vorne: höchstens 60 Zeichen davor
        var trenner = [
          { re: /\s=\s/, einmal: true, vorne: /^[^=]{1,60}\s=\s/ },   // „OGS = Original GARDENA System“
          { re: /;/ },
          { re: /\s[–—-]\s/ },
          { re: /:\s/, einmal: true, vorne: /^[^:]{1,60}:\s/ }
        ].map(function (t) {
          if (t.vorne && !t.vorne.test(z)) return null;
          var m = t.re.exec(z);
          return m ? { t: t, pos: m.index, len: m[0].length } : null;
        }).filter(Boolean).sort(function (a, b) { return a.pos - b.pos; })[0];
        if (trenner) teile = trenner.t.einmal ? [z.slice(0, trenner.pos), z.slice(trenner.pos + trenner.len)]
                                              : z.split(new RegExp(trenner.t.re.source, "g"));
        else if (/\s{2,}/.test(z)) teile = z.split(/\s{2,}/);
        else return null;
      }
      teile = teile.map(function (s) { return s.trim(); }).filter(function (s) { return s; });
      return teile.length >= 2 ? teile : null;
  }
  /* Zwei Formate: „Begriff – Bedeutung“ in einer Zeile (siehe trennen) oder – wie oft aus Fotos, PDFs und Google Lens –
     Begriff und Bedeutung je in einer eigenen Zeile. Hat höchstens die Hälfte der Zeilen ein Trennzeichen,
     liest die App immer zwei Zeilen als eine Karte (Erklärungen mit „:“ oder „–“ darin stören dann nicht). */
  function zerlege(text, tauschen) {
    var kopf = /^(deutsch|german|begriff|english|englisch|bedeutung|erklärung)$/i;
    var zeilen = String(text).replace(/\r/g, "").split("\n").map(function (z) {
      return z.replace(/^\s*(?:[•·▪◦*]|-(?=\s)|\d{1,3}[.)])\s+/, "").trim();   // Aufzählungszeichen und Nummern aus Fotos/Listen
    }).filter(function (z) { return z; });
    var ergebnis = { karten: [], uebersprungen: 0, paarweise: false };
    function karte(teile) {
      ergebnis.karten.push({
        de: tauschen ? teile[1] : teile[0],
        en: tauschen ? teile[0] : teile[1],
        bsp: teile.length > 2 ? teile.slice(2).join(" ").trim() : ""
      });
    }
    var geteilt = zeilen.map(trennen);
    var mitTrenner = geteilt.filter(Boolean).length;
    if (zeilen.length >= 2 && mitTrenner * 2 <= zeilen.length) {
      ergebnis.paarweise = true;
      var start = kopf.test(zeilen[0]) && kopf.test(zeilen[1]) ? 2 : 0;   // Überschrift „Begriff / Bedeutung“ ganz oben
      for (var k = start; k + 1 < zeilen.length; k += 2) karte([zeilen[k], zeilen[k + 1]]);
      if ((zeilen.length - start) % 2) ergebnis.uebersprungen++;   // letzte Zeile ohne Partner
      return ergebnis;
    }
    geteilt.forEach(function (teile, i) {
      if (!teile) { ergebnis.uebersprungen++; return; }
      if (i === 0 && kopf.test(teile[0]) && kopf.test(teile[1])) return;   // Überschriftenzeile (in beiden Reihenfolgen)
      karte(teile);
    });
    return ergebnis;
  }

  function zeichneVorschau() {
    var txt = document.getElementById("einfuegen").value;
    var v = document.getElementById("vorschau");
    v.classList.remove("fertig");
    var knopf = document.getElementById("btn-import-text");
    if (!txt.trim()) {
      v.textContent = "";
      knopf.disabled = true;
      return;
    }
    var r = zerlege(txt, document.getElementById("imp-tausch").checked);
    var vorhanden = {};
    daten.cards.forEach(function (c) { vorhanden[c.front.toLowerCase() + "\u0000" + c.back.toLowerCase()] = true; });
    var neu = 0, doppelt = 0, gesehen = {};
    r.karten.forEach(function (k) {
      var s = k.de.toLowerCase() + "\u0000" + k.en.toLowerCase();
      if (vorhanden[s] || gesehen[s]) { doppelt++; return; }
      gesehen[s] = true; neu++;
    });
    knopf.disabled = !neu;
    knopf.textContent = neu ? "Einlesen (" + neu + ")" : "Einlesen";

    var teile = [];
    teile.push(neu + (WISSEN ? (neu === 1 ? " neuer Begriff erkannt" : " neue Begriffe erkannt") : (neu === 1 ? " neue Vokabel erkannt" : " neue Vokabeln erkannt")));
    if (doppelt) teile.push(doppelt + " schon vorhanden");
    if (r.paarweise) teile.push("je zwei Zeilen = eine Karte");
    if (r.uebersprungen) teile.push(r.paarweise ? "letzte Zeile ohne Partner" : r.uebersprungen + " Zeilen ohne erkennbare Trennung");
    if (r.karten.length) {   // mit Seitennamen, damit man sieht, ob die Spalten richtig herum stehen
      var k0 = r.karten[0];
      teile.push("erste Karte: " + (WISSEN ? "Begriff" : "Deutsch") + " „" + k0.de + "“, " + (WISSEN ? "Bedeutung" : "Englisch") + " „" + k0.en + "“");
    }
    v.textContent = teile.join(" \u00b7 ");
  }

  /* ---------- Ansichten ---------- */
  var ansicht = "ueben";
  function wechsle(name) {
    ansicht = name;
    document.documentElement.classList.remove("tippt");   // kompakte Ansicht beim Schreiben gilt nur auf der Lernseite
    ["start", "ueben", "liste", "neu", "quiz", "sichern", "statistik"].forEach(function (v) {
      document.getElementById("view-" + v).classList.toggle("active", v === name);
    });
    var navName = name === "statistik" ? "ueben" : name;   // die Statistik gehört zum Üben
    Array.prototype.forEach.call(document.querySelectorAll("nav button"), function (b) {
      if (b.dataset.view === navName) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (name === "statistik") zeichneStatistik();
    waechterAbgleichen();
    if (name === "liste") zeichneListe();
    if (name === "ueben") {
      if (!aktuell && (filterFach ? imKasten().some(imFilter) : faellig().length)) {
        rundeStarten(!!filterFach);
      }
      else zeichneUeben();
    }
    if (name === "sichern") { zeichneStats(); uwEinstellungenZeigen(); stimmTipp(); zielWahlZeigen(); }
    if (name === "quiz") duEinstellungenZeigen();
    if (name === "start") zeichneKacheln();
    kopfZeigen();
    zeichneHinweis();
    document.querySelector("main").scrollTop = 0;
  }

  function kopfZeigen() {
    var name = kastenTitel(KASTEN);
    var titel = { start: name, ueben: modus === "hoeren" ? "Hörtraining" : name, liste: "Liste",
                  neu: "Neu", quiz: "Quiz-Duell", sichern: "Optionen", statistik: "Statistik" }[ansicht] || name;
    document.getElementById("kopf-titel").textContent = titel;
    document.getElementById("btn-start").hidden = ansicht === "start";
    var zielOben = ansicht === "ueben" && modus === "karten";   // beim Üben: Tagesziel oben rechts, „x offen“ steht in der Auswahlzeile
    document.getElementById("kopf-ziel").hidden = !zielOben;
    document.getElementById("status").hidden = ansicht === "start" || zielOben;   // steht auf der Startseite schon in der großen Karte
    document.getElementById("btn-einst").hidden = true;   // Optionen stehen in der Leiste unten - kein zweites Zahnrad oben
  }
  /* Begrüßung oben: bei jedem Öffnen der nächste Gruß (Buongiorno nur vormittags), während der Sitzung bleibt er */
  var GRUESSE = ["Servus", "Moin", "Buongiorno", "Grüß dich", "Moin Moin"], grussHeute = null;
  function begruessung() {
    if (grussHeute) return grussHeute;
    var passend = GRUESSE.filter(function (g) { return g !== "Buongiorno" || new Date().getHours() < 12; });
    var i = 0;
    try { i = (parseInt(window.localStorage.getItem("vokabelkasten.gruss"), 10) + 1) || 0; window.localStorage.setItem("vokabelkasten.gruss", String(i % 100)); } catch (e) {}
    grussHeute = passend[i % passend.length];
    return grussHeute;
  }
  /* Kacheln Hörtraining / Quiz-Duell: lange drücken → verkleinern (schmale Zeile) bzw. wieder groß. Je Kasten gemerkt. */
  function kachelnGroesse() {
    var klein = Array.isArray(daten.kachelnKlein) ? daten.kachelnKlein : [];
    var paar = document.querySelector(".st-paar");
    Array.prototype.forEach.call(document.querySelectorAll(".st-kachel"), function (k) { k.classList.toggle("klein", klein.indexOf(k.dataset.ziel) > -1); });
    if (paar) paar.classList.toggle("mit-klein", klein.length > 0);
  }
  /* Wochenzeile wie in BLOC: Mo–So, ein Punkt je Tag mit gelernten Karten (alle Kästen), heute fett */
  function zeichneWoche() {
    var box = document.getElementById("st-wochenzeile");
    if (!box) return;
    var jetzt = new Date(), wt = (jetzt.getDay() + 6) % 7;   // Montag = 0
    var mo = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - wt);
    var tage = 0, karten = 0, punkte = "";
    ["M", "D", "M", "D", "F", "S", "S"].forEach(function (b, i) {
      var tag = new Date(mo.getFullYear(), mo.getMonth(), mo.getDate() + i).getTime();
      var n = i <= wt ? geuebtAm(tag) : 0;
      if (n) { tage++; karten += n; }
      punkte += '<span class="sw-tag' + (n ? " an" : "") + (i === wt ? " heute" : "") + '"><i></i>' + b + '</span>';
    });
    box.setAttribute("aria-label", "Diese Woche: " + (tage ? tage + (tage === 1 ? " Tag" : " Tage") + ", " + karten + (karten === 1 ? " Karte" : " Karten") : "noch nicht gelernt"));
    box.innerHTML = '<span class="sw-tage">' + punkte + '</span>';
  }
  function zeichneKacheln() {
    zeichneWoche();
    kachelnGroesse();
    var f = daten.cards.filter(function (c) { return c.aktiv && istDran(c, Date.now()); }).length, k = imKasten().length;
    var ziel = tagesZiel(), h = geuebtAm(Date.now()), serie = lernSerie(), std = new Date().getHours();
    // Begrüßung mit Lernserie
    var gruss = document.getElementById("st-gruss");
    gruss.textContent = begruessung();
    if (serie) {
      var b = document.createElement("b");
      b.textContent = " · " + serie + (serie === 1 ? " Tag" : " Tage") + " in Folge";
      gruss.appendChild(b);
    }
    // große Karte: genau eine Hauptzahl - vor dem Start das erste Paket, danach die heute fälligen Karten
    var start = Math.min(paket, daten.cards.length), wort = WISSEN ? "Karten" : "Vokabeln";
    document.getElementById("st-hero-sub").textContent = k ? k + (k === 1 ? " Karte" : " Karten") + " im Kasten"
      : daten.cards.length ? daten.cards.length + " " + wort + " in der Liste" : "Dein Kasten ist noch leer";
    document.getElementById("st-faellig").textContent = String(k ? f : start);
    document.getElementById("st-faellig-txt").textContent = k ? (f === 1 ? "Karte heute fällig" : "Karten heute fällig")
      : start ? wort + " zum Start" : (WISSEN ? "Leg unten die ersten Begriffe an" : "Leg unten die ersten Vokabeln an");
    document.getElementById("st-ziel-fuell").closest(".st-ziel").hidden = !k;   // Tagesziel erst, wenn gelernt wird
    document.getElementById("st-ziel-fuell").style.width = Math.min(100, Math.round(h / ziel * 100)) + "%";
    document.getElementById("st-ziel-txt").textContent = "Tagesziel " + h + " / " + ziel + (h >= ziel ? " ✓" : "");
    document.getElementById("st-cta-txt").textContent = !k ? (start ? "Die ersten " + start + " lernen" : "Loslegen") : f ? "Jetzt üben" : "Alles erledigt · trotzdem üben";
    // Lernarten und Verwalten
    var n = uwKartenAuswahl(uwEinstellungen().auswahl).length;
    document.getElementById("k-hoeren").textContent = n ? n + (n === 1 ? " Karte" : " Karten") + " · freihändig" : "Vorlesen lassen, freihändig";
    var kListe = document.getElementById("k-liste");   // Zeile „Liste“ gibt es auf der Startseite nicht mehr (steht in der Leiste unten)
    if (kListe) kListe.textContent = daten.cards.length + (WISSEN ? " Karten · " : " Vokabeln · ") + k + " im Kasten";
  }
  Array.prototype.forEach.call(document.querySelectorAll(".kachel"), function (b) {
    b.addEventListener("click", function () {
      var z = b.dataset.ziel;
      if (z === "karten" || z === "hoeren") {
        setzeModus(z);
        // Erster Start: „Loslegen“ legt gleich das erste Paket in den leeren Kasten, statt auf eine leere Seite zu führen
        if (z === "karten" && b.classList.contains("st-hero") && !imKasten().length) aufnehmen(naechsteOffene(paket));
        sichern();
        wechsle("ueben");
        if (z === "karten") zeichneUeben();
      } else wechsle(z);
    });
  });
  document.getElementById("btn-einst").addEventListener("click", function () { wechsle("sichern"); });
  document.getElementById("btn-start").addEventListener("click", function () {
    wechsle(ansicht === "statistik" ? "ueben" : "start");
  });

  /* ---------- Aufbau ---------- */
  function fuelleSelects() {
    ["sn-kat", "sel-kat", "neu-kat", "imp-kat"].forEach(function (id) { document.getElementById(id).textContent = ""; });
    KATS.forEach(function (k, i) {
      var o2 = document.createElement("option"); o2.value = String(i); o2.textContent = k;
      document.getElementById("sn-kat").appendChild(o2);
    });
    var s = document.getElementById("sel-kat");
    var n = document.getElementById("neu-kat");
    var ik = document.getElementById("imp-kat");
    var o = document.createElement("option");
    o.value = "alle"; o.textContent = "Alle Kategorien";
    s.appendChild(o);
    var m = document.createElement("option");
    m.value = "merk"; m.textContent = "\u2605 Nur schwierige";
    s.appendChild(m);
    KATS.forEach(function (k, i) {
      var a = document.createElement("option");
      a.value = String(i); a.textContent = k;
      s.appendChild(a);
      var b = document.createElement("option");
      b.value = String(i); b.textContent = k;
      n.appendChild(b);
      var c2 = document.createElement("option");
      c2.value = String(i); c2.textContent = k;
      ik.appendChild(c2);
    });
    n.value = String(KATS.length - 1);
    ik.value = String(KATS.length - 1);
  }

  /* ---------- Ereignisse ---------- */
  Array.prototype.forEach.call(document.querySelectorAll("nav button"), function (b) {
    b.addEventListener("click", function () { wechsle(b.dataset.view); });
  });

  document.getElementById("sel-kat").addEventListener("change", function (e) {
    filterKat = e.target.value;
    document.getElementById("auswahl").open = false;
    rundeStarten(!!filterFach);
  });
  document.getElementById("sel-fach").addEventListener("change", function (e) {
    filterFach = Number(e.target.value) || 0;
    rundeStarten(!!filterFach);
  });

  document.getElementById("sel-richtung").addEventListener("change", function (e) {
    richtung = e.target.value;
    document.getElementById("auswahl").open = false;
    sichern();
    zeichneUeben();
  });

  document.getElementById("karte").addEventListener("click", function () {
    if (wischGerade) { wischGerade = false; return; }   // Klick nach einer Wischbewegung ignorieren
    if (aktuell && !aufgedeckt) {
      if (eingabeModus === "tippen") eingabe = { karte: aktuell, text: "", ok: false, genau: false };
      aufgedeckt = true; zeichneUeben();
    }
  });

  /* ---------- Eintippen: nur wenn eingestellt (daten.eingabe = "tippen"), Standard bleibt Aufdecken ----------
     Die Antwort wird gnädig geprüft (dieselbe Prüfung wie beim Sprechen, Stufe „locker“: kleine Tippfehler,
     fehlende Artikel, Klammern und Varianten „a / b“ zählen). Das Ergebnis ist nur ein Vorschlag -
     bewertet wird wie immer mit Gewusst / Nochmal, die Leitner-Logik bleibt unverändert. */
  var eingabeModus = "aufdecken", eingabe = null, eingabeKarte = null;
  function setzeEingabe(m) {
    eingabeModus = m === "tippen" ? "tippen" : "aufdecken";
    daten.eingabe = eingabeModus;
    Array.prototype.forEach.call(document.querySelectorAll("#eingabewahl button, #antwortwahl [data-eingabe]"), function (b) {
      b.setAttribute("aria-pressed", b.dataset.eingabe === eingabeModus ? "true" : "false");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#eingabewahl button, #antwortwahl [data-eingabe]"), function (b) {
    b.addEventListener("click", function () {
      setzeEingabe(b.dataset.eingabe); sichern(); zeichneUeben();
      // unter der Karte „Schreiben“ gewählt: gleich losschreiben
      if (eingabeModus === "tippen" && ansicht === "ueben" && aktuell && !aufgedeckt) document.getElementById("eingabe-feld").focus();
    });
  });
  function eingabeZeichnen() {
    var form = document.getElementById("eingabe"), feld = document.getElementById("eingabe-feld");
    var erg = document.getElementById("eingabe-ergebnis");
    var an = eingabeModus === "tippen" && !!aktuell;
    form.hidden = !an;
    if (aktuell && eingabeKarte !== aktuell) {   // neue Karte: Feld leeren, Fokus behalten, wenn man gerade tippt
      eingabeKarte = aktuell;
      eingabe = null;
      feld.value = "";
    }
    var gilt = an && aufgedeckt && eingabe && eingabe.karte === aktuell;
    erg.hidden = !gilt;
    erg.className = "eingabe-ergebnis" + (gilt ? (eingabe.ok ? " ok" : " falsch") : "");
    erg.textContent = "";
    if (gilt) {
      var b = document.createElement("b");
      b.textContent = !eingabe.text ? "Aufgedeckt" : eingabe.ok ? (eingabe.genau ? "Richtig!" : "Fast richtig") : "Leider nicht";
      erg.appendChild(b);
      if (eingabe.text && !eingabe.genau) {
        erg.appendChild(document.createTextNode(" – du hast "));
        var q = document.createElement("q"); q.textContent = eingabe.text; erg.appendChild(q);
        erg.appendChild(document.createTextNode(" geschrieben."));
      }
    }
    document.getElementById("eingabe-los").textContent = gilt ? "Weiter" : "Prüfen";
    document.getElementById("btn-gewusst").classList.toggle("vorschlag", !!(gilt && eingabe.text && eingabe.ok));
    document.getElementById("btn-nochmal").classList.toggle("vorschlag", !!(gilt && eingabe.text && !eingabe.ok));
    feld.readOnly = !!gilt;
  }
  function eingabePruefen(text) {
    if (!aktuell) return;
    var loesung = seiten(aktuell)[1], t = String(text || "").trim();
    var l = duLoesungen(loesung), treffer = t ? duPasst(t, l, 1) : { ok: false };
    var n = duNorm(t), nk = n.replace(DU_WEG_EN, "").replace(DU_WEG_DE, "");
    eingabe = { karte: aktuell, text: t, ok: !!treffer.ok, genau: !!t && (l.indexOf(n) > -1 || l.indexOf(nk) > -1) };
    aufgedeckt = true;
    // genau richtig geschrieben: gleich zur nächsten Karte (wie „Gewusst“); bei kleinen Tippfehlern bleibt das Ergebnis sichtbar
    if (eingabe.ok && eingabe.genau) { bewerten(true); return; }
    zeichneUeben();
  }
  // Steht schon während des Tippens die genaue Lösung da, geht es nach einem kurzen Moment von selbst weiter
  // (die kurze Pause lässt Zeit, ein längeres Wort fertig zu schreiben, das mit demselben Anfang ebenfalls gilt)
  (function () {
    var uhr = null, feld = document.getElementById("eingabe-feld");
    feld.addEventListener("input", function () {
      clearTimeout(uhr);
      var karte = aktuell, wert = feld.value, t = wert.trim();
      if (!karte || aufgedeckt || !t || eingabeModus !== "tippen") return;
      var l = duLoesungen(seiten(karte)[1]), n = duNorm(t), nk = n.replace(DU_WEG_EN, "").replace(DU_WEG_DE, "");
      if (l.indexOf(n) < 0 && !(nk && l.indexOf(nk) > -1)) return;
      uhr = setTimeout(function () {
        if (aktuell === karte && !aufgedeckt && feld.value === wert) {
          eingabePruefen(wert);
          if (eingabeModus === "tippen" && aktuell && !aufgedeckt) feld.focus();
        }
      }, 450);
    });
  })();
  document.getElementById("eingabe").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!aktuell) return;
    if (aufgedeckt && eingabe && eingabe.karte === aktuell) {
      bewerten(eingabe.text ? eingabe.ok : false);   // „Weiter“ / Enter übernimmt den Vorschlag
    } else {
      eingabePruefen(document.getElementById("eingabe-feld").value);
    }
    if (eingabeModus === "tippen" && aktuell && !aufgedeckt) document.getElementById("eingabe-feld").focus();
  });
  /* Beim Schreiben ist das halbe Handy von der Tastatur verdeckt: solange das Feld offen ist, rücken Auswahl, Fächer, Reiter und
     untere Leiste weg (CSS: html.tippt), damit die Vokabel über dem Feld sichtbar bleibt. */
  (function () {
    var wurzel = document.documentElement;
    function nachOben() {
      var m = document.querySelector("main");
      if (m && wurzel.classList.contains("tippt")) m.scrollTop = 0;
    }
    document.addEventListener("focusin", function (e) {
      if (e.target.id !== "eingabe-feld") return;
      wurzel.classList.add("tippt");
      requestAnimationFrame(nachOben);
      setTimeout(nachOben, 350);   // die Tastatur fährt erst danach ganz hoch
    });
    document.addEventListener("focusout", function (e) {
      if (e.target.id !== "eingabe-feld") return;
      setTimeout(function () {   // ein Tipp auf „Prüfen“ nimmt kurz den Fokus: dann bleibt es kompakt
        var a = document.activeElement;
        if (a && a.closest && a.closest("#eingabe")) return;
        wurzel.classList.remove("tippt");
      }, 150);
    });
  })();

  /* ---------- Wischen: rechts = gewusst, links = nochmal (erst nach dem Aufdecken) ---------- */
  var wischen = true, wischGerade = false;
  function setzeWischen(an) {
    wischen = an !== false;
    daten.wischen = wischen;
    Array.prototype.forEach.call(document.querySelectorAll("#wischwahl button"), function (b) {
      b.setAttribute("aria-pressed", (b.dataset.wischen === "an") === wischen ? "true" : "false");
    });
    document.getElementById("trainer").classList.toggle("wischbar", wischen);
  }
  Array.prototype.forEach.call(document.querySelectorAll("#wischwahl button"), function (b) {
    b.addEventListener("click", function () {
      setzeWischen(b.dataset.wischen === "an");
      sichern();
      zeichneUeben();
    });
  });
  (function () {
    var karte = document.getElementById("karte");
    var stG = document.getElementById("st-gewusst"), stN = document.getElementById("st-nochmal");
    var start = null, dx = 0, zieht = false, SCHWELLE = 90;
    function stempel(x) {
      stG.style.opacity = x > 0 ? Math.min(1, x / SCHWELLE) : 0;
      stN.style.opacity = x < 0 ? Math.min(1, -x / SCHWELLE) : 0;
    }
    function lage(x) {
      karte.style.transform = x ? "translateX(" + x + "px) rotate(" + (x / 18).toFixed(2) + "deg)" : "";
      stempel(x);
    }
    karte.addEventListener("pointerdown", function (e) {
      if (!wischen || !aktuell || !aufgedeckt || (e.pointerType === "mouse" && e.button !== 0)) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dx = 0; zieht = false;
    });
    karte.addEventListener("pointermove", function (e) {
      if (!start || e.pointerId !== start.id) return;
      var x = e.clientX - start.x, y = e.clientY - start.y;
      if (!zieht) {
        if (Math.abs(x) < 10) return;
        if (Math.abs(y) > Math.abs(x)) { start = null; return; }   // senkrecht: der Nutzer scrollt
        zieht = true;
        karte.classList.remove("zurueck", "rein");
        karte.classList.add("zieht");
        try { karte.setPointerCapture(e.pointerId); } catch (err) {}
      }
      dx = x;
      lage(dx);
    });
    function los(e) {
      if (!start || (e && e.pointerId !== start.id)) return;
      start = null;
      if (!zieht) return;
      zieht = false;
      wischGerade = true;
      setTimeout(function () { wischGerade = false; }, 350);
      karte.classList.remove("zieht");
      if (Math.abs(dx) >= SCHWELLE && e && e.type === "pointerup") {
        var gewusst = dx > 0, weit = (window.innerWidth || 400) * 1.1, gewischt = aktuell;
        karte.classList.add("fliegt");
        karte.style.transform = "translateX(" + (gewusst ? weit : -weit) + "px) rotate(" + (gewusst ? 18 : -18) + "deg)";
        karte.style.opacity = "0";
        setTimeout(function () {
          karte.classList.remove("fliegt");
          karte.style.opacity = "";
          lage(0);
          // schon per Knopf bewertet, während sie flog? Dann nicht noch einmal (sonst träfe es die nächste Karte)
          if (aktuell === gewischt) bewerten(gewusst);
          wischGerade = false;   // die nächste Karte ist da - ein Tipp zum Aufdecken zählt sofort
          karte.classList.add("rein");
          setTimeout(function () { karte.classList.remove("rein"); }, 260);
        }, 220);
      } else {
        karte.classList.add("zurueck");
        lage(0);
        setTimeout(function () { karte.classList.remove("zurueck"); }, 260);
      }
    }
    karte.addEventListener("pointerup", los);
    karte.addEventListener("pointercancel", los);
  })();
  document.getElementById("btn-nochmal").addEventListener("click", function (e) {
    e.stopPropagation(); bewerten(false);
  });
  document.getElementById("btn-gewusst").addEventListener("click", function (e) {
    e.stopPropagation(); bewerten(true);
  });
  // nur bei 4 Knöpfen sichtbar; Gewusst steht dann für „Gut“
  document.getElementById("btn-schwer").addEventListener("click", function (e) {
    e.stopPropagation(); bewerten(BEWERTUNG.SCHWER);
  });
  document.getElementById("btn-leicht").addEventListener("click", function (e) {
    e.stopPropagation(); bewerten(BEWERTUNG.LEICHT);
  });

  /* ---------- Schnell anlegen (Startseite) ----------
     English zuerst (so begegnet einem das Wort), Deutsch dazu, Enter: die Karte liegt sofort in Fach 1.
     Gibt es das Wort schon, wird die vorhandene Karte in den Kasten gelegt statt einer doppelten.
     Beispielsatz-Vorschlag: zuerst aus den eigenen Sätzen der App (offline), sonst - nur auf Tipp - aus dem
     freien Wörterbuch Wiktionary. Übersetzung: automatisch nach dem Eintippen (Wiktionary, sonst MyMemory).
     Dabei geht jeweils nur das englische Wort übers Netz, siehe Datenschutz. */
  var sn = { vorschlaege: [], nr: 0, fuer: "" };
  // Handy-Art für Kamera-Wege: iPhone erkennt Text selbst (Live Text, „Text scannen“), Android über Google Lens
  var GERAET_UA = navigator.userAgent || "";
  var IST_IOS = /iPhone|iPad|iPod/.test(GERAET_UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var IST_ANDROID = /Android/i.test(GERAET_UA);
  function snEl(x) { return document.getElementById("sn-" + x); }
  function snNorm(t) { return String(t || "").toLowerCase().replace(/^to\s+/, "").replace(/\s+/g, " ").trim(); }
  function snVorhanden(en) {
    var n = snNorm(en);
    if (!n) return null;
    for (var i = 0; i < daten.cards.length; i++) {
      var c = daten.cards[i];
      if (WISSEN) { if (snNorm(c.front) === n) return c; continue; }
      if (String(c.back).split(/\s*[\/;]\s*/).some(function (v) { return snNorm(v) === n; })) return c;
    }
    return null;
  }
  function snKatRaten(en) {
    var t = String(en || "").trim().toLowerCase(), i;
    if (/^to\s/.test(t)) i = KATS.indexOf("Verben");
    else if (t.split(/\s+/).length > 3) i = KATS.indexOf("Ganze Sätze");
    else if (t.split(/\s+/).length > 1) i = KATS.indexOf("Wendungen");
    else if (/ly$/.test(t)) i = KATS.indexOf("Adjektive & Adverbien");
    else i = KATS.indexOf("Sonstiges");
    return i > -1 ? i : KATS.length - 1;
  }
  function snInfo(text, fett) {
    var el = snEl("info");
    el.textContent = "";
    el.hidden = !text && !fett;
    if (fett) { var b = document.createElement("b"); b.textContent = fett; el.appendChild(b); el.appendChild(document.createTextNode(" ")); }
    if (text) el.appendChild(document.createTextNode(text));
  }
  function snPruefen() {
    var en = snEl("en").value.trim();
    snEl("mehr").hidden = !en;
    if (!en) { snInfo(""); return; }
    var c = snVorhanden(en);
    if (c) {
      snInfo(c.aktiv ? "liegt schon im Kasten (Fach " + fachVon(c) + ")." : "steht schon in der Liste – + legt die Karte in den Kasten.",
             WISSEN ? "„" + c.front + "“ = „" + c.back + "“" : "„" + c.back + "“ = „" + c.front + "“");
      if (!snEl("de").value) snEl("de").placeholder = c.front;
    } else {
      snEl("de").placeholder = WISSEN ? "Bedeutung" : "Deutsch";
      snInfo("");
    }
    if (sn.fuer !== snNorm(en)) { sn.vorschlaege = []; sn.nr = 0; sn.fuer = ""; }
    snEl("kat").value = String(WISSEN ? (/^[A-ZÄÖÜ0-9]{2,6}$/.test(en) ? 1 : 0) : snKatRaten(en));
  }
  function snLeeren() {
    snEl("en").value = ""; snEl("de").value = ""; snEl("bsp").value = "";
    sn.vorschlaege = []; sn.nr = 0; sn.fuer = ""; sn.ueb = ""; sn.bild = null;
    snEl("foto").textContent = "📷";
    snEl("de").placeholder = WISSEN ? "Bedeutung" : "Deutsch";
    snEl("mehr").hidden = true;
  }
  // Sätze aus der App, in denen das Wort vorkommt (auch mit Endung: decide -> decided)
  function snLokaleSaetze(en) {
    var w = snNorm(en).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!w) return [];
    var stamm = w.indexOf(" ") < 0 && w.length > 4 ? w.replace(/(e|y)$/, "") : w;
    var re = new RegExp("\\b" + stamm.replace(/ /g, "\\s+") + (w.indexOf(" ") < 0 ? "\\w*" : ""), "i");
    var out = [];
    daten.cards.forEach(function (c) { if (c.bsp && re.test(c.bsp) && out.indexOf(c.bsp) < 0) out.push(c.bsp); });
    return out.slice(0, 5);
  }
  // Wiktionary (freies Wörterbuch, erlaubt Abfragen direkt aus dem Browser): Beispielsätze zu den Bedeutungen
  function snOnline(en) {
    var wort = snNorm(en);
    if (!wort || !window.fetch || navigator.onLine === false) return Promise.resolve([]);
    var url = "https://en.wiktionary.org/api/rest_v1/page/definition/" + encodeURIComponent(wort.replace(/ /g, "_"));
    var stopp = new Promise(function (ok) { setTimeout(function () { ok([]); }, 8000); });   // nicht ewig warten
    var holen = fetch(url, { headers: { "Api-User-Agent": "Vokabelkasten (persönliche Lern-App)" } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) {
        var out = [], leser = new DOMParser();   // DOMParser: fremdes HTML nur lesen, nichts davon wird ausgeführt
        (j && j.en || []).forEach(function (e) {
          (e.definitions || []).forEach(function (d) {
            (d.examples || []).forEach(function (x) {
              var t = (leser.parseFromString(String(x), "text/html").body.textContent || "").replace(/\s+/g, " ").trim();
              var n = t.split(" ").length;
              if (n < 4 || n > 22 || out.indexOf(t) > -1) return;   // zu kurze Bruchstücke und lange Zitate weglassen
              out.push(t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : "."));
            });
          });
        });
        return out.sort(function (a, b) { return Math.abs(a.split(" ").length - 9) - Math.abs(b.split(" ").length - 9); }).slice(0, 6);
      })
      .catch(function () { return []; });
    return Promise.race([holen, stopp]);
  }
  /* Automatisch übersetzen: zuerst das deutsche Wiktionary (echte Wörterbucheinträge, mehrere Bedeutungen),
     sonst MyMemory (freier Übersetzungsdienst). Übers Netz geht nur das englische Wort. Das Ergebnis ist ein
     Vorschlag im Feld „Deutsch“ - markiert, damit man es mit dem ersten Tastendruck überschreiben kann. */
  function snWiktDe(text) {
    var i = text.search(/==[^=\n]*\(\{\{Sprache\|Englisch\}\}\)[^=\n]*==/);
    if (i < 0) return [];
    var rest = text.slice(i + 2), j = rest.search(/\n==[^=\n]*\(\{\{Sprache\|/);
    var teil = j > -1 ? rest.slice(0, j) : rest, out = [];
    teil.split("{{Bedeutungen}}").slice(1).forEach(function (block) {
      block.split("\n").slice(1).some(function (zeile) {
        if (!/^:/.test(zeile)) return zeile.trim() !== "";   // Block endet an der ersten Nicht-Bedeutungszeile
        var body = zeile.replace(/^:\s*\[[^\]]*\]\s*/, "").replace(/\{\{[^{}]*\}\}/g, "").replace(/<[^>]+>/g, "");
        var dp = body.lastIndexOf(":");
        if (dp > -1 && /\[\[/.test(body.slice(dp))) body = body.slice(dp + 1);   // „Erklärung: [[Wort]], [[Wort]]“
        var m, re = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, links = [];
        while ((m = re.exec(body))) links.push((m[2] || m[1]).trim());
        if (!links.length && body.trim().split(/\s+/).length <= 4) links = [body.replace(/[;.,]+$/, "").trim()];
        links.forEach(function (w) { if (w && out.indexOf(w) < 0) out.push(w); });
        return false;
      });
    });
    return out.slice(0, 4);
  }
  // Wissenskasten: erster Satz aus der deutschen Wikipedia als Vorschlag für die Bedeutung
  function snWikipedia(begriff) {
    var t = String(begriff || "").trim();
    if (!t || !window.fetch || navigator.onLine === false) return Promise.resolve(null);
    var stopp = new Promise(function (ok) { setTimeout(function () { ok(null); }, 8000); });
    var holen = fetch("https://de.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t.replace(/ /g, "_")),
                      { headers: { "Api-User-Agent": "Vokabelkasten (persönliche Lern-App)" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.type === "disambiguation" || !j.extract) return null;
        var satz = String(j.extract).replace(/\s+/g, " ").trim();
        var ende = satz.search(/[.!?](\s|$)/);   // nur der erste Satz
        if (ende > 20) satz = satz.slice(0, ende + 1);
        if (satz.length > 220) satz = satz.slice(0, 217).replace(/\s+\S*$/, "") + " …";
        return { text: satz, quelle: "Wikipedia" };
      })
      .catch(function () { return null; });
    return Promise.race([holen, stopp]);
  }
  function snUebersetzen(en) {
    if (WISSEN) return snWikipedia(en);
    var wort = snNorm(en);
    if (!wort || !window.fetch || navigator.onLine === false) return Promise.resolve(null);
    function wikt(titel) {
      return fetch("https://de.wiktionary.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&origin=*&page=" + encodeURIComponent(titel),
                   { headers: { "Api-User-Agent": "Vokabelkasten (persönliche Lern-App)" } })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (j) { return j && j.parse && j.parse.wikitext ? snWiktDe(j.parse.wikitext) : []; })
        .catch(function () { return []; });
    }
    function mymemory() {
      return fetch("https://api.mymemory.translated.net/get?langpair=en%7Cde&q=" + encodeURIComponent(wort))
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (j) {
          var kand = [(j.responseData || {}).translatedText].concat((j.matches || []).map(function (m) { return m.translation; }));
          var out = [], klein = [];
          kand.forEach(function (x) {
            x = String(x || "").replace(/[\s.!?:;]+$/, "").trim();
            if (!x || x.toLowerCase() === wort || /[<>{}]|MYMEMORY|QUERY LENGTH/i.test(x) || x.length > 60) return;
            if (klein.indexOf(x.toLowerCase()) > -1) return;
            klein.push(x.toLowerCase()); out.push(x);
          });
          // erster Treffer; ein zweiter nur, wenn er kurz ist („abheben, Start“ ja, „Freuen Sie sich auf“ nein)
          return out.slice(0, 1).concat(out.slice(1, 2).filter(function (x) { return x.split(" ").length <= 2; }));
        })
        .catch(function () { return []; });
    }
    var stopp = new Promise(function (ok) { setTimeout(function () { ok(null); }, 9000); });
    var holen = wikt(wort).then(function (a) {
      return a.length ? a : (wort !== en.trim() && en.trim().indexOf(" ") < 0 ? wikt(en.trim()) : []);
    }).then(function (a) {
      if (a.length) return { text: a.join(", "), quelle: "Wiktionary" };
      return mymemory().then(function (b) {
        if (!b.length) return null;
        // englisches Verb („to give up“): deutsches Verb klein („aufgeben“ statt „Aufgeben“)
        if (/^to\s/i.test(en.trim())) b = b.map(function (x) { return x.charAt(0).toLowerCase() + x.slice(1); });
        return { text: b.join(", "), quelle: "MyMemory" };
      });
    });
    return Promise.race([holen, stopp]);
  }
  function snAutoUebersetzen() {
    var en = snEl("en").value.trim(), de = snEl("de");
    if (!en || de.value.trim() || snVorhanden(en) || sn.ueb === snNorm(en)) return;
    sn.ueb = snNorm(en);
    var fuer = sn.ueb;
    de.placeholder = WISSEN ? "Suche Erklärung …" : "Übersetze …";
    snUebersetzen(en).then(function (r) {
      if (snNorm(snEl("en").value) !== fuer) return;   // inzwischen ein anderes Wort
      de.placeholder = WISSEN ? "Bedeutung" : "Deutsch";
      if (!r) {
        if (navigator.onLine !== false) snInfo(WISSEN ? "Keine Erklärung gefunden – schreib die Bedeutung einfach selbst." : "Keine Übersetzung gefunden – schreib sie einfach selbst.");
        return;
      }
      if (de.value.trim()) return;   // schon selbst geschrieben
      de.value = r.text;
      if (document.activeElement === de) de.select();
      snInfo("Vorschlag von " + r.quelle + " – passt? Dann Enter. Sonst einfach überschreiben.");
    });
  }
  function snZeigeVorschlag() {
    if (!sn.vorschlaege.length) return false;
    snEl("bsp").value = sn.vorschlaege[sn.nr % sn.vorschlaege.length];
    snEl("vorschlag").textContent = sn.vorschlaege.length > 1 ? "↻ " + (sn.nr % sn.vorschlaege.length + 1) + "/" + sn.vorschlaege.length : "Vorschlag";
    sn.nr++;
    return true;
  }
  snEl("vorschlag").addEventListener("click", function () {
    var en = snEl("en").value.trim();
    if (!en) { snEl("en").focus(); return; }
    if (sn.fuer === snNorm(en)) { snZeigeVorschlag(); return; }
    sn.fuer = snNorm(en); sn.nr = 0;
    sn.vorschlaege = snLokaleSaetze(en);
    if (snZeigeVorschlag()) return;
    var knopf = snEl("vorschlag");
    knopf.disabled = true; knopf.textContent = "Suche …";
    var fuer = sn.fuer;
    snOnline(en).then(function (liste) {
      knopf.disabled = false; knopf.textContent = "Vorschlag";
      if (sn.fuer !== fuer || snNorm(snEl("en").value) !== fuer) return;   // inzwischen ein anderes Wort
      sn.vorschlaege = liste;
      if (!snZeigeVorschlag()) snInfo(navigator.onLine === false ? "Ohne Internet gibt es nur Sätze aus der App – für dieses Wort keiner." : "Kein Beispielsatz gefunden – du kannst selbst einen schreiben.");
    });
  });
  snEl("en").addEventListener("input", snPruefen);
  snEl("en").addEventListener("change", snAutoUebersetzen);   // beim Verlassen des Feldes / Enter
  snEl("weg").addEventListener("click", function () { snLeeren(); snInfo(""); });
  snEl("foto").addEventListener("click", function () {
    bildWaehlen(function (blob) { sn.bild = blob; snEl("foto").textContent = "📷 ✓"; snInfo("Foto kommt auf die Rückseite."); });
  });
  /* Wort mit der Kamera erfassen. iPhone: die Tastatur kann das selbst („Text scannen“) - Feld öffnen und kurz erklären.
     Android: Foto aufnehmen und über „Teilen“ an Google Lens geben; dort Wort antippen → Teilen → Vokabelkasten,
     dann steht es hier im Feld (siehe „Geteilt aus einer anderen App“ unten) samt Übersetzungsvorschlag.
     Das Foto bleibt nur, solange das kleine Feld offen ist. Am Computer gibt es den Knopf nicht. */
  (function () {
    var knopf = snEl("scan"), eingabe = snEl("scan-datei"), feld = snEl("scan-feld"), bild = snEl("scan-bild"), teilen = snEl("scan-teilen");
    var foto = null, adresse = "";
    knopf.hidden = !(IST_IOS || IST_ANDROID);
    function zu() {
      feld.hidden = true;
      if (adresse) URL.revokeObjectURL(adresse);
      adresse = ""; foto = null; bild.removeAttribute("src");
    }
    knopf.addEventListener("click", function () {
      if (IST_IOS) {
        snEl("en").focus();
        snInfo("nochmal ins Feld tippen, „Text scannen“ wählen, die Kamera aufs Wort halten und „Einsetzen“ – " +
          (WISSEN ? "eine Erklärung sucht die App dann selbst." : "die Übersetzung schlägt die App dann vor."), "Wort scannen:");
        return;
      }
      eingabe.click();
    });
    eingabe.addEventListener("change", function () {
      var f = eingabe.files && eingabe.files[0];
      eingabe.value = "";
      if (!f) return;
      zu();
      foto = f; adresse = URL.createObjectURL(f); bild.src = adresse;
      var kannTeilen = false;
      try { kannTeilen = !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) {}
      teilen.hidden = !kannTeilen;
      snEl("scan-hinweis").innerHTML = kannTeilen
        ? "Im Teilen-Menü <b>Google Lens</b> wählen, das Wort antippen, dann <b>Teilen → Vokabelkasten</b>. Es landet hier mit " + (WISSEN ? "Erklärungsvorschlag." : "Übersetzungsvorschlag.")
        : "Dieser Browser kann das Foto nicht weitergeben. Öffne Google Lens direkt, markiere das Wort, <b>Kopieren</b> – und füge es oben ein.";
      feld.hidden = false;
    });
    teilen.addEventListener("click", function () {
      if (!foto) return;
      navigator.share({ files: [foto] }).then(zu).catch(function () {});   // abgebrochen: Feld bleibt offen
    });
    snEl("scan-zu").addEventListener("click", zu);
  })();
  // Ein ganzes Wort auf einmal (gescannt, eingefügt, aus der Vorschlagsleiste): gleich übersetzen, nicht erst beim Verlassen des Feldes
  snEl("en").addEventListener("input", function (e) {
    if (e.inputType === "insertFromPaste" || e.inputType === "insertReplacementText" || (e.data && e.data.length > 1)) {
      clearTimeout(sn.uhr);
      sn.uhr = setTimeout(snAutoUebersetzen, 300);
    }
  });
  snEl("de").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); document.getElementById("schnell").requestSubmit(); } });
  snEl("bsp").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); document.getElementById("schnell").requestSubmit(); } });
  document.getElementById("schnell").addEventListener("submit", function (e) {
    e.preventDefault();
    var en = snEl("en").value.trim(), de = snEl("de").value.trim(), bsp = snEl("bsp").value.trim();
    if (!en) { snEl("en").focus(); return; }
    var da = snVorhanden(en);
    if (da && !de) {   // vorhandene Karte in den Kasten legen
      if (!da.aktiv) { da.aktiv = true; da.box = 1; da.due = heute(); delete da.fsrs; }   // FSRS-Stand neu (Fach 1) in sichern()
      if (bsp && !da.bsp) da.bsp = bsp;
      sichern(); snLeeren(); zeichneKacheln();
      snInfo("ist jetzt im Kasten (Fach " + da.box + ").", "„" + (WISSEN ? da.front : da.back) + "“");
      snEl("en").focus();
      return;
    }
    if (!de) { snEl("de").focus(); snAutoUebersetzen(); return; }
    var neuK = {
      id: neueId(), front: WISSEN ? en : de, back: WISSEN ? de : en, bsp: bsp,   // Wissenskasten: erstes Feld = Begriff (vorne)
      kat: Number(snEl("kat").value) || 0,
      ord: naechsteOrd(), aktiv: true, merk: false, box: 1, due: heute(), created: Date.now()
    };
    daten.cards.push(neuK);
    if (sn.bild) { neuK.bild = true; bildSetzen(neuK.id, sn.bild); }
    sichern(); snLeeren(); zeichneKacheln();
    function kurz(x) { return x.length > 60 ? x.slice(0, 57).replace(/\s+\S*$/, "") + " …" : x; }
    snInfo("liegt im Kasten (Fach 1) und kommt heute noch dran.", "„" + en + "“ = „" + kurz(de) + "“");
    snEl("en").focus();
  });
  // Geteilt aus einer anderen App (Android: Text markieren → Teilen → Vokabelkasten): ein Wort wird vorausgefüllt,
  // mehrere Zeilen (z. B. eine Liste aus Google Lens) landen unter „Ganze Liste einfügen“ mit Vorschau
  (function () {
    try {
      var q = new URLSearchParams(location.search), t = q.get("text") || q.get("title") || "";
      if (!t) return;
      var zeilen = t.split(/\r?\n/).filter(function (z) { return z.trim(); });
      if (zeilen.length > 1) {
        history.replaceState(null, "", location.pathname);
        setTimeout(function () {
          wechsle("neu");
          neuTab("liste");
          var ta = document.getElementById("einfuegen");
          ta.value = zeilen.join("\n");
          zeichneVorschau();
          ta.scrollIntoView({ block: "center" });
        }, 0);
        return;
      }
      t = t.split(/\r?\n/)[0].replace(/https?:\/\/\S+/g, "").replace(/^["'“„‚‘\s]+|["'”“‘’\s.,;:!?]+$/g, "").trim().slice(0, 80);
      history.replaceState(null, "", location.pathname);
      if (!t) return;
      setTimeout(function () {
        wechsle("start");
        snEl("en").value = t;
        snPruefen();
        snEl("de").focus();
        snAutoUebersetzen();
      }, 0);
    } catch (e) {}
  })();

  /* Seite „Neu“: entweder eine Karte einzeln anlegen oder eine ganze Liste einlesen */
  function neuTab(name) {
    var liste = name === "liste";
    document.getElementById("neu-einzeln").hidden = liste;
    document.getElementById("neu-liste").hidden = !liste;
    Array.prototype.forEach.call(document.querySelectorAll("#neu-wahl button"), function (b) {
      b.setAttribute("aria-pressed", (b.dataset.neu === "liste") === liste ? "true" : "false");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#neu-wahl button"), function (b) {
    b.addEventListener("click", function () { neuTab(b.dataset.neu); });
  });

  document.getElementById("btn-add").addEventListener("click", function () {
    var vf = document.getElementById("in-vorne");
    var vb = document.getElementById("in-hinten");
    var vs = document.getElementById("in-bsp");
    var front = vf.value.trim(), back = vb.value.trim();
    if (!front || !back) { (front ? vb : vf).focus(); return; }
    daten.cards.push({
      id: neueId(), front: front, back: back, bsp: vs.value.trim(),
      kat: Number(document.getElementById("neu-kat").value) || 0,
      ord: naechsteOrd(), aktiv: true, merk: false, box: 1, due: heute(), created: Date.now()
    });
    sichern();
    vf.value = ""; vb.value = ""; vs.value = ""; vf.focus();
    var ok = document.getElementById("add-ok");
    ok.hidden = false;
    ok.textContent = "\u201e" + front + "\u201c gespeichert, Platz " + daten.cards.length + " in der Liste.";
  });
  document.getElementById("in-bsp").addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("btn-add").click();
  });
  document.getElementById("suche").addEventListener("input", zeichneListe);
  document.getElementById("einfuegen").addEventListener("input", zeichneVorschau);
  document.getElementById("imp-tausch").addEventListener("change", zeichneVorschau);

  /* Liste abfotografieren: Kamera auf, Foto groß zeigen, kurze Anleitung. Den Text erkennt das Handy selbst
     (Android: Google Lens über „Teilen“, iPhone: Live Text - lange auf den Text im Foto drücken).
     Das Foto bleibt nur im Speicher, solange das Feld offen ist; die App sendet es nirgendwohin. */
  (function () {
    var eingabe = document.getElementById("foto-datei"), feld = document.getElementById("foto-hilfe");
    var bild = document.getElementById("foto-bild"), teilen = document.getElementById("btn-foto-teilen");
    var foto = null, adresse = "", ios = IST_IOS, android = IST_ANDROID;
    function schritte(kannTeilen) {
      var s = android && kannTeilen ? [
        "„An Google Lens übergeben“ tippen und im Teilen-Menü <b>Google Lens</b> wählen.",
        "In Lens die Zeilen markieren, dann <b>Teilen → Vokabelkasten</b> – oder <b>Kopieren</b> und hier „Aus Zwischenablage“.",
        "Unten die Vorschau prüfen, bei Bedarf „Spalten tauschen“, dann <b>Einlesen</b>."
      ] : ios ? [
        "Lange auf den Text im Foto drücken, dann <b>Alles auswählen → Kopieren</b>." +
          (kannTeilen ? " Klappt das nicht: „Foto teilen …“ → <b>Bild sichern</b> und den Text in der Fotos-App kopieren." : ""),
        "„Aus Zwischenablage“ tippen.",
        "Unten die Vorschau prüfen, bei Bedarf „Spalten tauschen“, dann <b>Einlesen</b>."
      ] : [
        "Den Text im Foto markieren und kopieren, z. B. mit Google Lens.",
        "„Aus Zwischenablage“ tippen.",
        "Unten die Vorschau prüfen, bei Bedarf „Spalten tauschen“, dann <b>Einlesen</b>."
      ];
      document.getElementById("foto-schritte").innerHTML = s.map(function (x) { return "<li>" + x + "</li>"; }).join("");
    }
    function zu() {
      feld.hidden = true;
      if (adresse) URL.revokeObjectURL(adresse);
      adresse = ""; foto = null; bild.removeAttribute("src");
    }
    document.getElementById("btn-foto").addEventListener("click", function () { eingabe.click(); });
    eingabe.addEventListener("change", function () {
      var f = eingabe.files && eingabe.files[0];
      eingabe.value = "";
      if (!f) return;
      zu();
      foto = f; adresse = URL.createObjectURL(f); bild.src = adresse;
      // Übergeben geht nur, wo der Browser Dateien teilen kann (Android Chrome, iPhone Safari)
      var kannTeilen = false;
      try { kannTeilen = !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) {}
      schritte(kannTeilen);
      teilen.hidden = !kannTeilen;
      teilen.textContent = android ? "An Google Lens übergeben" : "Foto teilen …";
      feld.hidden = false;
      feld.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    teilen.addEventListener("click", function () {
      if (!foto) return;
      navigator.share({ files: [foto] }).catch(function () {});   // abgebrochen: nichts zu tun
    });
    document.getElementById("btn-foto-clip").addEventListener("click", function () { document.getElementById("btn-clip").click(); });
    document.getElementById("btn-foto-zu").addEventListener("click", zu);
  })();

  /* Ablage: Datei hineinziehen, wählen oder Text aus der Zwischenablage holen.
     CSV (Excel speichert mit ; oder ,) wird in Tab-getrennte Zeilen umgewandelt; eine Sicherungsdatei (.json)
     wird wie „Sicherung einlesen“ behandelt. Excel-Dateien selbst (.xlsx) kann der Browser nicht lesen. */
  function csvZeilen(text) {
    var zeilen = String(text).replace(/^﻿/, "").replace(/\r/g, "").split("\n");
    var kopf = zeilen[0] || "";
    if (kopf.indexOf("\t") > -1 || kopf.indexOf("|") > -1) return zeilen.join("\n");   // schon passend
    var trenner = (kopf.split(";").length >= kopf.split(",").length) ? ";" : ",";
    return zeilen.map(function (z) {
      var teile = [], feld = "", inQ = false;
      for (var i = 0; i < z.length; i++) {
        var ch = z[i];
        if (inQ) {
          if (ch === '"' && z[i + 1] === '"') { feld += '"'; i++; }
          else if (ch === '"') inQ = false;
          else feld += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === trenner) { teile.push(feld); feld = ""; }
        else feld += ch;
      }
      teile.push(feld);
      return teile.map(function (t) { return t.trim(); }).join("\t");
    }).join("\n");
  }
  function ablageText(text, name) {
    var ta = document.getElementById("einfuegen");
    if (/\.json$/i.test(name || "") || /^\s*\{/.test(text)) {
      var p = null;
      try { p = JSON.parse(text); } catch (e) {}
      if (p && Array.isArray(p.cards)) { dateiEinlesen(p); return; }
    }
    if (/\.xlsx?$/i.test(name || "")) { melde("Excel-Dateien kann der Browser nicht lesen. In Excel „Speichern unter → CSV“ wählen oder die Zellen kopieren und hier einfügen."); return; }
    var neu = /\.csv$/i.test(name || "") ? csvZeilen(text) : String(text).replace(/\r/g, "");
    ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, "\n") : "") + neu.trim();
    zeichneVorschau();
  }
  function ablageDatei(f) {
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { ablageText(String(r.result), f.name); };
    r.readAsText(f);
  }
  (function () {
    var ablage = document.getElementById("ablage"), datei = document.getElementById("liste-datei");
    document.getElementById("btn-datei").addEventListener("click", function () { datei.click(); });
    datei.addEventListener("change", function () { ablageDatei(datei.files && datei.files[0]); datei.value = ""; });
    document.getElementById("btn-clip").addEventListener("click", function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        document.getElementById("einfuegen").focus();
        melde("Der Browser erlaubt das Auslesen nicht. Tippe lang ins Feld und wähle „Einfügen“.");
        return;
      }
      navigator.clipboard.readText().then(function (t) {
        if (t && t.trim()) ablageText(t);
        else melde("Die Zwischenablage ist leer.");
      }).catch(function () {
        document.getElementById("einfuegen").focus();
        melde("Kein Zugriff auf die Zwischenablage. Tippe lang ins Feld und wähle „Einfügen“.");
      });
    });
    [ablage, document.getElementById("einfuegen")].forEach(function (el) {
      el.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") > -1) { e.preventDefault(); ablage.classList.add("drueber"); } });
      el.addEventListener("dragleave", function () { ablage.classList.remove("drueber"); });
      el.addEventListener("drop", function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        ablage.classList.remove("drueber");
        if (!f) return;   // Text aus einem anderen Fenster fügt der Browser selbst ins Feld ein
        e.preventDefault();
        ablageDatei(f);
      });
    });
  })();

  // Info-Symbol bei „Ganze Liste einfügen“: Anleitung zum Format auf- und zuklappen
  document.getElementById("imp-info-knopf").addEventListener("click", function () {
    var panel = document.getElementById("imp-info"), auf = panel.hidden;
    panel.hidden = !auf;
    this.setAttribute("aria-expanded", auf ? "true" : "false");
  });
  document.getElementById("btn-import-text").addEventListener("click", function () {
    var feld = document.getElementById("einfuegen");
    var r = zerlege(feld.value, document.getElementById("imp-tausch").checked);
    var kat = Number(document.getElementById("imp-kat").value) || 0;
    var rein = document.getElementById("imp-aktiv").checked;
    var vorhanden = {};
    daten.cards.forEach(function (c) { vorhanden[c.front.toLowerCase() + "\u0000" + c.back.toLowerCase()] = true; });
    var neu = 0, uebersprungen = 0;
    r.karten.forEach(function (k) {
      var s = k.de.toLowerCase() + "\u0000" + k.en.toLowerCase();
      if (vorhanden[s]) { uebersprungen++; return; }
      vorhanden[s] = true;
      daten.cards.push({
        id: neueId(), front: k.de, back: k.en, bsp: k.bsp, kat: kat,
        ord: naechsteOrd(), aktiv: rein, merk: false,
        box: 1, due: heute(), created: Date.now() + neu
      });
      neu++;
    });
    sichern();
    feld.value = "";
    zeichneVorschau();
    zeichneListe();
    var fertigText = (neu + (WISSEN ? (neu === 1 ? " Begriff angelegt" : " Begriffe angelegt") : (neu === 1 ? " Vokabel angelegt" : " Vokabeln angelegt")) +
      (uebersprungen ? ", " + uebersprungen + " doppelte übersprungen" : "") +
      (rein ? " und in den Kasten gelegt." : ". Sie warten in der Liste auf dein Häkchen."));
    meldeOk(fertigText);
    var v = document.getElementById("vorschau");   // auch direkt unter dem Feld, dort schaut man gerade hin
    v.textContent = "✓ " + fertigText;
    v.classList.add("fertig");
  });

  document.getElementById("btn-installieren").addEventListener("click", function () {
    if (!installAngebot) return;
    installAngebot.prompt();
    installAngebot.userChoice.then(function () {
      installAngebot = null;
      document.getElementById("installzeile").hidden = true;
    });
  });

  document.getElementById("btn-zurueck").addEventListener("click", schrittZurueck);
  document.getElementById("btn-weiter").addEventListener("click", schrittWeiter);

  /* ⋯ auf der Karte: seltene Aktionen, damit unter der Karte nur das Wichtige steht */
  document.getElementById("btn-mehr").addEventListener("click", function () {
    if (!aktuell) return;
    var k = aktuell, akt = [];
    akt.push({ text: "✎ Vokabel bearbeiten", tun: function () { karteBearbeitenBlatt(k); } });
    if (fachVon(k) > 1) akt.push({ text: "↓ Zurück in Fach " + (fachVon(k) - 1), tun: function () {
      if (!einFachRunter(k)) return;
      // Passt die Karte nicht mehr zur Auswahl, faellt sie aus der Runde.
      if (!imFilter(k)) { naechsteKarte(); return; }
      zeichneUeben();
    } });
    akt.push({ text: k.merk ? "★ Nicht mehr schwierig" : "☆ Als schwierig markieren", tun: function () {
      k.merk = !k.merk; sichern(); zeichneUeben();
    } });
    akt.push({ text: "Aus dem Kasten nehmen", leise: true, tun: function () {
      k.aktiv = false;
      runde = runde.filter(function (x) { return x.id !== k.id; });
      sichern();
      naechsteKarte();
    } });
    blattAuf(k.front, akt);
  });

  /* Bearbeiten direkt aus dem ⋯-Fenster: Text, Beispiel, Kategorie. Fach, Termine und Stern bleiben. */
  function karteBearbeitenBlatt(c) {
    blattTaste("Abbrechen");
    var knoepfe = document.getElementById("blatt-knoepfe");
    document.getElementById("blatt-titel").textContent = "Vokabel bearbeiten";
    knoepfe.textContent = "";
    var form = document.createElement("div");
    form.className = "blatt-form";
    function feld(text, wert) {
      var l = document.createElement("label");
      l.textContent = text;
      var i = document.createElement("input");
      i.type = "text"; i.value = wert || ""; i.autocomplete = "off";
      l.appendChild(i);
      form.appendChild(l);
      return i;
    }
    var eVorne = feld("Deutsch", c.front), eHinten = feld("English", c.back), eBsp = feld("Beispielsatz (optional)", c.bsp);
    var kl = document.createElement("label");
    kl.textContent = "Kategorie";
    var kat = document.createElement("select");
    KATS.forEach(function (k, i) {
      var o = document.createElement("option");
      o.value = String(i); o.textContent = k;
      kat.appendChild(o);
    });
    kat.value = String(c.kat);
    kl.appendChild(kat);
    form.appendChild(kl);
    var ok = document.createElement("button");
    ok.type = "button"; ok.className = "blatt-speichern";
    ok.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Speichern';
    form.appendChild(ok);
    knoepfe.appendChild(form);
    function speichern() {
      var vorne = eVorne.value.trim(), hinten = eHinten.value.trim();
      if (!vorne || !hinten) { (vorne ? eHinten : eVorne).focus(); return; }
      c.front = vorne; c.back = hinten; c.bsp = eBsp.value.trim(); c.kat = Number(kat.value) || 0;
      sichern();
      blattZu();
      // passt die Karte nicht mehr zur Auswahl, fällt sie aus der laufenden Runde
      if (!imFilter(c)) {
        runde = runde.filter(function (x) { return x.id !== c.id; });
        if (aktuell && aktuell.id === c.id) { naechsteKarte(); zeichneListe(); return; }
      }
      zeichneUeben();
      zeichneListe();
    }
    ok.addEventListener("click", speichern);
    [eVorne, eHinten, eBsp].forEach(function (i) {
      i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); speichern(); } });
    });
    document.getElementById("blatt").hidden = false;
    waechterAbgleichen();
  }

  /* ---------- Einblendfenster (⋯) ---------- */
  // Beschriftung der unteren Taste im Einblendfenster: „Abbrechen“ bei Auswahl und Rückfrage, „Schließen“ bei reinen Anzeigen
  function blattTaste(text) {
    var b = document.querySelector("#blatt .blatt-inhalt > button[data-blattzu]");
    if (b) b.textContent = text;
  }
  function blattAuf(titel, aktionen) {
    blattTaste("Abbrechen");
    var knoepfe = document.getElementById("blatt-knoepfe");
    document.getElementById("blatt-titel").textContent = titel;
    knoepfe.textContent = "";
    aktionen.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ghost blatt-knopf" + (a.leise ? " leise-rot" : "");
      b.textContent = a.text;
      b.addEventListener("click", function () { blattZu(); a.tun(); });
      knoepfe.appendChild(b);
    });
    document.getElementById("blatt").hidden = false;
    waechterAbgleichen();
    var erster = knoepfe.querySelector("button");
    if (erster) erster.focus();
  }
  function blattZu() {
    document.getElementById("blatt").hidden = true;
    waechterAbgleichen();
  }
  /* Rückfrage im eigenen Fenster statt confirm() - das wird in installierten Web-Apps teils gar nicht gezeigt
     (wie alert, siehe melde). gefaehrlich: roter Knopf. tun läuft erst nach dem Tipp auf den Knopf. */
  function frage(text, knopf, tun, gefaehrlich) {
    blattAuf(text, [{ text: knopf, leise: !!gefaehrlich, tun: tun }]);
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-blattzu]"), function (el) {
    el.addEventListener("click", blattZu);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !document.getElementById("blatt").hidden) blattZu();
  });

  /* ---------- Einführung (wie bei BLOC) ----------
     Fünf Seiten in der Farbe des Kastens. Beim ersten Start von selbst (ERSTER_START), sonst über die Einstellungen.
     Die Zahl der Start-Vokabeln zählt die App selbst. Gesehen: vokabelkasten.einfuehrung */
  var EINF_ICO = {
    kasten: '<rect x="3.5" y="6" width="13" height="14" rx="2"/><path d="M8 3.5h10.5a2 2 0 0 1 2 2V17"/>',
    antwort: '<path d="M4 5.5h16v10H9.5L5 19.5v-4H4z"/><path d="M8 10.5h8"/>',
    hoeren: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>',
    duell: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5.5h2.5v1.5a3 3 0 0 1-3 3M7 5.5H4.5v1.5a3 3 0 0 0 3 3M12 14v4M8.5 20.5h7"/>',
    neu: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 10h8M8 14h5"/>'
  };
  // Den Karteikasten kennt jeder - die Seiten zeigen, was dieser anders macht
  function einfSeiten() {
    var n = SEED.rows.filter(Boolean).length;
    return [
      { ico: EINF_ICO.kasten, titel: "Willkommen im Vokabelkasten",
        text: "Den Karteikasten kennst du – dieser kann mehr: selbst antworten, nebenbei lernen, im Duell spielen. Start mit " + n + " englischen Vokabeln oder deinen eigenen.",
        notiz: "Kein Konto, kein Tracking – alles bleibt auf deinem Handy." },
      { ico: EINF_ICO.antwort, titel: "Selbst antworten",
        text: "Schreib die Lösung oder sag sie laut – die App prüft mit und verzeiht Tippfehler. Umschalten direkt unter der Karte.",
        notiz: "Sprechen gibt es im Englisch-Kasten." },
      { ico: EINF_ICO.hoeren, titel: "Lernen nebenbei",
        text: "Die App liest dir deine Karten vor – beim Sport, Spazieren oder Autofahren.",
        notiz: "Das Handy bleibt in der Tasche." },
      { ico: EINF_ICO.duell, titel: "Quiz-Duell (Beta)",
        text: "Die App fragt, ihr antwortet per Stimme und sammelt Punkte – etwa zu zweit auf langer Fahrt.",
        notiz: "Testphase: Lärm und Musik können die Erkennung stören." },
      { ico: EINF_ICO.neu, titel: "Neue Wörter, eigene Kästen",
        text: "Eintippen, scannen oder ganze Listen fotografieren – die Übersetzung kommt von selbst. Mit „+“ legst du eigene Kästen an.",
        notiz: "Tipp: ab und zu unter Einstellungen → Sicherung sichern." }
    ];
  }
  var einfListe = [], einfNr = 0;
  function einfZeichnen() {
    var s = einfListe[einfNr], letzte = einfNr === einfListe.length - 1;
    var punkte = document.getElementById("einf-punkte");
    punkte.textContent = "";
    einfListe.forEach(function (x, i) { var p = document.createElement("i"); if (i === einfNr) p.className = "an"; punkte.appendChild(p); });
    document.getElementById("einf-ico").innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + s.ico + "</svg>";
    document.getElementById("einf-titel").textContent = s.titel;
    document.getElementById("einf-text").textContent = s.text;
    var notiz = document.getElementById("einf-notiz");
    notiz.hidden = !s.notiz;
    notiz.textContent = s.notiz || "";
    document.getElementById("einf-weg").hidden = letzte;
    document.getElementById("einf-zurueck").hidden = !einfNr;
    document.getElementById("einf-weiter").textContent = letzte ? "Los geht's" : "Weiter";
  }
  function einfBlaettern(d) {
    var n = einfNr + d;
    if (n < 0 || n >= einfListe.length) return;
    einfNr = n;
    einfZeichnen();
  }
  function einfuehrungAuf() {
    einfListe = einfSeiten(); einfNr = 0;
    einfZeichnen();
    document.getElementById("einf").hidden = false;
    waechterAbgleichen();
    document.getElementById("einf-weiter").focus();
  }
  function einfuehrungZu() {
    document.getElementById("einf").hidden = true;
    try { window.localStorage.setItem(EINF_KEY, "1"); } catch (e) {}
    waechterAbgleichen();
  }
  document.getElementById("einf-weiter").addEventListener("click", function () {
    if (einfNr === einfListe.length - 1) einfuehrungZu(); else einfBlaettern(1);
  });
  document.getElementById("einf-zurueck").addEventListener("click", function () { einfBlaettern(-1); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-einfzu]"), function (el) { el.addEventListener("click", einfuehrungZu); });
  document.getElementById("btn-einfuehrung").addEventListener("click", einfuehrungAuf);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !document.getElementById("einf").hidden) einfuehrungZu();
  });
  (function () {   // wischen: nach links weiter, nach rechts zurück
    var x0 = null, inhalt = document.querySelector(".einf-inhalt");
    inhalt.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    inhalt.addEventListener("touchend", function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) einfBlaettern(dx < 0 ? 1 : -1);
    });
  })();

  /* ---------- Auswahl (Kategorie, Richtung) als zugeklappte Zeile ---------- */
  function zeichneAuswahlText() {
    var kat = document.getElementById("sel-kat"), ri = document.getElementById("sel-richtung");
    Array.prototype.forEach.call(kat.options, function (o) { if (o.value === "merk") o.textContent = "★ Schwierige (" + anzahlSchwierige() + ")"; });
    var teile = [kat.options[kat.selectedIndex] ? kat.options[kat.selectedIndex].textContent : "Alle Kategorien"];
    if (modus !== "hoeren") teile.push(ri.options[ri.selectedIndex] ? ri.options[ri.selectedIndex].textContent : "");
    document.getElementById("aw-text").textContent = teile.filter(Boolean).join(" · ");
    document.getElementById("auswahl").classList.toggle("gefiltert", filterKat !== "alle");
  }
  document.getElementById("auswahl").addEventListener("toggle", waechterAbgleichen);

  /* ---------- Statistik ---------- */
  var statMonat = null, statTag = null;
  function zeichneStatistik() {
    var jetzt = new Date();
    if (!statMonat) statMonat = new Date(jetzt.getFullYear(), jetzt.getMonth(), 1);
    var serie = lernSerie();
    document.getElementById("st-serie").textContent = String(serie);
    document.getElementById("st-serie-l").textContent = serie === 1 ? "Tag in Folge" : "Tage in Folge";
    document.getElementById("st-heute").textContent = String(geuebtAm(Date.now()));
    document.getElementById("st-woche").textContent = String(summeAb(wochenStart(Date.now()), 7));
    document.getElementById("sel-ziel").value = String(tagesZiel());
    document.getElementById("st-monat").textContent = statMonat.toLocaleDateString("de-DE", { month: "long", year: "numeric" });

    var kal = document.getElementById("st-kalender");
    kal.textContent = "";
    ["M", "D", "M", "D", "F", "S", "S"].forEach(function (w) {
      var s = document.createElement("span"); s.className = "wt"; s.textContent = w; kal.appendChild(s);
    });
    var erster = new Date(statMonat), leer = (erster.getDay() + 6) % 7;
    for (var i = 0; i < leer; i++) kal.appendChild(document.createElement("span"));
    var tage = new Date(statMonat.getFullYear(), statMonat.getMonth() + 1, 0).getDate(), ziel = tagesZiel();
    for (var t = 1; t <= tage; t++) {
      (function (tag) {
        var ms = new Date(statMonat.getFullYear(), statMonat.getMonth(), tag).getTime(), n = geuebtAm(ms);
        var b = document.createElement("button");
        b.type = "button";
        b.className = "ktag" + (n ? " geuebt" : "") + (n >= ziel ? " ziel" : "") + (ms === heute() ? " heute" : "") + (statTag === ms ? " gewaehlt" : "");
        b.textContent = String(tag);
        b.setAttribute("aria-label", tag + ". – " + (n ? n + (n === 1 ? " Karte" : " Karten") : "nicht geübt"));
        b.addEventListener("click", function () { statTag = statTag === ms ? null : ms; zeichneStatistik(); });
        kal.appendChild(b);
      })(t);
    }
    var info = document.getElementById("st-tag");
    info.textContent = statTag
      ? new Date(statTag).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) + ": " +
        (geuebtAm(statTag) ? geuebtAm(statTag) + " Karten geübt" : "nicht geübt")
      : "Farbige Tage: geübt. Kräftig: Tagesziel erreicht. Tipp auf einen Tag zeigt die Zahl.";

    var wo = document.getElementById("st-wochen"), ws = wochenStart(Date.now()), werte = [];
    for (var w = 7; w >= 0; w--) {
      var d = new Date(ws); d.setDate(d.getDate() - 7 * w);
      werte.push({ start: d.getTime(), n: summeAb(d.getTime(), 7) });
    }
    var max = Math.max.apply(null, werte.map(function (x) { return x.n; }).concat([1]));
    wo.textContent = "";
    werte.forEach(function (x, i) {
      var sp = document.createElement("div");
      sp.className = "woche" + (i === werte.length - 1 ? " jetzt" : "");
      sp.innerHTML = '<small>' + (x.n || "") + '</small><span class="saeule"><i style="height:' + Math.round(x.n / max * 100) + '%"></i></span>' +
        '<small>' + new Date(x.start).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" }) + '</small>';
      wo.appendChild(sp);
    });
  }
  document.getElementById("tagesziel").addEventListener("click", function () { statTag = null; statMonat = null; wechsle("statistik"); });
  document.getElementById("kopf-ziel").addEventListener("click", function () { statTag = null; statMonat = null; wechsle("statistik"); });
  // „15 offen“ steht beim Üben vorn in der einklappbaren Auswahlzeile (statt „Auswahl“)
  (function () {
    var status = document.getElementById("status"), ziel = document.querySelector("#auswahl .aw-l");
    function spiegeln() { ziel.textContent = status.textContent || "Auswahl"; }
    new MutationObserver(spiegeln).observe(status, { childList: true, characterData: true, subtree: true });
    spiegeln();
  })();
  document.getElementById("stat-zurueck").addEventListener("click", function () { wechsle("ueben"); });
  document.getElementById("st-vor").addEventListener("click", function () { statMonat = new Date(statMonat.getFullYear(), statMonat.getMonth() - 1, 1); statTag = null; zeichneStatistik(); });
  document.getElementById("st-nach").addEventListener("click", function () { statMonat = new Date(statMonat.getFullYear(), statMonat.getMonth() + 1, 1); statTag = null; zeichneStatistik(); });
  document.getElementById("sel-ziel").addEventListener("change", function (e) {
    daten.ziel = Number(e.target.value) || 20; sichern(); zeichneStatistik(); zeichneTagesziel(); zielWahlZeigen();
  });
  // Tagesziel oben in den Optionen: dieselbe Einstellung wie in der Statistik
  function zielWahlZeigen() {
    var zl = tagesZiel(), h = geuebtAm(Date.now());
    Array.prototype.forEach.call(document.querySelectorAll("#zielwahl button"), function (b) {
      b.setAttribute("aria-pressed", Number(b.dataset.zielwahl) === zl ? "true" : "false");
    });
    document.getElementById("opt-ziel-stand").textContent = h + " / " + zl + " heute";
    document.getElementById("opt-ziel-fuell").style.width = Math.min(100, Math.round(h / zl * 100)) + "%";
  }
  Array.prototype.forEach.call(document.querySelectorAll("#zielwahl button"), function (b) {
    b.addEventListener("click", function () {
      daten.ziel = Number(b.dataset.zielwahl) || 20; sichern();
      document.getElementById("sel-ziel").value = String(daten.ziel);
      zielWahlZeigen(); zeichneTagesziel();
    });
  });

  /* ---------- Zurück-Taste (Android) ----------
     Liegt etwas „obenauf“ (Einblendfenster, Unterwegs, offene Auswahl, andere Ansicht als Üben),
     steht genau ein zusätzlicher Eintrag im Browser-Verlauf. Die Zurück-Taste schließt dann das
     Oberste bzw. geht zum Üben; erst auf dem Üben-Bildschirm verlässt sie die App. */
  var waechter = false, waechterUeberspringen = 0;
  function obenauf() {
    return !document.getElementById("einf").hidden || !document.getElementById("blatt").hidden || !document.getElementById("unterwegs").hidden || !document.getElementById("duell").hidden ||
      document.getElementById("auswahl").open || ansicht !== "start";
  }
  function waechterAbgleichen() {
    var soll = obenauf();
    if (soll && !waechter) { try { history.pushState({ vokabelkasten: 1 }, ""); waechter = true; } catch (e) {} }
    else if (!soll && waechter) { waechter = false; waechterUeberspringen++; history.back(); }
  }
  window.addEventListener("popstate", function () {
    if (waechterUeberspringen > 0) { waechterUeberspringen--; return; }
    waechter = false;
    if (!document.getElementById("einf").hidden) einfuehrungZu();
    else if (!document.getElementById("blatt").hidden) document.getElementById("blatt").hidden = true;
    else if (!document.getElementById("unterwegs").hidden) uwBeenden();
    else if (!document.getElementById("duell").hidden) duSchliessen();
    else if (document.getElementById("auswahl").open) document.getElementById("auswahl").open = false;
    else if (ansicht !== "start") wechsle(ansicht === "statistik" ? "ueben" : "start");
    waechterAbgleichen();
  });

  /* ---------- Aussprache: das Lautsprecher-Symbol auf der Karte ----------
     Liest vor, was gerade zu sehen ist: das englische Wort, sobald es sichtbar ist.
     Vor dem Aufdecken bei „Deutsch zuerst“ nur das deutsche Wort - sonst verriete
     das Symbol die Lösung. Stimme und Lautstärke wie beim Anhören. */
  function englischSichtbar() {
    var r = (richtung === "mix") ? wurf : richtung;
    return r === "en" || aufgedeckt;
  }
  function sprichKarte() {
    if (!sprache || !aktuell || uw) return;
    var en = englischSichtbar();
    sprichText(en ? aktuell.back : aktuell.front, en ? "en-GB" : "de-DE", document.getElementById("btn-sprich"));
  }
  // Liest einen Text mit der eingestellten Stimme; el leuchtet währenddessen (Klasse "spricht")
  /* Varianten („proposal / suggestion / offer“) mit kurzer Pause statt „Schrägstrich“ vorlesen,
     Abkürzungen ausgeschrieben */
  function sprechbar(text) {
    return String(text || "")
      .replace(/\s*\/\s*/g, ", ")
      .replace(/\bsth\./g, "something").replace(/\bsb\./g, "somebody")
      .replace(/\betw\./g, "etwas").replace(/\bjmdm\./g, "jemandem").replace(/\bjmdn\./g, "jemanden");
  }
  function sprichText(text, lang, el) {
    lang = spracheFuer(lang);
    if (!sprache || !text || uw || !lang) return;
    tonMischen(true);
    sprache.cancel();
    var u = new SpeechSynthesisUtterance(sprechbar(text));
    u.lang = lang;
    var st = stimmeFuer(lang);
    if (st) { u.voice = st; u.lang = st.lang; }
    u.rate = tempo(lang, 0.9);
    u.volume = uwEinstellungen().laut;
    Array.prototype.forEach.call(document.querySelectorAll(".spricht"), function (x) { x.classList.remove("spricht"); });
    if (el) el.classList.add("spricht");
    function fertig() { if (el) el.classList.remove("spricht"); }
    u.onend = fertig;
    u.onerror = fertig;
    setTimeout(fertig, 2500 + text.length * 150);   // falls der Browser das Ende nicht meldet
    // kurze Anlaufzeit: direkt nach cancel() schneiden manche Browser den Anfang ab
    setTimeout(function () { sprache.speak(u); }, 80);
  }
  document.getElementById("btn-sprich").addEventListener("click", sprichKarte);

  document.getElementById("btn-merk").addEventListener("click", function () {
    if (!aktuell) return;
    aktuell.merk = !aktuell.merk;
    sichern();
    zeichneUeben();
  });

  document.getElementById("sel-abdeck").addEventListener("change", function (e) {
    abdeck = e.target.value;
    // Die Beispielsaetze verraten das verdeckte Wort, also weg damit.
    if (abdeck !== "aus" && saetze) {
      saetze = false;
      document.getElementById("btn-saetze").textContent = "Sätze ein";
    }
    sichern();
    zeichneListe();
  });

  document.getElementById("btn-saetze").addEventListener("click", function () {
    saetze = !saetze;
    document.getElementById("btn-saetze").textContent = saetze ? "Sätze aus" : "Sätze ein";
    sichern();
    zeichneListe();
  });

  document.getElementById("btn-nurkasten").addEventListener("click", function () {
    nurKasten = !nurKasten;
    var b = document.getElementById("btn-nurkasten");
    b.className = "filt" + (nurKasten ? " on" : "");
    b.setAttribute("aria-pressed", nurKasten ? "true" : "false");
    zeichneListe();
  });

  /* Rückmeldung in der Liste, im selben Stil wie beim Üben; blendet sich nach einer Weile aus */
  var listMeldungTimer = null;
  function listMeldung(teile) {
    var el = document.getElementById("listmeldung");
    el.textContent = "";
    teile.forEach(function (t, i) {
      if (i % 2) { var b = document.createElement("b"); b.textContent = t; el.appendChild(b); }
      else el.appendChild(document.createTextNode(t));
    });
    el.hidden = false;
    clearTimeout(listMeldungTimer);
    listMeldungTimer = setTimeout(function () { el.hidden = true; }, 7000);
  }
  // nach dem Aufnehmen: Meldung mit Platznummern, neue Zeilen leuchten kurz auf
  function listeAufgenommen(karten, was) {
    var sortiert = daten.cards.slice().sort(function (a, b) { return a.ord - b.ord; });
    var nummern = karten.map(function (c) { return sortiert.indexOf(c) + 1; }).sort(function (a, b) { return a - b; });
    var bereich = nummern.length === 1 ? "Nr. " + nummern[0]
      : (nummern[nummern.length - 1] - nummern[0] === nummern.length - 1
          ? "Nr. " + nummern[0] + "–" + nummern[nummern.length - 1] : "");
    karten.forEach(function (c) { frischSet[c.id] = true; });
    listMeldung(["", was, (bereich ? " (" + bereich + ")" : "") + " in den Kasten gelegt. Sie starten in Fach 1 und kommen beim nächsten Üben dran."]);
    zeichneListe();
  }

  document.getElementById("btn-next10").addEventListener("click", function () {
    var neu = naechsteOffene(paket);
    aufnehmen(neu);
    listeAufgenommen(neu, neu.length === 1 ? "1 Vokabel" : neu.length + " Vokabeln");
  });

  document.getElementById("btn-leeren").addEventListener("click", function () {
    var n = imKasten().length;
    frage("Alle " + n + " Karten aus dem Kasten nehmen? Die Fächer bleiben erhalten, du kannst jederzeit wieder aufnehmen.", "Kasten leeren", function () {
      daten.cards.forEach(function (c) { c.aktiv = false; });
      runde = []; aktuell = null;
      sichern();
      listMeldung(["Kasten geleert: ", n + (n === 1 ? " Karte" : " Karten"), " herausgenommen. Ihre Fächer bleiben gespeichert."]);
      zeichneListe();
    });
  });

  document.getElementById("sel-paket").addEventListener("change", function (e) {
    paket = Number(e.target.value) || 15;
    sichern();
    zeichneListe();
  });

  document.getElementById("sel-listkat").addEventListener("change", function (e) {
    listKat = e.target.value; sichern(); zeichneListe();
  });
  document.getElementById("sel-sort").addEventListener("change", function (e) {
    listSort = e.target.value; sichern(); zeichneListe();
  });
  document.getElementById("btn-nurmerk").addEventListener("click", function () {
    nurMerk = !nurMerk;
    var b = document.getElementById("btn-nurmerk");
    b.className = "filt" + (nurMerk ? " on" : "");
    b.setAttribute("aria-pressed", nurMerk ? "true" : "false");
    zeichneListe();
  });

  Array.prototype.forEach.call(
    document.querySelectorAll(".themawahl button"),
    function (b) {
      b.addEventListener("click", function () {
        setzeThema(b.dataset.thema);
        sichern();
      });
    }
  );

  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var folgen = function () { if (thema === "auto") setzeThema(thema); };
    if (mq.addEventListener) mq.addEventListener("change", folgen);
    else if (mq.addListener) mq.addListener(folgen);
  }

  document.getElementById("sel-modus").addEventListener("change", function (e) {
    // nur die Weiche umstellen: beide Stände sind aktuell (siehe bewerten), darum verschiebt sich dabei keine Karte
    MODUS = e.target.value === "fsrs" ? "fsrs" : "leitner";
    sichern();
    rundeStarten(false);   // die Runde neu nach dem jetzt gültigen Verfahren zusammenstellen
    zeichneTempo();
  });
  // Behaltensquote gilt ab der nächsten Antwort; schon geplante Termine bleiben, wie sie sind
  document.getElementById("sel-retention").addEventListener("change", function (e) {
    RETENTION = Math.min(0.95, Math.max(0.8, Number(e.target.value) || 0.9));
    sichern();
  });
  document.getElementById("sel-knoepfe").addEventListener("change", function (e) {
    KNOEPFE = e.target.value === "4" ? 4 : 2;
    sichern();
    zeichneTempo();
    if (aktuell) zeichneUeben();
  });

  document.getElementById("sel-tempo").addEventListener("change", function (e) {
    if (e.target.value === "eigen") {
      document.getElementById("tempofelder").hidden = false;
      return;
    }
    setzeAbstaende(VORLAGEN[e.target.value]);
    sichern();
    zeichneTempo();
  });

  ["t2", "t3", "t4", "t5"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () {
      setzeAbstaende(["t2", "t3", "t4", "t5"].map(function (x) {
        return document.getElementById(x).value;
      }));
      sichern();
      zeichneTempo();
    });
  });

  /* Teilen: Sicherungsdatei direkt an Drive, Mail, Messenger … (Teilen-Menü des Handys).
     Chrome teilt nicht jede Dateiart - geht JSON nicht, dieselbe Datei als .txt (Einlesen versteht beides). */
  // Sicherung mit Fotos (als Daten-URL unter bilder["<Kasten>:<Karte>"])
  function sicherungMitBildern() {
    var aus = sicherungsInhalt(), wer = [];
    aus.cards.forEach(function (c) { if (c.bild) wer.push(["en", c.id]); });
    Object.keys(aus.kastenDaten || {}).forEach(function (kid) { aus.kastenDaten[kid].cards.forEach(function (c) { if (c.bild) wer.push([kid, c.id]); }); });
    if (!wer.length) return Promise.resolve(aus);
    aus.bilder = {};
    return Promise.all(wer.map(function (w) {
      return bildHolen(w[1], w[0]).then(function (b) { return b ? blobZuDatenUrl(b) : null; })
        .then(function (u) { if (u) aus.bilder[w[0] + ":" + w[1]] = u; });
    })).then(function () { return aus; });
  }
  function sicherungsDatei(inhalt) {
    var d = new Date(), name = "vokabeln-" + d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    inhalt = inhalt || JSON.stringify(sicherungsInhalt(), null, 1);
    try {
      var f = new File([inhalt], name + ".json", { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [f] })) return f;
      f = new File([inhalt], name + ".txt", { type: "text/plain" });
      if (navigator.canShare && navigator.canShare({ files: [f] })) return f;
    } catch (e) {}
    return null;
  }
  // nur prüfen, ob Teilen von Dateien geht - mit einer Probedatei, ohne den echten Stand anzufassen
  var kannTeilen = !!(navigator.share && sicherungsDatei("{}"));
  document.getElementById("btn-teilen").hidden = !kannTeilen;
  document.getElementById("btn-teilen").addEventListener("click", function () {
    sicherungMitBildern().then(function (aus) {
    var f = sicherungsDatei(JSON.stringify(aus, null, 1));
    if (!f) { document.getElementById("btn-export").click(); return; }
    navigator.share({ files: [f], title: "Vokabelkasten" }).then(function () {
      daten.letzteSicherung = Date.now();
      sichern();
      zeichneHinweis();
    }).catch(function (e) {
      if (e && e.name === "AbortError") return;   // im Teilen-Menü abgebrochen
      document.getElementById("btn-export").click();
    });
    });
  });

  document.getElementById("hinweis-tun").addEventListener("click", function () {
    document.getElementById(kannTeilen ? "btn-teilen" : "btn-export").click();
  });

  document.getElementById("hinweis-weg").addEventListener("click", function () {
    hinweisPause = true;
    zeichneHinweis();
  });

  document.getElementById("btn-export").addEventListener("click", function () {
    sicherungMitBildern().then(herunterladen);
  });
  function herunterladen(aus) {
    var blob = new Blob([JSON.stringify(aus, null, 1)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var d = new Date();
    a.href = url;
    daten.letzteSicherung = Date.now();
    sichern();
    zeichneHinweis();
    a.download = "vokabeln-" + d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0") + ".json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  document.getElementById("btn-import").addEventListener("click", function () {
    document.getElementById("file").click();
  });

  /* Sicherungsdatei: oben wie immer der Englisch-Kasten (alte Dateien bleiben lesbar),
     dazu alle weiteren Kästen unter kaesten / kastenDaten. Egal, welcher Kasten gerade offen ist. */
  function kastenLesen(id) {
    if (id === KASTEN.id) return daten;
    try { var x = JSON.parse(window.localStorage.getItem(kastenKey(id))); if (x && Array.isArray(x.cards)) return x; } catch (e) {}
    return null;
  }
  function sicherungsInhalt() {
    sichern();
    var en = kastenLesen("en") || { v: 3, seeded: true, cards: [], reviews: [] };
    var aus = JSON.parse(JSON.stringify(en));
    var weitere = KAESTEN.liste.filter(function (k) { return k.id !== "en"; });
    if (weitere.length) {
      aus.kaesten = weitere.map(function (k) { return { id: k.id, name: k.name, farbe: k.farbe, art: k.art }; });
      aus.kastenDaten = {};
      weitere.forEach(function (k) { var d = kastenLesen(k.id); if (d) aus.kastenDaten[k.id] = { cards: d.cards, reviews: d.reviews || [] }; });
    }
    return aus;
  }
  /* Karten einer Sicherung in einen Kasten mischen: Vorhandenes behält den besseren Lernstand, Neues kommt dazu.
     Leitner (Fach/Termin): das höhere Fach gewinnt, wie bisher. FSRS: der Stand mit der jüngeren Wiederholung gewinnt -
     jedes Verfahren behält so für sich das Aktuellere. reviews = Antwortprotokoll der Datei für diesen Kasten; es
     wird über ids (Kennung in der Datei -> Kennung hier) den Karten zugeordnet, auch wenn sie hier neu angelegt werden. */
  function kartenMischen(ziel, karten, katAnzahl, kid, bilder, aufgaben, quelle, reviews) {
    var idx = {}, neu = 0, akt = 0, ids = {};
    function foto(c, karte) {   // Foto aus der Datei an die Karte hängen (hat sie schon eins, bleibt es)
      var u = c.bild && bilder && bilder[(quelle || kid) + ":" + c.id];   // in der Datei unter der Kennung des Quell-Kastens
      // nur eingebettete Bilder (so schreibt die App sie selbst in die Sicherung) - eine Internetadresse in einer
      // fremden oder veränderten Datei würde sonst beim Einlesen unbemerkt abgerufen
      if (typeof u !== "string" || u.indexOf("data:image/") !== 0) return;
      aufgaben.push([kid, karte.id, u, !!karte.bild]);   // hatte die Karte schon ein Foto: nur ergänzen, falls es fehlt
      karte.bild = true;
    }
    ziel.cards.forEach(function (c) { idx[c.front + "\u0000" + c.back] = c; });
    var ord = ziel.cards.reduce(function (m, c) { return typeof c.ord === "number" && c.ord >= m ? c.ord + 1 : m; }, SEED.rows.length);
    (karten || []).forEach(function (c) {
      if (typeof c.front !== "string" || typeof c.back !== "string") return;
      var box = Math.min(5, Math.max(1, parseInt(c.box, 10) || 1));
      var vorhanden = idx[c.front + "\u0000" + c.back];
      var fsrs = VK_LERNEN.fsrsGueltig(c.fsrs);
      if (vorhanden) {
        if (typeof c.id === "string") ids[c.id] = vorhanden.id;
        if (c.merk) vorhanden.merk = true;
        if (c.aktiv !== false) vorhanden.aktiv = true;
        var besser = false;
        if (box > vorhanden.box) { vorhanden.box = box; vorhanden.due = typeof c.due === "number" ? c.due : vorhanden.due; besser = true; }
        if (fsrs && fsrs.last_review && !(vorhanden.fsrs && vorhanden.fsrs.last_review >= fsrs.last_review)) { vorhanden.fsrs = fsrs; besser = true; }
        if (typeof c.zuletzt === "number" && !(vorhanden.zuletzt >= c.zuletzt)) vorhanden.zuletzt = c.zuletzt;
        if (besser) akt++;
        foto(c, vorhanden);
        return;
      }
      var karte = {
        id: neueId(), front: c.front, back: c.back, bsp: typeof c.bsp === "string" ? c.bsp : "",
        kat: (typeof c.kat === "number" && c.kat >= 0 && c.kat < katAnzahl) ? c.kat : katAnzahl - 1,
        ord: ord++, merk: !!c.merk, aktiv: (typeof c.aktiv === "boolean") ? c.aktiv : true, box: box,
        due: typeof c.due === "number" ? c.due : heute(), created: typeof c.created === "number" ? c.created : Date.now()
      };
      // ohne (gültigen) FSRS-Stand in der Datei rechnet standNachtragen ihn beim Speichern aus dem Fach aus
      if (fsrs) karte.fsrs = fsrs;
      if (typeof c.zuletzt === "number") karte.zuletzt = c.zuletzt;
      if (typeof c.id === "string") ids[c.id] = karte.id;
      ziel.cards.push(karte);
      foto(c, karte);
      idx[c.front + "\u0000" + c.back] = karte;   // doppelte Zeilen in der Datei landen auf derselben Karte
      neu++;
    });
    VK_LERNEN.protokollMischen(ziel, reviews, ids);
    return { neu: neu, akt: akt };
  }
  function kastenSchreiben(id, d) {
    if (id === KASTEN.id) { sichern(); return; }
    // wie in sichern(): fehlende FSRS-Stände gleich ergänzen - aber nur in Schema 3; ein Kasten im alten Schema
    // wird erst beim Öffnen umgebaut, weil laden() vorher seine Sicherung anlegt
    if (d.v >= 3) VK_LERNEN.migriereV3(d, TAGE, Date.now());
    try { window.localStorage.setItem(kastenKey(id), JSON.stringify(d)); } catch (e) {}
  }
  // Fotos aus der Datei nachladen (nur wo die Karte noch keins hat)
  function fotosLaden(fotos) {
    fotos.forEach(function (f) {
      (f[3] ? bildHolen(f[1], f[0]) : Promise.resolve(null)).then(function (da) {
        if (da) return;
        return fetch(f[2]).then(function (x) { return x.blob(); }).then(function (b) { return bildSetzen(f[1], b, f[0]); });
      }).catch(function () {});
    });
  }
  /* Welche Kästen füllt eine Datei? Karten oben = Englisch, dazu jeder Kasten aus kaesten/kastenDaten mit Karten. */
  function dateiKaesten(p) {
    var l = [];
    if (p.cards.length) l.push({ id: "en", karten: p.cards, reviews: p.reviews });
    (Array.isArray(p.kaesten) ? p.kaesten : []).forEach(function (k) {
      var kd = k && k.id && k.id !== "en" && p.kastenDaten && p.kastenDaten[k.id];
      if (kd && Array.isArray(kd.cards) && kd.cards.length) l.push({ id: String(k.id), k: k, karten: kd.cards, reviews: kd.reviews });
    });
    return l;
  }
  // Kasten auf diesem Gerät, in den ein Kasten aus der Datei gehört: gleiche Kennung (auch im Papierkorb) oder gleicher Name
  function passenderKasten(k) {
    var gleich = KAESTEN.liste.concat(papierkorb()).filter(function (x) { return x.id === k.id; })[0];
    if (gleich) return gleich;
    var titel = kastenTitel({ id: k.id, name: k.name }).toLowerCase();
    return KAESTEN.liste.filter(function (x) { return x.id !== "en" && kastenTitel(x).toLowerCase() === titel; })[0] || null;
  }
  /* Eine Datei für nur einen Kasten (z. B. eine Wortliste), aber gerade ist ein anderer offen: erst fragen, wohin.
     Vorausgewählt ist der offene Kasten - so landet eine Liste, die man im Gardenakasten einliest, auch dort
     und nicht in einem neuen dritten Kasten. Vollständige Sicherungen (mehrere Kästen) gehen ohne Frage Kasten für Kasten zurück. */
  function dateiEinlesen(p) {
    var ziele = dateiKaesten(p);
    if (ziele.length === 1) {
      var z = ziele[0], ziel = z.id === "en" ? KAESTEN.liste[0] : passenderKasten(z.k);
      if (!ziel || ziel.id !== KASTEN.id) {
        var wieDatei = ziel ? "In den " + kastenTitel(ziel) : "In einen neuen " + kastenTitel({ id: z.id, name: z.k.name });
        blattAuf(z.karten.length + (z.karten.length === 1 ? " Karte" : " Karten") + " einlesen – wohin?", [
          { text: "In den offenen " + kastenTitel(KASTEN), tun: function () { inOffenenKasten(z, p.bilder); } },
          { text: wieDatei + " (wie in der Datei)", tun: function () { sicherungEinlesen(p); } }
        ]);
        return;
      }
    }
    sicherungEinlesen(p);
  }
  function inOffenenKasten(z, bilder) {
    var fotos = [];
    var r = kartenMischen(daten, z.karten, KATS.length, KASTEN.id, bilder, fotos, z.id, z.reviews);
    sichern();
    kastenLeisteZeichnen(); kastenVerwaltenZeichnen();
    zeichneListe();
    if (ansicht === "start") zeichneKacheln();
    fotosLaden(fotos);
    meldeOk(r.neu + " neu im " + kastenTitel(KASTEN) + (r.akt ? ", " + r.akt + " Lernstände aktualisiert." : "."));
  }
  function sicherungEinlesen(p) {
    var gesamt = { neu: 0, akt: 0 }, dazu = [], fotos = [];
    // Englisch (oben in der Datei)
    var en = kastenLesen("en") || { v: 3, seeded: true, cards: [], reviews: [] };
    var r = kartenMischen(en, p.cards, SEED.kats.length, "en", p.bilder, fotos, undefined, p.reviews);
    gesamt.neu += r.neu; gesamt.akt += r.akt;
    kastenSchreiben("en", en);
    // weitere Kästen: fehlende werden angelegt, vorhandene gemischt
    (Array.isArray(p.kaesten) ? p.kaesten : []).forEach(function (k) {
      if (!k || !k.id || k.id === "en" || !p.kastenDaten || !p.kastenDaten[k.id]) return;
      var eintrag = KAESTEN.liste.filter(function (x) { return x.id === k.id; })[0];
      if (!eintrag) {   // liegt er im Papierkorb, kommt er zurück in die Leiste
        var imKorb = papierkorb().filter(function (x) { return x.id === k.id; })[0];
        if (imKorb) {
          KAESTEN.papierkorb = papierkorb().filter(function (x) { return x !== imKorb; });
          eintrag = { id: imKorb.id, name: imKorb.name, farbe: imKorb.farbe, art: imKorb.art || "wissen" };
          KAESTEN.liste.push(eintrag);
        }
      }
      if (!eintrag) {   // gleicher Name schon da (z. B. vorher von Hand angelegt): die Karten kommen dort hinein
        var titel = kastenTitel({ id: k.id, name: k.name }).toLowerCase();
        eintrag = KAESTEN.liste.filter(function (x) { return x.id !== "en" && kastenTitel(x).toLowerCase() === titel; })[0];
      }
      if (!eintrag) {
        eintrag = { id: String(k.id), name: String(k.name || "Kasten").slice(0, 30), farbe: +k.farbe || 1, art: "wissen" };
        KAESTEN.liste.push(eintrag); dazu.push(kastenTitel(eintrag));
      }
      var d = kastenLesen(eintrag.id) || { v: 3, seeded: true, cards: [], reviews: [] };
      var r2 = kartenMischen(d, p.kastenDaten[k.id].cards, 4, eintrag.id, p.bilder, fotos, String(k.id), p.kastenDaten[k.id].reviews);
      gesamt.neu += r2.neu; gesamt.akt += r2.akt;
      kastenSchreiben(eintrag.id, d);
    });
    kaestenSichern();
    kastenLeisteZeichnen(); kastenVerwaltenZeichnen();
    zeichneListe();
    if (ansicht === "start") zeichneKacheln();
    fotosLaden(fotos);
    meldeOk(gesamt.neu + " neu, " + gesamt.akt + " Lernstände aktualisiert." + (dazu.length ? " Neue Kästen: " + dazu.join(", ") + "." : ""));
  }

  document.getElementById("file").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var p;
      try { p = JSON.parse(String(r.result)); } catch (err) { p = null; }
      if (!p || !Array.isArray(p.cards)) { melde("Das ist keine Sicherungsdatei dieser App."); return; }
      dateiEinlesen(p);
    };
    r.readAsText(f);
    e.target.value = "";
  });

  document.getElementById("btn-lernstand").addEventListener("click", function () {
    frage("Alle Karten zurück auf Fach 1? Vokabeln, Kasten und Sterne bleiben erhalten.", "Zurücksetzen", function () {
      var t = heute();
      daten.cards.forEach(function (c) { c.box = 1; c.due = t; delete c.fsrs; });   // sichern() gibt allen einen neuen FSRS-Stand
      sichern();
      zeichneStats();
      rundeStarten(false);
    }, true);
  });

  document.getElementById("btn-reset").addEventListener("click", function () {
    frage("Wirklich alle Vokabeln löschen? Nur eine Sicherungsdatei bringt sie zurück.", "Alle löschen", function () {
      daten = { v: 3, seeded: true, cards: [], reviews: [] };
      try { window.localStorage.removeItem(VOR_V3 + KASTEN.id); } catch (e) {}   // gelöscht heißt gelöscht: auch die Sicherung vor dem FSRS-Umbau
      bilderKastenLoeschen(KASTEN.id);
      runde = []; aktuell = null;
      sichern();
      zeichneListe(); zeichneStats();
      wechsle("ueben");
    }, true);
  });

  /* ---------- Offline-Unterstützung ---------- */

  var installAngebot = null;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installAngebot = e;
    var z = document.getElementById("installzeile");
    if (z) z.hidden = false;
  });

  window.addEventListener("appinstalled", function () {
    installAngebot = null;
    var z = document.getElementById("installzeile");
    if (z) z.hidden = true;
    appleKasten();
  });

  function offlineAnmelden() {
    if (!("serviceWorker" in navigator)) { offlineStatus(false); return; }
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      offlineStatus(false, "Offline-Betrieb geht nur über eine sichere Adresse. Auf einer lokalen Datei ist er nicht möglich.");
      return;
    }
    navigator.serviceWorker.register("sw.js").then(function () {
      offlineStatus(true);
    }).catch(function () {
      offlineStatus(false);
    });
  }

  function offlineStatus(bereit, text) {
    var el = document.getElementById("offline-status");
    if (!el) return;
    el.textContent = text || (bereit
      ? "Eingerichtet. Die App startet auch ohne Verbindung, dann mit dem zuletzt geladenen Stand."
      : "Auf diesem Gerät nicht verfügbar. Zum Öffnen brauchst du eine Verbindung.");
  }

  /* ---------- Unterwegs: Karten vorlesen lassen ----------
     Liest Wort, Denkpause, Lösung und auf Wunsch den Beispielsatz vor, dann die nächste Karte.
     Die Stimme kommt aus der Sprachausgabe des Geräts, es geht nichts nach außen.
     Bewertet wird nicht: Fächer und Termine bleiben unverändert. */
  var sprache = window.speechSynthesis || null;
  var uw = null;          // laufende Hörrunde: { karten, i, lauf, pausiert, fertig }
  var uwSperre = null;    // Wake Lock, damit der Bildschirm anbleibt

  function uwEinstellungen() {
    var e = daten.unterwegs || {};
    return {
      auswahl: ["faellig", "kasten", "alle", "liste"].indexOf(e.auswahl) > -1 ? e.auswahl : "faellig",
      denk: [1, 2, 3, 5, 8, 12].indexOf(e.denk) > -1 ? e.denk : 5,
      richtung: e.richtung === "en" || e.richtung === "mix" ? e.richtung : "de",
      bsp: e.bsp !== false,
      hintergrund: e.hintergrund === true,   // standardmäßig aus, damit Musik anderer Apps weiterläuft
      stimmeDe: e.stimmeDe || "",
      stimmeEn: e.stimmeEn || "",
      laut: e.laut >= 0.1 && e.laut <= 1 ? e.laut : 1
    };
  }
  function uwEinstellungenZeigen() {
    var e = uwEinstellungen();
    document.getElementById("uw-auswahl").value = e.auswahl;
    document.getElementById("uw-denk").value = String(e.denk);
    document.getElementById("uw-richtung").value = e.richtung;
    document.getElementById("uw-bsp-an").checked = e.bsp;
    document.getElementById("uw-hintergrund").checked = e.hintergrund;
    stimmenFuellen();
    document.getElementById("uw-laut").value = String(Math.round(e.laut * 100));
    lautAnzeigen();
  }
  function lautAnzeigen() {
    document.getElementById("uw-laut-wert").textContent = document.getElementById("uw-laut").value + " %";
  }
  function uwEinstellungenMerken() {
    daten.unterwegs = {
      auswahl: document.getElementById("uw-auswahl").value,
      denk: Number(document.getElementById("uw-denk").value) || 5,
      richtung: document.getElementById("uw-richtung").value,
      bsp: document.getElementById("uw-bsp-an").checked,
      hintergrund: document.getElementById("uw-hintergrund").checked,
      stimmeDe: document.getElementById("uw-stimme-de").value,
      stimmeEn: document.getElementById("uw-stimme-en").value,
      laut: (Number(document.getElementById("uw-laut").value) || 100) / 100
    };
    sichern();
    hoerInfo();
  }

  // Welche Karten die Hörrunde vorliest; die Kategorie-Auswahl oben gilt auch hier
  function uwKartenAuswahl(auswahl) {
    var t = heute();
    return daten.cards.filter(function (c) {
      if (!imKat(c)) return false;
      if (auswahl === "alle" || auswahl === "liste") return true;
      if (!c.aktiv) return false;
      return auswahl === "kasten" || istDran(c, t);
    });
  }
  function hoerInfo() {
    var e = uwEinstellungen(), n = uwKartenAuswahl(e.auswahl).length;
    var was = { faellig: "fällig", kasten: "im Kasten", alle: "in der Auswahl", liste: "in der Liste" }[e.auswahl];
    var el = document.getElementById("hoer-info");
    el.textContent = "";
    var b = document.createElement("b");
    b.textContent = String(n);
    el.appendChild(b);
    el.appendChild(document.createTextNode(n === 1 ? " Karte " + was : " Karten " + was));
    document.getElementById("btn-unterwegs").disabled = !n;
    // Einstellungen zugeklappt: eine Zeile zeigt, womit es losgeht
    document.getElementById("hoer-kurz").textContent = [auswahlText("uw-auswahl"), auswahlText("uw-denk") + " Denkpause", auswahlText("uw-richtung")]
      .concat(e.bsp ? ["mit Beispielsatz"] : []).join(" · ");
  }
  // gewählter Text eines Auswahlfelds (für die Kurzfassungen in zugeklappten Einstellungen)
  function auswahlText(id) {
    var s = document.getElementById(id);
    return s && s.selectedIndex > -1 ? s.options[s.selectedIndex].textContent.replace(/\s*\(.*\)\s*$/, "") : "";
  }

  /* ---------- Lernart: Karteikasten oder Unterwegs/Anhören ---------- */
  var modus = "karten";
  function setzeModus(neu) {
    modus = neu === "hoeren" ? "hoeren" : "karten";
    daten.modus = modus;
    var hoeren = modus === "hoeren";
    document.getElementById("view-ueben").classList.toggle("hoeren", hoeren);
    document.getElementById("modus-karten").hidden = hoeren;
    document.getElementById("modus-hoeren").hidden = !hoeren;
    Array.prototype.forEach.call(document.querySelectorAll("#modus button"), function (b) {
      b.setAttribute("aria-pressed", b.dataset.modus === modus ? "true" : "false");
    });
    if (hoeren) { uwEinstellungenZeigen(); hoerInfo(); }
    if (typeof ansicht !== "undefined") kopfZeigen();
    zeichneAuswahlText();   // die Abfragerichtung gilt nur für den Karteikasten
  }
  Array.prototype.forEach.call(document.querySelectorAll("#modus button"), function (b) {
    b.addEventListener("click", function () {
      setzeModus(b.dataset.modus);
      sichern();
      if (modus === "karten") zeichneUeben();
    });
  });

  function stimmSprache(v) { return String(v.lang || "").replace("_", "-").toLowerCase(); }
  // Alle Stimmen einer Sprache, Stimmen auf dem Gerät zuerst
  function stimmenFuer(kurz) {
    return (sprache.getVoices() || []).filter(function (v) {
      return stimmSprache(v).indexOf(kurz) === 0;
    }).sort(function (a, b) {
      if (a.localService !== b.localService) return a.localService ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }
  function stimmeFuer(lang) {
    var genau = lang.toLowerCase(), kurz = genau.slice(0, 2);
    var e = uwEinstellungen(), gewaehlt = kurz === "de" ? e.stimmeDe : e.stimmeEn;
    var liste = stimmenFuer(kurz);
    if (gewaehlt) {
      var treffer = liste.filter(function (v) { return v.voiceURI === gewaehlt; })[0];
      if (treffer) return treffer;
    }
    // Automatisch: bevorzugt eine Stimme auf dem Gerät, damit kein Text nach außen geht
    var lokal = liste.filter(function (v) { return v.localService; });
    return lokal.filter(function (v) { return stimmSprache(v) === genau; })[0] || lokal[0] ||
           liste.filter(function (v) { return stimmSprache(v) === genau; })[0] || liste[0] || null;
  }
  function stimmTipp() {
    var el = document.getElementById("stimm-tipp");
    if (/Android/i.test(navigator.userAgent)) {
      el.textContent = "Andere Stimmen: Android-Einstellungen \u2192 Bedienungshilfen \u2192 Text-in-Sprache \u2192 Google Sprachausgabe \u2192 Sprachdaten installieren.";
    } else if (istApple()) {
      el.textContent = "Bessere Stimmen: Einstellungen \u2192 Bedienungshilfen \u2192 Gesprochene Inhalte \u2192 Stimmen (\u201ePremium\u201c).";
    } else {
      el.textContent = "Neue Stimmen gibt es in den Spracheinstellungen des Geräts.";
    }
  }
  function stimmenFuellen() {
    if (!sprache) return;
    var e = uwEinstellungen();
    [["de", "uw-stimme-de", e.stimmeDe], ["en", "uw-stimme-en", e.stimmeEn]].forEach(function (x) {
      var sel = document.getElementById(x[1]);
      sel.textContent = "";
      var auto = document.createElement("option");
      auto.value = "";
      auto.textContent = "Automatisch";
      sel.appendChild(auto);
      stimmenFuer(x[0]).forEach(function (v) {
        var o = document.createElement("option");
        o.value = v.voiceURI;
        // „Microsoft Katja - German (Germany)“ wird zu „Microsoft Katja“
        o.textContent = String(v.name).replace(/\s+-\s+[^-]+\([^)]*\)\s*$/, "") + (v.localService ? "" : " · online");
        sel.appendChild(o);
      });
      sel.value = x[2];
      if (sel.value !== x[2]) sel.value = "";   // gemerkte Stimme gibt es auf diesem Gerät nicht
    });
  }
  // Probe hören: kurzer Satz mit der gewählten Stimme und Lautstärke
  function stimmProbe(kurz) {
    if (!sprache) return;
    tonMischen(true);
    sprache.cancel();
    var lang = kurz === "de" ? "de-DE" : "en-GB";
    var u = new SpeechSynthesisUtterance(kurz === "de"
      ? "Hallo! So klingt diese Stimme." : "Hello! This is how this voice sounds.");
    u.lang = lang;
    var st = stimmeFuer(lang);
    if (st) { u.voice = st; u.lang = st.lang; }
    u.rate = tempo(lang, 0.95);
    u.volume = uwEinstellungen().laut;
    setTimeout(function () { sprache.speak(u); }, kurz === "de" ? 420 : 220);
  }

  // Spricht einen Text; das Versprechen erfüllt sich am Ende oder wenn die Runde abgebrochen wurde
  function sprich(text, lang, lauf) {
    return sprichWenn(text, lang, function () { return uw && lauf === uw.lauf; });
  }
  /* „Deutsch vorlesen mit“: deutscher Stimme, englischer Stimme oder gar nicht (daten.deStimme) */
  /* Tempo der deutschen Stimme (daten.deTempo): die ist auf vielen Handys sehr träge - standardmäßig 1,5-fach */
  function deTempo() { return [1, 1.25, 1.5, 2].indexOf(daten.deTempo) > -1 ? daten.deTempo : 1.5; }
  function enTempo() { return [1, 1.25, 1.5, 2].indexOf(daten.enTempo) > -1 ? daten.enTempo : 1; }
  function tempo(lang, basis) { return Math.min(2, basis * (/^de/i.test(lang) ? deTempo() : enTempo())); }
  function deModus() { return daten.deStimme === "en" || daten.deStimme === "aus" ? daten.deStimme : "de"; }
  function spracheFuer(lang) {
    if (WISSEN) lang = "de-DE";   // Wissenskasten: Begriff und Bedeutung sind Deutsch
    if (!/^de/i.test(lang)) return lang;
    var m = deModus();
    return m === "aus" ? null : m === "en" ? "en-GB" : lang;
  }
  // wie sprich(), aber mit eigener Prüfung, ob die Runde noch läuft (auch fürs Duell)
  function sprichWenn(text, lang, laeuft) {
    lang = spracheFuer(lang);
    return new Promise(function (fertig) {
      if (!text || !lang || !laeuft()) { fertig(); return; }
      tonStandard();
      var u = new SpeechSynthesisUtterance(sprechbar(text));
      u.lang = lang;
      var st = stimmeFuer(lang);
      if (st) u.voice = st;
      u.rate = tempo(lang, 0.95);
      u.volume = uwEinstellungen().laut;
      var erledigt = false, notbremse = null;
      function ende() { if (erledigt) return; erledigt = true; clearTimeout(notbremse); fertig(); }
      u.onend = ende;
      u.onerror = ende;
      // Kurze Anlaufzeit: direkt nach cancel() schneiden manche Browser den Anfang ab
      setTimeout(function () {
        if (!laeuft()) { ende(); return; }
        // Manche Browser melden das Ende nicht zuverlässig - dann geht es nach einer Schätzung weiter
        notbremse = setTimeout(ende, 3000 + text.length * 120);
        sprache.speak(u);
      }, lang.indexOf("de") === 0 ? 420 : 220);   // Deutsch bekommt 0,2 s mehr Anlauf
    });
  }

  /* Hält den Audio-Ausgang wach, solange die Runde läuft: unhörbare Stille über Web Audio.
     Sonst legen sich Bluetooth-Kopfhörer und manche Lautsprecher zwischen zwei Ansagen
     schlafen und verschlucken beim Aufwachen den ersten Laut. */
  var uwStille = null;
  /* Musik anderer Apps (Spotify & Co.) soll weiterlaufen: Ansagen mischen sich dazu.
     iPhone/iPad (Safari 16.4+): Audio-Sitzung "ambient" statt Wiedergabe, die andere Apps anhält.
     Nur mit „Im Hintergrund weiterlaufen“ läuft eine echte Wiedergabe ("playback"). */
  function tonMischen(mischen) {
    try {
      var soll = mischen ? "ambient" : "playback";
      if (navigator.audioSession && navigator.audioSession.type !== soll) navigator.audioSession.type = soll;
    } catch (e) {}
  }
  // vor jeder Ansage: mischen - außer „Im Hintergrund weiterlaufen“ ist in einer laufenden Hörrunde an
  function tonStandard() { tonMischen(!(uw && uwEinstellungen().hintergrund)); }
  function stilleAn() {
    tonMischen(!uwEinstellungen().hintergrund);
    if (uwStille) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      var ctx = new AC();
      var osc = ctx.createOscillator(), g = ctx.createGain();
      g.gain.value = 0.0001;            // praktisch lautlos, hält den Ausgang aber aktiv
      osc.frequency.value = 40;
      osc.connect(g); g.connect(ctx.destination);
      osc.start();
      if (ctx.state === "suspended") ctx.resume();
      uwStille = { ctx: ctx, osc: osc };
    } catch (e) { uwStille = null; }
  }
  function stilleAus() {
    if (!uwStille) return;
    try { uwStille.osc.stop(); uwStille.ctx.close(); } catch (e) {}
    uwStille = null;
  }

  function warte(ms, lauf, tick) {
    return warteWenn(ms, function () { return uw && lauf === uw.lauf; }, tick);
  }
  function warteWenn(ms, laeuft, tick) {
    return new Promise(function (fertig) {
      var start = Date.now();
      (function schritt() {
        if (!laeuft()) { fertig(); return; }
        var rest = ms - (Date.now() - start);
        if (tick) tick(rest);
        if (rest <= 0) { fertig(); return; }
        setTimeout(schritt, Math.min(200, rest));
      })();
    });
  }

  function uwText(id, text) {
    var el = document.getElementById(id);
    el.textContent = text || "";
    if (id === "uw-phase" || id === "uw-vorne") uwMedienInfo();
  }

  /* ---------- Unterwegs im Hintergrund und auf dem Sperrbildschirm ----------
     Handys lassen eine Seite im Hintergrund nur weiterlaufen, wenn sie Medien abspielt.
     Deshalb läuft während der Hörrunde ein stummer Audio-Loop über ein <audio>-Element
     (die Stille über Web Audio zählt dafür nicht). Dazu kommen Titel und Tasten
     (Pause, Nächste, Zurück) auf dem Sperrbildschirm bzw. in der Benachrichtigung. */
  var uwAudio = null;
  function stummeWavUrl() {
    var rate = 8000, n = rate * 10, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, "data"); v.setUint32(40, n, true);
    for (var i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  function uwMedienAn() {
    // Ohne die Option keine stumme Wiedergabe: die würde Spotify & Co. anhalten
    if (!uwEinstellungen().hintergrund) { tonMischen(true); return; }
    tonMischen(false);
    try {
      if (!uwAudio) { uwAudio = new Audio(stummeWavUrl()); uwAudio.loop = true; }
      var p = uwAudio.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
    if (!("mediaSession" in navigator)) return;
    var ms = navigator.mediaSession;
    function tu(a, fn) { try { ms.setActionHandler(a, fn); } catch (e) {} }
    function klick(id) { var b = document.getElementById(id); if (b && !b.disabled) b.click(); }
    tu("play", function () { if (uw && (uw.pausiert || uw.fertig)) klick("uw-pause"); });
    tu("pause", function () { if (uw && !uw.pausiert && !uw.fertig) klick("uw-pause"); });
    tu("nexttrack", function () { klick("uw-naechste"); });
    tu("previoustrack", function () { klick("uw-zurueck"); });
    tu("stop", function () { uwBeenden(); });
  }
  function uwMedienInfo() {
    if (!uw || !("mediaSession" in navigator) || !uwEinstellungen().hintergrund) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: document.getElementById("uw-vorne").textContent || "Unterwegs",
        artist: document.getElementById("uw-phase").textContent + " · " + document.getElementById("uw-stand").textContent,
        album: "Vokabelkasten · Unterwegs",
        artwork: [{ src: "icon.png", sizes: "512x512", type: "image/png" }, { src: "icon-180.png", sizes: "180x180", type: "image/png" }]
      });
      navigator.mediaSession.playbackState = (uw.pausiert || uw.fertig) ? "paused" : "playing";
    } catch (e) {}
  }
  function uwMedienAus() {
    if (uwAudio) try { uwAudio.pause(); } catch (e) {}
    tonMischen(true);   // nach der Runde wieder mit anderer Musik mischen
    if ("mediaSession" in navigator) try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    } catch (e) {}
  }
  /* Laufende Hörrunde merken: wird die App im Hintergrund beendet, kann man später weiterhören */
  function uwMerken() {
    if (!uw || uw.fertig) { if (daten.uwSitzung) { delete daten.uwSitzung; sichern(); } return; }
    daten.uwSitzung = { ids: uw.karten.map(function (c) { return c.id; }), i: uw.i, reihe: uw.reihe, zeit: Date.now() };
    sichern();
  }
  function uwGemerkt() {
    var s = daten.uwSitzung;
    if (!s || !Array.isArray(s.ids) || !s.ids.length || Date.now() - s.zeit > 3 * 86400000) return null;
    var nachId = {};
    daten.cards.forEach(function (c) { nachId[c.id] = c; });
    var karten = s.ids.map(function (id) { return nachId[id]; }).filter(Boolean);
    if (!karten.length || s.i >= karten.length) return null;
    return { karten: karten, i: Math.max(0, s.i), reihe: !!s.reihe };
  }
  function uwWeiterKnopf() {
    var g = uwGemerkt(), b = document.getElementById("btn-uw-weiter");
    b.hidden = !g;
    if (g) b.textContent = "▶ Weiterhören · Karte " + (g.i + 1) + " von " + g.karten.length;
  }

  function uwKarte() {
    if (!uw) return;
    var lauf = ++uw.lauf;
    sprache.cancel();
    var c = uw.karten[uw.i];
    if (!c) { uwFertig(); return; }
    var e = uwEinstellungen();
    // „Gemischt“: je Karte einmal gewürfelt und für die Runde gemerkt (Zurück/Weiter bleibt gleich)
    uw.wurf = uw.wurf || {};
    if (e.richtung === "mix" && !(uw.i in uw.wurf)) uw.wurf[uw.i] = Math.random() < 0.5;
    var deZuerst = e.richtung === "mix" ? uw.wurf[uw.i] : e.richtung === "de";
    var frage = deZuerst ? c.front : c.back, antwort = deZuerst ? c.back : c.front;
    var sFrage = deZuerst ? "de-DE" : "en-GB", sAntwort = deZuerst ? "en-GB" : "de-DE";
    var aktiv = function () { return uw && lauf === uw.lauf; };
    if (uw.zeigI !== uw.i) { uw.vorI = uw.zeigI; uw.zeigI = uw.i; uw.wechselZeit = Date.now(); }

    uwText("uw-stand", (uw.i + 1) + " / " + uw.karten.length);
    uwMerken();
    uwText("uw-phase", "Hör zu");
    uwText("uw-vorne", frage);
    uwText("uw-hinten", "");
    uwText("uw-bsp", "");
    document.getElementById("uw-pause").textContent = "Pause";
    uwExtraZeigen();

    sprich(frage, sFrage, lauf)
      .then(function () {
        return warte(e.denk * 1000, lauf, function (rest) {
          if (aktiv()) uwText("uw-phase", "Denk nach · " + Math.max(1, Math.ceil(rest / 1000)));
        });
      })
      .then(function () {
        if (!aktiv()) return;
        uwText("uw-phase", "Lösung");
        uwText("uw-hinten", antwort);
        return sprich(antwort, sAntwort, lauf);
      })
      .then(function () {
        if (!aktiv() || !e.bsp || !c.bsp) return;
        uwText("uw-bsp", c.bsp);
        return warte(400, lauf).then(function () { return sprich(c.bsp, "en-GB", lauf); });
      })
      .then(function () { return warte(1600, lauf); })
      .then(function () {
        if (!aktiv()) return;
        uw.i++;
        uwKarte();
      });
  }


  function uwExtraZeigen() {
    var c = uw && !uw.fertig ? uw.karten[uw.i] : null;
    document.getElementById("uw-extra").hidden = !c;
    document.getElementById("uw-zurueck").disabled = !c || uw.i === 0;
    document.getElementById("uw-naechste").disabled = !c;
    if (!c) return;
    var m = document.getElementById("uw-merk");
    m.className = "ghost" + (c.merk ? " on" : "");
    m.textContent = c.merk ? "\u2605 Schwierig" : "\u2606 Schwierig";
    m.setAttribute("aria-pressed", c.merk ? "true" : "false");
    var k = document.getElementById("uw-kasten");
    k.className = "ghost" + (c.aktiv ? " drin" : "");
    k.textContent = c.aktiv ? "\u2713 Im Kasten" : "+ Kasten";
    k.title = c.aktiv ? "Diese Karte ist im Kasten" : "Diese Karte zum \u00dcben in den Kasten legen";
    k.disabled = !!c.aktiv;
  }

  function uwFertig() {
    uw.fertig = true;
    uw.lauf++;
    uwText("uw-stand", uw.karten.length + " / " + uw.karten.length);
    uwText("uw-phase", "Runde fertig");
    uwText("uw-vorne", "Alle " + uw.karten.length + (uw.karten.length === 1 ? " Karte" : " Karten") + " gehört.");
    uwText("uw-hinten", "");
    var neu = Object.keys(uw.neu).length;
    uwText("uw-bsp", neu ? (neu === 1 ? "1 Karte" : neu + " Karten") + " in den Kasten gelegt – sie kommen beim nächsten Üben in Fach 1 dran." : "");
    document.getElementById("uw-pause").textContent = "Nochmal";
    uwExtraZeigen();
    uwSchlafen();
    stilleAus();
    uwMerken();
    uwMedienInfo();
    if (uwAudio) try { uwAudio.pause(); } catch (e) {}
  }

  function uwWach() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (s) { uwSperre = s; }).catch(function () {});
  }
  function uwSchlafen() {
    if (uwSperre) { uwSperre.release().catch(function () {}); uwSperre = null; }
  }

  function nachListe(karten) {
    return karten.slice().sort(function (a, b) { return a.ord - b.ord; });
  }
  // ohne Angabe gelten die Einstellungen im Anhören-Bereich; die Liste reicht ihre Treffer herein
  function uwStarten(eigene, fortsetzen) {
    if (!sprache) { melde("Dieser Browser kann leider nicht vorlesen."); return; }
    var reihe, karten;
    if (fortsetzen) {
      uw = { karten: fortsetzen.karten, reihe: fortsetzen.reihe, i: fortsetzen.i, lauf: 0, pausiert: false, fertig: false, neu: {} };
      uwEinstellungenZeigen();
      document.getElementById("unterwegs").hidden = false;
      stilleAn();
      uwMedienAn();
      uwWach();
      waechterAbgleichen();
      uwKarte();
      return;
    }
    if (Array.isArray(eigene)) { karten = eigene; reihe = true; }
    else {
      var auswahl = uwEinstellungen().auswahl;
      karten = uwKartenAuswahl(auswahl);
      reihe = auswahl === "liste";
      if (!karten.length) { hoerInfo(); return; }
    }
    if (!karten.length) return;
    uw = { karten: reihe ? nachListe(karten) : mische(karten.slice()), reihe: reihe,
           i: 0, lauf: 0, pausiert: false, fertig: false, neu: {} };
    uwEinstellungenZeigen();
    document.getElementById("unterwegs").hidden = false;
    stilleAn();                               // muss direkt im Tipp auf den Knopf starten (Autoplay-Regeln)
    uwMedienAn();
    uwWach();
    waechterAbgleichen();
    uwKarte();
  }

  function uwBeenden() {
    if (!uw) return;
    var geaendert = uw.geaendert;
    uw.lauf++;
    uw = null;
    sprache.cancel();
    uwSchlafen();
    stilleAus();
    uwMedienAus();
    document.getElementById("unterwegs").hidden = true;
    waechterAbgleichen();
    uwWeiterKnopf();
    if (geaendert) { zeichneListe(); zeichneUeben(); }
  }

  document.getElementById("btn-unterwegs").addEventListener("click", function () { uwStarten(); });
  document.getElementById("btn-uw-weiter").addEventListener("click", function () {
    var g = uwGemerkt();
    if (g) uwStarten(null, g); else uwWeiterKnopf();
  });
  document.getElementById("btn-liste-hoeren").addEventListener("click", function () { uwStarten(listeTreffer); });
  document.getElementById("uw-ende").addEventListener("click", uwBeenden);
  document.getElementById("uw-pause").addEventListener("click", function () {
    if (!uw) return;
    if (uw.fertig) {                        // „Nochmal“: dieselben Karten neu gemischt
      uw = { karten: uw.reihe ? uw.karten : mische(uw.karten.slice()), reihe: uw.reihe,
             i: 0, lauf: uw.lauf, pausiert: false, fertig: false, neu: uw.neu, geaendert: uw.geaendert };
      stilleAn();
      uwMedienAn();
      uwWach();
      uwKarte();
      return;
    }
    if (uw.pausiert) {                      // weiter: die aktuelle Karte beginnt von vorn
      uw.pausiert = false;
      if (uwAudio && uwEinstellungen().hintergrund) { var p = uwAudio.play(); if (p && p.catch) p.catch(function () {}); }
      uwKarte();
      return;
    }
    uw.pausiert = true;
    uw.lauf++;
    sprache.cancel();
    uwText("uw-phase", "Pausiert");
    this.textContent = "Weiter";
    if (uwAudio) try { uwAudio.pause(); } catch (e) {}
    uwMedienInfo();
  });
  document.getElementById("uw-naechste").addEventListener("click", function () {
    if (!uw || uw.fertig) return;
    uw.pausiert = false;
    uw.i++;
    uwKarte();
  });
  document.getElementById("uw-zurueck").addEventListener("click", function () {
    if (!uw || uw.fertig || uw.i === 0) return;
    uw.pausiert = false;
    uw.i--;
    uwKarte();
  });
  document.getElementById("uw-wdh").addEventListener("click", function () {
    if (!uw || uw.fertig) return;
    uw.pausiert = false;
    uwKarte();                             // dieselbe Karte noch einmal von vorn
  });
  document.getElementById("uw-merk").addEventListener("click", function () {
    var c = uw && !uw.fertig && uw.karten[uw.i];
    if (!c) return;
    c.merk = !c.merk;
    uw.geaendert = true;
    sichern();
    uwExtraZeigen();                       // die Ansage läuft ungestört weiter
  });
  document.getElementById("uw-kasten").addEventListener("click", function () {
    var c = uw && !uw.fertig && uw.karten[uw.i];
    if (!c || c.aktiv) return;
    aufnehmen([c]);
    uw.neu[c.id] = true;
    uw.geaendert = true;
    uwExtraZeigen();
  });
  ["uw-auswahl", "uw-denk", "uw-richtung", "uw-bsp-an", "uw-hintergrund", "uw-stimme-de", "uw-stimme-en", "uw-laut"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", uwEinstellungenMerken);
  });
  document.getElementById("uw-laut").addEventListener("input", lautAnzeigen);
  /* Lautstärke der Stimme: ein schlichter Lautsprecher-Knopf, antippen öffnet den Regler (Lernseite, Unterwegs, Duell).
     Alle Regler hängen an derselben Einstellung wie in den Optionen (uw-laut). */
  function lautSymbol(w) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ls-box" d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z"/>' +
      (w >= 15 ? '<path d="M15.3 9.3a3.8 3.8 0 0 1 0 5.4"/>' : '') +
      (w >= 55 ? '<path d="M17.9 6.8a7.3 7.3 0 0 1 0 10.4"/>' : '') + '</svg>';
  }
  function lautAlle() {
    var w = Math.round(uwEinstellungen().laut * 100);
    document.getElementById("ue-laut-zeile").hidden = !sprache;
    Array.prototype.forEach.call(document.querySelectorAll("[data-laut]"), function (el) {
      el.hidden = !sprache && !el.closest("#duell");   // im Duell bleibt der Signalton immer einstellbar
      el.querySelector(".laut-knopf").innerHTML = lautSymbol(w);
      el.querySelector("input").value = String(w);
      el.querySelector("b").textContent = w + " %";
    });
  }
  function lautZu(ausser) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-laut]"), function (el) {
      if (el === ausser) return;
      el.querySelector(".laut-pop").hidden = true;
      el.querySelector(".laut-knopf").setAttribute("aria-expanded", "false");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-laut]"), function (el) {
    el.innerHTML = '<button type="button" class="laut-knopf" aria-label="Lautstärke der Stimme" aria-expanded="false"></button>' +
      '<span class="laut-pop" hidden><span class="laut-zeile"><small>Stimme</small><input type="range" min="10" max="100" step="5" aria-label="Lautstärke der Stimme"><b></b></span></span>';
    var knopf = el.querySelector(".laut-knopf"), pop = el.querySelector(".laut-pop");
    knopf.addEventListener("click", function (e) {
      e.stopPropagation();
      lautZu(el);
      pop.hidden = !pop.hidden;
      knopf.setAttribute("aria-expanded", String(!pop.hidden));
    });
    pop.addEventListener("click", function (e) { e.stopPropagation(); });
    el.querySelector("input").addEventListener("input", function (e) {
      var ziel = document.getElementById("uw-laut");
      ziel.value = e.target.value;
      ziel.dispatchEvent(new Event("change", { bubbles: true }));   // speichert wie in den Optionen
      lautAnzeigen();
      lautAlle();
    });
  });
  document.addEventListener("click", function () { lautZu(null); });
  // Im Duell steckt auch der Signalton im selben Fenster (statt eines zweiten Lautsprechers unten)
  (function () {
    var pop = document.querySelector("#duell [data-laut] .laut-pop"), alt = document.querySelector("#duell .du-laut");
    if (!pop || !alt) return;
    var zeile = document.createElement("span");
    zeile.className = "laut-zeile";
    zeile.innerHTML = "<small>Signalton</small>";
    zeile.appendChild(document.getElementById("du-laut-spiel"));
    zeile.appendChild(document.getElementById("du-laut-spiel-wert"));
    pop.appendChild(zeile);
    alt.parentNode.removeChild(alt);
  })();
  document.getElementById("uw-laut").addEventListener("input", lautAlle);
  function uwLautOben() { lautAlle(); }
  try { lautAlle(); } catch (err) {}
  Array.prototype.forEach.call(document.querySelectorAll(".probe"), function (b) {
    b.addEventListener("click", function () {
      if (uw) return;
      stimmProbe(b.dataset.probe);
    });
  });
  document.addEventListener("visibilitychange", function () {
    if (uw && !uw.fertig && document.visibilityState === "visible") uwWach();
  });
  // Seite wird im Hintergrund beendet (v. a. iOS): Stand der Runde noch schnell sichern
  window.addEventListener("pagehide", function () { if (uw) uwMerken(); else if (aktuell || runde.length) sitzungMerken(); });
  if (!sprache) {
    // ohne Sprachausgabe gibt es nichts anzuhören - dann auch keinen Umschalter
    document.getElementById("modus").hidden = true;
    document.getElementById("ab-stimme").hidden = true;   // ohne Sprachausgabe kein Abschnitt „Stimme und Hören“
  } else if (sprache.getVoices) {
    sprache.getVoices();                    // Stimmen schon mal laden lassen
    // Die Stimmen kommen oft erst nach dem Start - dann die Auswahl neu füllen
    if (sprache.addEventListener) sprache.addEventListener("voiceschanged", stimmenFuellen);
    else sprache.onvoiceschanged = stimmenFuellen;
    [500, 1500, 3000].forEach(function (ms) { setTimeout(stimmenFuellen, ms); });
  }


  /* =====================================================================
     Quiz / Vokabel-Duell (experimentell)
     Zwei Spieler, die App liest vor. Wer antwortet, sagt seinen Namen davor
     („Kirsten: suggestion“). Richtig = 1 Punkt; falsch oder „weiß nicht“ →
     die andere Person darf antworten und bekommt 2 Punkte. Unsichere Fälle
     entscheidet die mitfahrende Person per Knopf. Fächer und Termine bleiben
     unberührt.
     Aufbau: Text-Normalisierung und Antwortvergleich (duNorm, duPasst),
     Namen im Text (duWer), Spracherkennung (duHoere), Spielablauf (duFrage).
     ===================================================================== */
  var DU_SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var du = null;   // laufendes Spiel
  var duLaufBasis = 0;

  function duEinstellungen() {
    var e = daten.duell || {};
    // Früher stand "Kevin" und "Kirsten" voreingestellt: gespeicherte Namen genau dieser Art werden einmalig auf die neutralen Namen zurückgesetzt
    // (namenV 2 = die Namen sind seit der Umstellung gespeichert, dann bleibt alles, was jemand eintippt)
    var altVoreinstellung = e.namenV !== 2 && e.namen && e.namen[0] === "Kevin" && e.namen[1] === "Kirsten";
    return {
      namen: altVoreinstellung ? ["Spieler 1", "Spieler 2"] : [e.namen && e.namen[0] || "Spieler 1", e.namen && e.namen[1] || "Spieler 2"],
      ziel: ["10", "20", "30", "alle", "p10"].indexOf(e.ziel) > -1 ? e.ziel : "10",
      zeit: [1, 2, 3, 4, 5, 6, 8, 10, 12].indexOf(e.zeit) > -1 ? e.zeit : 5,
      bsp: !!e.bsp,
      tonLaut: typeof e.tonLaut === "number" && e.tonLaut >= 0.2 && e.tonLaut <= 1.5 ? e.tonLaut : 0.8,
      streng: [0, 1, 2].indexOf(e.streng) > -1 ? e.streng : 1,
      reihe: e.reihe === "liste" ? "liste" : "zufall",
      auswahl: ["kasten", "faellig", "schwierig", "alle"].indexOf(e.auswahl) > -1 ? e.auswahl : (imKasten().length ? "kasten" : "alle"),
      richtung: e.richtung === "en" ? "en" : "de",
      manuell: !!e.manuell || !DU_SR,
      diagnose: !!e.diagnose
    };
  }
  function duEinstellungenZeigen() {
    var e = duEinstellungen();
    document.getElementById("du-name1").value = e.namen[0];
    document.getElementById("du-name2").value = e.namen[1];
    document.getElementById("du-ziel").value = e.ziel;
    document.getElementById("du-zeit").value = String(e.zeit);
    document.getElementById("du-auswahl").value = e.auswahl;
    document.getElementById("du-richtung").value = e.richtung;
    var man = document.getElementById("du-manuell");
    man.checked = e.manuell;
    man.disabled = !DU_SR;
    document.getElementById("du-diagnose").checked = e.diagnose;
    document.getElementById("du-bsp").checked = e.bsp;
    duLautZeigen();
    document.getElementById("du-streng").value = String(e.streng);
    document.getElementById("du-reihe").value = e.reihe;
    duKartenInfo();
    duStatusZeigen();
    duStatKurz();
  }
  function duEinstellungenMerken() {
    var n1 = document.getElementById("du-name1").value.trim() || "Spieler 1";
    var n2 = document.getElementById("du-name2").value.trim() || "Spieler 2";
    daten.duell = {
      namen: [n1, n2], namenV: 2,
      ziel: document.getElementById("du-ziel").value,
      zeit: Number(document.getElementById("du-zeit").value) || 5,
      bsp: document.getElementById("du-bsp").checked,
      tonLaut: (Number(document.getElementById("du-tonlaut").value) || 80) / 100,
      streng: Number(document.getElementById("du-streng").value),
      reihe: document.getElementById("du-reihe").value,
      auswahl: document.getElementById("du-auswahl").value,
      richtung: document.getElementById("du-richtung").value,
      manuell: document.getElementById("du-manuell").checked,
      diagnose: document.getElementById("du-diagnose").checked
    };
    sichern();
    duKartenInfo();
  }
  function duKarten(auswahl) {
    var t = heute();
    return daten.cards.filter(function (c) {
      if (!imKat(c)) return false;
      if (auswahl === "alle") return true;
      if (auswahl === "schwierig") return !!c.merk;
      if (!c.aktiv) return false;
      return auswahl === "kasten" || istDran(c, t);
    });
  }
  function duKartenInfo() {
    var e = duEinstellungen(), n = duKarten(e.auswahl).length;
    var el = document.getElementById("du-karten-info");
    el.textContent = "";
    var b = document.createElement("b");
    b.textContent = String(n);
    el.appendChild(b);
    el.appendChild(document.createTextNode(n === 1 ? " Karte zur Auswahl" : " Karten zur Auswahl"));
    document.getElementById("du-start").disabled = !n;
    document.getElementById("du-kurz").textContent = [auswahlText("du-ziel"), auswahlText("du-zeit"), auswahlText("du-auswahl"), auswahlText("du-richtung")].join(" · ");
  }

  /* ---------- Was kann dieser Browser? (ehrlich, ohne Garantien) ---------- */
  function duStatusZeigen() {
    var el = document.getElementById("du-status");
    function zeige(art, titel, text) {
      el.className = "du-status " + art;
      el.textContent = "";
      var b = document.createElement("b"); b.textContent = titel; el.appendChild(b);
      el.appendChild(document.createTextNode(text));
    }
    if (!DU_SR) {
      zeige("warn", "Spracherkennung nicht verfügbar",
        "Dieser Browser kann gesprochene Antworten nicht erkennen. Das Duell läuft trotzdem: Die App liest vor, und die mitfahrende Person vergibt die Punkte per Knopf. Auf Android klappt die Erkennung in Chrome, auf dem iPhone in Safari.");
      return;
    }
    var offline = navigator.onLine === false ? " Gerade besteht keine Internetverbindung – die Erkennung wird dann vermutlich nicht funktionieren." : "";
    zeige("", "Spracherkennung verfügbar",
      "Sie läuft je nach Gerät meist über einen Onlinedienst (Google bzw. Apple) und braucht dann Internet." + offline +
      " Solange das Mikrofon zuhört, halten die meisten Handys Musik (z. B. Spotify) an – ohne Mikrofon (Punkte per Knopf) läuft sie weiter." +
      " Die Namenserkennung ist experimentell: Fahrgeräusche, Musik oder gleichzeitiges Sprechen können sie stören – dann fragt die App nach.");
    // Neuere Chrome-Versionen können melden, ob die Erkennung auf dem Gerät möglich ist
    var e = duEinstellungen(), lang = e.richtung === "de" ? "en-GB" : "de-DE";
    try {
      if (typeof DU_SR.available === "function") {
        Promise.resolve(DU_SR.available({ langs: [lang], processLocally: true })).then(function (st) {
          du_lokal = st === "available";
          if (du_lokal) zeige("gut", "Lokale Spracherkennung verfügbar",
            "Die Erkennung läuft auf diesem Gerät, ohne Onlinedienst." +
            " Die Namenserkennung bleibt experimentell: Fahrgeräusche, Musik oder gleichzeitiges Sprechen können sie stören – dann fragt die App nach.");
        }).catch(function () {});
      }
    } catch (x) {}
  }
  var du_lokal = false;

  /* ---------- Text vergleichen ---------- */
  // klein, ohne Satzzeichen, Umlaute ausgeschrieben, Akzente weg
  function duNorm(s) {
    return String(s || "").toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[’'`´]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function duLev(a, b) {
    if (a === b) return 0;
    var v = [], i, j;
    for (j = 0; j <= b.length; j++) v[j] = j;
    for (i = 1; i <= a.length; i++) {
      var prev = v[0]; v[0] = i;
      for (j = 1; j <= b.length; j++) {
        var tmp = v[j];
        v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return v[b.length];
  }
  var DU_WEG_EN = /^(to|the|a|an) /, DU_WEG_DE = /^(sich|der|die|das|den|dem|ein|eine|einen|zu) /;
  // alle Formen, die als richtig gelten: jede Variante („proposal / suggestion“), mit und ohne „to“, Klammern usw.
  function duLoesungen(text) {
    var out = [];
    String(text || "").split(/\s*[\/;]\s*|\s+oder\s+|\s+or\s+/).forEach(function (v) {
      var roh = v.replace(/\b(sth|sb|etw|jmdm|jmdn|jmds)\./g, " ").replace(/…|\.\.\./g, " ");
      [roh.replace(/\([^)]*\)/g, " "), roh.replace(/[()]/g, " ")].forEach(function (x) {
        var n = duNorm(x);
        if (!n) return;
        out.push(n);
        var kurz = n.replace(DU_WEG_EN, "").replace(DU_WEG_DE, "");
        if (kurz && kurz !== n) out.push(kurz);
      });
    });
    return out.filter(function (x, i) { return out.indexOf(x) === i; });
  }
  // erlaubte Tippfehler je Länge; Stufe 0 = genau, 1 = locker, 2 = sehr locker
  function duErlaubt(len, stufe) {
    if (stufe === 2) return len <= 2 ? 0 : len <= 4 ? 1 : len <= 7 ? 2 : Math.ceil(len * 0.33);
    if (stufe === 1) return len <= 3 ? 0 : len <= 5 ? 1 : len <= 9 ? 2 : Math.ceil(len * 0.25);
    return len <= 4 ? 0 : len <= 7 ? 1 : len <= 12 ? 2 : Math.floor(len * 0.18);
  }
  // grober „Klang-Schlüssel“: gleich klingende Schreibweisen werden gleich (ph/f, th/t, c/k, v/w, ee/ea/i …),
  // stummes End-e und Auslautverhärtung (d→t, b→p, g→k) fallen weg, doppelte Buchstaben zählen einfach
  function duKlang(s) {
    return (" " + s + " ").replace(/ph/g, "f").replace(/th/g, "t").replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s")
      .replace(/[cq]/g, "k").replace(/x/g, "ks").replace(/z/g, "s").replace(/v/g, "w").replace(/y/g, "i")
      .replace(/ae/g, "e").replace(/oe/g, "o").replace(/ue/g, "u").replace(/ie|ee|ea/g, "i").replace(/oo|ou/g, "u")
      .replace(/([^ ])h/g, "$1").replace(/dt|d(?= )/g, "t").replace(/b(?= )/g, "p").replace(/g(?= )/g, "k")
      .replace(/([^ ])e(?= )/g, "$1").replace(/(.)\1+/g, "$1").trim();
  }
  function duPasst(gesagt, loesungen, stufe) {
    if (stufe == null) stufe = du && du.streng != null ? du.streng : duEinstellungen().streng;
    var g = duNorm(gesagt), best = { ok: false, wert: 0, ziel: loesungen[0] || "" };
    if (!g) return best;
    var gk = g.replace(DU_WEG_EN, "").replace(DU_WEG_DE, "");
    loesungen.forEach(function (l) {
      var lKlang = duKlang(l), n = l.split(" ").length;
      [g, gk].forEach(function (x) {
        // Kandidaten: die ganze Antwort; locker auch nach Klang und jedes passende Stück eines längeren Satzes
        var teile = [x];
        if (stufe > 0) {
          var w = x.split(" ");
          if (w.length > n) for (var len = Math.max(1, n - 1); len <= n + 1; len++)
            for (var i = 0; i + len <= w.length; i++) teile.push(w.slice(i, i + len).join(" "));
        }
        teile.forEach(function (t) {
          var d = duLev(t, l), wert = 1 - d / Math.max(t.length, l.length, 1);
          var ok = d <= duErlaubt(l.length, stufe) ||
                   (" " + x + " ").indexOf(" " + l + " ") > -1 && l.length >= 4;   // „the proposal“, „I think proposal“
          if (!ok && stufe > 0) {
            // nach Klang eine Stufe strenger - sonst würde „hint“ zu „hand“
            var tk = duKlang(t), dk = duLev(tk, lKlang);
            if (dk <= duErlaubt(lKlang.length, stufe - 1)) { ok = true; wert = Math.max(wert, 1 - dk / Math.max(tk.length, lKlang.length, 1)); }
          }
          if (ok) wert = Math.max(wert, 0.9);
          if (ok > best.ok || (ok === best.ok && wert > best.wert)) best = { ok: ok, wert: wert, ziel: l };
        });
      });
    });
    return best;
  }
  var DU_PASS = ["weiss nicht", "weiss ich nicht", "keine ahnung", "passe", "pass", "ich passe", "i dont know", "dont know",
                 "no idea", "i pass", "skip", "keine idee", "weiter"];
  function duIstPass(t) {
    t = duNorm(t);
    return DU_PASS.some(function (p) { return t === p || (t.indexOf(p) === 0 && t.length <= p.length + 6); });
  }

  /* ---------- Wer hat geantwortet? Name am Anfang (oder am Ende) des Satzes ---------- */
  function duNamensKey(s) {
    return duNorm(s).replace(/[^a-z]/g, "").replace(/ph/g, "f").replace(/th/g, "t").replace(/c/g, "k")
      .replace(/y/g, "i").replace(/ie/g, "i").replace(/h/g, "").replace(/(.)\1+/g, "$1");
  }
  function duIstName(wort, name) {
    var a = duNamensKey(wort), b = duNamensKey(name);
    if (!a || !b) return false;
    if (a === b) return true;
    return duLev(a, b) <= (b.length >= 6 ? 2 : 1) && Math.abs(a.length - b.length) <= 2;
  }
  var DU_FUELL = /^(sagt|says|meint|ist|is|antwort|answer|ich|i|also|aehm|aeh|um|uh|aeh|hm|aaeh)$/;
  // Ergebnis: { wer: 0|1|-1 (unbekannt)|2 (beide genannt), antwort: Rest ohne Namen }
  function duWer(text, namen) {
    var w = duNorm(text).split(" ").filter(Boolean);
    function treffer(i, len) {
      var stueck = w.slice(i, i + len).join("");
      for (var p = 0; p < 2; p++) if (duIstName(stueck, namen[p])) return p;
      return -1;
    }
    var genannt = {}, wer = -1, von = 0, bis = w.length;
    // am Anfang: ein Wort oder zwei zusammengezogene („kir sten“)
    for (var len = 1; len <= 2 && wer < 0; len++) {
      var p = treffer(0, len);
      if (p > -1) { wer = p; von = len; }
    }
    // sonst am Ende („proposal, Kevin“)
    if (wer < 0 && w.length > 1) {
      var q = treffer(w.length - 1, 1);
      if (q > -1) { wer = q; bis = w.length - 1; }
    }
    if (wer > -1) genannt[wer] = true;
    // der andere Name auch noch drin? Dann haben vermutlich beide gesprochen
    w.forEach(function (x, i) {
      if (i < von || i >= bis) return;
      for (var p2 = 0; p2 < 2; p2++) if (p2 !== wer && duIstName(x, namen[p2])) genannt[p2] = true;
    });
    var rest = w.slice(von, bis);
    while (rest.length && DU_FUELL.test(rest[0])) rest.shift();
    return { wer: Object.keys(genannt).length > 1 ? 2 : wer, antwort: rest.join(" ") };
  }

  /* ---------- Zuhören: Spracherkennung für ein Antwortfenster ----------
     fertig({ grund, fehler }) - grund: "entschieden" | "zeit" | "fehler" | "abbruch".
     jeder(alternativen) wird bei jedem fertigen Satz aufgerufen; gibt er true zurück,
     ist die Frage entschieden und das Zuhören endet sofort. */
  function duHoere(lang, ms, lauf, jeder, zwischen) {
    return new Promise(function (fertig) {
      var aktiv = function () { return du && lauf === du.lauf; };
      if (!aktiv()) { fertig({ grund: "abbruch" }); return; }
      var rec;
      try { rec = new DU_SR(); } catch (x) { fertig({ grund: "fehler", fehler: "start" }); return; }
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      try { if (du_lokal) rec.processLocally = true; } catch (x) {}
      var ende = false, start = Date.now(), frist = start + ms, zwischenText = "", fehler = null, timer = null;
      var versuche = 0, nachPause = false;
      du.rec = rec;
      function starte() {
        if (ende) return;
        try { rec.start(); }
        catch (x) {
          if (++versuche <= 3 && Date.now() < frist) { setTimeout(starte, 300); return; }
          fehler = fehler || "start"; schluss("fehler");
        }
      }
      function schluss(grund) {
        if (ende) return;
        ende = true;
        clearInterval(timer);
        duMicFreigeben(rec);
        if (du) du.rec = null;
        tonMischen(true);
        // Zeit um, aber ein Satz war noch unfertig: den letzten Stand trotzdem werten
        if (grund === "zeit" && zwischenText) { var t = zwischenText; zwischenText = ""; if (jeder([t], true)) grund = "entschieden"; }
        fertig({ grund: grund, fehler: fehler, sprachBeginn: du ? du.sprachBeginn : null });
      }
      rec.onresult = function (ev) {
        if (!aktiv()) { schluss("abbruch"); return; }
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var r = ev.results[i];
          if (du.sprachBeginn == null) du.sprachBeginn = Date.now() - start;
          if (r.isFinal) {
            var alt = [];
            for (var j = 0; j < r.length; j++) if (r[j].transcript) alt.push(r[j].transcript);
            zwischenText = "";
            if (alt.length && jeder(alt, false)) { schluss("entschieden"); return; }
          } else {
            zwischenText = r[0].transcript;
            if (zwischen) zwischen(zwischenText);
          }
        }
      };
      rec.onerror = function (ev) {
        if (ev.error === "no-speech" || ev.error === "aborted") return;
        fehler = ev.error;
        if (du && du.frage) du.frage.notiz.push("Mikrofon: Fehler „" + ev.error + "“" + (versuche ? " (Versuch " + (versuche + 1) + ")" : ""));
        // Mikro kurz belegt (z. B. noch vom letzten Zuhören): gleich noch einmal versuchen
        if (ev.error === "audio-capture" && versuche < 3 && Date.now() < frist) { versuche++; nachPause = true; return; }
        if (["not-allowed", "service-not-allowed", "network", "language-not-supported", "audio-capture"].indexOf(ev.error) > -1) schluss("fehler");
      };
      // Manche Browser beenden die Erkennung nach einer Pause von selbst - dann neu starten
      rec.onend = function () {
        if (ende) return;
        if (Date.now() < frist) {
          if (nachPause) { nachPause = false; setTimeout(starte, 300); return; }
          try { rec.start(); return; } catch (x) {}
        }
        schluss("zeit");
      };
      timer = setInterval(function () {
        if (!aktiv()) { schluss("abbruch"); return; }
        var rest = frist - Date.now();
        duZeitAnzeigen(rest);
        // nach Ablauf noch bis zu 2,5 s warten, wenn gerade jemand mitten im Satz ist
        if (rest <= 0 && (!zwischenText || rest < -2500)) schluss("zeit");
      }, 200);
      // erst starten, wenn das vorige Zuhören das Mikro wirklich freigegeben hat (sonst bleibt es beim 2. Versuch aus)
      Promise.resolve(duMicBelegt).then(function () {
        if (ende) return;
        if (!aktiv()) { schluss("abbruch"); return; }
        start = Date.now(); frist = start + ms;
        starte();
      });
    });
  }

  /* ---------- Ton, Sprache, Anzeige ---------- */
  var duTonCtx = null;
  function duTon(hoch, freq, kraeftig) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      tonMischen(true);
      if (!duTonCtx) duTonCtx = new AC();
      if (duTonCtx.state === "suspended") duTonCtx.resume();
      var t = duTonCtx.currentTime, o = duTonCtx.createOscillator(), g = duTonCtx.createGain();
      var laut = duEinstellungen().tonLaut, dauer = kraeftig ? 0.34 : 0.3;
      // weicher „Glockenton“: Sinus (tiefer als früher) mit leisem Oberton, sanftem Einsatz und langem Ausklang
      o.frequency.value = freq || (hoch ? 880 : 659);
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(laut, t + 0.045);   // Signalton-Lautstärke (Quiz-Seite)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
      o.connect(g);
      var o2 = duTonCtx.createOscillator(), g2 = duTonCtx.createGain();
      o2.type = "sine"; o2.frequency.value = o.frequency.value * 2;
      g2.gain.value = 0.18;
      o2.connect(g2); g2.connect(g);
      g.connect(duTonCtx.destination);
      o.start(t); o.stop(t + dauer + 0.03);
      o2.start(t); o2.stop(t + dauer + 0.03);
    } catch (x) {}
  }
  function duSprich(text, lang, lauf) {
    return sprichWenn(text, lang, function () { return du && lauf === du.lauf; });
  }
  // beide Schieberegler (Quiz-Seite und im Spiel) zeigen denselben Wert
  function duLautZeigen() {
    var v = Math.round(duEinstellungen().tonLaut * 100);
    ["du-tonlaut", "du-laut-spiel"].forEach(function (id) {
      var r = document.getElementById(id);
      if (String(r.value) !== String(v)) r.value = v;
      document.getElementById(id + "-wert").textContent = v + " %";
    });
  }
  // Stern = „Schwierig“ (wird sofort gespeichert, gilt auch beim normalen Üben)
  function duMerkZeigen() {
    var b = document.getElementById("du-merk"), c = du && du.frage && du.frage.karte, an = !!(c && c.merk);
    b.classList.toggle("on", an);
    b.setAttribute("aria-pressed", an ? "true" : "false");
    b.querySelector(".du-stern").textContent = an ? "\u2605" : "\u2606";
  }
  function duSetze(id, text) { document.getElementById(id).textContent = text || ""; }
  function duPhase(text, hoert) {
    var el = document.getElementById("du-phase");
    el.textContent = text;
    el.classList.toggle("hoert", !!hoert);
    document.getElementById("du-card").classList.toggle("hoert", !!hoert);
  }
  // Zeitbalken in der Karte: läuft während des Zuhörens ab
  function duUhr(rest) {
    document.getElementById("du-uhr").style.transform = "scaleX(" + Math.max(0, Math.min(1, rest / du.zeit)).toFixed(3) + ")";
  }
  function duPauseKnopf(text) {
    var b = document.getElementById("du-pause");
    b.querySelector("span").textContent = text;
    b.querySelector("svg").innerHTML = text === "Pause"
      ? '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>'
      : '<path d="M8 5.5v13l10.5-6.5z"/>';
  }
  function duZeitAnzeigen(rest) {
    if (!du || du.phase !== "hoeren") return;
    var p = du.nurSpieler;
    duPhase((p == null ? "" : duWerName(p) + (du.fuerZwei ? " · für 2 Punkte" : "") + " · ") + Math.max(0, Math.ceil(rest / 1000)) + " s", true);
    duUhr(rest);
  }
  function duTafel(hervor, plus) {
    for (var p = 0; p < 2; p++) {
      var el = document.getElementById("du-p" + p);
      el.querySelector(".du-pname").textContent = du.namen[p];
      el.querySelector(".du-punkte").textContent = String(du.punkte[p]);
      el.classList.toggle("dran", hervor === p);
      el.classList.toggle("plus", plus === p);
    }
    var n = du.i + 1;
    if (du.solo) {
      if (du.phase === "vorlesen") duFaecherZeigen(aktuell ? aktuell.box : 0);
      var offen = runde.length + (aktuell ? 1 : 0);
      document.getElementById("du-fort").style.width = Math.round(du.i / Math.max(1, du.i + offen) * 100) + "%";
      duSetze("du-frage-nr", "Karte " + n);
      duSetze("du-rest", offen + " offen");
      return;
    }
    var fort = du.ziel === "p10" ? Math.max(du.punkte[0], du.punkte[1]) / 10 : du.i / Math.max(1, du.anzahl);
    document.getElementById("du-fort").style.width = Math.min(100, Math.round(fort * 100)) + "%";
    duSetze("du-frage-nr", "Frage " + n + (du.anzahl ? " von " + du.anzahl : ""));
    duSetze("du-rest", du.ziel === "p10" ? "bis 10 Punkte" : (du.anzahl - n) + " übrig");
  }
  function duDiag(zeilen) {
    var el = document.getElementById("du-diag");
    if (!du.diagnose) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = zeilen.join("\n");
  }

  /* ---------- Spielablauf ---------- */
  function duStarten(nochmal) {
    if (!sprache) { melde("Dieser Browser kann leider nicht vorlesen."); return; }
    duEinstellungenMerken();
    var e = duEinstellungen();
    var karten = nochmal && du ? du.alleKarten : duKarten(e.auswahl);
    if (!karten.length) { duKartenInfo(); return; }
    document.getElementById("duell").classList.remove("solo");
    karten = e.reihe === "liste" ? nachListe(karten) : mische(karten.slice());   // zufällige Vokabelwahl
    var anzahl = e.ziel === "alle" || e.ziel === "p10" ? karten.length : Math.min(Number(e.ziel), karten.length);
    duLaufBasis += 10000;   // alte, noch wartende Abläufe erkennen sich nicht als „aktuell“
    du = { namen: e.namen.slice(), punkte: [0, 0], karten: karten, alleKarten: karten, anzahl: e.ziel === "p10" ? 0 : anzahl,
           ziel: e.ziel, zeit: e.zeit * 1000, richtung: e.richtung, manuell: e.manuell, diagnose: e.diagnose, bsp: e.bsp, streng: e.streng,
           i: 0, lauf: duLaufBasis, pausiert: false, auto: 0, hand: 0, rec: null, phase: "" };
    duTon(false);   // Audio im Tipp freischalten (iOS)
    duLautZeigen();
    document.getElementById("duell").hidden = false;
    document.getElementById("du-spiel").hidden = false;
    document.getElementById("du-schluss").hidden = true;
    stilleAn();
    uwWach();
    waechterAbgleichen();
    duFrage();
  }
  /* Vokabelkasten per Sprache: die laufende Übungsrunde wird mit dem Quiz-Ablauf abgefragt (vorlesen, Piep,
     zuhören, prüfen) und mit bewerten() gewertet - Fächer, Termine und Zusatzrunde für Sternkarten wie beim Üben.
     Antwortzeit, Aussprache, Signalton, Beispielsätze und Knopf-Modus kommen aus den Quiz-Einstellungen. */
  function duAlleinStarten(e) {
    if (!sprache) { melde("Dieser Browser kann leider nicht vorlesen."); return; }
    e = e || duEinstellungen();
    if (!aktuell) rundeStarten(false);
    if (!aktuell) return;
    duLaufBasis += 10000;
    du = { solo: true, namen: ["Gewusst", "Nochmal"], punkte: [0, 0], karten: [], alleKarten: [], anzahl: 0,
           ziel: "alle", zeit: e.zeit * 1000, richtung: e.richtung, manuell: e.manuell, diagnose: e.diagnose, bsp: e.bsp, streng: e.streng,
           i: 0, lauf: duLaufBasis, pausiert: false, auto: 0, hand: 0, rec: null, phase: "" };
    duTon(false);   // Audio im Tipp freischalten (iOS)
    duLautZeigen();
    document.getElementById("duell").classList.add("solo");
    document.getElementById("duell").hidden = false;
    document.getElementById("du-spiel").hidden = false;
    document.getElementById("du-schluss").hidden = true;
    stilleAn();
    uwWach();
    waechterAbgleichen();
    duFrage();
  }
  /* Fächer-Leiste: Karten im Kasten je Fach (wie beim Üben, mit der gewählten Kategorie).
     jetzt = Fach der aktuellen Karte, ziel = wohin sie gerade gewandert ist (kurz hervorgehoben) */
  function duFaecherZeigen(jetzt, ziel, hoch) {
    var el = document.getElementById("du-faecher");
    el.textContent = "";
    for (var f = 1; f <= 5; f++) {
      var n = daten.cards.filter(function (c) { return c.aktiv && imKat(c) && fachVon(c) === f; }).length;
      var d = document.createElement("div");
      d.className = "du-fach" + (f === jetzt ? " jetzt" : "") + (f === ziel ? " ziel" + (hoch ? " hoch" : " runter") : "");
      var b = document.createElement("b");
      b.textContent = String(n);
      var sm = document.createElement("small");
      sm.textContent = "Fach " + f;
      d.appendChild(b);
      d.appendChild(sm);
      el.appendChild(d);
    }
  }
  /* sofort werten, sobald feststeht, ob die Antwort richtig war - dann sieht man gleich, wohin die Karte wandert */
  function duSoloWerten(gewusst) {
    if (!du || !du.solo || du.gewertet || !du.frage) return;
    var k = du.frage.karte, vorher = fachVon(k);
    du.gewertet = true;
    du.offen = 0;
    if (aktuell === k) bewerten(gewusst);
    var nachher = fachVon(k);
    duFaecherZeigen(0, nachher, gewusst);
    duPhase(gewusst ? (nachher > vorher ? "Gewusst · Fach " + vorher + " → " + nachher : "Gewusst · bleibt in Fach " + nachher)
                    : (vorher > 1 ? "Zurück in Fach 1" : "Bleibt in Fach 1"));
  }
  // wer gerade antwortet - im Allein-Modus ohne Namen
  function duWerName(p) { return du.solo ? "Deine Antwort" : du.namen[p]; }
  /* nach einer Karte weiter: im Allein-Modus erst im Kasten werten (rückt die Übungsrunde weiter) */
  function duWeiter(gewusst) {
    if (du.solo) duSoloWerten(gewusst);
    du.i++;
    duFrage();
  }
  function duStopHoeren() {
    if (du && du.rec) { duMicFreigeben(du.rec); du.rec = null; }
  }
  // Erkennung abbrechen und merken, bis wann das Mikro noch belegt ist (höchstens 900 ms warten)
  var duMicBelegt = null;
  function duMicFreigeben(rec) {
    duMicBelegt = new Promise(function (frei) {
      var t = setTimeout(frei, 900);
      rec.onresult = rec.onerror = null;
      rec.onend = function () { clearTimeout(t); setTimeout(frei, 60); };
      try { rec.abort(); } catch (x) { clearTimeout(t); frei(); }
    });
  }
  function duSpielVorbei() {
    if (du.solo) return !aktuell;
    if (du.ziel === "p10") return du.punkte[0] >= 10 || du.punkte[1] >= 10 || du.i >= du.karten.length;
    return du.i >= du.anzahl;
  }

  /* Ablauf einer Vokabel (bewusst wortkarg):
     Vokabel vorlesen → Piep → Name dessen, der dran ist → zuhören.
     Richtig: Erfolgston, 1 Punkt. Falsch, „weiß nicht“ oder nichts: Name der anderen Person → zuhören,
     richtig = 2 Punkte. Wusste es keiner: nur die Lösung vorlesen. Dann die nächste Vokabel. */
  function duFrage() {
    if (!du) return;
    var lauf = ++du.lauf;
    duStopHoeren();
    sprache.cancel();
    if (duSpielVorbei()) { duEnde(); return; }
    var c = du.solo ? aktuell : du.karten[du.i];
    var deZuerst = du.solo ? (richtung === "mix" ? Math.random() < 0.5 : richtung !== "en") : du.richtung === "de";
    var frage = deZuerst ? c.front : c.back, antwort = deZuerst ? c.back : c.front;
    var sFrage = deZuerst ? "de-DE" : "en-GB", sAntwort = deZuerst ? "en-GB" : "de-DE";
    if (WISSEN) { sFrage = "de-DE"; sAntwort = "de-DE"; }   // Begriff und Bedeutung auf Deutsch (z. B. „Zugmodul“)
    du.frage = { karte: c, frage: frage, antwort: antwort, sFrage: sFrage, sAntwort: sAntwort,
                 loesungen: duLoesungen(antwort), notiz: [] };
    duMerkZeigen();
    du.gewertet = false;
    du.dran = du.solo ? 0 : du.i % 2;          // abwechselnd: Spieler 1 beginnt, dann Spieler 2, …
    du.nurSpieler = null;
    du.fuerZwei = false;
    du.sprachBeginn = null;
    du.phase = "vorlesen";
    duTafel(du.dran);
    duEntscheidZu();
    duPhase(du.solo ? "Fach " + fachVon(c) : du.namen[du.dran] + " ist dran");
    duSetze("du-vorne", frage);
    duSetze("du-hinten", "");
    duSetze("du-gehoert", "");
    duDiag([]);
    duPauseKnopf("Pause");
    var aktiv = function () { return du && lauf === du.lauf; };
    duSeite(null);
    duSprich(frage, sFrage, lauf)
      .then(function () { return warteWenn(120, aktiv); })   // nur der Nachhall der App-Stimme
      .then(function () { if (aktiv()) return duDran(lauf, du.dran, 1); });
  }
  // Piep, Name, dann zuhören (bzw. im Knopf-Modus warten)
  function duDran(lauf, wer, pkt) {
    var aktiv = function () { return du && lauf === du.lauf; };
    du.nurSpieler = wer;
    du.fuerZwei = pkt === 2;
    duTafel(wer);
    duSeite(wer);                 // linke bzw. rechte Bildschirmhälfte wird orange - kein Name mehr
    duTon(pkt === 2, 0, true);    // sanfter Glockenton: Mikro ist an
    if (du.manuell) return duManuellRunde(lauf, wer, pkt);
    // das Mikro startet erst, wenn der Piep verklungen ist - sonst kann Android das Mikro blockieren
    return warteWenn(380, aktiv).then(function () { if (aktiv()) return duHoerRunde(lauf, wer, pkt); });
  }

  /* Zuhören für die Person, die dran ist. Die erste Antwort zählt; Namen dürfen, müssen aber nicht fallen. */
  function duHoerRunde(lauf, wer, pkt) {
    var f = du.frage, aktiv = function () { return du && lauf === du.lauf; };
    du.phase = "hoeren";
    var ergebnis = null;
    function werte(alt, zuletzt) {
      var besteWahl = null;
      alt.forEach(function (t) {
        var w = duWer(t, du.solo ? ["", ""] : du.namen);
        var pass = duIstPass(w.antwort), p = duPasst(w.antwort, f.loesungen);
        var rang = (p.ok ? 4 : 0) + (pass ? 2 : 0) + (w.antwort ? 1 : 0);
        if (!besteWahl || rang > besteWahl.rang) besteWahl = { rang: rang, text: t, wer: w.wer, antwort: w.antwort, pass: pass, p: p };
      });
      var b = besteWahl;
      f.notiz.push(duWerName(wer) + " (" + pkt + " P.) – gehört: „" + b.text + "“" + (alt.length > 1 ? "  (+" + (alt.length - 1) + " Alternativen)" : "") +
        "\n  Antwort: „" + b.antwort + "“ · " + (b.pass ? "weiß nicht" : (b.p.ok ? "richtig" : "falsch")) +
        " (Ähnlichkeit " + Math.round(b.p.wert * 100) + " % zu „" + b.p.ziel + "“)" + (b.wer === 1 - wer ? " · Name der anderen Person – ignoriert" : ""));
      duSetze("du-gehoert", "„" + b.text + "“");
      duDiagZeigen();
      if (b.wer === 1 - wer) return false;     // die andere Person hat sich mit Namen eingemischt: zählt nicht
      if (!b.antwort) return false;            // nur ein Name o. Ä. – weiter zuhören
      ergebnis = b.p.ok && !b.pass ? "richtig" : "falsch";
      return true;
    }
    return duHoere(f.sAntwort, du.zeit, lauf, werte, function (z) {
      if (aktiv()) duSetze("du-gehoert", "„" + z + "“");
    }).then(function (r) {
      if (!aktiv()) return;
      du.phase = "pruefen";
      if (r.grund === "fehler") {
        f.notiz.push("Spracherkennung: Fehler „" + (r.fehler || "?") + "“");
        duDiagZeigen();
        if (r.fehler === "not-allowed" || r.fehler === "service-not-allowed") du.manuell = true;
        return duManuellEntscheid(lauf, r.fehler === "network" ? "Keine Verbindung für die Spracherkennung" :
          (du.manuell ? "Mikrofon nicht verfügbar" : "Spracherkennung gestört"), wer, pkt);
      }
      if (ergebnis === "richtig") { du.auto++; return duPunkt(lauf, wer, pkt); }
      if (du.solo && !ergebnis) return duSoloOffen(lauf, "Nichts gehört · Karte bleibt im Fach");   // nichts verstanden: nicht abwerten, nicht nachfragen
      if (pkt === 1 && !du.solo) {
        duPhase(ergebnis ? "Falsch" : "Keine Antwort");
        return duDran(lauf, 1 - wer, 2);       // die andere Person ist dran, für 2 Punkte
      }
      du.auto++;
      return duLoesung(lauf);
    });
  }

  // Wer dran ist: Spieler 1 = linke, Spieler 2 = rechte Bildschirmhälfte orange (null = keine)
  function duSeite(wer) {
    var el = document.getElementById("duell");
    if (wer === 0 || wer === 1) el.setAttribute("data-seite", String(wer));
    else el.removeAttribute("data-seite");
  }
  // Wusste es keiner: nur die Lösung vorlesen, dann weiter
  function duLoesung(lauf) {
    var f = du.frage, aktiv = function () { return du && lauf === du.lauf; };
    du.phase = "ergebnis";
    duSeite(null);
    if (du.solo) { du.punkte[1]++; duSoloWerten(false); }
    else { duTafel(-1); duPhase("Lösung"); }
    duSetze("du-hinten", f.antwort);
    return duSprich(f.antwort, f.sAntwort, lauf)
      .then(function () { return duBeispiel(lauf); })
      .then(function () { return warteWenn(900, aktiv); })
      .then(function () { if (aktiv()) duWeiter(false); });
  }
  // Punkt vergeben: Erfolgston und Tafel, ohne Ansage
  function duPunkt(lauf, wer, pkt) {
    var aktiv = function () { return du && lauf === du.lauf; };
    if (du.solo) return duSoloRichtig(lauf);
    if (wer === "beide") { du.punkte[0] += pkt; du.punkte[1] += pkt; }
    else du.punkte[wer] += pkt;
    duTafel(-1, wer === "beide" ? -1 : wer);
    duSeite(null);
    duErfolg();
    (wer === "beide" ? [0, 1] : [wer]).forEach(function (p) {
      var pl = document.querySelector("#du-p" + p + " .du-plus");
      pl.textContent = "+" + pkt;
      pl.classList.remove("pop"); void pl.offsetWidth; pl.classList.add("pop");
    });
    var karte = document.getElementById("du-card");
    karte.classList.remove("richtig"); void karte.offsetWidth; karte.classList.add("richtig");
    setTimeout(function () { karte.classList.remove("richtig"); }, 900);
    du.phase = "ergebnis";
    duPhase(du.solo ? "Gewusst" : "+" + pkt + " " + (wer === "beide" ? "beide" : du.namen[wer]));
    duSetze("du-hinten", du.frage.antwort);
    return warteWenn(700, aktiv)
      .then(function () { return duBeispiel(lauf); })
      .then(function () { return warteWenn(500, aktiv); })
      .then(function () { if (aktiv()) duWeiter(true); });
  }
  // Allein: richtig -> Erfolgston, Karte wandert sofort ein Fach hoch (Anzeige oben), dann weiter
  function duSoloRichtig(lauf) {
    var aktiv = function () { return du && lauf === du.lauf; };
    du.punkte[0]++;
    duSeite(null);
    duErfolg();
    var karte = document.getElementById("du-card");
    karte.classList.remove("richtig"); void karte.offsetWidth; karte.classList.add("richtig");
    setTimeout(function () { karte.classList.remove("richtig"); }, 900);
    du.phase = "ergebnis";
    duSetze("du-hinten", du.frage.antwort);
    duSoloWerten(true);
    return warteWenn(900, aktiv)
      .then(function () { return duBeispiel(lauf); })
      .then(function () { return warteWenn(500, aktiv); })
      .then(function () { if (aktiv()) duWeiter(true); });
  }
  function duBeispiel(lauf) {
    if (!du || lauf !== du.lauf || !du.frage) return Promise.resolve();   // Spiel inzwischen beendet
    var c = du.frage.karte;
    if (!du.bsp || !c.bsp) return Promise.resolve();
    return duSprich(c.bsp, "en-GB", lauf);
  }
  // kurzer, sanfter Zweiklang für „richtig“
  function duErfolg() {
    duTon(true);
    setTimeout(function () { duTon(true, 1047); }, 150);
  }
  function duDiagZeigen() {
    if (!du || !du.frage) return;
    duDiag(["erwartet: " + du.frage.loesungen.join(" | "),
            "Sprache: " + du.frage.sAntwort + (du.sprachBeginn != null ? " · erster Laut nach " + (du.sprachBeginn / 1000).toFixed(1) + " s" : "")]
           .concat(du.frage.notiz));
  }

  /* ---------- Knopf-Modus (ohne Mikrofon) und Notfall bei Erkennungsfehlern ---------- */
  function duManuellRunde(lauf, wer, pkt) {
    var aktiv = function () { return du && lauf === du.lauf; };
    du.phase = "hoeren";
    return warteWenn(du.zeit, aktiv, function (rest) { if (aktiv()) { duPhase(duWerName(wer) + " · " + Math.max(0, Math.ceil(rest / 1000)) + " s", true); duUhr(rest); } })
      .then(function () { if (aktiv()) return duManuellEntscheid(lauf, duWerName(wer) + (pkt === 2 ? " – für 2 Punkte" : ""), wer, pkt); });
  }
  function duEntscheidZu() {
    document.getElementById("du-entscheid").hidden = true;
    document.getElementById("du-knoepfe").textContent = "";
    document.getElementById("du-steuer").hidden = false;
  }
  // Richtig → Punkte; Falsch → beim ersten Versuch ist die andere Person dran, sonst Lösung
  function duManuellEntscheid(lauf, frage, wer, pkt) {
    var aktiv = function () { return du && lauf === du.lauf; };
    if (!aktiv()) return;
    if (du.solo) return duSoloOffen(lauf, du.manuell ? "Lösung" : "Nicht verstanden · Karte bleibt im Fach");
    du.phase = "entscheiden";
    duSeite(null);
    duPhase(frage);
    duSetze("du-hinten", du.frage.antwort);
    document.getElementById("du-frage-wer").textContent = du.solo ? "Gewusst?" : "Hatte " + du.namen[wer] + " recht?";
    var box = document.getElementById("du-knoepfe");
    box.textContent = "";
    document.getElementById("du-entscheid").hidden = false;
    document.getElementById("du-steuer").hidden = true;
    return new Promise(function (fertig) {
      (du.solo ? [["Gewusst", true, "plus"], ["Nicht gewusst", false, ""]]
               : [["Richtig +" + pkt, true, pkt === 2 ? "plus2" : "plus"], ["Falsch / nichts", false, ""]]).forEach(function (w) {
        var b = document.createElement("button");
        b.type = "button"; b.className = w[2]; b.textContent = w[0];
        b.addEventListener("click", function () {
          if (!aktiv()) return;
          duEntscheidZu();
          du.hand++;
          if (w[1]) fertig(duPunkt(lauf, wer, pkt));
          else if (pkt === 1 && !du.solo) fertig(duDran(lauf, 1 - wer, 2));
          else fertig(duLoesung(lauf));
        });
        box.appendChild(b);
      });
    });
  }

  /* Allein, wenn die App nicht weiß, ob die Antwort stimmte (nichts gehört, Erkennung gestört, ohne Mikrofon):
     nicht stehen bleiben und nicht nachfragen. Die Lösung wird vorgelesen, die Karte bleibt ungewertet in ihrem Fach
     und kommt am Ende der Runde noch einmal. Wer das Handy gerade in der Hand hat, kann in der Zeit trotzdem
     „Gewusst“ oder „Nicht gewusst“ tippen - muss aber nicht. */
  function duSoloOffen(lauf, grund) {
    var f = du.frage, aktiv = function () { return du && lauf === du.lauf; };
    du.phase = "ergebnis";
    duSeite(null);
    duPhase(grund);
    duSetze("du-hinten", f.antwort);
    var box = document.getElementById("du-knoepfe"), gewaehlt = null;
    document.getElementById("du-frage-wer").textContent = "Gewusst? (kein Muss)";
    box.textContent = "";
    [["Gewusst", true, "plus"], ["Nicht gewusst", false, ""]].forEach(function (w) {
      var b = document.createElement("button");
      b.type = "button"; b.className = w[2]; b.textContent = w[0];
      b.addEventListener("click", function () {
        if (!aktiv() || du.gewertet) return;
        gewaehlt = w[1];
        du.hand++;
        du.punkte[w[1] ? 0 : 1]++;
        duEntscheidZu();
        duSoloWerten(w[1]);
      });
      box.appendChild(b);
    });
    document.getElementById("du-entscheid").hidden = false;   // die Leiste mit Pause, Stern und Überspringen bleibt sichtbar
    return duSprich(f.antwort, f.sAntwort, lauf)
      .then(function () { return duBeispiel(lauf); })
      .then(function () { return warteWenn(2500, aktiv); })
      .then(function () {
        if (!aktiv()) return;
        duEntscheidZu();
        if (du.gewertet) { du.offen = 0; duWeiter(gewaehlt); return; }
        du.offen = (du.offen || 0) + 1;
        if (du.offen > runde.length + 1) { duEnde(); return; }   // nur noch ungewertete Karten: Runde beenden statt endlos kreisen
        if (runde.length) { runde.push(aktuell); naechsteKarte(); }
        duFrage();
      });
  }

  /* ---------- Duell-Statistik ----------
     Jedes beendete Duell zu zweit landet in daten.duellLog = [{ at, n:[Name 1, Name 2], p:[Punkte 1, Punkte 2], f:Fragen }]
     (höchstens 100, nur auf diesem Gerät, je Kasten). Die Bilanz fasst nach Namen zusammen. Die Namen sind frei eingetippt:
     das Fenster baut seine Texte darum nur mit textContent, nie mit HTML. */
  function duStatistikMerken(g) {
    if (!Array.isArray(daten.duellLog)) daten.duellLog = [];
    daten.duellLog.push(g);
    if (daten.duellLog.length > 100) daten.duellLog = daten.duellLog.slice(-100);
    sichern();
    duStatKurz();
  }
  function duStatistik() {
    var log = (Array.isArray(daten.duellLog) ? daten.duellLog : []).filter(function (g) {
      return g && Array.isArray(g.n) && Array.isArray(g.p) && typeof g.at === "number";
    });
    var map = {};
    log.forEach(function (g) {
      [0, 1].forEach(function (i) {
        var name = String(g.n[i] || "").trim(), k = name.toLowerCase();
        if (!k) return;
        var s = map[k] || (map[k] = { name: name, spiele: 0, siege: 0, punkte: 0 });
        s.spiele++;
        s.punkte += Number(g.p[i]) || 0;
        if ((Number(g.p[i]) || 0) > (Number(g.p[1 - i]) || 0)) s.siege++;
      });
    });
    return {
      log: log,
      spieler: Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return b.spiele - a.spiele || b.siege - a.siege; }).slice(0, 4),
      unentschieden: log.filter(function (g) { return (Number(g.p[0]) || 0) === (Number(g.p[1]) || 0); }).length,
      fragen: log.reduce(function (s, g) { return s + (Number(g.f) || 0); }, 0)
    };
  }
  function duStatKurz() {
    var el = document.getElementById("du-stat-kurz");
    if (!el) return;
    var s = duStatistik(), l = s.log[s.log.length - 1];
    el.textContent = !l ? "Noch kein Duell gespielt"
      : s.log.length + (s.log.length === 1 ? " Spiel" : " Spiele") + " · zuletzt " + l.n[0] + " " + l.p[0] + " : " + l.p[1] + " " + l.n[1];
  }
  function duStatOeffnen() {
    var s = duStatistik(), hat = s.log.length > 0;
    var knoepfe = document.getElementById("blatt-knoepfe");
    function neu(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    document.getElementById("blatt-titel").textContent = "Duell-Statistik";
    knoepfe.textContent = "";
    var box = neu("div", "dst");
    var zahlen = neu("div", "dst-zahlen");
    [[s.log.length, "Spiele"], [s.unentschieden, "Unentschieden"], [s.fragen, "Fragen gespielt"]].forEach(function (z) {
      var d = neu("div");
      d.appendChild(neu("b", null, hat ? String(z[0]) : "–"));
      d.appendChild(neu("span", null, z[1]));
      zahlen.appendChild(d);
    });
    box.appendChild(zahlen);
    box.appendChild(neu("h4", null, "Bilanz"));
    var tab = neu("div", "dst-tab");
    function zeile(werte, kopf) {
      var z = neu("div", "dst-zeile" + (kopf ? " dst-kopf" : ""));
      werte.forEach(function (w) { z.appendChild(neu("span", null, w)); });
      tab.appendChild(z);
    }
    zeile(["Name", "Spiele", "Siege", "Ø Punkte"], true);
    if (hat) s.spieler.forEach(function (p) { zeile([p.name, String(p.spiele), String(p.siege), (p.punkte / p.spiele).toFixed(1).replace(".", ",")]); });
    else zeile(["–", "–", "–", "–"]);
    box.appendChild(tab);
    if (hat) {
      box.appendChild(neu("h4", null, "Letzte Spiele"));
      var liste = neu("div", "dst-liste");
      s.log.slice(-6).reverse().forEach(function (g) {
        var z = neu("div", "dst-zeile");
        z.appendChild(neu("span", null, new Date(g.at).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" })));
        z.appendChild(neu("span", "dst-ergebnis", g.n[0] + " " + g.p[0] + " : " + g.p[1] + " " + g.n[1]));
        liste.appendChild(z);
      });
      box.appendChild(liste);
    } else {
      box.appendChild(neu("p", "dst-leer", "Noch kein Duell gespielt. Nach dem ersten Spiel steht hier die Bilanz – wer wie oft gewonnen hat und wie viele Punkte im Schnitt."));
    }
    var loeschen = neu("button", "ghost dst-loeschen", "Statistik löschen");
    loeschen.type = "button";
    loeschen.disabled = !hat;
    loeschen.addEventListener("click", function () {
      frage("Duell-Statistik wirklich löschen? Karten, Fächer und Einstellungen bleiben, nur die Spielergebnisse gehen verloren.", "Löschen", function () {
        delete daten.duellLog; sichern(); duStatKurz(); melde("Duell-Statistik gelöscht.", "ok");
      }, true);
    });
    box.appendChild(loeschen);
    knoepfe.appendChild(box);
    blattTaste("Schließen");
    document.getElementById("blatt").hidden = false;
    waechterAbgleichen();
  }
  document.getElementById("du-stat").addEventListener("click", duStatOeffnen);

  function duEnde() {
    if (!du) return;
    var lauf = ++du.lauf;
    duStopHoeren();
    duSeite(null);
    document.getElementById("du-spiel").hidden = true;
    document.getElementById("du-schluss").hidden = false;
    var p = du.punkte, n = du.namen;
    for (var i = 0; i < 2; i++) {
      var el = document.getElementById("du-e" + i);
      el.querySelector(".du-pname").textContent = n[i];
      el.querySelector(".du-punkte").textContent = String(p[i]);
      el.classList.toggle("plus", p[i] > p[1 - i]);
    }
    document.getElementById("du-nochmal").hidden = !!(du.solo && !aktuell && !faellig().length);
    document.getElementById("du-neu").hidden = !!du.solo;
    if (!du.solo && !du.gespeichert && du.i > 0) {   // Duell für die Statistik merken (nur zu zweit, nur einmal je Spiel)
      du.gespeichert = true;
      duStatistikMerken({ at: Date.now(), n: n.slice(), p: p.slice(), f: du.i });
    }
    if (du.solo) {
      duFaecherZeigen(0);
      duSetze("du-sieger", aktuell ? "Pause – der Rest wartet beim Üben" : "Kasten für heute geschafft!");
      var gefragt = p[0] + p[1];
      duSetze("du-bilanz", gefragt + (gefragt === 1 ? " Karte" : " Karten") + " · " + p[0] + " gewusst · " + p[1] + " zurück in Fach 1");
      uwSchlafen();
      duErfolg();
      return;
    }
    var satz = p[0] === p[1] ? p[0] + " : " + p[1] : n[p[0] > p[1] ? 0 : 1] + ", " + Math.max(p[0], p[1]) + " : " + Math.min(p[0], p[1]);
    duSetze("du-sieger", p[0] === p[1] ? "Unentschieden" : n[p[0] > p[1] ? 0 : 1] + " gewinnt!");
    duSetze("du-bilanz", du.i + (du.i === 1 ? " Frage" : " Fragen") + " · " + du.auto + " automatisch entschieden · " +
      du.hand + " per Knopf entschieden");
    uwSchlafen();
    duErfolg();
    duSprich(satz, "en-GB", lauf);
  }
  function duSchliessen() {
    document.getElementById("duell").classList.remove("solo");
    document.getElementById("du-nochmal").hidden = false;
    document.getElementById("du-neu").hidden = false;
    if (!du) { document.getElementById("duell").hidden = true; waechterAbgleichen(); return; }
    du.lauf++;
    duStopHoeren();
    sprache.cancel();
    du = null;
    uwSchlafen();
    stilleAus();
    duSeite(null);
    document.getElementById("duell").hidden = true;
    waechterAbgleichen();
  }

  /* ---------- Mikrofon-Test in der Einrichtung ---------- */
  var duTestLaeuft = false;
  function duMikroTest() {
    var out = document.getElementById("du-testergebnis");
    out.hidden = false;
    if (!DU_SR) { out.textContent = "Dieser Browser hat keine Spracherkennung – ihr spielt mit Knöpfen."; return; }
    if (duTestLaeuft || du) return;
    duEinstellungenMerken();
    var e = duEinstellungen(), lang = e.richtung === "de" ? "en-GB" : "de-DE";
    var bsp = e.richtung === "de" ? "suggestion" : "Vorschlag";
    out.textContent = "Sag jetzt deutlich: „" + bsp + "“ …";
    duTestLaeuft = true;
    var rec;
    try { rec = new DU_SR(); } catch (x) { out.textContent = "Die Spracherkennung ließ sich nicht starten."; duTestLaeuft = false; return; }
    rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
    try { if (du_lokal) rec.processLocally = true; } catch (x) {}
    var gehoert = "", ende = setTimeout(function () { try { rec.stop(); } catch (x) {} }, 7000);
    rec.onresult = function (ev) {
      for (var i = ev.resultIndex; i < ev.results.length; i++) gehoert = ev.results[i][0].transcript;
      out.textContent = "Gehört: „" + gehoert + "“";
    };
    rec.onerror = function (ev) {
      if (ev.error === "no-speech") return;
      var was = { "not-allowed": "Das Mikrofon ist nicht freigegeben. Bitte in den Browser-Einstellungen erlauben.",
                  "service-not-allowed": "Die Spracherkennung ist auf diesem Gerät gesperrt.",
                  "network": "Die Spracherkennung braucht hier eine Internetverbindung.",
                  "audio-capture": "Kein Mikrofon gefunden." }[ev.error];
      out.textContent = was || ("Fehler der Spracherkennung: " + ev.error);
      gehoert = null;
    };
    rec.onend = function () {
      clearTimeout(ende);
      duTestLaeuft = false;
      if (gehoert === null) return;
      if (!gehoert) { out.textContent = "Nichts gehört. Mikrofon erlaubt? Nochmal versuchen und etwas lauter sprechen."; return; }
      var w = duWer(gehoert, e.namen), p = duPasst(w.antwort, duLoesungen(bsp));
      out.textContent = "Gehört: „" + gehoert + "“\n" +
        (p.ok ? "✓ Antwort „" + bsp + "“ erkannt – so klappt es im Spiel." : "✗ Antwort nicht erkannt (" + Math.round(p.wert * 100) + " % ähnlich).");
    };
    try { rec.start(); } catch (x) { out.textContent = "Die Spracherkennung ließ sich nicht starten."; duTestLaeuft = false; }
  }

  ["du-name1", "du-name2"].forEach(function (id) { document.getElementById(id).addEventListener("change", duEinstellungenMerken); });
  ["du-ziel", "du-zeit", "du-auswahl", "du-richtung", "du-manuell", "du-diagnose", "du-bsp", "du-tonlaut", "du-reihe", "du-streng"].forEach(function (id) {
    document.getElementById(id).addEventListener("change", function () {
      duEinstellungenMerken();
      if (id === "du-richtung") duStatusZeigen();
      if (id === "du-tonlaut") { duLautZeigen(); duTon(false, 0, true); }   // gleich hören, wie laut es ist
    });
  });
  document.getElementById("du-tonlaut").addEventListener("input", function () {
    document.getElementById("du-tonlaut-wert").textContent = this.value + " %";
  });
  // Lautstärke während des Spiels: sofort wirksam, beim Loslassen gespeichert + Probe-Piep
  (function () {
    var r = document.getElementById("du-laut-spiel");
    r.addEventListener("input", function () {
      if (!daten.duell) daten.duell = {};
      daten.duell.tonLaut = Number(r.value) / 100;
      duLautZeigen();
    });
    r.addEventListener("change", function () { sichern(); duTon(false, 0, true); });
  })();
  document.getElementById("du-test").addEventListener("click", duMikroTest);
  (function () {
    [["st-detempo", "deTempo", deTempo, 1.5, "de"], ["st-entempo", "enTempo", enTempo, 1, "en"]].forEach(function (x) {
      var t = document.getElementById(x[0]);
      t.value = String(x[2]());
      t.addEventListener("change", function () {
        daten[x[1]] = Number(t.value) || x[3]; sichern();
        if (sprache && !uw && !du) stimmProbe(x[4]);   // gleich hören, wie schnell es jetzt ist
      });
    });
  })();
  // Stimme und Tempo stellt man nur in den Einstellungen ein - das gilt dann überall
  (function () {
    var sel = document.getElementById("st-destimme");
    sel.value = deModus();
    sel.addEventListener("change", function () { daten.deStimme = sel.value; sichern(); });
  })();
  document.getElementById("du-start").addEventListener("click", function () { duStarten(false); });
  document.getElementById("du-nochmal").addEventListener("click", function () {
    if (du && du.solo) { duSchliessen(); duAlleinStarten(); } else duStarten(true);
  });
  document.getElementById("du-neu").addEventListener("click", function () { duSchliessen(); duEinstellungenZeigen(); });
  document.getElementById("btn-sprache").addEventListener("click", function () { duAlleinStarten(); });
  document.getElementById("du-schliessen").addEventListener("click", duSchliessen);
  document.getElementById("du-ende").addEventListener("click", function () { if (du) duEnde(); });
  document.getElementById("du-merk").addEventListener("click", function () {
    var c = du && du.frage && du.frage.karte;
    if (!c) return;
    c.merk = !c.merk;
    sichern();
    duMerkZeigen();                        // das Spiel läuft ungestört weiter
  });
  document.getElementById("du-weiter").addEventListener("click", function () {
    if (!du || du.phase === "entscheiden") return;
    du.pausiert = false;
    if (du.solo && aktuell) {
      if (runde.length) { runde.push(aktuell); naechsteKarte(); }
      duFrage();
      return;
    }
    du.i++;
    duFrage();
  });
  document.getElementById("du-pause").addEventListener("click", function () {
    if (!du) return;
    if (du.pausiert) { du.pausiert = false; duFrage(); return; }   // die Frage beginnt von vorn
    du.pausiert = true;
    du.lauf++;
    duStopHoeren();
    sprache.cancel();
    duPhase("Pausiert");
    duPauseKnopf("Start");
  });
  window.addEventListener("online", function () { if (ansicht === "quiz") duStatusZeigen(); });
  window.addEventListener("offline", function () { if (ansicht === "quiz") duStatusZeigen(); });

  /* ---------- App teilen ---------- */
  // Als Datei geöffnet (file://) gibt es keine teilbare Adresse - dann die veröffentlichte App
  var APP_ADRESSE = "https://kevinhbrck.github.io/Vokabelkasten/";
  function appAdresse() {
    if (!/^https?:$/.test(location.protocol) || location.hostname === "localhost") return APP_ADRESSE;
    return location.origin + location.pathname.replace(/index\.html$/, "");
  }
  function kopiere(text, fertig) {
    function alt() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); fertig(); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(fertig, alt);
    else alt();
  }
  document.getElementById("teil-url").textContent = appAdresse();
  document.getElementById("btn-teil-kopie").addEventListener("click", function () {
    var b = this;
    kopiere(appAdresse(), function () {
      b.textContent = "✓ Kopiert";
      setTimeout(function () { b.textContent = "Link kopieren"; }, 2000);
    });
  });
  var teilBtn = document.getElementById("btn-teil");
  if (!navigator.share) teilBtn.hidden = true;
  teilBtn.addEventListener("click", function () {
    navigator.share({ title: "Vokabelkasten", text: "Englischvokabeln lernen mit dem Vokabelkasten:", url: appAdresse() }).catch(function () {});
  });

  /* ---------- Fotos auf der Rückseite (nur auf diesem Gerät) ----------
     Fotos liegen in IndexedDB (localStorage wäre dafür zu klein), Schlüssel "<Kasten>:<Karte>", verkleinert auf
     höchstens 1024 px als JPEG. Die Karte selbst trägt nur bild:true. Nichts davon geht ins Internet;
     die Sicherungsdatei nimmt die Fotos als Daten-URL mit. */
  var BILD_DB = "vokabelkasten-bilder", BILD_STORE = "bilder", bildUrls = {};
  function bildDb() {
    return new Promise(function (ok, fehler) {
      if (!window.indexedDB) { fehler(); return; }
      var r;
      try { r = indexedDB.open(BILD_DB, 1); } catch (e) { fehler(e); return; }
      r.onupgradeneeded = function () { r.result.createObjectStore(BILD_STORE); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { fehler(r.error); };
    });
  }
  function bildKey(cid, kid) { return (kid || KASTEN.id) + ":" + cid; }
  function bildHolen(cid, kid) {
    return bildDb().then(function (db) {
      return new Promise(function (ok) {
        var q = db.transaction(BILD_STORE, "readonly").objectStore(BILD_STORE).get(bildKey(cid, kid));
        q.onsuccess = function () { ok(q.result || null); };
        q.onerror = function () { ok(null); };
      });
    }).catch(function () { return null; });
  }
  function bildSetzen(cid, blob, kid) {
    var k = bildKey(cid, kid);
    if (bildUrls[k]) { URL.revokeObjectURL(bildUrls[k]); delete bildUrls[k]; }
    return bildDb().then(function (db) {
      return new Promise(function (ok) {
        var tx = db.transaction(BILD_STORE, "readwrite"), st = tx.objectStore(BILD_STORE);
        if (blob) st.put(blob, k); else st.delete(k);
        tx.oncomplete = function () { ok(true); };
        tx.onerror = function () { ok(false); };
      });
    }).catch(function () { return false; });
  }
  function bildUrl(cid) {
    var k = bildKey(cid);
    if (bildUrls[k]) return Promise.resolve(bildUrls[k]);
    return bildHolen(cid).then(function (b) { if (!b) return null; bildUrls[k] = URL.createObjectURL(b); return bildUrls[k]; });
  }
  function bilderKastenLoeschen(kid) {
    return bildDb().then(function (db) {
      var st = db.transaction(BILD_STORE, "readwrite").objectStore(BILD_STORE);
      var c = st.openCursor();
      c.onsuccess = function () { var cur = c.result; if (!cur) return; if (String(cur.key).indexOf(kid + ":") === 0) cur.delete(); cur.continue(); };
    }).catch(function () {});
  }
  // Foto verkleinern: längste Seite höchstens 1024 px, JPEG - so bleiben Speicher und Sicherung klein
  function bildVerkleinern(datei) {
    return new Promise(function (ok, fehler) {
      var url = URL.createObjectURL(datei), img = new Image();
      img.onload = function () {
        var f = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { if (b) ok(b); else fehler(); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); fehler(); };
      img.src = url;
    });
  }
  function bildWaehlen(fertig) {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      bildVerkleinern(f).then(fertig).catch(function () { melde("Das Foto ließ sich nicht lesen."); });
    });
    inp.click();
  }
  function bildAufKarte() {
    var kb = document.getElementById("k-bild");
    if (!aktuell || !aufgedeckt || !aktuell.bild) { kb.hidden = true; kb.removeAttribute("src"); return; }
    var id = aktuell.id;
    bildUrl(id).then(function (u) {
      if (!u || !aktuell || aktuell.id !== id || !aufgedeckt) return;
      kb.src = u; kb.hidden = false;
    });
  }
  function blobZuDatenUrl(b) {
    return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { ok(null); }; r.readAsDataURL(b); });
  }

  /* ---------- Kästen: Beschriftung, Leiste, Wischen, Anlegen ---------- */
  /* Ursprüngliche Texte (Vokabel-Fassung) merken, bevor ein Wissenskasten sie umschreibt - für den Wechsel zurück */
  var textUrsprung = [];   // [Element, Eigenschaft ("@name" = Attribut), ursprünglicher Wert]
  function merke(el, eig) {
    for (var i = 0; i < textUrsprung.length; i++) if (textUrsprung[i][0] === el && textUrsprung[i][1] === eig) return;
    textUrsprung.push([el, eig, eig.charAt(0) === "@" ? el.getAttribute(eig.slice(1)) : el[eig]]);
  }
  function texteZurueck() {
    textUrsprung.forEach(function (u) {
      if (u[1].charAt(0) !== "@") u[0][u[1]] = u[2];
      else if (u[2] === null) u[0].removeAttribute(u[1].slice(1));
      else u[0].setAttribute(u[1].slice(1), u[2]);
    });
  }
  function kastenTexte() {
    document.documentElement.style.setProperty("--kasten", KASTEN_FARBEN[KASTEN.farbe % KASTEN_FARBEN.length]);
    document.documentElement.toggleAttribute("data-wissen", WISSEN);
    document.title = kastenTitel(KASTEN);
    document.getElementById("st-hero-name").textContent = kastenTitel(KASTEN);
    texteZurueck();   // erst die Vokabel-Texte, dann (bei Wissenskästen) umschreiben
    if (!WISSEN) return;
    function setze(el, eig, wert) {
      if (!el) return;
      merke(el, eig);
      if (eig.charAt(0) === "@") el.setAttribute(eig.slice(1), wert); else el[eig] = wert;
    }
    function txt(sel, t) { setze(document.querySelector(sel), "textContent", t); }
    function opt(sel, wert, t) { setze(document.querySelector(sel + ' option[value="' + wert + '"]'), "textContent", t); }
    var en = document.getElementById("sn-en"), de = document.getElementById("sn-de");
    setze(en, "placeholder", "Neuer Begriff"); setze(en, "@aria-label", "Neuer Begriff");
    setze(en, "@autocapitalize", "sentences");
    setze(de, "placeholder", "Bedeutung");
    setze(de, "rows", 3);   // Erklärungen sind länger als Übersetzungen
    setze(de, "@aria-label", "Bedeutung");
    txt('label[for="in-vorne"]', "Begriff"); txt('label[for="in-hinten"]', "Bedeutung");
    txt("#view-neu h2", "Neuer Begriff"); txt("#btn-add", "Begriff speichern");
    setze(document.getElementById("einf-hilfe"), "innerHTML", "Eine Zeile pro Karte: <b>Begriff · Bedeutung</b>, getrennt durch Tab, |, ;, „ = “, „ – “ oder „: “.");
    txt("#imp-tausch-text", "Bedeutung steht vorn (Spalten tauschen)");
    txt("#imp-info-spalten", "Begriff · Bedeutung · Beispiel (optional)");
    txt("#imp-info-bsp", "Leitzins = Zinssatz, zu dem Banken sich Geld leihen\nInflation | Anstieg des Preisniveaus\nRendite; Ertrag einer Geldanlage");
    setze(document.getElementById("einfuegen"), "placeholder", "Leitzins = Zinssatz, zu dem sich Banken bei der Zentralbank Geld leihen");
    opt("#sel-richtung", "de", "Begriff zuerst"); opt("#sel-richtung", "en", "Bedeutung zuerst");
    ["#uw-richtung", "#du-richtung"].forEach(function (sel) { opt(sel, "de", "Begriff → Bedeutung"); opt(sel, "en", "Bedeutung → Begriff"); });
    opt("#sel-sort", "de", "Begriff A–Z"); opt("#sel-sort", "en", "Bedeutung A–Z");
    opt("#sel-abdeck", "en", "Bedeutung abdecken"); opt("#sel-abdeck", "de", "Begriff abdecken");
  }
  /* Kasten öffnen ohne Neuladen: Laufendes beenden, alten Stand sichern, Zustand auf Anfang,
     dann den neuen Kasten genau wie beim Start einlesen. Gespeichert wird erst wieder nach laden() (geladen). */
  function kastenOeffnen(id) {
    var k = KAESTEN.liste.filter(function (x) { return x.id === id; })[0];
    if (!k) return;
    if (uw) uwBeenden();
    if (du) duSchliessen();
    if (geladen) sichern();
    geladen = false;
    daten = { v: 3, seeded: false, cards: [], reviews: [] };
    KAESTEN.aktiv = k.id;
    kaestenSichern();
    KASTEN = k; WISSEN = k.art === "wissen"; KATS = kastenKats(); KEY = kastenKey(k.id);
    SNAP_KEY = snapKey(); snapZeit = null;
    fremdeLogs = fremdeLogsLesen();
    // alles, was zu einem Kasten gehört, auf Anfang (wie beim Start der Seite)
    filterKat = "alle"; richtung = "de"; nurMerk = false; nurKasten = false; filterFach = 0; paket = 15; abdeck = "aus";
    bearbeiteId = null; frischId = null; frischSet = {}; fokusNach = null; saetze = true;
    listKat = "alle"; listSort = "nr"; listeTreffer = [];
    runde = []; aktuell = null; aufgedeckt = false; rundeBilanz = [0, 0]; meldung = null; verlauf = [];
    extraOffen = {}; extraGehabt = {}; eingabeKarte = null; statMonat = null; statTag = null;
    kastenTexte();
    kastenLeisteZeichnen();
    kastenVerwaltenZeichnen();
    fuelleSelects();
    laden();
    document.getElementById("sel-paket").value = String(paket);
    document.getElementById("sel-abdeck").value = abdeck;
    setzeThema(thema);
    setzeModus(daten.modus);
    setzeWischen(daten.wischen);
    setzeEingabe(daten.eingabe);
    document.getElementById("btn-saetze").textContent = saetze ? "Sätze aus" : "Sätze ein";
    document.getElementById("sel-richtung").value = richtung;
    snLeeren();
    if (!sitzungFortsetzen()) rundeStarten(false);
    uwWeiterKnopf();
    snapPruefen();
    zeichneListe();
    wechsle(ansicht);
  }
  var wechselLaeuft = false;
  function kastenWechseln(id, weg, tempo) {
    if (id === KASTEN.id || wechselLaeuft) return;
    var st = document.getElementById("view-start");
    if (document.visibilityState !== "visible" || ansicht !== "start" || wenigBewegung) {   // ohne Animation
      st.style.transition = ""; st.style.transform = ""; st.style.opacity = "";
      kastenOeffnen(id);
      return;
    }
    wechselLaeuft = true;
    // Seite gleitet ganz hinaus - aus der aktuellen Wischposition und mit dem Schwung des Fingers weiter
    var breite = st.offsetWidth || 400;
    var jetzt = new DOMMatrix(getComputedStyle(st).transform).m41 || 0, rest = breite - Math.abs(jetzt);
    var dauer = Math.round(Math.max(140, Math.min(260, tempo ? rest / tempo : 240)));
    st.style.transition = "transform " + dauer + "ms cubic-bezier(.25,.6,.45,1), opacity " + dauer + "ms linear";
    st.style.transform = "translateX(" + (weg === "rechts" ? "" : "-") + "100%)";
    st.style.opacity = ".4";
    setTimeout(function () {
      try { kastenOeffnen(id); } catch (e) { wechselLaeuft = false; st.style.transition = ""; st.style.transform = ""; st.style.opacity = ""; throw e; }
      // der neue Kasten steht auf der anderen Seite bereit und gleitet herein
      st.style.transition = "none";
      st.style.transform = "translateX(" + (weg === "rechts" ? "-" : "") + "100%)";
      st.style.opacity = ".4";
      void st.offsetWidth;
      st.style.transition = "transform .36s cubic-bezier(.16,1,.3,1), opacity .3s ease-out";
      st.style.transform = ""; st.style.opacity = "";
      wechselLaeuft = false;   // der neue Kasten ist da - ab jetzt darf schon weitergewechselt werden
      setTimeout(function () { if (!wechselLaeuft) st.style.transition = ""; }, 420);
    }, dauer);
  }
  function kastenLeisteZeichnen() {
    var leiste = document.getElementById("kasten-leiste"), punkte = document.getElementById("kasten-punkte");
    leiste.textContent = ""; punkte.textContent = "";
    var aktivI = 0;
    KAESTEN.liste.forEach(function (k, i) {
      if (k.id === KASTEN.id) aktivI = i;
      var b = document.createElement("button");
      b.type = "button"; b.className = "kasten-reiter" + (k.id === KASTEN.id ? " an" : "");
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", k.id === KASTEN.id ? "true" : "false");
      b.style.setProperty("--k", KASTEN_FARBEN[k.farbe % KASTEN_FARBEN.length]);
      b.textContent = k.id === "en" ? "Englisch" : k.name;
      b.addEventListener("click", function () { kastenWechseln(k.id, i > aktivI ? "links" : "rechts"); });
      if (k.id !== "en") { langDruck(b, function () { kastenMenue(k); }); b.title = "Lange drücken: Papierkorb, verschieben, umbenennen"; }
      leiste.appendChild(b);
      var pk = document.createElement("i");
      if (k.id === KASTEN.id) pk.className = "an";
      punkte.appendChild(pk);
    });
    var plus = document.createElement("button");
    plus.type = "button"; plus.className = "kasten-reiter plus"; plus.textContent = "+";
    plus.setAttribute("aria-label", "Neuen Kasten anlegen"); plus.title = "Neuen Kasten anlegen";
    plus.addEventListener("click", kastenNeuFragen);
    leiste.appendChild(plus);
    punkte.hidden = KAESTEN.liste.length < 2;
    var an = leiste.querySelector(".an");
    if (an && an.scrollIntoView) an.scrollIntoView({ inline: "center", block: "nearest" });
  }
  // Neuer Kasten: nur das Thema wird gefragt - der Rest ist wie gewohnt
  function kastenNeuFragen() {
    var ov = document.getElementById("kasten-dialog");
    ov.hidden = false;
    var inp = document.getElementById("kasten-name");
    inp.value = "";
    setTimeout(function () { inp.focus(); }, 50);
  }
  function kastenAnlegen(name) {
    name = String(name || "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (!name) return;
    var genutzt = KAESTEN.liste.map(function (k) { return k.farbe; }), farbe = 1;
    while (genutzt.indexOf(farbe) > -1 && farbe < KASTEN_FARBEN.length - 1) farbe++;
    var k = { id: "k" + Date.now().toString(36), name: name, farbe: farbe, art: "wissen" };
    KAESTEN.liste.push(k);
    kastenWechseln(k.id, "links");
  }
  document.getElementById("kasten-form").addEventListener("submit", function (e) {
    e.preventDefault();
    kastenAnlegen(document.getElementById("kasten-name").value);
  });
  document.getElementById("kasten-abbruch").addEventListener("click", function () { document.getElementById("kasten-dialog").hidden = true; });
  // Wischen auf der Startseite: links = nächster Kasten, rechts = vorheriger (am Ende passiert nichts - neu nur über „+“)
  /* Die Seite folgt dem Finger. Loslassen weit genug (oder schnell genug) -> sie gleitet ganz hinaus und
     der Nachbarkasten gleitet herein; sonst federt sie zurück. Am Rand (kein Nachbar) gibt sie nur leicht nach. */
  (function () {
    var st = document.getElementById("view-start"), start = null, zieht = false;
    function index() { var i = 0; KAESTEN.liste.forEach(function (k, j) { if (k.id === KASTEN.id) i = j; }); return i; }
    var fertigUhr = null;
    function setze(x, animiert) {
      clearTimeout(fertigUhr);
      st.style.transition = animiert ? "transform .28s cubic-bezier(.2,.8,.2,1), opacity .28s ease-out" : "none";
      st.style.transform = x ? "translateX(" + x + "px)" : "";
      st.style.opacity = x ? String(Math.max(.5, 1 - Math.abs(x) / (st.offsetWidth * 2.2))) : "";
      // Absicherung: danach steht die Seite garantiert an ihrem Platz, auch falls ein Übergang hängen bleibt
      if (animiert) fertigUhr = setTimeout(function () { st.style.transition = ""; }, 320);
    }
    st.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (wechselLaeuft) { start = null; return; }
      if (e.target.closest("input, textarea, select, .kasten-leiste, .kasten-dialog")) { start = null; return; }
      start = { x: e.clientX, y: e.clientY, t: Date.now() }; zieht = false;
    });
    st.addEventListener("pointermove", function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!zieht) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; }   // senkrecht = Scrollen
        if (Math.abs(dx) < 12) return;
        zieht = true;
      }
      var i = index(), nachbar = dx < 0 ? i + 1 < KAESTEN.liste.length : i > 0;
      setze(nachbar ? dx : dx * .25, false);   // ohne Nachbarn nur leichtes Nachgeben
    });
    function ende(e) {
      if (!start) return;
      var s = start; start = null;
      if (!zieht) return;
      var dx = e.clientX - s.x, dt = Math.max(1, Date.now() - s.t), i = index();
      var weit = Math.abs(dx) > st.offsetWidth * .28 || (Math.abs(dx) > 40 && Math.abs(dx) / dt > .5);
      var tempo = Math.min(3, Math.abs(dx) / dt);
      if (weit && dx < 0 && i + 1 < KAESTEN.liste.length) { kastenWechseln(KAESTEN.liste[i + 1].id, "links", tempo); return; }
      if (weit && dx > 0 && i > 0) { kastenWechseln(KAESTEN.liste[i - 1].id, "rechts", tempo); return; }
      setze(0, true);
    }
    st.addEventListener("pointerup", ende);
    st.addEventListener("pointercancel", function (e) { if (start) { start = null; setze(0, true); } });
    // nach einem Wisch kein versehentlicher Tipp auf Karten oder Knöpfe
    st.addEventListener("click", function (e) { if (zieht) { e.stopPropagation(); e.preventDefault(); zieht = false; } }, true);
    try { sessionStorage.removeItem("vk-kasten-rein"); } catch (e) {}   // Rest aus Fassungen mit Neuladen
  })();
  // Einstellungen: Kasten umbenennen oder löschen (Englisch bleibt immer)
  function kastenUmbenennen(k) {
    // eigenes Fenster statt prompt() (siehe frage); gleiche Form wie „Vokabel bearbeiten“
    blattTaste("Abbrechen");
    var knoepfe = document.getElementById("blatt-knoepfe");
    document.getElementById("blatt-titel").textContent = "Neuer Name für den Kasten";
    knoepfe.textContent = "";
    var form = document.createElement("div");
    form.className = "blatt-form";
    var l = document.createElement("label");
    l.textContent = "Name";
    var inp = document.createElement("input");
    inp.type = "text"; inp.value = k.name || ""; inp.maxLength = 30; inp.autocomplete = "off";
    l.appendChild(inp);
    form.appendChild(l);
    var ok = document.createElement("button");
    ok.type = "button"; ok.className = "blatt-speichern";
    ok.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Speichern';
    form.appendChild(ok);
    knoepfe.appendChild(form);
    function speichern() {
      var neu = inp.value.trim();
      if (!neu) { inp.focus(); return; }
      blattZu();
      k.name = neu.slice(0, 30); kaestenSichern(); kastenVerwaltenZeichnen(); kastenLeisteZeichnen(); kastenTexte(); kopfZeigen();
    }
    ok.addEventListener("click", speichern);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); speichern(); } });
    document.getElementById("blatt").hidden = false;
    waechterAbgleichen();
    inp.focus(); inp.select();
  }
  /* Papierkorb: der Kasten verschwindet aus der Leiste, seine Karten bleiben gespeichert (KAESTEN.papierkorb).
     Zurückholen oder endgültig löschen in den Einstellungen unter „Kästen“. Englisch bleibt immer. */
  function papierkorb() { return KAESTEN.papierkorb || (KAESTEN.papierkorb = []); }
  function kastenInPapierkorb(k) {
    if (k.id === "en") return;
    var offen = KAESTEN.aktiv === k.id;
    if (offen && geladen) sichern();
    KAESTEN.liste = KAESTEN.liste.filter(function (x) { return x.id !== k.id; });
    papierkorb().push({ id: k.id, name: k.name, farbe: k.farbe, art: k.art, weg: Date.now() });
    if (offen) kastenOeffnen("en"); else { kaestenSichern(); fremdeLogs = fremdeLogsLesen(); kastenLeisteZeichnen(); }
    kastenVerwaltenZeichnen();
    snInfo("liegt im Papierkorb – zurückholen in den Einstellungen unter „Kästen“.", "„" + kastenTitel(k) + "“");
  }
  function kastenZurueckholen(k) {
    KAESTEN.papierkorb = papierkorb().filter(function (x) { return x.id !== k.id; });
    KAESTEN.liste.push({ id: k.id, name: k.name, farbe: k.farbe, art: k.art || "wissen" });
    kaestenSichern(); fremdeLogs = fremdeLogsLesen(); kastenLeisteZeichnen(); kastenVerwaltenZeichnen();
  }
  function kastenEndgueltigLoeschen(k) {
    frage("„" + kastenTitel(k) + "“ mit allen Karten endgültig löschen? Das lässt sich nur mit einer Sicherungsdatei rückgängig machen.", "Endgültig löschen", function () {
      try { window.localStorage.removeItem(kastenKey(k.id)); window.localStorage.removeItem(VOR_V3 + k.id); } catch (e) {}   // samt Sicherung vor dem FSRS-Umbau
      bilderKastenLoeschen(k.id);
      KAESTEN.papierkorb = papierkorb().filter(function (x) { return x.id !== k.id; });
      kaestenSichern(); kastenVerwaltenZeichnen();
    }, true);
  }
  // Reihenfolge ändern - Englisch bleibt vorn (das Verzeichnis gilt nur mit Englisch an erster Stelle)
  function kastenVerschieben(k, um) {
    var l = KAESTEN.liste, i = l.indexOf(k), j = i + um;
    if (i < 1 || j < 1 || j >= l.length) return;
    l[i] = l[j]; l[j] = k;
    kaestenSichern(); kastenLeisteZeichnen(); kastenVerwaltenZeichnen();
  }
  /* Langes Drücken auf einen Kasten oben öffnet sein Menü (der Tipp danach wechselt nicht) */
  Array.prototype.forEach.call(document.querySelectorAll(".st-kachel"), function (k) {
    langDruck(k, function () {
      var klein = Array.isArray(daten.kachelnKlein) ? daten.kachelnKlein.slice() : [], z = k.dataset.ziel, ist = klein.indexOf(z) > -1;
      blattAuf(k.querySelector("b").textContent, [{ text: ist ? "Wieder groß anzeigen" : "Verkleinern", tun: function () {
        daten.kachelnKlein = ist ? klein.filter(function (x) { return x !== z; }) : klein.concat([z]);
        sichern(); kachelnGroesse();
      } }]);
    });
  });
  function langDruck(el, fn) {
    var uhr = null, ausgeloest = false, x0 = 0, y0 = 0;
    function weg() { clearTimeout(uhr); uhr = null; }
    function los() { weg(); ausgeloest = true; try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} fn(); }
    el.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      ausgeloest = false; x0 = e.clientX; y0 = e.clientY; weg();
      uhr = setTimeout(los, 520);
    });
    el.addEventListener("pointermove", function (e) { if (uhr && (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10)) weg(); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) { el.addEventListener(t, weg); });
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); if (!ausgeloest) los(); });   // Android und Rechtsklick
    el.addEventListener("click", function (e) { if (ausgeloest) { ausgeloest = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }
  var menueKasten = null;
  function kastenMenue(k) {
    var d = kastenLesen(k.id), n = d ? d.cards.length : 0, i = KAESTEN.liste.indexOf(k);
    menueKasten = k;
    document.getElementById("km-titel").textContent = kastenTitel(k);
    document.getElementById("km-info").textContent = n + (n === 1 ? " Karte" : " Karten") + (k.id === KASTEN.id ? " · gerade offen" : "");
    document.getElementById("km-links").disabled = i <= 1;
    document.getElementById("km-rechts").disabled = i >= KAESTEN.liste.length - 1;
    document.getElementById("kasten-menue").hidden = false;
  }
  function kastenMenueZu() { document.getElementById("kasten-menue").hidden = true; menueKasten = null; }
  document.getElementById("km-papierkorb").addEventListener("click", function () { var k = menueKasten; kastenMenueZu(); if (k) kastenInPapierkorb(k); });
  document.getElementById("km-umbenennen").addEventListener("click", function () { var k = menueKasten; kastenMenueZu(); if (k) kastenUmbenennen(k); });
  document.getElementById("km-links").addEventListener("click", function () { var k = menueKasten; if (k) { kastenVerschieben(k, -1); kastenMenue(k); } });
  document.getElementById("km-rechts").addEventListener("click", function () { var k = menueKasten; if (k) { kastenVerschieben(k, 1); kastenMenue(k); } });
  document.getElementById("km-abbruch").addEventListener("click", kastenMenueZu);
  document.getElementById("kasten-menue").addEventListener("click", function (e) { if (e.target.id === "kasten-menue") kastenMenueZu(); });
  function kastenVerwaltenZeichnen() {
    var box = document.getElementById("kasten-verwalten");
    if (!box) return;
    box.textContent = "";
    KAESTEN.liste.forEach(function (k) {
      var z = document.createElement("div"); z.className = "kv-zeile";
      var n = document.createElement("span"); n.className = "kv-name"; n.style.setProperty("--k", KASTEN_FARBEN[k.farbe % KASTEN_FARBEN.length]);
      n.textContent = kastenTitel(k) + (k.id === KASTEN.id ? " (offen)" : "");
      z.appendChild(n);
      if (k.id !== "en") {
        var um = document.createElement("button"); um.type = "button"; um.className = "ghost"; um.textContent = "Umbenennen";
        um.addEventListener("click", function () { kastenUmbenennen(k); });
        var lo = document.createElement("button"); lo.type = "button"; lo.className = "ghost kv-weg"; lo.textContent = "Papierkorb";
        lo.addEventListener("click", function () { kastenInPapierkorb(k); });
        z.appendChild(um); z.appendChild(lo);
      }
      box.appendChild(z);
    });
    // Papierkorb: zurückholen oder endgültig löschen
    if (!papierkorb().length) return;
    var t = document.createElement("p"); t.className = "kv-korb"; t.textContent = "Papierkorb";
    box.appendChild(t);
    papierkorb().forEach(function (k) {
      var d = kastenLesen(k.id), n = d ? d.cards.length : 0;
      var z = document.createElement("div"); z.className = "kv-zeile";
      var name = document.createElement("span"); name.className = "kv-name"; name.style.setProperty("--k", KASTEN_FARBEN[k.farbe % KASTEN_FARBEN.length]);
      name.textContent = kastenTitel(k) + " (" + n + (n === 1 ? " Karte)" : " Karten)");
      var zu = document.createElement("button"); zu.type = "button"; zu.className = "ghost"; zu.textContent = "Zurückholen";
      zu.addEventListener("click", function () { kastenZurueckholen(k); });
      var lo = document.createElement("button"); lo.type = "button"; lo.className = "ghost kv-weg"; lo.textContent = "Endgültig löschen";
      lo.addEventListener("click", function () { kastenEndgueltigLoeschen(k); });
      z.appendChild(name); z.appendChild(zu); z.appendChild(lo);
      box.appendChild(z);
    });
  }

  /* ---------- Start ---------- */
  kastenTexte();
  kastenLeisteZeichnen();
  kastenVerwaltenZeichnen();
  fuelleSelects();
  laden();
  document.getElementById("sel-paket").value = String(paket);
  document.getElementById("sel-abdeck").value = abdeck;
  setzeThema(thema);
  setzeModus(daten.modus);
  setzeWischen(daten.wischen);
  setzeEingabe(daten.eingabe);

  /* Klick-Rückmeldung: bei kurzen Taps bleibt der Knopf kurz sichtbar gedrückt */
  (function () {
    function los(e) {
      var b = e.target.closest && e.target.closest("button");
      if (!b || b.disabled) return;
      b.classList.add("gedrueckt");
      var ab = Date.now();
      function hoch() {
        document.removeEventListener("pointerup", hoch);
        document.removeEventListener("pointercancel", hoch);
        setTimeout(function () { b.classList.remove("gedrueckt"); }, Math.max(0, 140 - (Date.now() - ab)));
      }
      document.addEventListener("pointerup", hoch);
      document.addEventListener("pointercancel", hoch);
    }
    document.addEventListener("pointerdown", los, { passive: true });
  })();
  zeichneHinweis();
  offlineAnmelden();
  snapPruefen();
  document.getElementById("btn-saetze").textContent = saetze ? "Sätze aus" : "Sätze ein";
  document.getElementById("sel-richtung").value = richtung;
  if (!sitzungFortsetzen()) rundeStarten(false);
  uwWeiterKnopf();
  tonMischen(true);   // von Anfang an: Musik anderer Apps läuft weiter
  wechsle("start");
  if (ERSTER_START && !GEOEFFNET_PER_TEILEN) setTimeout(einfuehrungAuf, 250);
})();
