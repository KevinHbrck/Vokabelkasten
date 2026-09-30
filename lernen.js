/* Vokabelkasten – Lernverfahren (Scheduler). Reine Rechenregeln ohne Bildschirm und Speicher, damit sie sich
   in einheitstest.html einzeln prüfen lassen. app.js holt sie am Anfang unter window.VK_LERNEN.
   Jedes Verfahren hat dieselbe Schnittstelle:
     review(karte, bewertung, jetzt, einst) - trägt eine Antwort in die Karte ein und gibt die Karte zurück
     isDue(karte, jetzt)                    - ist die Karte an diesem Tag dran?
   bewertung: 1 = Nochmal, 2 = Schwer, 3 = Gut, 4 = Leicht (wie bei FSRS). jetzt: Zeitpunkt in ms.
   einst: Einstellungen des Kastens, bei Leitner { tage: [...] } = Abstand in Tagen je Fach (Index = Fach),
   bei FSRS { retention: 0.9 } = gewünschte Behaltensquote. */
(function () {
  "use strict";

  var BEWERTUNG = { NOCHMAL: 1, SCHWER: 2, GUT: 3, LEICHT: 4 };
  var TAG = 86400000;

  // Beginn des Kalendertags (Ortszeit) - Fälligkeiten zählen in ganzen Tagen, wie überall in der App
  function tagesBeginn(ms) {
    var d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /* ---------- Leitner ----------
     Unverändert aus bewerten() in app.js herausgelöst: gewusst = ein Fach weiter (höchstens 5) mit dem Abstand
     dieses Fachs, nicht gewusst = zurück in Fach 1, heute noch einmal. Schwer, Gut und Leicht zählen als gewusst.
     Die Zusatzrunde für Sternkarten bleibt in app.js: Sie ruft review() dann gar nicht erst auf. */
  var LeitnerScheduler = {
    review: function (k, bewertung, jetzt, einst) {
      if (bewertung >= BEWERTUNG.SCHWER) {
        k.box = Math.min(5, k.box + 1);
        k.due = tagesBeginn(jetzt) + einst.tage[k.box] * TAG;
      } else {
        k.box = 1;
        k.due = tagesBeginn(jetzt);
      }
      return k;
    },
    isDue: function (k, jetzt) {
      return k.due <= tagesBeginn(jetzt);
    }
  };

  /* ---------- FSRS ----------
     Rechnet mit ts-fsrs (ts-fsrs.js, window.FSRS). Der Stand liegt je Karte in k.fsrs als schlichtes Objekt mit Zeiten
     in ms, weil localStorage keine Date-Objekte kennt: due, stability, difficulty, reps, lapses, state, last_review.
     Kurzzeit-Schritte (enable_short_term) sind aus, weil die App in ganzen Tagen plant: Nochmal heißt hier
     "morgen wieder", nicht "in 10 Minuten". Fällig ist eine Karte am Kalendertag ihres due, wie bei Leitner.
     einst: { retention: 0.8 bis 0.95, fuzz: false nur für Tests } - fuzz streut die Abstände leicht,
     damit gleich gelernte Karten nicht alle am selben Tag wiederkommen. k.box und k.due (Leitner) bleiben unberührt. */
  var FSRS_NEU = 0;
  var planerSpeicher = {};

  // ein ts-fsrs-Planer je Einstellung - wird nur einmal gebaut, nicht bei jeder Antwort
  function planer(einst) {
    var retention = einst && einst.retention ? einst.retention : 0.9, fuzz = !(einst && einst.fuzz === false);
    var schluessel = retention + "|" + fuzz;
    if (!planerSpeicher[schluessel]) {
      planerSpeicher[schluessel] = window.FSRS.fsrs(window.FSRS.generatorParameters({
        request_retention: retention, enable_short_term: false, enable_fuzz: fuzz
      }));
    }
    return planerSpeicher[schluessel];
  }

  // gespeicherter Stand -> Karte für ts-fsrs (mit Date-Objekten); ohne Stand eine neue Karte
  function zuFsrsKarte(f, jetzt) {
    if (!f) return window.FSRS.createEmptyCard(new Date(jetzt));
    return {
      due: new Date(f.due), stability: f.stability, difficulty: f.difficulty, elapsed_days: 0, scheduled_days: 0,
      reps: f.reps, lapses: f.lapses, learning_steps: 0, state: f.state,
      last_review: f.last_review ? new Date(f.last_review) : undefined
    };
  }

  // Karte von ts-fsrs -> schlichter Stand zum Speichern (nur die Felder, die ts-fsrs zum Weiterrechnen braucht)
  function ausFsrsKarte(c) {
    return {
      due: c.due.getTime(), stability: c.stability, difficulty: c.difficulty, reps: c.reps, lapses: c.lapses,
      state: c.state, last_review: c.last_review ? c.last_review.getTime() : null
    };
  }

  // aktueller Abstand einer FSRS-Karte in ganzen Tagen (fällig minus zuletzt gelernt); neue Karten haben 0
  function intervallTage(f) {
    if (!f || f.state === FSRS_NEU || !f.last_review) return 0;
    return Math.max(0, Math.round((tagesBeginn(f.due) - tagesBeginn(f.last_review)) / TAG));
  }

  /* Fach für die Fächer-Ansicht im FSRS-Modus: FSRS kennt keine Fächer, darum wird nach dem Abstand sortiert.
     Dieselben Grenzen gelten für den Rückweg FSRS -> Leitner, damit Ansicht und Umrechnung zusammenpassen. */
  function fachAusIntervall(tage) {
    if (tage < 1) return 1;
    if (tage < 7) return 2;
    if (tage < 30) return 3;
    if (tage < 90) return 4;
    return 5;
  }

  var FsrsScheduler = {
    review: function (k, bewertung, jetzt, einst) {
      var ergebnis = planer(einst).next(zuFsrsKarte(k.fsrs, jetzt), new Date(jetzt), bewertung);
      k.fsrs = ausFsrsKarte(ergebnis.card);
      return k;
    },
    isDue: function (k, jetzt) {
      return !k.fsrs || tagesBeginn(k.fsrs.due) <= tagesBeginn(jetzt);
    },
    /* Für die Knöpfe: in wie vielen Tagen käme die Karte je Bewertung wieder ({ 1: Tage, 2: …, 3: …, 4: … }).
       Rechnet nur voraus, ändert die Karte nicht. Mit Streuung (fuzz) kann die echte Antwort ein, zwei Tage
       davon abweichen, weil die Streuung auch vom Zeitpunkt abhängt - darum zeigt die App ab 3 Tagen "≈". */
    vorschau: function (k, jetzt, einst) {
      var alle = planer(einst).repeat(zuFsrsKarte(k.fsrs, jetzt), new Date(jetzt)), tage = {};
      [BEWERTUNG.NOCHMAL, BEWERTUNG.SCHWER, BEWERTUNG.GUT, BEWERTUNG.LEICHT].forEach(function (b) {
        tage[b] = Math.round((tagesBeginn(alle[b].card.due.getTime()) - tagesBeginn(jetzt)) / TAG);
      });
      return tage;
    }
  };

  /* ---------- Umrechnen zwischen den Verfahren ----------
     Normalerweise braucht es das nicht: Jede Antwort schreibt beide Stände fort (k.box/k.due und k.fsrs), darum geht
     beim Umschalten nichts verloren. Umgerechnet wird nur, wo ein Stand fehlt - beim ersten Start mit FSRS
     (Schema 3), bei Karten aus älteren Sicherungen und wenn im FSRS-Modus ein Fach von Hand gesetzt wird. */
  var FSRS_WIEDERHOLEN = 2;
  var MITTLERE_SCHWIERIGKEIT = 5;   // FSRS-Skala 1 bis 10; ohne Verlauf wissen wir nichts Genaueres

  /* Leitner -> FSRS: Fach 1 gilt als neu. Ab Fach 2 wird der Abstand des Fachs zur Stabilität (bei 90 % Behaltensquote
     ist die Stabilität genau der Abstand, nach dem man die Karte wiederholen sollte). Lief der Kasten zuletzt im früheren
     SM-2-Modus (sm2 = true), bringt jede Karte ihren eigenen Abstand iv mit, der ist genauer als das Fach - sonst ist iv
     veraltet und zählt nicht. due bleibt, wie es ist; zuletzt gelernt wird
     zurückgerechnet (due minus Abstand). Ohne due wird die Karte über die nächsten Tage verteilt (nr = Platz in der
     Liste), damit nicht alle an einem Tag kommen. */
  function fsrsAusFach(k, tage, jetzt, nr, sm2) {
    var abstand = sm2 && typeof k.iv === "number" && k.iv > 0 ? k.iv : tage[k.box] || 0;
    var due = typeof k.due === "number" ? k.due : tagesBeginn(jetzt) + ((nr || 0) % Math.max(1, abstand)) * TAG;
    if (!(k.box > 1) || !abstand) {
      return { due: due, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: FSRS_NEU, last_review: null };
    }
    return {
      due: due, stability: abstand, difficulty: MITTLERE_SCHWIERIGKEIT,
      reps: sm2 && typeof k.rep === "number" && k.rep > 0 ? k.rep : k.box - 1, lapses: 0,
      state: FSRS_WIEDERHOLEN, last_review: due - abstand * TAG
    };
  }

  /* Fach von Hand gesetzt, während FSRS gilt: Die Karte bekommt den kleinsten Abstand, der in der Fächer-Ansicht
     zu diesem Fach gehört (Fach 1 = neu), und ist heute dran - wie beim Verschieben unter Leitner. Nicht die
     Leitner-Tabelle, sonst läge die Karte danach in der Ansicht in einem anderen Fach als gewählt. */
  var FACH_UNTERGRENZE = [0, 0, 1, 7, 30, 90];
  function fsrsFuerFach(fach, jetzt) {
    var abstand = FACH_UNTERGRENZE[fach] || 0, due = tagesBeginn(jetzt);
    if (!abstand) return { due: due, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: FSRS_NEU, last_review: null };
    return {
      due: due, stability: abstand, difficulty: MITTLERE_SCHWIERIGKEIT, reps: fach - 1, lapses: 0,
      state: FSRS_WIEDERHOLEN, last_review: due - abstand * TAG
    };
  }

  // FSRS -> Leitner: Fach nach dem Abstand, mit denselben Grenzen wie die Fächer-Ansicht; fällig am selben Tag
  function leitnerAusFsrs(k) {
    k.box = fachAusIntervall(intervallTage(k.fsrs));
    k.due = tagesBeginn(k.fsrs.due);
    return k;
  }

  /* FSRS-Stand aus einer Sicherungsdatei: nur übernehmen, wenn alle Felder da und plausibel sind - sonst null, dann
     rechnet die App ihn aus dem Fach neu aus (standNachtragen). Gibt eine saubere Kopie ohne fremde Felder zurück. */
  function fsrsGueltig(f) {
    function zahl(x) { return typeof x === "number" && isFinite(x) && x >= 0; }
    if (!f || typeof f !== "object") return null;
    if (!zahl(f.due) || !zahl(f.stability) || !zahl(f.difficulty) || !zahl(f.reps) || !zahl(f.lapses)) return null;
    if ([0, 1, 2, 3].indexOf(f.state) < 0 || f.difficulty > 10) return null;
    if (f.last_review !== null && !zahl(f.last_review)) return null;
    if (f.state !== FSRS_NEU && (!f.last_review || !(f.stability > 0))) return null;   // gelernt ohne Datum oder Stabilität geht nicht
    return {
      due: f.due, stability: f.stability, difficulty: f.difficulty, reps: f.reps, lapses: f.lapses,
      state: f.state, last_review: f.last_review
    };
  }

  /* Antwortprotokoll aus einer Sicherungsdatei in das eines Kastens übernehmen. ids: Kartenkennung in der Datei ->
     Kennung auf diesem Gerät (neue Karten bekommen beim Einlesen eine neue). Einträge ohne passende Karte oder mit
     unbrauchbaren Werten fallen weg; was schon da ist (gleiche Karte, gleicher Zeitpunkt), kommt nicht doppelt -
     so kann man dieselbe Sicherung auch zweimal einlesen. Gibt die Zahl der übernommenen Einträge zurück. */
  function protokollMischen(ziel, eintraege, ids) {
    if (!Array.isArray(ziel.reviews)) ziel.reviews = [];
    var da = {}, dazu = 0;
    ziel.reviews.forEach(function (r) { da[r.cardId + "|" + r.timestamp] = true; });
    (Array.isArray(eintraege) ? eintraege : []).forEach(function (r) {
      if (!r || !Object.prototype.hasOwnProperty.call(ids, r.cardId)) return;
      if (typeof r.timestamp !== "number" || !isFinite(r.timestamp) || [1, 2, 3, 4].indexOf(r.rating) < 0) return;
      var id = ids[r.cardId];
      if (da[id + "|" + r.timestamp]) return;
      da[id + "|" + r.timestamp] = true;
      ziel.reviews.push({ cardId: id, timestamp: r.timestamp, rating: r.rating, scheduler: r.scheduler === "fsrs" ? "fsrs" : "leitner" });
      dazu++;
    });
    if (dazu) ziel.reviews.sort(function (a, b) { return a.timestamp - b.timestamp; });
    return dazu;
  }

  /* Ergänzt, was einer Karte fehlt: FSRS-Stand aus dem Fach, Fach aus dem FSRS-Stand, zuletzt gelernt (k.zuletzt, ms
     oder null). Vorhandene Werte bleiben unangetastet. Gibt true zurück, wenn etwas ergänzt wurde. */
  function standNachtragen(k, tage, jetzt, nr, sm2) {
    var neu = false;
    if (typeof k.box !== "number" && k.fsrs) { leitnerAusFsrs(k); neu = true; }
    if (!k.fsrs) { k.fsrs = fsrsAusFach(k, tage, jetzt, nr, sm2); neu = true; }
    if (k.zuletzt === undefined) { k.zuletzt = k.fsrs.last_review; neu = true; }
    return neu;
  }

  /* Schema 3 (2026-09): jede Karte hat k.fsrs und k.zuletzt, der Kasten ein Antwortprotokoll
     d.reviews = [{ cardId, timestamp, rating, scheduler }] - gedacht für eine spätere Anpassung der FSRS-Parameter.
     Einen Verlauf je Karte gab es vorher nicht (nur Tageszählungen in d.log), darum wird aus dem Fach abgeleitet.
     Die alten Felder (box, due, bei SM-2 auch iv/ez/rep) bleiben stehen: So geht nichts verloren, auch nicht beim
     Zurückschalten. Die Sicherung vor dem Umbau macht app.js, weil nur dort der Speicher bekannt ist.
     Läuft bei jedem Laden: ergänzt auch Karten, die später ohne FSRS-Stand dazugekommen sind. */
  function migriereV3(d, tage, jetzt) {
    var geaendert = false, sm2 = d.modus === "sm2";
    d.cards.forEach(function (k, i) { if (standNachtragen(k, tage, jetzt, i, sm2)) geaendert = true; });
    if (!Array.isArray(d.reviews)) { d.reviews = []; geaendert = true; }
    if (!(d.v >= 3)) { d.v = 3; geaendert = true; }
    return geaendert;
  }

  window.VK_LERNEN = {
    BEWERTUNG: BEWERTUNG, tagesBeginn: tagesBeginn, LeitnerScheduler: LeitnerScheduler, FsrsScheduler: FsrsScheduler,
    intervallTage: intervallTage, fachAusIntervall: fachAusIntervall,
    fsrsAusFach: fsrsAusFach, fsrsFuerFach: fsrsFuerFach, fsrsGueltig: fsrsGueltig, protokollMischen: protokollMischen, leitnerAusFsrs: leitnerAusFsrs, standNachtragen: standNachtragen, migriereV3: migriereV3
  };
})();
