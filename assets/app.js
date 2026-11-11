/* Cockpit d'Antonin : lit et écrit dans Supabase (projets, agendas synchronisés, tâches, clients, suivis).
   Accueil (#) : l'heure, la journée en frise horizontale et les quatre projets côte à côte.
   Page projet (#palomano, ...) : tâches, agenda, clients et suivis, chiffres, notes.
   Clavier : 0 accueil, 1 à 9 projets, N nouvelle tâche, ← → jour précédent / suivant, T aujourd'hui. */
(function () {
  "use strict";

  var CFG = window.COCKPIT_CONFIG || {};
  var app = document.getElementById("app");
  var navProjets = document.getElementById("projets");
  var barre = document.getElementById("nav");
  var JOUR = 86400000;

  var S = {
    route: "", jour: debutJour(new Date()),
    activites: [], agendas: [], evenements: [], taches: [], clients: [], suivis: [], semaine: [], factures: [], factureOuverte: null, comptes: [], message: "",
    ouvert: null, edition: null, voirFaites: false, voirRetards: false
  };
  var db = null;

  // ---------- Utilitaires ----------
  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (enfants || []).forEach(function (e) {
      if (e == null || e === false) return;
      n.appendChild(typeof e === "string" ? document.createTextNode(e) : e);
    });
    return n;
  }
  function debutJour(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function ajouterJours(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function lundi(d) { var x = debutJour(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function isoJour(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function lireJour(s) { if (!s) return null; var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function hDec(d) { return d.getHours() + d.getMinutes() / 60; }
  function hTexte(x) { var h = Math.floor(x), m = Math.round((x - h) * 60); return h + "h" + (m ? pad(m) : ""); }
  function memeJour(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function joursDepuis(d) { return Math.round((debutJour(d) - debutJour(new Date())) / JOUR); }
  var fmtN = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  function nombre(v, unite) {
    if (v == null || v === "") return "—";
    if (typeof v !== "number") return String(v);
    return fmtN.format(v) + (unite ? (unite === "%" ? " %" : " " + unite) : "");
  }
  function compact(v) { return Math.abs(v) >= 10000 ? fmtN.format(Math.round(v / 100) / 10) + " k" : fmtN.format(v); }
  function fmt(d, o) { return new Intl.DateTimeFormat("fr-FR", o).format(d); }
  function quand(d) {
    var j = joursDepuis(d);
    if (j === 0) return "aujourd'hui";
    if (j === 1) return "demain";
    if (j === -1) return "hier";
    if (j < 0) return "retard " + (-j) + " j";
    if (j < 7) return fmt(d, { weekday: "long" });
    return fmt(d, { day: "numeric", month: "short" });
  }
  function duree(ms) {
    var m = Math.max(0, Math.ceil(ms / 60000 - 0.01));
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    return h + " h" + (r ? " " + pad(r) : "");
  }
  function activite(id) { return S.activites.filter(function (a) { return a.id === id; })[0] || null; }
  function couleur(id) { var a = activite(id); return a ? a.couleur : "#9a9184"; }
  function nomActivite(id) { var a = activite(id); return a ? a.nom : "Non classé"; }
  function actEv(e) { return e.activite_forcee || e.activite_id || null; }
  function projets() { return S.activites.filter(function (a) { return a.id !== "perso"; }); }
  // Colonnes propres à un projet (ex. Berkay : prix du bien, commissions) : activites.reglages + clients.donnees.
  function reglages(a) { return (a && a.reglages) || {}; }
  function valeurChamp(c, cle) { return cle === "montant" ? c.montant : (c.donnees || {})[cle]; }
  function totalClient(a, c) {
    var t = reglages(a).total;
    return t ? t.de.reduce(function (s, k) { return s + (+valeurChamp(c, k) || 0); }, 0) : null;
  }
  function estAbandonne(c) { return /abandon|perdu/i.test(c.etape || ""); }
  // Indicateurs calculés en direct à partir des fiches, puis indicateurs saisis (activites.kpis).
  function kpisProjet(a) {
    var r = reglages(a), calcules = [];
    if (r.total) {
      var cs = S.clients.filter(function (c) { return c.activite_id === a.id && !estAbandonne(c); });
      var gagnes = cs.filter(function (c) { return (r.etapes_gagnees || []).indexOf(c.etape) >= 0; });
      var enCours = cs.filter(function (c) { return gagnes.indexOf(c) < 0; });
      var somme = function (l) { return l.reduce(function (s, c) { return s + totalClient(a, c); }, 0); };
      calcules = [
        { label: "Commissions signées", valeur: somme(gagnes), unite: "€", detail: gagnes.length + " affaire" + (gagnes.length > 1 ? "s" : "") + " : " + (r.etapes_gagnees || []).join(" ou ").toLowerCase() },
        { label: "Commissions en cours", valeur: somme(enCours), unite: "€", detail: enCours.length + " affaire" + (enCours.length > 1 ? "s" : "") + " en discussion" },
        { label: r.libelle_montant ? "Volume (" + r.libelle_montant.toLowerCase() + ")" : "Volume", valeur: cs.reduce(function (s, c) { return s + (+c.montant || 0); }, 0), unite: "€" }
      ];
    }
    return calcules.concat(a.kpis || []);
  }
  var POIDS = { haute: 0, moyenne: 1, basse: 2 };
  var STATUTS = { "a-faire": "À faire", "en-cours": "En cours", "en-revision": "En révision", "fait": "Terminé" };
  var TYPES_SUIVI = { appel: "Appel", mail: "E-mail", rdv: "Rendez-vous", note: "Note", relance: "Relance", devis: "Devis", signature: "Signature" };
  function trierTaches(ts) {
    return ts.sort(function (x, y) {
      if ((x.statut === "fait") !== (y.statut === "fait")) return x.statut === "fait" ? 1 : -1;
      if (x.echeance && y.echeance && x.echeance !== y.echeance) return x.echeance < y.echeance ? -1 : 1;
      if (!x.echeance !== !y.echeance) return x.echeance ? -1 : 1;
      return (POIDS[x.priorite] || 1) - (POIDS[y.priorite] || 1);
    });
  }
  // Saisie en cours : un champ actif, ou une fiche ouverte modifiée et pas encore enregistrée
  // (sinon une mise à jour automatique redessinerait la fiche et effacerait ce qui n'est pas enregistré).
  function enSaisie() {
    var a = document.activeElement;
    return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT") && app.contains(a))
      || !!app.querySelector("form.fiche[data-modifiee]");
  }
  function marquerFiche(ev) {
    var f = ev.target && ev.target.closest && ev.target.closest("form.fiche");
    if (f && !(ev.type === "click" && (ev.target.closest("button") || {}).type !== "button")) f.dataset.modifiee = "1";
  }
  ["input", "change"].forEach(function (t) { document.addEventListener(t, marquerFiche, true); });
  document.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest("form.fiche button[type=button]")) marquerFiche(ev); }, true);
  function signaler(texte) {
    var t = el("div", { class: "toast", role: "status", text: texte });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("sort"); }, 2800);
    setTimeout(function () { t.remove(); }, 3300);
  }
  function verifier(res) { if (res && res.error) { signaler("Erreur : " + res.error.message); throw res.error; } return res; }

  // ---------- Données ----------
  function chargerTout() {
    var debut = ajouterJours(lundi(S.jour), -7).toISOString();
    var fin = ajouterJours(lundi(S.jour), 63).toISOString();
    var depuis = ajouterJours(new Date(), -14).toISOString();
    return Promise.all([
      db.from("activites").select("*").order("ordre"),
      db.from("agendas").select("id, nom, activite_id, compte_id, ecriture, actif, derniere_synchro, derniere_erreur, nb_evenements").order("nom"),
      db.from("evenements").select("*").gte("fin", debut).lte("debut", fin).order("debut"),
      db.from("taches").select("*").or("statut.neq.fait,fait_le.gte." + depuis),
      db.from("clients").select("*").order("nom"),
      db.from("suivis").select("*").order("le", { ascending: false }).limit(500),
      db.from("semaine_type").select("*").order("debut"),
      db.from("factures").select("*"),
      db.from("comptes_agenda").select("id, fournisseur, email, usage, droits, derniere_erreur, cree_le").order("cree_le"),
      db.from("briefings").select("*").eq("jour", isoJour(new Date())).maybeSingle(),
      db.from("propositions").select("*").eq("statut", "proposee").order("cree_le"),
      db.from("recommandations").select("*").order("recue_le", { ascending: false }),
      db.from("production").select("*").order("annee").order("mois").order("cree_le"),
      db.from("reponses").select("*").gte("cree_le", ajouterJours(new Date(), -30).toISOString()).order("cree_le", { ascending: false })
    ]).then(function (r) {
      r.forEach(verifier);
      appliquerDonnees(r.map(function (x) { return x.data; }));
      memoriserDonnees(r.map(function (x) { return x.data; }));
    });
  }
  // Copie des dernières données sur cet appareil : au démarrage, le cockpit s'affiche aussitôt avec elles,
  // puis se met à jour dès que la base a répondu (aucune attente du renouvellement de session ni du réseau).
  var CLE_CACHE = "cockpit-donnees-v1";
  function memoriserDonnees(d) {
    try { var t = JSON.stringify({ le: Date.now(), d: d }); if (t.length < 4500000) localStorage.setItem(CLE_CACHE, t); } catch (e) { try { localStorage.removeItem(CLE_CACHE); } catch (e2) { /* rien */ } }
  }
  function donneesMemorisees() {
    try { var c = JSON.parse(localStorage.getItem(CLE_CACHE) || "null"); return c && c.d && c.d.length === 14 && Date.now() - c.le < 7 * 864e5 ? c.d : null; } catch (e) { return null; }
  }
  function appliquerDonnees(d) {
    var r = d.map(function (x) { return { data: x }; });
      S.activites = r[0].data; S.agendas = r[1].data;
      // Un même rendez-vous présent dans deux agendas (invitation partagée) n'apparaît qu'une fois ;
      // on garde la copie modifiable, puis celle d'un agenda sans projet imposé.
      var vus = {};
      S.tousEvenements = r[2].data.filter(function (e) { return !e.annule; }); // toutes les copies, pour les supprimer ensemble
      S.evenements = S.tousEvenements.slice()
        .sort(function (x, y) {
          var imposeX = (S.agendas.filter(function (g) { return g.id === x.agenda_id; })[0] || {}).activite_id ? 1 : 0;
          var imposeY = (S.agendas.filter(function (g) { return g.id === y.agenda_id; })[0] || {}).activite_id ? 1 : 0;
          return ((x.activite_forcee ? 0 : 1) - (y.activite_forcee ? 0 : 1)) || (imposeX - imposeY) || (y.modifiable - x.modifiable);
        })
        .filter(function (e) { var k = (e.titre || "") + "|" + e.debut + "|" + e.fin; if (vus[k]) return false; vus[k] = true; return true; })
        .sort(function (x, y) { return new Date(x.debut) - new Date(y.debut); });
      S.taches = r[3].data; S.clients = r[4].data; S.suivis = r[5].data; S.semaine = r[6].data; S.factures = r[7].data; S.comptes = r[8].data;
      S.briefing = r[9].data; S.propositions = r[10].data || []; S.recommandations = r[11].data || []; S.production = r[12].data || [];
      S.reponses = r[13].data || [];
  }
  var redessinPrevu = null;
  function rechargerPuisDessiner() {
    clearTimeout(redessinPrevu);
    redessinPrevu = setTimeout(function () { chargerTout().then(dessiner); }, 250);
  }
  function tachesDuJour(iso, act) {
    return S.taches.filter(function (t) { return t.echeance === iso && (!act || t.activite_id === act); });
  }
  function tachesEnRetard(iso, act) {
    return S.taches.filter(function (t) { return t.statut !== "fait" && t.echeance && t.echeance < iso && (!act || t.activite_id === act); });
  }
  function relances(iso, act) {
    return S.clients.filter(function (c) { return c.prochaine_action_le && c.prochaine_action_le <= iso && (!act || c.activite_id === act); })
      .sort(function (a, b) { return a.prochaine_action_le < b.prochaine_action_le ? -1 : 1; });
  }
  function prochainRdv(act) {
    var n = new Date();
    return S.evenements.filter(function (e) { return !e.journee && new Date(e.fin) > n && (!act || actEv(e) === act); })[0] || null;
  }

  // ---------- Planning d'une journée : rendez-vous + blocs de la semaine type dans les trous ----------
  function planJour(jour) {
    var debut = debutJour(jour), fin = ajouterJours(debut, 1);
    var evs = S.evenements.filter(function (e) { return new Date(e.debut) < fin && new Date(e.fin) > debut; });
    var journee = evs.filter(function (e) { return e.journee; });
    var horaires = evs.filter(function (e) { return !e.journee; }).map(function (e) {
      var a = new Date(e.debut), b = new Date(e.fin);
      return { ev: e, s: a < debut ? 0 : hDec(a), e: b >= fin ? 24 : hDec(b), activite: actEv(e) };
    });
    var blocs = [];
    S.semaine.filter(function (b) { return b.jour === jour.getDay(); }).forEach(function (b) {
      var morceaux = [[+b.debut, +b.fin]];
      horaires.forEach(function (h) {
        var suite = [];
        morceaux.forEach(function (m) {
          if (h.e <= m[0] || h.s >= m[1]) { suite.push(m); return; }
          if (h.s > m[0]) suite.push([m[0], h.s]);
          if (h.e < m[1]) suite.push([h.e, m[1]]);
        });
        morceaux = suite;
      });
      morceaux.forEach(function (m) {
        if (m[1] - m[0] >= 0.5) blocs.push({ s: m[0], e: m[1], activite: b.activite_id, libelle: b.libelle });
      });
    });
    return { journee: journee, horaires: horaires, blocs: blocs };
  }
  function heuresSemaine() {
    var h = {}, l = lundi(S.jour);
    for (var i = 0; i < 7; i++) {
      var p = planJour(ajouterJours(l, i));
      p.horaires.concat(p.blocs).forEach(function (x) { if (x.activite) h[x.activite] = (h[x.activite] || 0) + (x.e - x.s); });
    }
    return h;
  }

  // ---------- Chartes graphiques des projets (logos dans assets/marques, couleurs dans activites.couleur) ----------
  var CHARTES = {
    "palomano": { icone: "assets/marques/palomano-icone.svg", police: '"Playpen Sans", var(--sans)',
      couverture: "linear-gradient(115deg, #c1daf3 0%, #e1ebbd 33%, #f7d589 66%, #ef818e 100%)" },
    "evoa-courtage": { icone: "assets/marques/evoa-icone.png", police: '"Montserrat", var(--sans)',
      couverture: "linear-gradient(115deg, #204e99 0%, #2b3f8f 55%, #38297c 100%)", bouton: "linear-gradient(115deg, #204e99, #38297c)" },
    "harnes-volley": { icone: "assets/marques/harnes.png", police: '"Barlow Condensed", var(--sans)', style: "majuscules",
      couverture: "linear-gradient(105deg, #0e0e0f 0 56%, #d01818 56% 61%, #0e0e0f 61% 64%, #8f0000 64% 100%)" },
    "berkay": { icone: "assets/marques/berkay-icone.svg", police: 'Arial, "Helvetica Neue", var(--sans)', style: "italique", couverture: "linear-gradient(115deg, #123208, #2a5a1c)" },
    "camp-rouzier-marechal": { icone: "assets/marques/camp.png", police: '"Anton", "Arial Narrow", var(--sans)', style: "majuscules-larges",
      couverture: "linear-gradient(105deg, #0B1736 0 60%, #FFC929 60% 64.5%, #0F1E45 64.5% 100%)", bouton: "#0B1736" },
    "wealthy": { icone: "assets/marques/wealthy-icone.png", police: '"Bodoni Moda", Didot, serif', style: "capitales-fines",
      couverture: "linear-gradient(180deg, #f4efe6, #e6ddcd)" }
  };
  function couvertureDe(a) {
    var ch = CHARTES[a.id];
    return ch && ch.couverture || "linear-gradient(115deg, color-mix(in srgb, " + a.couleur + " 38%, #fff), color-mix(in srgb, " + a.couleur + " 10%, #fff))";
  }

  // ---------- Navigation : barre latérale façon Notion, fil d'Ariane en haut ----------
  var ICONES = {
    aujourdhui: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg>',
    taches: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="3"/><path d="M5.5 8.2l1.8 1.8 3.4-3.6"/></svg>',
    agendas: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>',
    chercher: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>',
    mails: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 9.5V12a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 14 12V9.5"/><path d="M2 9.5h3.2l.8 1.5h4l.8-1.5H14L12.3 3.7a1.5 1.5 0 0 0-1.4-1.2H5.1a1.5 1.5 0 0 0-1.4 1.2z"/></svg>',
    clients: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.5" r="2.5"/><path d="M1.8 13.5c.6-2.4 2.2-3.6 4.2-3.6s3.6 1.2 4.2 3.6"/><circle cx="11.5" cy="6" r="2"/><path d="M11 9.9c1.6 0 2.8 1 3.3 3"/></svg>',
    recos: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.9l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z"/></svg>',
    factures: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.8h9v12.4l-1.8-1.1-1.8 1.1L7.1 13l-1.8 1.2-1.8-1.1z"/><path d="M5.8 5.5h4.4M5.8 8h4.4M5.8 10.5h2.6"/></svg>',
    chiffres: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5"/></svg>',
    notes: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3z"/><path d="M10 2.5v3h3M5.5 8.5h5M5.5 11h3.5"/></svg>',
    retour: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
    fleche: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>'
  };
  function icone(nom, classe) { var s = el("span", { class: "icone " + (classe || "") }); s.innerHTML = ICONES[nom]; return s; }
  function nomCourt(nom) { return nom.replace(" Courtage", "").replace(" Rouzier Maréchal", "").replace(" Volley", "").replace(" Gestion Privée", ""); }
  function iconeProjet(a, grande) {
    var ch = CHARTES[a.id];
    if (ch && ch.icone) return el("span", { class: "icone-projet logo" + (grande ? " grande" : ""), style: "--c:" + a.couleur, "aria-hidden": "true" }, [el("img", { src: ch.icone, alt: "", decoding: "async" })]);
    return el("span", { class: "icone-projet" + (grande ? " grande" : ""), style: "--c:" + a.couleur, "aria-hidden": "true", text: nomCourt(a.nom).charAt(0) });
  }
  function boutonsLiens(liens) {
    return el("div", { class: "boutons-liens" }, liens.map(function (l) {
      var domaine = ""; try { domaine = new URL(l.url).hostname.replace(/^www\./, ""); } catch (e) {}
      var b = el("a", { class: "bouton-lien", href: l.url, target: "_blank", rel: "noopener" }, [
        el("span", { class: "bouton-lien-initiale", "aria-hidden": "true", text: l.label.charAt(0).toUpperCase() }),
        el("span", { class: "bouton-lien-texte" }, [el("b", { text: l.label }), domaine ? el("small", { text: domaine }) : null])
      ]);
      b.insertAdjacentHTML("beforeend", '<svg class="bouton-lien-fleche" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11l6-6M6 5h5v5"/></svg>');
      return b;
    }));
  }
  function lienCote(href, actif, contenu, nb, touche) {
    var l = el("a", { href: href, class: "cote-lien", title: touche ? "Touche " + touche : null }, contenu.concat([nb ? el("small", { text: String(nb) }) : null]));
    if (actif) l.setAttribute("aria-current", "page");
    return l;
  }
  function dessinerNav() {
    navProjets.textContent = "";
    var iso = isoJour(new Date());
    var nbT = S.taches.filter(function (t) { return t.statut !== "fait" && t.echeance && t.echeance <= iso; }).length;
    navProjets.appendChild(el("div", { class: "cote-groupe" }, [
      lienCote("#", !S.route, [icone("aujourdhui"), el("span", { text: "Aujourd'hui" })], tachesDuJour(iso).filter(function (t) { return t.statut !== "fait"; }).length, "0"),
      lienCote("#taches", S.route === "taches", [icone("taches"), el("span", { text: "Tâches" })], nbT, "B"),
      lienCote("#agendas", S.route === "agendas", [icone("agendas"), el("span", { text: "Agendas" })]),
      lienCote("#mails", S.route === "mails", [icone("mails"), el("span", { text: "Tri des boîtes" })]),
      lienCote("#recherche", S.route === "recherche", [icone("chercher"), el("span", { text: "Rechercher un mail" })]),
      lienCote("#reponses", S.route === "reponses", [icone("mails"), el("span", { text: "Réponses" })],
        (S.reponses || []).filter(function (x) { return x.statut === "brouillon"; }).length)
    ]));
    navProjets.appendChild(el("div", { class: "cote-groupe" }, [el("p", { class: "cote-titre", text: "Projets" })].concat(S.activites.map(function (a, i) {
      var n = S.taches.filter(function (t) { return t.activite_id === a.id && t.statut !== "fait"; }).length;
      var lien = lienCote("#" + a.id, a.id === S.route && !S.rubrique, [iconeProjet(a), el("span", { text: a.nom })], n, String(i + 1));
      if (a.id !== S.route) return lien;
      // Projet ouvert : ses rubriques en sous-menu, pour passer de l'une à l'autre sans descendre dans la page
      return el("div", { class: "cote-projet-ouvert", style: "--c:" + a.couleur }, [lien,
        el("div", { class: "cote-sous-menu" }, rubriquesDe(a).map(function (x) {
          return lienCote("#" + a.id + "/" + x.id, S.rubrique === x.id, [icone(x.icone), el("span", { text: x.nom })]);
        }))]);
    }))));
    // Fil d'Ariane de la barre du haut
    var fil = document.getElementById("fil"), a = activite(S.route);
    fil.textContent = "";
    fil.append(el("a", { href: "#", text: "Cockpit" }), el("span", { class: "fil-sep", text: "/" }),
      a ? (S.rubrique ? el("a", { class: "fil-page", href: "#" + a.id }, [iconeProjet(a), a.nom]) : el("span", { class: "fil-page" }, [iconeProjet(a), a.nom]))
        : el("span", { class: "fil-page", text: S.route === "taches" ? "Tâches" : S.route === "agendas" ? "Agendas" : S.route === "mails" ? "Tri des boîtes" : S.route === "recherche" ? "Rechercher un mail" : S.route === "reponses" ? "Réponses" : "Aujourd'hui" }));
    var rubA = a && rubriquesDe(a).filter(function (x) { return x.id === S.rubrique; })[0];
    if (rubA) fil.append(el("span", { class: "fil-sep", text: "/" }), el("span", { class: "fil-page", text: rubA.nom }));
  }
  // Menu sur téléphone : la barre latérale glisse par-dessus la page.
  function menu(ouvert) {
    barre.classList.toggle("menu-ouvert", ouvert);
    document.getElementById("ouvrir-menu").setAttribute("aria-expanded", ouvert ? "true" : "false");
  }
  document.getElementById("ouvrir-menu").addEventListener("click", function () { menu(true); });
  document.getElementById("fermer-menu").addEventListener("click", function () { menu(false); });
  document.getElementById("voile").addEventListener("click", function () { menu(false); });
  navProjets.addEventListener("click", function (ev) { if (ev.target.closest("a")) menu(false); });

  // ---------- Tâches ----------
  function caseTache(t) {
    return el("input", { type: "checkbox", class: "coche", checked: t.statut === "fait", "aria-label": "Marquer comme faite", onchange: function (ev) {
      t.statut = ev.target.checked ? "fait" : "a-faire";
      db.from("taches").update({ statut: t.statut }).eq("id", t.id).then(verifier);
      if (t.statut === "fait") signaler("Bien joué : « " + t.titre + " »");
      dessiner();
    } });
  }
  function ligneTache(t, options) {
    options = options || {};
    if (S.edition === t.id) return formTache(t);
    var j = t.echeance ? joursDepuis(lireJour(t.echeance)) : null;
    var meta = [];
    if (options.projet) meta.push(el("span", { class: "pt", style: "--c:" + couleur(t.activite_id), text: nomActivite(t.activite_id) }));
    if (options.date !== false && t.echeance) meta.push(el("span", { class: t.statut !== "fait" && j < 0 ? "retard" : "", text: quand(lireJour(t.echeance)) }));
    if (t.statut === "en-cours" || t.statut === "en-revision") meta.push(el("span", { text: STATUTS[t.statut] }));
    var client = t.client_id && S.clients.filter(function (c) { return c.id === t.client_id; })[0];
    if (client) meta.push(el("span", { text: client.nom }));
    return el("li", { class: "tache" + (t.statut === "fait" ? " faite" : "") + (t.priorite === "haute" ? " haute" : "") }, [
      caseTache(t),
      el("button", { type: "button", class: "intitule", title: "Modifier", onclick: function () { S.edition = t.id; dessiner(); } }, [
        el("span", { text: t.titre }), meta.length ? el("small", {}, meta) : null
      ]),
      t.statut !== "fait" ? el("button", { type: "button", class: "reporter", title: "Reporter à demain", text: "Demain", onclick: function () {
        t.echeance = isoJour(ajouterJours(new Date(), 1));
        db.from("taches").update({ echeance: t.echeance }).eq("id", t.id).then(verifier);
        dessiner();
      } }) : null
    ]);
  }
  function optionsActivites(courante) {
    return S.activites.map(function (a) { return el("option", { value: a.id, selected: a.id === courante, text: a.nom }); });
  }
  function formTache(t) {
    var f = el("form", { class: "edition" });
    var cT = el("input", { type: "text", value: t.titre, required: true, "aria-label": "Titre" });
    var cA = el("select", { "aria-label": "Projet" }, optionsActivites(t.activite_id));
    var cD = el("input", { type: "date", value: t.echeance || "", "aria-label": "Échéance" });
    var cP = el("select", { "aria-label": "Priorité" }, [["haute", "Haute"], ["moyenne", "Normale"], ["basse", "Basse"]].map(function (p) { return el("option", { value: p[0], selected: p[0] === t.priorite, text: p[1] }); }));
    var cS = el("select", { "aria-label": "Statut" }, Object.keys(STATUTS).map(function (s) { return el("option", { value: s, selected: s === t.statut, text: STATUTS[s] }); }));
    var cN = el("input", { type: "text", value: t.notes || "", placeholder: "Note", "aria-label": "Note" });
    f.append(cT, el("div", { class: "rangee" }, [cA, cD, cP, cS]), cN, el("div", { class: "rangee" }, [
      el("button", { type: "submit", class: "btn-plein", text: "Enregistrer" }),
      el("button", { type: "button", class: "btn-texte", text: "Annuler", onclick: function () { S.edition = null; dessiner(); } }),
      el("button", { type: "button", class: "btn-texte danger", text: "Supprimer", onclick: function () {
        if (!confirm("Supprimer « " + t.titre + " » ?")) return;
        S.taches = S.taches.filter(function (x) { return x.id !== t.id; }); S.edition = null;
        db.from("taches").delete().eq("id", t.id).then(verifier); dessiner();
      } })
    ]));
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var maj = { titre: cT.value.trim(), activite_id: cA.value, echeance: cD.value || null, priorite: cP.value, statut: cS.value, notes: cN.value.trim() || null };
      Object.assign(t, maj); S.edition = null;
      db.from("taches").update(maj).eq("id", t.id).then(verifier); dessiner();
    });
    setTimeout(function () { cT.focus(); }, 0);
    return el("li", { class: "tache-edition" }, [f]);
  }
  function champAjout(activiteId, jour, texte) {
    var champ = el("input", { type: "text", placeholder: texte || "+ Ajouter une tâche", "aria-label": "Nouvelle tâche" });
    var f = el("form", { class: "ajout" }, [champ]);
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!champ.value.trim()) return;
      creerTache({ titre: champ.value.trim(), activite_id: activiteId, echeance: jour ? isoJour(jour) : null, priorite: "moyenne" });
      champ.value = "";
    });
    return f;
  }
  function creerTache(t) {
    return db.from("taches").insert(t).select().single().then(verifier).then(function (r) {
      S.taches.push(r.data); dessiner(); signaler("Ajoutée : " + t.titre);
    });
  }
  function listeTaches(ts, options, vide) {
    return el("ul", { class: "taches" }, ts.length ? ts.map(function (t) { return ligneTache(t, options); }) : [el("li", { class: "vide", text: vide })]);
  }

  // ---------- Tâches façon Notion : tableau par statut (glisser-déposer) ou liste ----------
  var COLONNES = [["a-faire", "Tâches"], ["en-cours", "En cours"], ["en-revision", "En révision"], ["fait", "Terminé"]];
  function lirePref(cle, defaut) { try { return localStorage.getItem("cockpit." + cle) || defaut; } catch (e) { return defaut; } }
  function ecrirePref(cle, v) { try { localStorage.setItem("cockpit." + cle, v); } catch (e) {} }
  // Changement de statut : les cartes glissent vers leur nouvelle colonne (transition de vue nommée par carte).
  function changerStatut(t, statut) {
    if (!statut || t.statut === statut) return;
    t.statut = statut; t.fait_le = statut === "fait" ? new Date().toISOString() : null;
    db.from("taches").update({ statut: statut }).eq("id", t.id).then(verifier);
    if (statut === "fait") signaler("Bien joué : « " + t.titre + " »");
    avecTransition(dessiner, "carte");
  }
  function majTache(t, maj) {
    Object.assign(t, maj);
    db.from("taches").update(maj).eq("id", t.id).then(verifier);
    dessiner();
  }
  function pastilleProjet(id) { return el("span", { class: "pt", style: "--c:" + couleur(id), text: nomActivite(id) }); }
  function carteTache(t, opts) {
    if (S.edition === t.id) return formTache(t);
    var j = t.echeance ? joursDepuis(lireJour(t.echeance)) : null, meta = [];
    if (opts.projet) meta.push(pastilleProjet(t.activite_id));
    if (t.echeance) meta.push(el("span", { class: "carte-date" + (t.statut !== "fait" && j < 0 ? " retard" : ""), text: quand(lireJour(t.echeance)) }));
    if (t.priorite === "haute") meta.push(el("span", { class: "carte-prio", text: "Prioritaire" }));
    var client = t.client_id && S.clients.filter(function (c) { return c.id === t.client_id; })[0];
    if (client) meta.push(el("span", { text: client.nom }));
    var li = el("li", { class: "carte-tache" + (t.statut === "fait" ? " faite" : ""), style: "--vt:t-" + t.id + ";--c:" + couleur(t.activite_id) }, [
      el("button", { type: "button", class: "carte-titre", title: "Ouvrir (ou glisser vers une autre colonne)", onclick: function () {
        if (Date.now() - (S.finGlisse || 0) < 350) return;
        S.edition = t.id; dessiner();
      } }, [
        el("span", { text: t.titre }), t.notes ? el("small", { text: t.notes }) : null
      ]),
      meta.length ? el("div", { class: "carte-meta" }, meta) : null
    ]);
    activerGlisser(li, t);
    return li;
  }
  // Glisser une carte vers une autre colonne : à la souris, ou au doigt par un appui long (le défilement reste libre sinon).
  function activerGlisser(li, t) {
    li.addEventListener("pointerdown", function (ev) {
      if ((ev.pointerType === "mouse" && ev.button !== 0) || S.glisse) return;
      var x0 = ev.clientX, y0 = ev.clientY, tactile = ev.pointerType !== "mouse", g = null, minuterie = null, boucle = 0;
      function demarrer(x, y) {
        var r = li.getBoundingClientRect();
        g = S.glisse = { dx: x - r.left, dy: y - r.top, x: x, y: y, cible: null, fantome: li.cloneNode(true) };
        g.fantome.classList.add("fantome"); g.fantome.style.width = r.width + "px";
        document.body.appendChild(g.fantome);
        li.classList.add("glissee"); document.documentElement.classList.add("en-glisse");
        if (tactile && navigator.vibrate) navigator.vibrate(8);
        placer(x, y); boucle = requestAnimationFrame(defiler);
      }
      function placer(x, y) {
        g.x = x; g.y = y;
        g.fantome.style.transform = "translate3d(" + (x - g.dx) + "px," + (y - g.dy) + "px,0) rotate(2.5deg)";
        var sous = document.elementFromPoint(x, y), col = sous && sous.closest(".col-statut");
        // Sous une colonne plus courte (en bas du tableau), on retient la colonne d'après la seule position horizontale
        var tab = li.closest(".tableau-taches"), rt = tab && tab.getBoundingClientRect();
        if (!col && rt && y >= rt.top && y <= rt.bottom + 120) col = Array.prototype.find.call(tab.querySelectorAll(".col-statut"), function (c) {
          var r = c.getBoundingClientRect(); return x >= r.left && x <= r.right;
        }) || null;
        if (col !== g.cible) { if (g.cible) g.cible.classList.remove("survol"); g.cible = col; if (col) col.classList.add("survol"); }
      }
      // Près des bords, la page (et le tableau sur téléphone) défile tout seul.
      function defiler() {
        if (!g) return;
        var v = g.y < 70 ? -14 : g.y > innerHeight - 70 ? 14 : 0, tab = li.closest(".tableau-taches");
        if (v) window.scrollBy(0, v);
        if (tab) { var r = tab.getBoundingClientRect(), h = g.x < r.left + 40 ? -16 : g.x > r.right - 40 ? 16 : 0; if (h) tab.scrollLeft += h; }
        if (v || tab) placer(g.x, g.y);
        boucle = requestAnimationFrame(defiler);
      }
      function bouger(e) {
        if (g) { e.preventDefault(); placer(e.clientX, e.clientY); return; }
        var d = Math.hypot(e.clientX - x0, e.clientY - y0);
        if (tactile) { if (d > 10) fin(); } else if (d > 5) demarrer(e.clientX, e.clientY);
      }
      function lacher() {
        var cible = g && g.cible, avait = !!g;
        fin();
        if (avait) { S.finGlisse = Date.now(); if (cible) changerStatut(t, cible.dataset.statut); }
      }
      function fin() {
        clearTimeout(minuterie); cancelAnimationFrame(boucle);
        document.removeEventListener("pointermove", bouger); document.removeEventListener("pointerup", lacher); document.removeEventListener("pointercancel", fin);
        if (g) {
          g.fantome.remove(); li.classList.remove("glissee"); document.documentElement.classList.remove("en-glisse");
          if (g.cible) g.cible.classList.remove("survol");
        }
        g = S.glisse = null;
      }
      if (tactile) minuterie = setTimeout(function () { demarrer(x0, y0); }, 260);
      document.addEventListener("pointermove", bouger, { passive: false });
      document.addEventListener("pointerup", lacher);
      document.addEventListener("pointercancel", fin);
    });
  }
  // Pendant un glisser au doigt, le doigt déplace la carte et non la page.
  document.addEventListener("touchmove", function (e) { if (S.glisse) e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", function (e) { if (S.glisse) e.preventDefault(); });
  function ajoutCarte(statut, opts) {
    var champ = el("input", { type: "text", placeholder: "+ Nouvelle tâche", "aria-label": "Nouvelle tâche · " + STATUTS[statut] });
    var choix = opts.choixProjet ? el("select", { class: "ajout-projet", "aria-label": "Projet" }, optionsActivites(S.dernierProjet || (S.activites[0] && S.activites[0].id))) : null;
    var f = el("form", { class: "ajout-carte" }, [champ, choix]);
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var titre = champ.value.trim(); if (!titre) return;
      var projet = choix ? (S.dernierProjet = choix.value) : opts.activite;
      creerTache({ titre: titre, activite_id: projet, statut: statut, priorite: "moyenne", echeance: null }).then(function () {
        var c = app.querySelector(".col-statut." + statut + " .ajout-carte input"); if (c) c.focus();
      });
      champ.value = "";
    });
    return f;
  }
  function tableauTaches(ts, opts) {
    return el("div", { class: "tableau-taches" }, COLONNES.map(function (c) {
      var cartes = trierTaches(ts.filter(function (t) { return t.statut === c[0]; }));
      if (c[0] === "fait") cartes.sort(function (x, y) { return String(y.fait_le || "").localeCompare(String(x.fait_le || "")); });
      var col = el("section", { class: "col-statut " + c[0], "data-statut": c[0], "aria-label": c[1] }, [
        el("header", {}, [el("span", { class: "statut-pastille " + c[0], text: c[1] }), el("span", { class: "colonne-nb", text: String(cartes.length) })]),
        el("ul", { class: "colonne-cartes" }, cartes.map(function (t) { return carteTache(t, opts); })),
        c[0] !== "fait" ? ajoutCarte(c[0], opts) : null
      ]);
      return col;
    }));
  }
  function listeNotion(ts, opts) {
    var iso = isoJour(new Date());
    var lignes = trierTaches(ts.slice()).map(function (t) {
      if (S.edition === t.id) return el("tr", { class: "ligne-edition" }, [el("td", { colspan: opts.projet ? 5 : 4 }, [el("ul", { class: "taches" }, [formTache(t)])])]);
      return el("tr", { class: "ligne-tache" + (t.statut === "fait" ? " faite" : "") }, [
        el("td", { class: "td-titre" }, [caseTache(t), el("button", { type: "button", class: "lien-titre", text: t.titre, title: "Ouvrir", onclick: function () { S.edition = t.id; dessiner(); } })]),
        opts.projet ? el("td", {}, [pastilleProjet(t.activite_id)]) : null,
        el("td", {}, [el("input", { type: "date", class: "cellule" + (t.statut !== "fait" && t.echeance && t.echeance < iso ? " retard" : ""), value: t.echeance || "", "aria-label": "Échéance",
          onchange: function (ev) { majTache(t, { echeance: ev.target.value || null }); } })]),
        el("td", {}, [el("select", { class: "cellule prio " + t.priorite, "aria-label": "Priorité", onchange: function (ev) { majTache(t, { priorite: ev.target.value }); } },
          [["haute", "Haute"], ["moyenne", "Normale"], ["basse", "Basse"]].map(function (p) { return el("option", { value: p[0], selected: p[0] === t.priorite, text: p[1] }); }))]),
        el("td", {}, [el("select", { class: "cellule statut-pastille " + t.statut, "aria-label": "Statut", onchange: function (ev) { changerStatut(t, ev.target.value); } },
          Object.keys(STATUTS).map(function (k) { return el("option", { value: k, selected: k === t.statut, text: STATUTS[k] }); }))])
      ]);
    });
    return el("div", { class: "liste-notion" }, [el("table", {}, [
      el("thead", {}, [el("tr", {}, [el("th", { text: "Tâche" }), opts.projet ? el("th", { text: "Projet" }) : null, el("th", { text: "Échéance" }), el("th", { text: "Priorité" }), el("th", { text: "Statut" })])]),
      el("tbody", {}, lignes.length ? lignes : [el("tr", {}, [el("td", { class: "vide", colspan: 5, text: "Aucune tâche." })])])
    ])]);
  }
  var ICONES_VUE = {
    tableau: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="3.5" height="11" rx="1"/><rect x="6.25" y="2.5" width="3.5" height="7" rx="1"/><rect x="11" y="2.5" width="3.5" height="9" rx="1"/></svg>',
    liste: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg>'
  };
  function commutateurVue(cle, vue) {
    return el("div", { class: "vues", role: "tablist", "aria-label": "Affichage des tâches" }, [["tableau", "Tableau"], ["liste", "Liste"]].map(function (v) {
      var b = el("button", { type: "button", role: "tab", "aria-selected": v[0] === vue ? "true" : "false", onclick: function () {
        if (v[0] === vue) return;
        ecrirePref(cle, v[0]); S.edition = null; avecTransition(dessiner, "jour");
      } }, [v[1]]);
      b.insertAdjacentHTML("afterbegin", ICONES_VUE[v[0]]);
      return b;
    }));
  }

  // ---------- Frise horizontale de la journée ----------
  function frise(jour, filtre) {
    var p = planJour(jour);
    var rdvs = p.horaires.filter(function (x) { return !filtre || x.activite === filtre; }).sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var blocs = p.blocs.filter(function (x) { return !filtre || x.activite === filtre; });
    var tous = rdvs.concat(blocs);
    var h0 = Math.min(7, Math.floor(Math.min.apply(null, tous.map(function (x) { return x.s; }).concat([24])))),
        h1 = Math.max(20, Math.ceil(Math.max.apply(null, tous.map(function (x) { return x.e; }).concat([0]))));
    var pct = function (h) { return ((h - h0) / (h1 - h0) * 100) + "%"; };
    var larg = function (a, b) { return "calc(" + ((b - a) / (h1 - h0) * 100) + "% - 3px)"; };

    var pistes = [];
    rdvs.forEach(function (x) {
      var i = pistes.findIndex(function (fin) { return fin <= x.s + 1e-6; });
      if (i < 0) { i = pistes.length; pistes.push(0); }
      pistes[i] = x.e; x.piste = i;
    });
    var nbPistes = Math.max(1, pistes.length);

    var regle = el("div", { class: "regle" });
    for (var h = h0; h <= h1; h++) regle.appendChild(el("span", { style: "left:" + pct(h), text: h + "h" }));

    var prevu = el("div", { class: "piste-prevue" }, blocs.map(function (b) {
      return el("div", { class: "prevu", style: "left:" + pct(b.s) + ";width:" + larg(b.s, b.e) + ";--c:" + couleur(b.activite), title: b.libelle + " · " + hTexte(b.s) + "–" + hTexte(b.e) },
        [el("span", { text: b.libelle })]);
    }));

    var maintenant = new Date();
    var zone = el("div", { class: "pistes", style: "--n:" + nbPistes }, rdvs.map(function (x) {
      var e = x.ev, d = new Date(e.debut), f = new Date(e.fin);
      var etat = f < maintenant ? " passe" : (d <= maintenant ? " en-cours" : "");
      return el("button", {
        type: "button", class: "rdv" + etat, style: "left:" + pct(x.s) + ";width:" + larg(x.s, x.e) + ";top:calc(" + x.piste + " * var(--h-piste));--c:" + couleur(x.activite),
        title: (e.titre || "") + "\n" + hm(d) + "–" + hm(f) + " · " + nomActivite(x.activite) + (e.lieu ? "\n" + e.lieu : "") + "\nCliquer pour changer de projet",
        onclick: function () { reclasser(e); }
      }, [el("b", { text: e.titre || "(sans titre)" }), el("span", { text: hm(d) + " · " + nomActivite(x.activite) })]);
    }));

    var cadre = el("div", { class: "frise", id: filtre ? null : "frise" }, [regle, prevu, zone]);
    for (var g = h0; g <= h1; g++) cadre.appendChild(el("i", { class: "graduation", style: "left:" + pct(g) }));
    if (memeJour(jour, maintenant)) {
      var n = hDec(maintenant);
      if (n >= h0 && n <= h1) cadre.appendChild(el("div", { class: "curseur", id: filtre ? null : "curseur", style: "left:" + pct(n), "data-h0": h0, "data-h1": h1 }, [el("span", { text: hm(maintenant) })]));
    }
    var journee = p.journee.filter(function (e) { return !filtre || actEv(e) === filtre; }).map(function (e) {
      return el("button", { type: "button", class: "journee", style: "--c:" + couleur(actEv(e)), onclick: function () { reclasser(e); } }, [el("i"), e.titre || "(sans titre)"]);
    });
    return el("div", { class: "frise-cadre" }, [journee.length ? el("div", { class: "journees" }, journee) : null,
      el("div", { class: "frise-defile" }, [cadre]),
      !rdvs.length && !blocs.length ? el("p", { class: "vide centre", text: "Aucun rendez-vous ce jour-là." }) : null]);
  }
  function reclasser(e) { ouvrirRdv(e); }

  // ---------- Accueil ----------
  function phraseDuMoment() {
    var n = new Date(), p = planJour(n), hN = hDec(n);
    var courant = p.horaires.filter(function (x) { return new Date(x.ev.debut) <= n && n < new Date(x.ev.fin); })[0];
    var bloc = !courant && p.blocs.filter(function (b) { return b.s <= hN && hN < b.e; })[0];
    var suivant = S.evenements.filter(function (e) { return !e.journee && new Date(e.debut) > n; })[0];
    var morceaux = [];
    var mot = function (texte, act) { return el("em", { style: "--c:" + couleur(act), text: texte }); };
    if (courant) morceaux.push("En ce moment, ", mot(courant.ev.titre || "un rendez-vous", courant.activite), ", encore " + duree(new Date(courant.ev.fin) - n) + ". ");
    else if (bloc) morceaux.push("Créneau prévu : ", mot(bloc.libelle, bloc.activite), " jusqu'à " + hTexte(bloc.e) + ". ");
    else morceaux.push("Rien de prévu en ce moment. ");
    if (suivant) {
      var d = new Date(suivant.debut);
      morceaux.push("Ensuite, ", mot(suivant.titre || "un rendez-vous", actEv(suivant)),
        memeJour(d, n) ? " à " + hm(d) + (d - n < 3 * 3600000 ? ", dans " + duree(d - n) : "") + "." : " " + quand(d) + " à " + hm(d) + ".");
    } else morceaux.push("Plus aucun rendez-vous à venir.");
    return el("p", { class: "phrase", id: "phrase" }, morceaux);
  }
  function hero() {
    var n = new Date(), iso = isoJour(n), p = planJour(n);
    var reste = p.horaires.filter(function (x) { return new Date(x.ev.debut) > n; }).length;
    var aFaire = tachesDuJour(iso).filter(function (t) { return t.statut !== "fait"; }).length;
    var nbRel = relances(iso).length;
    var moment = n.getHours() < 12 ? "Bonjour" : n.getHours() < 18 ? "Bon après-midi" : "Bonsoir";
    return el("section", { class: "hero" }, [
      el("div", { class: "hero-gauche" }, [
        el("p", { class: "surtitre", text: moment + " Antonin · " + fmt(n, { weekday: "long", day: "numeric", month: "long" }) }),
        el("h1", { class: "heure", id: "grande-heure", text: hm(n) }),
        phraseDuMoment()
      ]),
      el("dl", { class: "hero-chiffres" }, [
        el("div", {}, [el("dt", { text: "Rendez-vous" }), el("dd", { text: String(reste) }), el("small", { text: "encore aujourd'hui" })]),
        el("div", {}, [el("dt", { text: "Tâches" }), el("dd", { text: String(aFaire) }), el("small", { text: "pour aujourd'hui" })]),
        el("div", {}, [el("dt", { text: "Relances" }), el("dd", { text: String(nbRel) }), el("small", { text: "clients à rappeler" })])
      ])
    ]);
  }
  function selecteurJours() {
    var l = lundi(S.jour);
    var jours = [];
    for (var i = 0; i < 7; i++) (function (d) {
      var p = planJour(d), acts = Array.from(new Set(p.horaires.map(function (x) { return x.activite; }).filter(Boolean))).slice(0, 4);
      jours.push(el("button", { type: "button", class: "jour" + (memeJour(d, S.jour) ? " choisi" : "") + (memeJour(d, new Date()) ? " auj" : ""), onclick: function () { changerJour(d); } }, [
        el("span", { text: fmt(d, { weekday: "short" }).replace(".", "") }), el("b", { text: String(d.getDate()) }),
        el("i", {}, acts.map(function (a) { return el("u", { style: "background:" + couleur(a) }); }))
      ]));
    })(ajouterJours(l, i));
    return el("div", { class: "jours" }, [
      el("button", { type: "button", class: "fleche", "aria-label": "Semaine précédente", text: "←", onclick: function () { changerJour(ajouterJours(S.jour, -7)); } })
    ].concat(jours, [el("button", { type: "button", class: "fleche", "aria-label": "Semaine suivante", text: "→", onclick: function () { changerJour(ajouterJours(S.jour, 7)); } })]));
  }
  function changerJour(d) {
    var avant = lundi(S.jour).getTime();
    S.jour = debutJour(d);
    if (lundi(S.jour).getTime() !== avant) chargerTout().then(function () { avecTransition(dessiner, "jour"); });
    else avecTransition(dessiner, "jour");
  }
  function colonneProjet(a, iso) {
    // Priorités de la colonne : tâches du jour, puis retards, puis tâches des 7 prochains jours (5 au plus).
    var duJour = trierTaches(tachesDuJour(iso, a.id));
    var retard = trierTaches(tachesEnRetard(iso, a.id));
    var semaine = isoJour(ajouterJours(new Date(iso), 7));
    var bientot = trierTaches(S.taches.filter(function (t) { return t.activite_id === a.id && t.statut !== "fait" && t.echeance > iso && t.echeance <= semaine; }));
    var priorites = duJour.concat(retard, bientot);
    var reste = priorites.length - 5;
    var rel = relances(iso, a.id);
    var rdv = prochainRdv(a.id);
    var k = kpisProjet(a)[0];
    var heures = heuresSemaine()[a.id] || 0;
    return el("article", { class: "colonne", style: "--c:" + a.couleur }, [
      el("a", { class: "colonne-tete", href: "#" + a.id }, [
        el("span", { class: "numero", text: String(S.activites.indexOf(a) + 1).padStart(2, "0") }),
        el("h3", { text: a.nom }),
        el("span", { class: "ouvrir", text: "Ouvrir →" })
      ]),
      el("div", { class: "bloc" }, [
        el("p", { class: "etiquette", text: "Prochain rendez-vous" }),
        rdv ? el("p", { class: "rdv-texte" }, [el("b", { text: rdv.titre || "(sans titre)" }),
          el("span", { text: new Date(rdv.debut) <= new Date() ? "en cours, jusqu'à " + hm(new Date(rdv.fin))
            : (memeJour(new Date(rdv.debut), new Date()) ? "aujourd'hui" : quand(new Date(rdv.debut))) + " à " + hm(new Date(rdv.debut)) })])
          : el("p", { class: "vide", text: "Aucun dans les 60 jours." })
      ]),
      el("div", { class: "bloc" }, [
        el("p", { class: "etiquette", text: "À faire" + (retard.length ? " · " + retard.length + " en retard" : "") }),
        listeTaches(priorites.slice(0, 5), {}, "Rien d'urgent cette semaine."),
        reste > 0 ? el("a", { class: "retards-lien", href: "#" + a.id + "/taches", text: "et " + reste + " autre" + (reste > 1 ? "s" : "") + " →" }) : null,
        champAjout(a.id, new Date(iso), "+ Tâche pour aujourd'hui")
      ]),
      rel.length ? el("div", { class: "bloc" }, [
        el("p", { class: "etiquette", text: "À relancer" }),
        el("ul", { class: "relances" }, rel.slice(0, 4).map(function (c) {
          return el("li", {}, [el("a", { href: "#" + a.id + "/clients", onclick: function () { S.ouvert = c.id; } }, [el("b", { text: c.nom }), el("span", { text: c.prochaine_action || quand(lireJour(c.prochaine_action_le)) })])]);
        }).concat(rel.length > 4 ? [el("li", { class: "vide", text: "et " + (rel.length - 4) + " autres" })] : []))
      ]) : null,
      el("div", { class: "pied-colonne" }, [
        k ? el("div", { class: "chiffre" }, [el("span", { text: k.label }), el("b", { text: nombre(k.valeur, k.unite) })]) : null,
        reglages(a).factures ? (function () {
          var rf = resumeFactures(facturesDe(a));
          return el("div", { class: "chiffre" + (rf.nbRetard ? " alerte" : "") }, [el("span", { text: rf.nbRetard ? "À encaisser · " + rf.nbRetard + " en retard" : "À encaisser" }), el("b", { text: fmtN.format(Math.round(rf.attente)) + " €" })]);
        })() : null,
        el("div", { class: "chiffre" }, [el("span", { text: "Cette semaine" }), el("b", { text: fmtN.format(Math.round(heures * 2) / 2) + " h" + (a.cible_heures ? " / " + fmtN.format(+a.cible_heures) : "") })])
      ])
    ]);
  }
  // ---------- Aujourd'hui : calendrier du jour (vue verticale, en direct) ----------
  var H_HEURE = 60; // pixels par heure
  function calendrierJour(jour) {
    var p = planJour(jour), maintenant = new Date(), estAuj = memeJour(jour, maintenant);
    var rdvs = p.horaires.slice().sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var tous = rdvs.concat(p.blocs);
    var h0 = Math.min(7, Math.floor(Math.min.apply(null, tous.map(function (x) { return x.s; }).concat([24])))),
        h1 = Math.max(21, Math.ceil(Math.max.apply(null, tous.map(function (x) { return x.e; }).concat([0]))));
    var y = function (h) { return (h - h0) * H_HEURE; };
    var cal = el("div", { class: "cal", style: "height:" + y(h1) + "px", "data-h0": h0,
      title: "Cliquer sur un créneau libre pour ajouter un rendez-vous",
      onclick: function (ev) {
        if (ev.target !== cal && !ev.target.classList.contains("cal-ligne")) return;
        var r = cal.getBoundingClientRect(), h = h0 + (ev.clientY - r.top) / H_HEURE;
        var d = new Date(jour); d.setHours(Math.floor(h), Math.floor((h % 1) * 2) * 30, 0, 0);
        ouvrirRdv(null, d);
      } });
    for (var h = h0; h <= h1; h++) {
      cal.appendChild(el("div", { class: "cal-ligne", style: "top:" + y(h) + "px" }, [el("span", { text: pad(h) + ":00" })]));
      if (h < h1) cal.appendChild(el("div", { class: "cal-ligne demi", style: "top:" + y(h + 0.5) + "px" }));
    }
    p.blocs.forEach(function (b) {
      cal.appendChild(el("div", { class: "cal-prevu", style: "top:" + y(b.s) + "px;height:" + Math.max(16, y(b.e) - y(b.s) - 2) + "px;--c:" + couleur(b.activite) },
        [el("span", { text: b.libelle + (b.activite ? " · " + nomActivite(b.activite) : "") })]));
    });
    // Rendez-vous qui se chevauchent : côte à côte.
    var groupes = [], g = null;
    rdvs.forEach(function (x) { if (!g || x.s >= g.fin) { g = { items: [], fin: x.e }; groupes.push(g); } g.items.push(x); g.fin = Math.max(g.fin, x.e); });
    groupes.forEach(function (gr) {
      var cols = [];
      gr.items.forEach(function (x) {
        var c = cols.findIndex(function (fin) { return fin <= x.s + 1e-6; });
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = x.e; x.col = c;
      });
      gr.items.forEach(function (x) {
        var e = x.ev, d = new Date(e.debut), f = new Date(e.fin), n = cols.length, haut = Math.max(24, y(x.e) - y(x.s) - 3);
        var etat = f < maintenant ? " passe" : d <= maintenant ? " en-cours" : "";
        cal.appendChild(el("button", {
          type: "button", class: "cal-rdv" + etat + (haut < 40 ? " court" : ""),
          style: "top:" + y(x.s) + "px;height:" + haut + "px;left:calc(64px + (100% - 72px) * " + x.col / n + ");width:calc((100% - 72px) / " + n + " - 4px);--c:" + couleur(x.activite),
          title: (e.titre || "") + "\n" + hm(d) + "–" + hm(f) + " · " + nomActivite(x.activite) + (e.lieu ? "\n" + e.lieu : ""),
          onclick: function () { ouvrirRdv(e); }
        }, [el("b", { text: e.titre || "(sans titre)" }), el("span", { text: hm(d) + " – " + hm(f) + (e.lieu ? " · " + e.lieu.split("\n")[0] : "") })]));
      });
    });
    if (estAuj) {
      var n = hDec(maintenant);
      if (n >= h0 && n <= h1) cal.appendChild(el("div", { class: "cal-maintenant", id: "cal-maintenant", style: "top:" + y(n) + "px" }, [el("span", { text: hm(maintenant) })]));
    }
    var journee = p.journee.map(function (e) {
      return el("button", { type: "button", class: "journee", style: "--c:" + couleur(actEv(e)), onclick: function () { ouvrirRdv(e); } }, [el("i"), e.titre || "(sans titre)"]);
    });
    var vide = !rdvs.length && !p.journee.length;
    return el("div", { class: "cal-cadre" }, [
      journee.length ? el("div", { class: "journees" }, journee) : null,
      el("div", { class: "cal-defile", id: "cal-defile" }, [cal]),
      vide ? el("p", { class: "vide cal-vide", text: S.agendas.length ? "Aucun rendez-vous ce jour-là. Cliquez dans le calendrier pour en ajouter un." : "Aucun agenda connecté : allez dans Agendas pour relier Google ou Outlook." }) : null
    ]);
  }

  // Ce qui se passe maintenant et juste après (mis à jour toutes les 20 s).
  function blocMaintenant() {
    var n = new Date(), p = planJour(n), hN = hDec(n);
    var courant = p.horaires.filter(function (x) { return new Date(x.ev.debut) <= n && n < new Date(x.ev.fin); })[0];
    var bloc = !courant && p.blocs.filter(function (b) { return b.s <= hN && hN < b.e; })[0];
    var suivant = S.evenements.filter(function (e) { return !e.journee && new Date(e.debut) > n; })[0];
    var lignes = [];
    if (courant) lignes.push(el("div", { class: "moment actuel", style: "--c:" + couleur(courant.activite) }, [
      el("span", { class: "etiquette", text: "En cours · encore " + duree(new Date(courant.ev.fin) - n) }),
      el("button", { type: "button", onclick: function () { ouvrirRdv(courant.ev); } }, [courant.ev.titre || "(sans titre)"]),
      el("small", { text: nomActivite(courant.activite) + " · jusqu'à " + hm(new Date(courant.ev.fin)) })]));
    else if (bloc) lignes.push(el("div", { class: "moment moment-prevu", style: "--c:" + couleur(bloc.activite) }, [
      el("span", { class: "etiquette", text: "Créneau prévu · jusqu'à " + hTexte(bloc.e) }), el("b", { text: bloc.libelle }),
      el("small", { text: bloc.activite ? nomActivite(bloc.activite) : "Semaine type" })]));
    else lignes.push(el("div", { class: "moment libre" }, [el("span", { class: "etiquette", text: "Maintenant" }), el("b", { text: "Créneau libre" })]));
    if (suivant) {
      var d = new Date(suivant.debut), dans = d - n;
      lignes.push(el("div", { class: "moment suivant" + (dans < 15 * 60000 ? " imminent" : ""), style: "--c:" + couleur(actEv(suivant)) }, [
        el("span", { class: "etiquette", text: memeJour(d, n) ? "Ensuite · dans " + duree(dans) : "Prochain rendez-vous · " + quand(d) }),
        el("button", { type: "button", onclick: function () { ouvrirRdv(suivant); } }, [suivant.titre || "(sans titre)"]),
        el("small", { text: hm(d) + " · " + nomActivite(actEv(suivant)) + (suivant.lieu ? " · " + suivant.lieu.split("\n")[0] : "") })]));
    }
    return el("div", { class: "moments", id: "bloc-maintenant" }, lignes);
  }

  function panneauAFaire(iso) {
    var duJour = trierTaches(tachesDuJour(iso));
    var retard = trierTaches(tachesEnRetard(iso));
    var rel = relances(iso);
    var facts = S.factures.filter(factureEnRetard);
    var ouvertes = duJour.filter(function (t) { return t.statut !== "fait"; }).length;
    var parties = [
      el("div", { class: "panneau-tete" }, [el("h2", { text: "À faire" }),
        el("span", { class: "compte", text: ouvertes ? ouvertes + " aujourd'hui" : duJour.length ? "tout est fait" : "rien de daté" })]),
      champAjout(S.route || "perso", new Date(iso), "Ajouter une tâche pour aujourd'hui…"),
      listeTaches(duJour, { projet: true, date: false }, "Aucune tâche datée d'aujourd'hui.")
    ];
    if (retard.length) parties.push(el("details", { class: "groupe", open: S.voirRetards }, [
      el("summary", { onclick: function (ev) { ev.preventDefault(); S.voirRetards = !S.voirRetards; dessiner(); } }, [
        el("span", { class: "pastille-compte retard", text: String(retard.length) }), "En retard", el("small", { text: "à faire en premier ou à reporter" })]),
      listeTaches(retard, { projet: true }, "")]));
    if (rel.length) parties.push(el("div", { class: "groupe" }, [
      el("p", { class: "groupe-titre" }, [el("span", { class: "pastille-compte", text: String(rel.length) }), "À relancer"]),
      el("ul", { class: "relances" }, rel.slice(0, 8).map(function (c) {
        var j = joursDepuis(lireJour(c.prochaine_action_le));
        return el("li", { style: "--c:" + couleur(c.activite_id) }, [el("a", { href: "#" + c.activite_id + "/clients", onclick: function () { S.ouvert = c.id; } }, [
          el("i"), el("b", { text: c.nom }), el("span", { text: (c.prochaine_action || "Relancer") }), el("em", { class: j < 0 ? "retard" : "", text: quand(lireJour(c.prochaine_action_le)) })])]);
      }))]));
    if (facts.length) parties.push(el("div", { class: "groupe" }, [
      el("p", { class: "groupe-titre" }, [el("span", { class: "pastille-compte retard", text: String(facts.length) }), "Factures en retard"]),
      el("ul", { class: "relances" }, facts.map(function (fa) {
        return el("li", { style: "--c:" + couleur(fa.activite_id) }, [el("a", { href: "#" + fa.activite_id + "/factures", onclick: function () { S.factureOuverte = fa.id; } }, [
          el("i"), el("b", { text: (fa.numero ? "N° " + fa.numero + " · " : "") + fmtN.format(Math.round(ttc(fa))) + " €" }), el("span", { text: fa.destinataire || nomActivite(fa.activite_id) }),
          el("em", { class: "retard", text: "+" + (-joursDepuis(lireJour(fa.echeance))) + " j" })])]);
      }))]));
    return el("section", { class: "panneau a-faire" }, parties);
  }

  function carteProjet(a, iso) {
    var ouvertes = S.taches.filter(function (t) { return t.activite_id === a.id && t.statut !== "fait"; });
    var retard = tachesEnRetard(iso, a.id).length, rdv = prochainRdv(a.id), k = kpisProjet(a)[0];
    return el("a", { class: "carte-projet", href: "#" + a.id, style: "--c:" + a.couleur }, [
      el("div", { class: "carte-tete" }, [el("i"), el("b", { text: a.nom }), el("kbd", { text: String(S.activites.indexOf(a) + 1) })]),
      el("p", { class: "carte-rdv", text: rdv ? (memeJour(new Date(rdv.debut), new Date()) ? hm(new Date(rdv.debut)) : quand(new Date(rdv.debut))) + " · " + (rdv.titre || "rendez-vous") : "Aucun rendez-vous prévu" }),
      el("div", { class: "carte-chiffres" }, [
        el("span", {}, [el("b", { text: String(ouvertes.length) }), " tâches", retard ? el("em", { text: " · " + retard + " en retard" }) : null]),
        k ? el("span", {}, [el("b", { text: nombre(k.valeur, k.unite) }), " " + k.label.toLowerCase()]) : null
      ])
    ]);
  }

  // ---------- Victor : le point du matin (briefing préparé par la routine du Mac, tâches proposées à partir des mails) ----------
  function pastilleProjetSiConnu(id) { return id && activite(id) ? pastilleProjet(id) : null; }
  function traiterProposition(p, accepter, projet) {
    S.propositions = S.propositions.filter(function (x) { return x.id !== p.id; });
    var fin = db.from("propositions").update({ statut: accepter ? "acceptee" : "ecartee", traitee_le: new Date().toISOString() }).eq("id", p.id).then(verifier);
    if (accepter) {
      var source = p.source && (p.source.de || p.source.objet) ? "Mail de " + (p.source.de || "?") + (p.source.objet ? " : « " + p.source.objet + " »" : "") : null;
      creerTache({ titre: p.titre, activite_id: projet, echeance: p.echeance, priorite: p.priorite || "moyenne", notes: [p.notes, source].filter(Boolean).join(" · ") || null });
    } else { avecTransition(dessiner, "carte"); signaler("Écartée : " + p.titre); }
    return fin;
  }
  function carteProposition(p) {
    var choix = el("select", { class: "proposition-projet", "aria-label": "Projet" }, optionsActivites(p.activite_id || (S.activites[0] && S.activites[0].id)));
    var src = p.source || {};
    return el("li", { class: "proposition", style: "--vt:p-" + p.id }, [
      el("div", { class: "proposition-texte" }, [
        el("b", { text: p.titre }),
        el("small", { text: [src.boite, src.de, src.objet ? "« " + src.objet + " »" : null].filter(Boolean).join(" · ") }),
        p.notes ? el("p", { text: p.notes }) : null
      ]),
      el("div", { class: "proposition-actions" }, [
        choix,
        p.echeance ? el("span", { class: "carte-date", text: quand(lireJour(p.echeance)) }) : null,
        el("button", { type: "button", class: "btn-plein petit", text: "Ajouter", onclick: function () { traiterProposition(p, true, choix.value); } }),
        el("button", { type: "button", class: "btn-texte", text: "Écarter", onclick: function () { traiterProposition(p, false); } })
      ])
    ]);
  }
  // Emploi du temps en direct (agenda du jour, sans doublon ni séjour de plusieurs jours) : jamais en retard sur l'agenda
  function planningDuJour() {
    var d0 = debutJour(new Date()), d1 = ajouterJours(d0, 1), maintenant = Date.now();
    return S.evenements.filter(function (e) {
      var deb = new Date(e.debut), fin = new Date(e.fin);
      return fin > d0 && deb < d1 && !e.journee && fin - deb < 10 * 3600e3;
    }).map(function (e) {
      return { debut: hm(new Date(e.debut)), fin: hm(new Date(e.fin)), titre: e.titre, activite_id: actEv(e),
        type: /orias/i.test(e.titre || "") ? "orias" : "rdv", passe: new Date(e.fin) < maintenant };
    });
  }
  // Boîtes du point de Victor : projet (couleur) et adresse, pour ouvrir un mail sans référence enregistrée
  var BOITES = {
    gmail: { email: "arouzier@gmail.com", projet: "perso", web: "gmail" },
    camp: { email: "camprouziermarechal@gmail.com", projet: "camp-rouzier-marechal", web: "gmail" },
    palomano: { email: "lille@palomano.com", projet: "palomano", web: "outlook" },
    evoa: { email: "a.rouzier@evoa-courtage.fr", projet: "evoa-courtage", web: "outlook" },
    harnes: { email: "antonin.rouzier@harnes-volleyball.fr", projet: "harnes-volley", web: "ionos" }
  };
  function boiteDe(m) {
    var k = String(m.boite || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s/)[0];
    return BOITES[k] || { email: m.ref ? m.ref.boite : "", projet: null, web: m.ref && /^gmail:/.test(m.ref.id) ? "gmail" : "outlook" };
  }
  function nomSeul(de) { var x = String(de || "").replace(/<[^>]*>/g, "").replace(/"/g, "").trim(); return x || String(de || "").replace(/[<>]/g, ""); }
  function lienBoite(m) {
    var b = boiteDe(m);
    if (b.web === "gmail") return "https://mail.google.com/mail/u/" + encodeURIComponent(b.email) + "/#search/" + encodeURIComponent('subject:"' + (m.objet || "") + '"');
    return b.web === "ionos" ? "https://mail.ionos.fr/" : "https://outlook.office.com/mail/";
  }
  function nomWeb(m) { var w = boiteDe(m).web; return w === "gmail" ? "Gmail" : w === "ionos" ? "la messagerie IONOS" : "Outlook"; }

  function blocVictor() {
    var b = S.briefing, props = S.propositions || [];
    var tete = el("header", { class: "victor-tete" }, [
      el("span", { class: "victor-avatar", "aria-hidden": "true", text: "V" }),
      el("div", {}, [el("h2", { text: "Le point de Victor" }),
        el("p", { text: b ? "Préparé à " + hm(new Date(b.mise_a_jour)) + (b.orias_minutes ? " · " + Math.round(b.orias_minutes / 6) / 10 + " h d'ORIAS dans l'agenda" : "") : "Victor passe chaque matin à 6 h 30 : il lit vos mails, prépare la journée et place 2 h d'ORIAS." })])
    ]);
    var parties = [tete];
    if (b) {
      if (b.resume) parties.push(el("p", { class: "victor-resume", text: b.resume }));
      // Emploi du temps : une frise d'une ligne (le calendrier détaillé est juste en dessous)
      var planning = planningDuJour(), maintenant = Date.now();
      if (planning.length) parties.push(el("ol", { class: "victor-frise", "aria-label": "Emploi du temps" }, planning.map(function (x) {
        return el("li", { class: (x.type === "orias" ? "orias" : "") + (x.passe ? " passe" : ""), style: "--c:" + couleur(x.activite_id) }, [
          el("time", { text: x.debut }), el("span", { text: x.titre || "(sans titre)" })]);
      })));
      var colonnes = [];
      if ((b.priorites || []).length) colonnes.push(el("div", { class: "victor-col priorites" }, [
        el("h3", {}, ["À faire aujourd'hui", el("span", { class: "nb", text: String(b.priorites.length) })]),
        el("ol", { class: "victor-priorites" }, b.priorites.map(function (x, i) {
          return el("li", { style: "--c:" + couleur(x.activite_id) }, [
            el("span", { class: "rang", text: String(i + 1).padStart(2, "0") }),
            el("div", {}, [el("b", { text: x.titre }),
              el("p", {}, [x.activite_id && activite(x.activite_id) ? el("span", { class: "projet", text: nomActivite(x.activite_id) }) : null, x.pourquoi ? el("span", { text: x.pourquoi }) : null])])
          ]);
        }))]));
      var mails = b.mails || [];
      if (mails.length) {
        var visibles = S.mailsTous ? mails : mails.slice(0, 6);
        colonnes.push(el("div", { class: "victor-col mails" }, [
          el("h3", {}, ["Mails à traiter", el("span", { class: "nb", text: String(mails.length) })]),
          el("ul", { class: "victor-mails" }, visibles.map(function (m, i) {
            var bx = boiteDe(m);
            return el("li", {}, [el("button", { type: "button", class: "mail-ligne", style: "--c:" + couleur(bx.projet), title: "Lire le mail",
              onclick: function () { ouvrirMail(i, mails); } }, [
              el("span", { class: "mail-de" }, [el("i", { "aria-hidden": "true" }), el("span", { text: m.boite || "" }), el("span", { class: "qui", text: nomSeul(m.de) })]),
              el("b", { text: m.objet || "(sans objet)" }),
              m.action || m.resume ? el("span", { class: "mail-action", text: m.action || m.resume }) : null,
              el("span", { class: "mail-fleche", "aria-hidden": "true", text: "→" })
            ])]);
          })),
          mails.length > 6 ? el("button", { type: "button", class: "btn-texte voir-plus", text: S.mailsTous ? "Réduire" : "Voir les " + (mails.length - 6) + " autres",
            onclick: function () { S.mailsTous = !S.mailsTous; dessiner(); } }) : null
        ]));
      }
      if (colonnes.length) parties.push(el("div", { class: "victor-grille" }, colonnes));
    }
    if (props.length) parties.push(el("div", { class: "victor-propositions" }, [
      el("h3", { text: "Victor propose " + props.length + " tâche" + (props.length > 1 ? "s" : "") + " d'après vos mails" }),
      el("ul", {}, props.map(carteProposition))
    ]));
    return el("section", { class: "victor", "aria-label": "Le point de Victor" }, parties);
  }


  // ---------- Rechercher un mail : une description libre, Victor cherche dans toutes les boîtes (fonction chercher-mails) ----------
  function lancerRecherche(demande) {
    demande = String(demande || "").trim();
    if (demande.length < 3) return;
    S.recherche = { demande: demande, etat: "cherche" };
    if (S.route !== "recherche") location.hash = "recherche"; else dessiner();
    var r0 = S.recherche;
    db.functions.invoke("chercher-mails", { body: { demande: demande } }).then(function (r) {
      if (r.error && r.error.context && typeof r.error.context.json === "function") return r.error.context.json().then(function (j) { throw new Error(j.erreur || r.error.message); });
      if (r.error) throw r.error;
      if (S.recherche !== r0) return;
      S.recherche = { demande: demande, etat: "fini", comprise: r.data.comprise, erreurs: r.data.erreurs || [],
        resultats: (r.data.resultats || []).map(function (x) { return { boite: x.nom, de: x.de, objet: x.objet, date: x.date, extrait: x.extrait, resume: x.raison || "", ref: { boite: x.boite, id: x.id } }; }) };
      if (S.route === "recherche") dessiner();
    }).catch(function (e) {
      if (S.recherche !== r0) return;
      S.recherche = { demande: demande, etat: "erreur", message: e.message };
      if (S.route === "recherche") dessiner();
    });
  }
  function dateCourte(d) {
    var x = new Date(d), n = new Date();
    if (memeJour(x, n)) return hm(x);
    return fmt(x, x.getFullYear() === n.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  }
  function vueRecherche() {
    var R = S.recherche || {}, f = document.createDocumentFragment();
    var champ = el("input", { type: "search", class: "recherche-champ", value: R.demande || "", enterkeyhint: "search", "aria-label": "Mail recherché",
      placeholder: "Ex. : le devis du plombier reçu cet été, avec le PDF" });
    f.appendChild(el("header", { class: "recherche-tete" }, [
      el("p", { class: "surtitre", text: "Toutes les boîtes · Gmail, Camp, Palomano, Harnes" }),
      el("h1", { text: "Rechercher un mail" }),
      el("p", { class: "recherche-aide", text: "Décris ce que tu cherches avec tes mots : qui l'a envoyé, de quoi il parle, à peu près quand. Victor fouille toutes tes boîtes et te montre le plus probable en premier." }),
      el("form", { class: "recherche-form", role: "search", onsubmit: function (ev) { ev.preventDefault(); lancerRecherche(champ.value); } }, [
        icone("chercher"), champ,
        el("button", { type: "submit", class: "btn-plein", text: R.etat === "cherche" ? "Recherche…" : "Chercher", disabled: R.etat === "cherche" })
      ]),
      !R.etat ? el("div", { class: "recherche-exemples" }, ["la facture Palo-Franchise de novembre", "le mail d'Arnaud sur la prévoyance des joueurs",
        "le contrat signé avec Toyota, en pièce jointe", "les avis Google du Camp ce mois-ci"].map(function (t) {
        return el("button", { type: "button", class: "puce-exemple", text: t, onclick: function () { lancerRecherche(t); } });
      })) : null
    ]));
    if (R.etat === "cherche") {
      f.appendChild(el("div", { class: "recherche-attente", role: "status" }, [
        el("p", {}, [el("span", { class: "dis-victor-onde envoi", "aria-hidden": "true" }, [el("i"), el("i"), el("i"), el("i")]), "Victor cherche dans toutes tes boîtes…"]),
        el("div", { class: "lecteur-attente" }, [el("i"), el("i"), el("i"), el("i")])
      ]));
    } else if (R.etat === "erreur") {
      f.appendChild(el("p", { class: "recherche-vide", text: "La recherche n'a pas abouti : " + R.message + ". Réessaie dans un instant." }));
    } else if (R.etat === "fini") {
      var res = R.resultats, k = R.comprise || {};
      var compris = [].concat(k.expediteur ? ["de « " + k.expediteur + " »"] : [], (k.mots || []).length ? ["« " + k.mots.join(" », « ") + " »"] : [],
        k.depuis || k.jusqu ? [(k.depuis ? "depuis le " + fmt(new Date(k.depuis), { day: "numeric", month: "short", year: "numeric" }) : "") + (k.jusqu ? " jusqu'au " + fmt(new Date(k.jusqu), { day: "numeric", month: "short", year: "numeric" }) : "")] : [],
        k.pieces ? ["avec pièce jointe"] : [], (k.boites || []).length ? ["dans " + k.boites.join(", ")] : []);
      f.appendChild(el("p", { class: "recherche-compris", text: (res.length ? res.length + " mail" + (res.length > 1 ? "s" : "") + " trouvé" + (res.length > 1 ? "s" : "") : "Aucun mail trouvé") + (compris.length ? " · " + compris.join(" · ") : "") }));
      if (!res.length) f.appendChild(el("p", { class: "recherche-vide", text: "Essaie avec d'autres mots : le nom de l'expéditeur, un numéro de facture, ou une période plus large." }));
      else f.appendChild(el("ol", { class: "recherche-resultats" }, res.map(function (m, i) {
        var bx = boiteDe(m);
        return el("li", { class: i === 0 ? "premier" : "" }, [el("button", { type: "button", class: "mail-ligne", style: "--c:" + couleur(bx.projet), onclick: function () { ouvrirMail(i, res); } }, [
          i === 0 ? el("span", { class: "recherche-badge", text: "Le plus probable" }) : null,
          el("span", { class: "mail-de" }, [el("i", { "aria-hidden": "true" }), el("span", { text: m.boite }), el("span", { class: "qui", text: nomSeul(m.de) }), el("time", { text: dateCourte(m.date) })]),
          el("b", { text: m.objet || "(sans objet)" }),
          m.extrait ? el("span", { class: "recherche-extrait", text: m.extrait }) : null,
          m.resume ? el("span", { class: "mail-action", text: m.resume }) : null,
          el("span", { class: "mail-fleche", "aria-hidden": "true", text: "→" })
        ])]);
      })));
      if ((R.erreurs || []).length) f.appendChild(el("p", { class: "recherche-erreurs", text: "Boîtes non lues : " + R.erreurs.join(" ; ") }));
    }
    setTimeout(function () { if (!R.etat && document.activeElement === document.body) champ.focus(); }, 0);
    return el("div", { class: "page-recherche" }, [f]);
  }
  // ---------- Lecteur de mail : un clic sur un mail à traiter l'ouvre ici (texte brut, lecture seule) ----------
  var lecteur = null, lecteurIndex = 0, lecteurCache = {}, lecteurListe = [];
  function ouvrirMail(i, liste) {
    if (liste) lecteurListe = liste;
    if (!lecteur) {
      lecteur = el("dialog", { class: "lecteur", "aria-label": "Mail" });
      lecteur.addEventListener("click", function (ev) { if (ev.target === lecteur) lecteur.close(); });
      lecteur.addEventListener("keydown", function (ev) {
        if (ev.target.closest && ev.target.closest("a, button") && (ev.key === "Enter" || ev.key === " ")) return;
        if (ev.key === "ArrowDown" || ev.key === "j") { ev.preventDefault(); ouvrirMail(lecteurIndex + 1); }
        else if (ev.key === "ArrowUp" || ev.key === "k") { ev.preventDefault(); ouvrirMail(lecteurIndex - 1); }
      });
      document.body.appendChild(lecteur);
    }
    var mails = lecteurListe;
    if (i < 0 || i >= mails.length) return;
    lecteurIndex = i;
    var m = mails[i], bx = boiteDe(m), cle = m.ref ? m.ref.boite + "|" + m.ref.id : null;
    var corps = el("div", { class: "lecteur-corps" }, [el("div", { class: "lecteur-attente", "aria-label": "Chargement" }, [el("i"), el("i"), el("i"), el("i")])]);
    var lien = el("a", { class: "btn-contour", href: lienBoite(m), target: "_blank", rel: "noopener", text: "Ouvrir dans " + nomWeb(m) + " ↗" });
    var meta = el("dl", { class: "lecteur-meta" }, [el("dt", { text: "De" }), el("dd", { text: m.de || "" })]);
    lecteur.textContent = "";
    lecteur.style.setProperty("--c", couleur(bx.projet));
    lecteur.appendChild(el("div", { class: "lecteur-feuille" }, [
      el("header", { class: "lecteur-haut" }, [
        el("span", { class: "lecteur-boite" }, [el("i", { "aria-hidden": "true" }), m.boite || ""]),
        el("span", { class: "lecteur-pos", text: (i + 1) + " / " + mails.length }),
        el("button", { type: "button", class: "btn-icone-mini", "aria-label": "Mail précédent", title: "Précédent (↑)", disabled: i === 0, text: "↑", onclick: function () { ouvrirMail(i - 1); } }),
        el("button", { type: "button", class: "btn-icone-mini", "aria-label": "Mail suivant", title: "Suivant (↓)", disabled: i === mails.length - 1, text: "↓", onclick: function () { ouvrirMail(i + 1); } }),
        el("button", { type: "button", class: "btn-icone-mini", "aria-label": "Fermer", title: "Fermer (Échap)", text: "×", onclick: function () { lecteur.close(); } })
      ]),
      el("h2", { text: m.objet || "(sans objet)" }),
      meta,
      m.action || m.resume ? el("p", { class: "lecteur-victor" }, [el("span", { text: "Victor" }), m.action || m.resume]) : null,
      corps,
      el("footer", { class: "lecteur-pied" }, [
        el("button", { type: "button", class: "btn-plein", text: "Répondre avec Victor", onclick: function () {
          lecteur.close(); direAVictor("Réponds à " + nomSeul(m.de) + " au sujet de « " + (m.objet || "") + " » : ", false);
        } }),
        el("button", { type: "button", class: "btn-contour", text: "En faire une tâche", onclick: function () {
          lecteur.close(); direAVictor("Ajoute une tâche : " + (m.action || m.objet || ""), false);
        } }),
        lien
      ])
    ]));
    if (!lecteur.open) lecteur.showModal();
    lecteur.querySelector(".lecteur-feuille").scrollTop = 0;
    var afficher = function (d) {
      if (lecteurIndex !== i) return;
      meta.textContent = "";
      [["De", d.de], ["À", d.a], ["Cc", d.cc], ["Reçu", d.date ? fmt(new Date(d.date), { weekday: "long", day: "numeric", month: "long" }) + " à " + hm(new Date(d.date)) : ""]]
        .forEach(function (x) { if (x[1]) { meta.appendChild(el("dt", { text: x[0] })); meta.appendChild(el("dd", { text: x[1] })); } });
      if (d.lien) lien.href = d.lien;
      corps.textContent = "";
      if ((d.pieces || []).length) corps.appendChild(el("ul", { class: "lecteur-pieces" }, d.pieces.map(function (p) { return el("li", { text: p }); })));
      corps.appendChild(el("div", { class: "lecteur-texte", text: d.texte || "(mail sans texte)" }));
    };
    var echec = function (texte) {
      if (lecteurIndex !== i) return;
      corps.textContent = "";
      corps.appendChild(el("p", { class: "lecteur-absent", text: texte }));
    };
    if (!cle) return echec("Ce mail vient d'un point préparé avant l'ouverture directe : le bouton ci-dessous le retrouve dans " + nomWeb(m) + ". Les prochains points de Victor s'ouvriront ici.");
    if (lecteurCache[cle]) return afficher(lecteurCache[cle]);
    db.functions.invoke("mail", { body: { boite: m.ref.boite, id: m.ref.id } }).then(function (r) {
      if (r.error && r.error.context && typeof r.error.context.json === "function") return r.error.context.json().then(function (j) { if (j.lien) lien.href = j.lien; throw new Error(j.erreur || r.error.message); });
      if (r.error) throw r.error;
      lecteurCache[cle] = r.data; afficher(r.data);
    }).catch(function (e) { echec(e.message || "Lecture impossible pour le moment."); });
  }

  // ---------- « Dis-le à Victor » : une phrase (tapée, ou dictée avec Wispr Flow) exécutée par l'agent des dictées ----------
  // Une dictée arrive d'un bloc (collée par Wispr Flow) : envoi automatique après un court délai, annulable en tapant ou avec Échap.
  var victorForm = document.getElementById("dis-victor"), victorChamp = document.getElementById("dis-victor-champ"), victorMinuterie = null;
  function direAVictor(texte, envoyer) {
    victorChamp.value = texte; victorChamp.focus();
    victorChamp.setSelectionRange(texte.length, texte.length);
    if (envoyer) programmerEnvoi();
  }
  function annulerEnvoi() { clearTimeout(victorMinuterie); victorMinuterie = null; victorForm.classList.remove("compte"); }
  function programmerEnvoi() {
    annulerEnvoi();
    if (victorChamp.value.trim().split(/\s+/).length < 2) return;
    void victorForm.offsetWidth; victorForm.classList.add("compte");
    victorMinuterie = setTimeout(envoyerAVictor, 1800);
  }
  // Échanges récents avec Victor (pour « oui, supprime-le », « et demain ? »), gardés sur cet appareil
  var victorHisto = (function () { try { return JSON.parse(sessionStorage.getItem("victor-histo") || "[]"); } catch (e) { return []; } })();
  function noterVictor(qui, texte) {
    victorHisto = victorHisto.concat([{ qui: qui, texte: texte }]).slice(-8);
    try { sessionStorage.setItem("victor-histo", JSON.stringify(victorHisto)); } catch (e) { /* stockage indisponible */ }
  }
  function bulleVictor(contenu, classe, duree) {
    var bulle = document.getElementById("victor-reponse");
    bulle.textContent = ""; bulle.className = "victor-reponse " + (classe || "");
    bulle.appendChild(el("span", { class: "victor-avatar mini", "aria-hidden": "true", text: "V" }));
    bulle.appendChild(el("div", { class: "victor-reponse-corps" }, contenu));
    bulle.appendChild(el("button", { type: "button", class: "btn-icone-mini", "aria-label": "Fermer", text: "×", onclick: function () { bulle.hidden = true; } }));
    bulle.hidden = false;
    clearTimeout(bulle.minuterie);
    if (duree) bulle.minuterie = setTimeout(function () { bulle.hidden = true; }, duree);
  }
  function envoyerAVictor() {
    annulerEnvoi();
    var phrase = victorChamp.value.trim();
    if (!phrase || victorForm.classList.contains("envoi")) return;
    victorForm.classList.add("envoi"); victorChamp.readOnly = true;
    bulleVictor([el("p", { class: "victor-cite", text: "« " + phrase + " »" }), el("p", { class: "victor-attente", text: "Je m'en occupe…" })], "attente");
    var rendu = function (texte, ok, ouvrir, mails) {
      victorForm.classList.remove("envoi"); victorChamp.readOnly = false;
      if (ok) { victorChamp.value = ""; victorChamp.blur(); noterVictor("moi", phrase); noterVictor("victor", texte); }
      var liste = (mails || []).map(function (x) { return { boite: x.nom, de: x.de, objet: x.objet, date: x.date, resume: x.raison || "", ref: { boite: x.boite, id: x.id } }; });
      bulleVictor([
        el("p", { class: "victor-cite", text: "« " + phrase + " »" }),
        el("p", { class: "victor-texte", text: texte }),
        liste.length ? el("ul", { class: "victor-reponse-mails" }, liste.slice(0, 4).map(function (m, i) {
          return el("li", {}, [el("button", { type: "button", onclick: function () { ouvrirMail(i, liste); } }, [el("b", { text: m.objet || "(sans objet)" }), el("span", { text: m.boite + " · " + nomSeul(m.de) })])]);
        })) : null,
        ouvrir && ouvrir.indexOf(location.origin) === 0 ? el("a", { href: ouvrir.replace(/^[^#]*/, ""), class: "btn-texte", text: "Voir dans le cockpit →" }) : null
      ], ok ? "ok" : "erreur", liste.length ? 0 : ok ? 14000 : 20000);
      if (ok) chargerTout().then(dessiner);
    };
    db.functions.invoke("assistant", { body: { texte: phrase, historique: victorHisto } }).then(function (r) {
      if (r.error && r.error.context && typeof r.error.context.json === "function")
        return r.error.context.json().then(function (j) { rendu(j.texte || j.erreur || r.error.message, false); });
      if (r.error) throw r.error;
      rendu(r.data.texte, true, r.data.ouvrir, r.data.mails);
    }).catch(function (e) { rendu("Victor n'a pas pu traiter la demande : " + e.message, false); });
  }
  // Micro : reconnaissance vocale du navigateur (Chrome, Safari), en français ; la phrase part à la fin de la dictée.
  var Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition, ecoute = null;
  var boutonMicro = document.getElementById("dis-victor-micro");
  boutonMicro.addEventListener("click", function () {
    if (ecoute) { ecoute.stop(); return; }
    if (!Reconnaissance) { signaler("Ce navigateur n'a pas de dictée intégrée : utilise Wispr Flow ou Chrome / Safari."); victorChamp.focus(); return; }
    annulerEnvoi();
    var rec = new Reconnaissance(), avant = victorChamp.value.trim(), final = "";
    rec.lang = "fr-FR"; rec.interimResults = true; rec.continuous = false;
    rec.onresult = function (ev) {
      var provisoire = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) final += ev.results[i][0].transcript; else provisoire += ev.results[i][0].transcript;
      }
      victorChamp.value = [avant, (final + provisoire).trim()].filter(Boolean).join(" ");
    };
    rec.onerror = function (ev) {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") signaler("Le micro est bloqué : autorise-le pour ce site dans le navigateur (icône à gauche de l'adresse).");
      else if (ev.error === "no-speech") signaler("Je n'ai rien entendu : réessaie.");
      else if (ev.error !== "aborted") signaler("Micro indisponible (" + ev.error + ").");
    };
    rec.onend = function () {
      ecoute = null; victorForm.classList.remove("ecoute"); boutonMicro.setAttribute("aria-pressed", "false");
      victorChamp.placeholder = "Demande à Victor : une tâche, un rendez-vous, un mail…";
      if (final.trim()) programmerEnvoi();
    };
    try { rec.start(); } catch (e) { signaler("Micro indisponible : " + e.message); return; }
    ecoute = rec; victorForm.classList.add("ecoute"); boutonMicro.setAttribute("aria-pressed", "true");
    victorChamp.placeholder = "Je t'écoute…";
  });
  victorForm.addEventListener("submit", function (ev) { ev.preventDefault(); envoyerAVictor(); });
  victorChamp.addEventListener("input", function (ev) {
    var dicte = ev.inputType === "insertFromPaste" || ev.inputType === "insertReplacementText" || ev.inputType === "insertFromDrop" ||
      (ev.inputType === "insertText" && (ev.data || "").length > 10);
    if (dicte) programmerEnvoi(); else annulerEnvoi();
  });
  victorChamp.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { ev.preventDefault(); if (victorMinuterie) annulerEnvoi(); else { victorChamp.value = ""; victorChamp.blur(); } }
    else if (ev.key !== "Enter" && victorMinuterie && !ev.metaKey) annulerEnvoi();
  });
  // Wispr Flow colle la dictée là où se trouve le curseur : sans champ actif dans le cockpit, elle part vers Victor.
  document.addEventListener("paste", function (ev) {
    var t = ev.target;
    if (!db || barre.hidden || dialogue.open || dlgRdv.open || (lecteur && lecteur.open)) return;
    if (t && t.closest && t.closest("input, textarea, select, [contenteditable=''], [contenteditable=true]")) return;
    var texte = ((ev.clipboardData || window.clipboardData).getData("text") || "").trim();
    if (!texte || texte.length > 500) return;
    ev.preventDefault();
    direAVictor(texte, true);
  });

  function vueAccueil() {
    var f = document.createDocumentFragment(), iso = isoJour(S.jour), n = new Date(), estAuj = memeJour(S.jour, n);
    f.appendChild(el("header", { class: "entete-jour" }, [
      el("div", {}, [
        el("p", { class: "surtitre", text: (n.getHours() < 12 ? "Bonjour" : n.getHours() < 18 ? "Bon après-midi" : "Bonsoir") + " Antonin" }),
        el("h1", { class: "cap", text: fmt(S.jour, { weekday: "long", day: "numeric", month: "long" }) })
      ]),
      estAuj ? el("div", { class: "horloge-jour", id: "grande-heure", text: hm(n) }) : null,
      el("div", { class: "nav-jours" }, [
        el("button", { type: "button", class: "btn-icone", "aria-label": "Jour précédent", title: "Jour précédent (←)", text: "←", onclick: function () { changerJour(ajouterJours(S.jour, -1)); } }),
        el("button", { type: "button", class: "btn-contour" + (estAuj ? " actif" : ""), text: "Aujourd'hui", onclick: function () { changerJour(new Date()); } }),
        el("button", { type: "button", class: "btn-icone", "aria-label": "Jour suivant", title: "Jour suivant (→)", text: "→", onclick: function () { changerJour(ajouterJours(S.jour, 1)); } }),
        selecteurJours()
      ])
    ]));
    if (estAuj) f.appendChild(blocVictor());
    f.appendChild(el("div", { class: "grille-aujourdhui" }, [
      el("section", { class: "panneau calendrier" }, [
        el("div", { class: "panneau-tete" }, [el("h2", { text: "Calendrier" }),
          el("span", { class: "compte", text: planJour(S.jour).horaires.length + " rendez-vous" }),
          el("button", { type: "button", class: "btn-contour petit", text: "+ Rendez-vous", onclick: function () { ouvrirRdv(null); } })]),
        calendrierJour(S.jour)
      ]),
      el("div", { class: "colonne-droite" }, [estAuj ? blocMaintenant() : null, panneauAFaire(iso)])
    ]));
    f.appendChild(el("section", { class: "section projets-section" }, [
      el("div", { class: "entete" }, [el("h2", { text: "Projets" }), el("p", { class: "aside", text: "touches 1 à " + S.activites.length })]),
      el("div", { class: "cartes-projets" }, S.activites.map(function (a) { return carteProjet(a, iso); }))
    ]));
    return f;
  }

  // ---------- Page projet ----------
  // Onglets de la page : chacun fait défiler jusqu'à sa rubrique.
  function ongletsProjet(a) {
    var r = reglages(a), avecClients = r.champs || (a.etapes || []).length || S.clients.some(function (c) { return c.activite_id === a.id; });
    var onglets = [["s-taches", "Tâches"], avecClients ? ["s-clients", r.titre_clients || "Clients"] : null, r.recommandations ? ["s-recos", "Recommandations"] : null, r.factures ? ["s-factures", "Factures"] : null,
      kpisProjet(a).length ? ["s-chiffres", "Chiffres"] : null, ["s-notes", "Notes"]].filter(Boolean);
    return el("nav", { class: "barre-rubriques", style: "--c:" + a.couleur, "aria-label": "Rubriques du projet" }, [el("div", { class: "rubriques" }, [
      el("span", { class: "rubriques-nom" }, [el("i"), a.nom])
    ].concat(onglets.map(function (o) {
      return el("button", { type: "button", "data-cible": o[0], text: o[1], onclick: function () {
        var c = document.getElementById(o[0]); if (c) c.scrollIntoView({ behavior: mouvementReduit ? "auto" : "smooth", block: "start" });
      } });
    })))]);
  }
  // Rubriques d'un projet : chacune a sa page (#projet/rubrique), la présentation (#projet) y mène par de grands boutons
  function rubriquesDe(a) {
    var r = reglages(a), avecClients = r.champs || (a.etapes || []).length || S.clients.some(function (c) { return c.activite_id === a.id; });
    return [
      { id: "taches", nom: "Tâches", icone: "taches" },
      { id: "agenda", nom: "Agenda", icone: "agendas" },
      avecClients ? { id: "clients", nom: r.titre_clients || "Clients", icone: "clients" } : null,
      r.recommandations ? { id: "recos", nom: "Recommandations", icone: "recos" } : null,
      r.production ? { id: "production", nom: "Production", icone: "factures" } : null, // Evoa : la production est la facturation
      r.factures && !r.production ? { id: "factures", nom: "Factures", icone: "factures" } : null,
      kpisProjet(a).length ? { id: "chiffres", nom: "Chiffres", icone: "chiffres" } : null,
      { id: "notes", nom: "Notes", icone: "notes" }
    ].filter(Boolean);
  }
  function rubriqueActive(a) { return rubriquesDe(a).some(function (x) { return x.id === S.rubrique; }) ? S.rubrique : ""; }
  // Résumé en direct affiché sur chaque bouton de la présentation
  function resumeRubrique(a, id) {
    var iso = isoJour(new Date()), argent = function (v) { return fmtN.format(Math.round(v)) + " €"; };
    if (id === "taches") {
      var ouv = S.taches.filter(function (t) { return t.activite_id === a.id && t.statut !== "fait"; }).length, ret = tachesEnRetard(iso, a.id).length;
      return ouv ? ouv + " ouverte" + (ouv > 1 ? "s" : "") + (ret ? " · " + ret + " en retard" : "") : "Rien en cours";
    }
    if (id === "agenda") { var rdv = prochainRdv(a.id); return rdv ? (rdv.titre || "Rendez-vous") + " · " + quand(new Date(rdv.debut)) + " à " + hm(new Date(rdv.debut)) : "Rien dans les 60 jours"; }
    if (id === "clients") {
      var cs = S.clients.filter(function (c) { return c.activite_id === a.id && !estAbandonne(c); });
      if (reglages(a).total) return cs.length + " affaires · " + argent(kpisProjet(a)[0].valeur) + " signés";
      var somme = cs.reduce(function (t, c) { return t + (+c.montant || 0); }, 0);
      return cs.length + " fiche" + (cs.length > 1 ? "s" : "") + (somme ? " · " + argent(somme) : "");
    }
    if (id === "recos") return compteRecos((S.recommandations || []).filter(function (x) { return x.activite_id === a.id; }));
    if (id === "factures") { var rf = resumeFactures(facturesDe(a)); return rf.attente ? argent(rf.attente) + " à encaisser" + (rf.nbRetard ? " · " + rf.nbRetard + " en retard" : "") : "Tout est encaissé"; }
    if (id === "production") {
      var an = new Date().getFullYear(), lp = (S.production || []).filter(function (x) { return x.activite_id === a.id && x.annee === an; });
      var part = lp.reduce(function (t, x) { return t + calculProd(x).net; }, 0);
      return lp.length ? an + " : " + lp.length + " contrat" + (lp.length > 1 ? "s" : "") + " · " + argent(part) + " pour vous" : "Production " + an + " à saisir";
    }
    if (id === "chiffres") { var k = kpisProjet(a)[0]; return k ? k.label + " : " + (typeof k.valeur === "number" ? fmtN.format(k.valeur) : k.valeur) + (k.unite ? " " + k.unite : "") : ""; }
    if (id === "notes") return (a.notes || "").split("\n")[0].slice(0, 70) || "Notes libres du projet";
    return "";
  }
  function tuilesProjet(a) {
    return el("nav", { class: "tuiles-projet", style: "--c:" + a.couleur, "aria-label": "Rubriques de " + a.nom }, rubriquesDe(a).map(function (x) {
      return el("a", { class: "tuile", href: "#" + a.id + "/" + x.id }, [
        icone(x.icone, "tuile-icone"), el("span", { class: "tuile-texte" }, [el("b", { text: x.nom }), el("small", { text: resumeRubrique(a, x.id) })]), icone("fleche", "tuile-fleche")
      ]);
    }));
  }
  // En-tête d'une rubrique : flèche de retour vers la présentation et mini-menu des rubriques
  function enteteRubrique(a, rub) {
    var ch = CHARTES[a.id] || {}, x = rubriquesDe(a).filter(function (y) { return y.id === rub; })[0];
    var retour = el("a", { class: "retour-projet", href: "#" + a.id, title: "Retour à la présentation (Échap)" }, [icone("retour"), iconeProjet(a), el("span", { text: a.nom })]);
    return el("header", { class: "entete-rubrique", style: "--c:" + a.couleur + (ch.police ? ";--police-marque:" + ch.police : "") }, [
      retour,
      el("h1", { class: ch.style ? "titre-" + ch.style : "", text: x ? x.nom : "" }),
      el("nav", { class: "mini-menu", "aria-label": "Rubriques" }, rubriquesDe(a).map(function (y) {
        var l = el("a", { href: "#" + a.id + "/" + y.id }, [icone(y.icone), y.nom]);
        if (y.id === rub) l.setAttribute("aria-current", "page");
        return l;
      }))
    ]);
  }
  function vueProjet(a) {
    var f = document.createDocumentFragment(), n = new Date(), iso = isoJour(n), rub = rubriqueActive(a);
    var ouvertes = trierTaches(S.taches.filter(function (t) { return t.activite_id === a.id && t.statut !== "fait"; }));
    var rdv = prochainRdv(a.id);
    var ch = CHARTES[a.id] || {};
    if (rub) f.appendChild(enteteRubrique(a, rub));
    else f.appendChild(el("div", { class: "couverture", style: "--couverture:" + couvertureDe(a), "aria-hidden": "true" }));
    if (!rub) f.appendChild(el("section", { class: "hero-projet avec-couverture" + (ch.style ? " titre-" + ch.style : ""), style: "--c:" + a.couleur + (ch.police ? ";--police-marque:" + ch.police : "") }, [
      el("div", {}, [
        iconeProjet(a, true),
        el("p", { class: "surtitre", text: "Projet " + String(S.activites.indexOf(a) + 1).padStart(2, "0") }),
        el("h1", { text: a.nom }),
        a.description ? el("p", { class: "chapo", text: a.description }) : null
      ]),
      el("dl", { class: "hero-chiffres" }, [
        el("div", {}, [el("dt", { text: "Prochain rendez-vous" }), el("dd", { class: "petit", text: rdv ? rdv.titre || "(sans titre)" : "—" }),
          el("small", { text: rdv ? quand(new Date(rdv.debut)) + " à " + hm(new Date(rdv.debut)) : "rien dans les 60 jours" })]),
        el("div", {}, [el("dt", { text: "Tâches ouvertes" }), el("dd", { text: String(ouvertes.length) }), el("small", { text: tachesEnRetard(iso, a.id).length + " en retard" })]),
        // Projets à commissions (Berkay) : total vente + frais des affaires signées, et ce qui est en discussion
        reglages(a).total ? (function () {
          var k = kpisProjet(a);
          return el("div", { class: "chiffre-commissions" }, [el("dt", { text: "Commissions signées" }), el("dd", { class: "petit", text: fmtN.format(Math.round(k[0].valeur)) + " €" }),
            el("small", { text: "+ " + fmtN.format(Math.round(k[1].valeur)) + " € en cours · vente + frais TTC" })]);
        })() : null,
        reglages(a).factures ? (function () {
          var rf = resumeFactures(facturesDe(a));
          return el("div", {}, [el("dt", { text: "À encaisser" }), el("dd", { class: "petit", text: fmtN.format(Math.round(rf.attente)) + " €" }),
            el("small", { class: rf.nbRetard ? "retard" : "", text: rf.nbRetard ? rf.nbRetard + " facture(s) en retard" : rf.aEmettre ? fmtN.format(Math.round(rf.aEmettre)) + " € à émettre" : "à jour" })]);
        })() : null
      ])
    ]));

    if (!rub) {
      f.appendChild(tuilesProjet(a));
      if ((a.liens || []).length) f.appendChild(el("section", { class: "liens-projet", style: "--c:" + a.couleur }, [el("p", { class: "etiquette", text: "Liens utiles" }), boutonsLiens(a.liens)]));
      return f;
    }

    var prochains = S.evenements.filter(function (e) { return actEv(e) === a.id && new Date(e.fin) >= n && new Date(e.debut) < ajouterJours(debutJour(n), 15); });
    var vueT = lirePref("vue-taches-projet", "tableau");
    var enteteTaches = el("div", { class: "entete" }, [el("h2", { text: "Tâches" }), el("p", { class: "aside", text: ouvertes.length + " ouvertes" }), commutateurVue("vue-taches-projet", vueT)]);
    var blocAgenda = el("div", {}, [
        el("div", { class: "entete" }, [el("h2", { text: "Agenda" }), el("p", { class: "aside", text: "14 prochains jours" })]),
        el("ul", { class: "agenda" + (vueT === "tableau" ? " agenda-large" : "") }, prochains.length ? prochains.map(function (e) {
          var d = new Date(e.debut);
          return el("li", {}, [
            el("time", {}, [el("b", { text: String(d.getDate()) }), el("span", { text: fmt(d, { weekday: "short" }).replace(".", "") })]),
            el("button", { type: "button", onclick: function () { reclasser(e); } }, [el("b", { text: e.titre || "(sans titre)" }), el("span", { text: (e.journee ? "toute la journée" : hm(d) + "–" + hm(new Date(e.fin))) + (e.lieu ? " · " + e.lieu.split("\n")[0] : "") })])
          ]);
        }) : [el("li", { class: "vide", text: "Aucun rendez-vous classé dans ce projet." })])
      ]);
    var tachesProjet = S.taches.filter(function (t) { return t.activite_id === a.id; });
    var sectionFrise = el("section", { class: "section" }, [el("div", { class: "entete" }, [el("h2", { text: "Aujourd'hui dans ce projet" })]), frise(n, a.id)]);
    // Les tâches d'abord, comme un tableau Notion ; en liste, elles partagent la largeur avec l'agenda.
    if (rub === "taches") f.appendChild(el("section", { class: "section", id: "s-taches" }, vueT === "tableau"
      ? [enteteTaches, tableauTaches(tachesProjet, { activite: a.id })]
      : [enteteTaches, listeNotion(tachesProjet, {}), champAjout(a.id, null, "+ Ajouter une tâche (sans date)")]));
    if (rub === "agenda") { f.appendChild(sectionFrise); f.appendChild(el("section", { class: "section" }, [blocAgenda])); }
    if (rub === "clients") f.appendChild(sectionClients(a));
    if (rub === "recos") f.appendChild(sectionRecommandations(a));
    if (rub === "factures") f.appendChild(sectionFactures(a));
    if (rub === "production") f.appendChild(sectionProduction(a));

    var kpis = kpisProjet(a);
    if (rub === "chiffres" && kpis.length) {
      var maj = reglages(a).total ? "Calculés en direct à partir des affaires" : a.mise_a_jour ? "Mis à jour le " + fmt(new Date(a.mise_a_jour), { day: "numeric", month: "long" }) + ((a.sources || []).length ? " · " + a.sources.join(", ") : "") : "";
      f.appendChild(el("section", { class: "section" }, [
        el("div", { class: "entete", id: "s-chiffres" }, [el("h2", { text: "Les chiffres" }), el("p", { class: "aside", text: maj })]),
        el("div", { class: "chiffres" }, kpis.map(function (k) {
          var ecart = typeof k.valeur === "number" && typeof k.precedent === "number" && k.precedent ? (k.valeur - k.precedent) / Math.abs(k.precedent) * 100 : null;
          var pctObj = typeof k.objectif === "number" && k.objectif > 0 && typeof k.valeur === "number" ? Math.min(100, Math.max(0, k.valeur / k.objectif * 100)) : null;
          return el("div", { class: "chiffre-grand" + (k.alerte ? " alerte" : "") }, [
            el("span", { class: "etiquette", text: k.label }),
            el("b", {}, [typeof k.valeur === "number" ? fmtN.format(k.valeur) : String(k.valeur), k.unite ? el("small", { text: " " + k.unite }) : null]),
            ecart != null ? el("span", { class: "ecart " + (ecart >= 0 ? "hausse" : "baisse"), text: (ecart >= 0 ? "+" : "") + fmtN.format(Math.round(ecart)) + " % vs " + nombre(k.precedent, k.unite) }) : null,
            pctObj != null ? el("span", { class: "objectif" }, [el("i", { style: "width:" + pctObj + "%" }), el("em", { text: Math.round(pctObj) + " % de " + nombre(k.objectif, k.unite) })]) : null,
            k.detail ? el("p", { text: k.detail }) : null
          ]);
        })),
        a.serie ? serie(a.serie, a.couleur) : null
      ]));
    }

    var notes = el("textarea", { class: "notes", rows: "6", "aria-label": "Notes du projet", placeholder: "Notes libres, enregistrées automatiquement." });
    notes.value = a.notes || "";
    notes.addEventListener("change", function () { a.notes = notes.value; db.from("activites").update({ notes: notes.value }).eq("id", a.id).then(verifier).then(function () { signaler("Notes enregistrées"); }); });
    if (rub === "notes") f.appendChild(el("section", { class: "section", id: "s-notes" }, [el("div", { class: "entete" }, [el("h2", { text: "Notes" })]), notes]));
    // Le titre de la rubrique est déjà en tête de page : on retire celui de la section s'il le répète
    var nomRub = (rubriquesDe(a).filter(function (x) { return x.id === rub; })[0] || {}).nom;
    var h2 = f.querySelector(".section .entete h2");
    if (h2 && (h2.textContent === nomRub || (rub === "chiffres" && h2.textContent === "Les chiffres"))) h2.remove();
    return f;
  }
  function serie(s, c) {
    var pts = s.points || [];
    if (!pts.length) return null;
    var max = Math.max.apply(null, pts.map(function (p) { return +p.valeur || 0; })) || 1;
    return el("figure", { class: "serie", style: "--c:" + c }, [
      el("figcaption", { text: s.titre }),
      el("div", { class: "barres" }, pts.map(function (p, i) {
        return el("div", { class: "barre" + (i === pts.length - 1 ? " derniere" : "") }, [
          el("em", { text: compact(+p.valeur || 0) }), el("i", { style: "height:" + Math.max(2, (+p.valeur || 0) / max * 100) + "%" }), el("span", { text: p.label })
        ]);
      }))
    ]);
  }

  function sectionClients(a) {
    var r = reglages(a);
    var clients = S.clients.filter(function (c) { return c.activite_id === a.id; });
    var etapes = (a.etapes || []).length ? a.etapes : Array.from(new Set(clients.map(function (c) { return c.etape; }).filter(Boolean)));
    var pipe = null;
    if (etapes.length && clients.length) {
      pipe = el("div", { class: "pipeline", style: "--c:" + a.couleur }, etapes.map(function (e, i) {
        var cs = clients.filter(function (c) { return c.etape === e; });
        var somme = cs.reduce(function (s, c) { return s + (r.total ? totalClient(a, c) : (+c.montant || 0)); }, 0);
        return el("div", { class: "etape" + (cs.length ? "" : " vide-etape"), style: "--o:" + (0.25 + 0.75 * (i + 1) / etapes.length) }, [
          el("b", { text: String(cs.length) }), el("span", { text: e }), somme ? el("em", { text: compact(somme) + " €" + (r.total ? " de comm." : "") }) : null
        ]);
      }));
    }
    var tri = clients.slice().sort(function (x, y) {
      if (r.champs) {
        // Étape la plus avancée d'abord (les affaires abandonnées en bas), puis la signature la plus récente
        var ix = estAbandonne(x) ? -1 : etapes.indexOf(x.etape), iy = estAbandonne(y) ? -1 : etapes.indexOf(y.etape);
        if (ix !== iy) return iy - ix;
        var sx = valeurChamp(x, "date_acte") || valeurChamp(x, "date_compromis") || "", sy = valeurChamp(y, "date_acte") || valeurChamp(y, "date_compromis") || "";
        if (sx !== sy) return sx < sy ? 1 : -1;
        return (+y.montant || 0) - (+x.montant || 0);
      }
      var dx = x.prochaine_action_le || "9999", dy = y.prochaine_action_le || "9999";
      return dx < dy ? -1 : dx > dy ? 1 : x.nom.localeCompare(y.nom);
    });
    var nom = el("input", { type: "text", placeholder: r.champs ? "+ Nouvelle affaire (nom de l'investisseur)" : "+ Nouveau client ou prospect", "aria-label": "Nom du client" });
    var ajout = el("form", { class: "ajout" }, [nom]);
    ajout.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!nom.value.trim()) return;
      db.from("clients").insert({ activite_id: a.id, nom: nom.value.trim(), etape: etapes[0] || null }).select().single().then(verifier).then(function (res) {
        S.clients.push(res.data); S.ouvert = res.data.id; dessiner();
      });
    });
    var liste = r.champs ? tableauAffaires(a, tri, etapes)
      : el("ul", { class: "clients" }, tri.length ? tri.map(function (c) { return ligneClient(c, etapes, a); }) : [el("li", { class: "vide", text: "Aucun client pour l'instant." })]);
    return el("section", { class: "section", id: "s-clients" }, [
      el("div", { class: "entete" }, [el("h2", { text: r.titre_clients || "Clients et suivis" }), el("p", { class: "aside", text: clients.length + (clients.length > 1 ? " fiches" : " fiche") })]),
      pipe, liste, ajout
    ]);
  }

  // Tableau façon tableur pour les projets à colonnes propres (Berkay) : une ligne par affaire, totaux en pied.
  function tableauAffaires(a, clients, etapes) {
    var r = reglages(a);
    var visibles = (r.champs || []).filter(function (ch) { return ch.colonne !== false; });
    var argent = function (v) { return v ? fmtN.format(Math.round(v)) + " €" : "–"; };
    var cellule = function (ch, c) {
      var v = valeurChamp(c, ch.cle);
      if (ch.type === "date") return el("td", { class: "date" + (ch.cle === "rdv" && v && v >= isoJour(new Date()) ? " a-venir" : ""), text: v ? fmt(lireJour(v), { day: "numeric", month: "short" }) : "–" });
      if (ch.cle === "pack" && v) return el("td", {}, [el("span", { class: "hs-pack petit", style: "--p:" + (COULEURS_PACK[v] || a.couleur), text: v })]);
      return el("td", { class: ch.type === "euros" ? "nb" : "", text: ch.type === "euros" ? argent(+v) : (v || "–") });
    };
    var nbCol = 4 + visibles.length + (r.total ? 1 : 0);
    var textes = visibles.filter(function (ch) { return ch.type !== "euros" && ch.type !== "date"; }),
        euros = visibles.filter(function (ch) { return ch.type === "euros"; }),
        dates = visibles.filter(function (ch) { return ch.type === "date"; });
    var corps = [];
    clients.forEach(function (c) {
      var ouvert = S.ouvert === c.id;
      corps.push(el("tr", { class: "ligne-affaire" + (ouvert ? " ouverte" : "") + (estAbandonne(c) ? " abandon" : "") + (S.vientDeBouger === c.id ? " vient-de-bouger" : ""), "data-id": c.id,
        onclick: function () { S.ouvert = ouvert ? null : c.id; dessiner(); } }, [
        el("th", { scope: "row" }, [el("button", { type: "button", "aria-expanded": ouvert ? "true" : "false", text: c.nom })]),
        el("td", {}, [el("span", { class: "puce" + ((r.etapes_gagnees || []).indexOf(c.etape) >= 0 ? " gagne" : ""), text: c.etape || "—" })])
      ].concat(textes.map(function (ch) { return cellule(ch, c); }),
        [el("td", { class: "nb", text: argent(+c.montant) })],
        euros.map(function (ch) { return cellule(ch, c); }),
        r.total ? [el("td", { class: "nb total", text: argent(totalClient(a, c)) })] : [],
        dates.map(function (ch) { return cellule(ch, c); }),
        [(function () {
          var j = c.prochaine_action_le ? joursDepuis(lireJour(c.prochaine_action_le)) : null;
          return el("td", { class: "suite" + (j != null && j < 0 ? " retard" : j === 0 ? " auj" : ""), title: c.prochaine_action || "",
            text: c.prochaine_action_le ? quand(lireJour(c.prochaine_action_le)) : "" });
        })()])));
      if (ouvert) corps.push(el("tr", { class: "detail-affaire" }, [el("td", { colspan: String(nbCol + 1) }, [ficheClient(c, etapes, a)])]));
    });
    var actifs = clients.filter(function (c) { return !estAbandonne(c); });
    var somme = function (f) { return actifs.reduce(function (s, c) { return s + (+f(c) || 0); }, 0); };
    var pied = el("tr", {}, [el("th", { scope: "row", text: "Total" }), el("td", { text: actifs.length + " affaires" })]
      .concat(textes.map(function () { return el("td"); }),
        [el("td", { class: "nb", text: argent(somme(function (c) { return c.montant; })) })],
        euros.map(function (ch) { return el("td", { class: "nb", text: argent(somme(function (c) { return valeurChamp(c, ch.cle); })) }); }),
        r.total ? [el("td", { class: "nb total", text: argent(somme(function (c) { return totalClient(a, c); })) })] : [],
        dates.map(function () { return el("td"); }), [el("td")]));
    var tete = el("tr", {}, [el("th", { scope: "col", text: r.hubspot ? "Partenaire" : "Client" }), el("th", { scope: "col", text: "Étape" })]
      .concat(textes.map(function (ch) { return el("th", { scope: "col", text: ch.label }); }),
        [el("th", { scope: "col", class: "nb", text: r.libelle_montant || "Montant" })],
        euros.map(function (ch) { return el("th", { scope: "col", class: "nb", text: ch.label }); }),
        r.total ? [el("th", { scope: "col", class: "nb total", text: r.total.label })] : [],
        dates.map(function (ch) { return el("th", { scope: "col", text: ch.label.replace(/ signé le$/, "") }); }),
        [el("th", { scope: "col", text: r.libelle_relance || "Relance" })]));
    return el("div", { class: "tableau-defile", style: "--c:" + a.couleur }, [el("table", { class: "affaires" }, [el("thead", {}, [tete]), el("tbody", {}, corps), el("tfoot", {}, [pied])])]);
  }

  function ligneClient(c, etapes, a) {
    var ouvert = S.ouvert === c.id;
    var j = c.prochaine_action_le ? joursDepuis(lireJour(c.prochaine_action_le)) : null;
    var tete = el("button", { type: "button", class: "client-tete", "aria-expanded": ouvert ? "true" : "false", onclick: function () { S.ouvert = ouvert ? null : c.id; dessiner(); } }, [
      el("b", { text: c.nom }),
      el("span", { class: "puce", text: c.etape || "—" }),
      el("span", { class: "montant", text: c.montant ? nombre(+c.montant, "€") : "" }),
      el("span", { class: "action" }, [c.prochaine_action || "", c.prochaine_action_le ? el("em", { class: j < 0 ? "retard" : j === 0 ? "auj" : "", text: quand(lireJour(c.prochaine_action_le)) }) : null])
    ]);
    if (!ouvert) return el("li", { class: "client" + (S.vientDeBouger === c.id ? " vient-de-bouger" : ""), "data-id": c.id }, [tete]);
    return el("li", { class: "client ouvert" }, [tete, ficheClient(c, etapes, a)]);
  }

  function ficheClient(c, etapes, a) {
    var r = reglages(a);
    var etape = el("select", { "aria-label": "Étape" }, [el("option", { value: "", text: "Étape" })].concat(etapes.map(function (e) { return el("option", { value: e, selected: e === c.etape, text: e }); })));
    var type = el("select", { "aria-label": "Type" }, ["prospect", "client", "partenaire", "fournisseur", "autre"].map(function (t) { return el("option", { value: t, selected: t === c.type, text: t }); }));
    var montant = el("input", { type: "number", step: "any", value: c.montant == null ? "" : c.montant, placeholder: (r.libelle_montant || "Montant") + " €", "aria-label": r.libelle_montant || "Montant" });
    // Les champs venus de HubSpot sont déjà affichés dans le bloc HubSpot de la fiche
    var champs = (r.champs || []).filter(function (ch) { return !(ch.hubspot && (c.donnees || {}).hubspot_id) && !(r.besoins && ch.cle === "besoin"); }).map(function (ch) {
      var v = (c.donnees || {})[ch.cle];
      var aide = ch.taux ? " (vide = " + fmtN.format(ch.taux * 100) + " % du prix)" : "";
      return { ch: ch, input: el("input", { type: ch.type === "euros" ? "number" : ch.type === "date" ? "date" : "text", step: "any", value: v == null ? "" : v, placeholder: ch.label + (ch.type === "euros" ? " €" : "") + aide, "aria-label": ch.label,
        title: ch.hubspot ? ch.label + " : à modifier dans HubSpot" : ch.label + aide, readonly: ch.hubspot && (c.donnees || {}).hubspot_id ? true : null }) };
    });
    var listeBesoins = r.besoins ? editeurBesoins(c, r) : null;
    // Commission totale (ex. Berkay : vente + frais), recalculée pendant la saisie ; une case vide prend le taux du projet
    var totalFiche = null;
    if (r.total) {
      var valeurTotal = el("b", {}), detailTotal = el("small", {});
      totalFiche = el("div", { class: "total-fiche", style: "--c:" + a.couleur }, [el("span", { text: r.total.label }), valeurTotal, detailTotal]);
      var recalculer = function () {
        var prix = montant.value === "" ? 0 : +montant.value, morceaux = [];
        var t = r.total.de.reduce(function (somme, cle) {
          var x = champs.filter(function (y) { return y.ch.cle === cle; })[0], v = x ? x.input.value.trim() : valeurChamp(c, cle);
          var n = v === "" || v == null ? (x && x.ch.taux && prix ? Math.round(prix * x.ch.taux) : 0) : +v;
          if (x) morceaux.push(x.ch.label.replace(/^Comm\. /, "").replace(/ TTC$/, "") + " " + fmtN.format(n) + " €");
          return somme + n;
        }, 0);
        valeurTotal.textContent = fmtN.format(Math.round(t)) + " €";
        detailTotal.textContent = morceaux.join(" + ");
      };
      [montant].concat(champs.map(function (x) { return x.input; })).forEach(function (i) { i.addEventListener("input", recalculer); });
      recalculer();
    }
    // Fiche synchronisée avec HubSpot : étape et montant se changent dans HubSpot (sinon la synchro les réécrirait)
    if (r.hubspot && (c.donnees || {}).hubspot_id) {
      etape.disabled = true; etape.title = "Étape : à changer dans HubSpot";
      montant.readOnly = true; montant.title = "Montant : à changer dans HubSpot";
    }
    var contact = el("input", { type: "text", value: c.contact || "", placeholder: "Contact (nom, téléphone, e-mail)", "aria-label": "Contact" });
    var action = el("input", { type: "text", value: c.prochaine_action || "", placeholder: "Prochaine action", "aria-label": "Prochaine action" });
    var actionLe = el("input", { type: "date", value: c.prochaine_action_le || "", "aria-label": "Date de la prochaine action" });
    var notes = el("textarea", { rows: "3", placeholder: "Notes", "aria-label": "Notes" }); notes.value = c.notes || "";
    var deHubspot = !!(r.hubspot && (c.donnees || {}).hubspot_id); // le nom vient alors de HubSpot, qui le réécrirait
    var nom = el("input", { type: "text", class: "nom-fiche", value: c.nom || "", placeholder: "Nom", "aria-label": "Nom", required: true,
      readonly: deHubspot ? true : null, title: deHubspot ? "Nom à modifier dans HubSpot" : null });
    var fiche = el("form", { class: "fiche" }, [
      el("label", { class: "champ-nom" }, [el("span", { text: "Nom" }), nom]),
      deHubspot ? blocHubspot(c, a) : null,
      el("div", { class: "rangee" }, [etape, r.champs ? null : type, montant]),
      champs.length ? el("div", { class: "rangee champs" }, champs.map(function (x) { return el("label", {}, [el("span", { text: x.ch.label }), x.input]); })) : null,
      totalFiche,
      r.besoins ? listeBesoins.bloc : null,
      contact, el("div", { class: "rangee" }, [action, actionLe]), notes,
      el("div", { class: "rangee" }, [
        el("button", { type: "submit", class: "btn-plein", text: "Enregistrer" }),
        r.factures ? el("button", { type: "button", class: "btn-texte", text: "Créer la facture", onclick: function () {
          var montant = r.total ? totalClient(a, c) : null;
          creerFacture(a, { client_id: c.id, objet: (r.total ? "Commission d'apport d'affaires – " : "Commission – ") + c.nom, montant_ht: montant || null });
        } }) : null,
        el("button", { type: "button", class: "btn-texte", text: "En faire une tâche", onclick: function () {
          creerTache({ titre: (action.value.trim() || "Suivre") + " – " + c.nom, activite_id: c.activite_id, client_id: c.id, echeance: actionLe.value || isoJour(new Date()), priorite: "moyenne" });
        } }),
        el("button", { type: "button", class: "btn-texte danger", text: "Supprimer la fiche", onclick: function () {
          if (!confirm("Supprimer la fiche « " + c.nom + " » et son historique ?")) return;
          S.clients = S.clients.filter(function (x) { return x.id !== c.id; });
          db.from("clients").delete().eq("id", c.id).then(verifier); dessiner();
        } })
      ])
    ]);
    fiche.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var prix = montant.value === "" ? null : +montant.value;
      var donnees = Object.assign({}, c.donnees || {});
      if (listeBesoins) {
        // Besoins ligne par ligne ; le résumé texte alimente la colonne du tableau, la prime totale le montant si rien n'est saisi
        var lignesB = listeBesoins.valeur();
        donnees.besoins = lignesB;
        donnees.besoin = lignesB.map(function (b) { return b.produit + (b.assureur ? " (" + b.assureur + ")" : ""); }).join(", ") || null;
        var totalPrimes = lignesB.filter(function (b) { return b.statut !== "Refusé"; }).reduce(function (t, b) { return t + (+b.prime || 0); }, 0);
        if (montant.value === "" && totalPrimes) montant.value = totalPrimes;
      }
      champs.forEach(function (x) {
        var v = x.input.value.trim();
        // Commission laissée vide : calculée avec le taux du projet si le prix est connu.
        if (v === "" && x.ch.taux && prix) v = String(Math.round(prix * x.ch.taux));
        if (v === "") delete donnees[x.ch.cle]; else donnees[x.ch.cle] = x.ch.type === "euros" ? +v : v;
      });
      // Une date de signature saisie fait avancer l'étape (ex. Berkay : compromis, puis acte où la commission est due)
      var nouvelleEtape = etape.value || null, avant = nouvelleEtape;
      (r.etapes_auto || []).forEach(function (regle) {
        if (donnees[regle.champ] && !estAbandonne({ etape: nouvelleEtape }) && etapes.indexOf(nouvelleEtape) < etapes.indexOf(regle.etape)) nouvelleEtape = regle.etape;
      });
      var maj = { nom: deHubspot ? c.nom : nom.value.trim() || c.nom, etape: nouvelleEtape, type: type.value, montant: prix, contact: contact.value.trim() || null, donnees: donnees,
        prochaine_action: action.value.trim() || null, prochaine_action_le: actionLe.value || null, notes: notes.value.trim() || null };
      Object.assign(c, maj);
      db.from("clients").update(maj).eq("id", c.id).then(verifier).then(function () { signaler(nouvelleEtape !== avant ? "Fiche enregistrée · passée en « " + nouvelleEtape + " »" : "Fiche enregistrée"); });
      S.ouvert = null; S.vientDeBouger = c.id; // la fiche se referme, la ligne reprend sa place mise à jour
      dessiner();
      // La ligne enregistrée a pris sa nouvelle place : on la montre et on la fait briller un instant
      var ligne = app.querySelector('.ligne-affaire[data-id="' + c.id + '"], .client[data-id="' + c.id + '"]');
      if (ligne) { ligne.scrollIntoView({ block: "center", behavior: mouvementReduit ? "auto" : "smooth" }); setTimeout(function () { S.vientDeBouger = null; }, 1600); }
    });
    var hist = S.suivis.filter(function (s) { return s.client_id === c.id; });
    var typeS = el("select", { "aria-label": "Type de suivi" }, Object.keys(TYPES_SUIVI).map(function (t) { return el("option", { value: t, text: TYPES_SUIVI[t] }); }));
    var texteS = el("input", { type: "text", placeholder: "Noter un échange (Entrée)", "aria-label": "Suivi" });
    var formS = el("form", { class: "ajout suivi" }, [typeS, texteS]);
    formS.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!texteS.value.trim()) return;
      db.from("suivis").insert({ activite_id: c.activite_id, client_id: c.id, type: typeS.value, contenu: texteS.value.trim() }).select().single().then(verifier).then(function (res) {
        S.suivis.unshift(res.data); dessiner();
      });
    });
    var journal = el("ol", { class: "journal" }, hist.length ? hist.map(function (s) {
      return el("li", {}, [el("time", { text: fmt(new Date(s.le), { day: "numeric", month: "short" }) }), el("b", { text: TYPES_SUIVI[s.type] || s.type }), el("span", { text: s.contenu })]);
    }) : [el("li", { class: "vide", text: "Pas encore d'échange noté." })]);
    return el("div", { class: "client-corps", onclick: function (ev) { ev.stopPropagation(); } }, [fiche, el("div", { class: "historique" }, [el("p", { class: "etiquette", text: "Historique" }), formS, journal]),
      r.recommandations ? tableauRecommandations(c) : null]);
  }

  // ---------- Fiche façon HubSpot (Harnes) : pack, avantages, saisons, contacts et entreprise associés ----------
  var COULEURS_PACK = { "Bronze": "#b0784a", "Argent": "#8e99a6", "Or": "#c9a227", "Platine": "#5f7386", "À la carte": "#d01818", "Parrainage de match": "#0e0e0f" };
  function blocHubspot(c, a) {
    var d = c.donnees || {}, argent = function (v) { return v == null ? "—" : fmtN.format(Math.round(v)) + " €"; };
    var evolution = function (avant, apres) {
      if (avant == null || apres == null || !avant) return null;
      var p = Math.round((apres - avant) / avant * 100);
      return el("span", { class: "evolution " + (p > 0 ? "hausse" : p < 0 ? "baisse" : ""), text: (p > 0 ? "+" : "") + p + " %" });
    };
    var saisons = el("div", { class: "hs-saisons" }, [
      el("div", {}, [el("small", { text: "2025-2026" }), el("b", { text: d.nouveau ? "Nouveau" : argent(d.saison_precedente) })]),
      el("div", { class: "courante" }, [el("small", { text: "2026-2027" }), el("b", { text: argent(+c.montant || null) }), evolution(d.saison_precedente, +c.montant)]),
      el("div", {}, [el("small", { text: "2027-2028 prévu" }), el("b", { text: argent(d.saison_suivante) }), evolution(+c.montant, d.saison_suivante)])
    ]);
    var contacts = (d.contacts || []).map(function (k) {
      return el("div", { class: "hs-contact" }, [
        el("span", { class: "hs-avatar", text: (k.nom || "?").split(" ").map(function (m) { return m.charAt(0); }).join("").slice(0, 2).toUpperCase() }),
        el("div", {}, [el("b", { text: k.nom }), k.fonction ? el("small", { text: k.fonction }) : null,
          el("div", { class: "hs-liens" }, [k.email ? el("a", { href: "mailto:" + k.email, text: k.email }) : null, k.tel ? el("a", { href: "tel:" + k.tel.replace(/\s/g, ""), text: k.tel }) : null])])
      ]);
    });
    var ent = d.entreprise;
    return el("div", { class: "hs-fiche", onclick: function (ev) { ev.stopPropagation(); } }, [
      el("div", { class: "hs-tete" }, [
        d.pack ? el("span", { class: "hs-pack", style: "--p:" + (COULEURS_PACK[d.pack] || a.couleur), text: "Pack " + d.pack }) : null,
        d.cloture ? el("span", { class: "hs-meta", text: "Clôture " + fmt(lireJour(d.cloture), { day: "numeric", month: "short", year: "numeric" }) }) : null,
        el("a", { class: "btn-contour petit hs-ouvrir", href: d.hubspot_url, target: "_blank", rel: "noopener", text: "Ouvrir dans HubSpot ↗" })
      ]),
      saisons,
      d.avantages ? el("div", { class: "hs-avantages" }, d.avantages.split(", ").map(function (x) { return el("span", { text: x }); })) : null,
      el("div", { class: "hs-colonnes" }, [
        el("div", {}, [el("p", { class: "etiquette", text: "Contacts" + (contacts.length ? " (" + contacts.length + ")" : "") }),
          contacts.length ? el("div", { class: "hs-contacts" }, contacts) : el("p", { class: "vide", text: "Contacts HubSpot pas encore lus (droit de lecture à activer)." })]),
        el("div", {}, [el("p", { class: "etiquette", text: "Entreprise" }),
          ent ? el("div", { class: "hs-entreprise" }, [el("b", { text: ent.nom || c.nom }), el("small", { text: [ent.ville, ent.site, ent.tel].filter(Boolean).join(" · ") })])
            : el("p", { class: "vide", text: "—" })])
      ]),
      d.description ? el("p", { class: "hs-description", text: d.description }) : null,
      el("p", { class: "hs-note", text: "Pack, montants, avantages et contacts viennent de HubSpot (mis à jour tous les quarts d'heure) : modifiez-les dans HubSpot. Relance, notes et historique restent ici." })
    ]);
  }

  // ---------- Besoins d'un client, ligne par ligne, choisis dans le catalogue du projet (Evoa : produits du DER) ----------
  function besoinsDe(c) {
    var d = c.donnees || {};
    if (Array.isArray(d.besoins)) return d.besoins.map(function (b) { return Object.assign({}, b); });
    // Reprise de l'ancien champ texte : « Prévoyance (UNIM), assurance de prêt » -> une ligne par besoin
    return String(d.besoin || "").split(/,|\s\/\s/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
      var m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(x), nom = m ? m[1] : x;
      var devis = /^devis\s+(.+)$/i.exec(nom); // « Devis Abeille » : l'assureur est connu, le produit reste à préciser
      return { produit: devis ? "" : produitDuCatalogue(nom), assureur: m ? m[2] : devis ? devis[1] : "", prime: null, statut: devis ? "Devis en cours" : "À étudier" };
    });
  }
  // Rapproche un libellé libre d'un produit du catalogue Evoa (« assurance de prêt » -> « Assurance emprunteur »)
  var ALIAS_PRODUITS = [[/pr[eê]t|emprunt/i, "Assurance emprunteur"], [/^pno|non occupant/i, "Propriétaire non occupant (PNO)"], [/habitation|mrh/i, "Multirisque habitation"],
    [/pr[ée]voyance collective/i, "Prévoyance collective"], [/sant[ée] collective|mutuelle collective/i, "Santé collective"], [/mutuelle|compl[ée]mentaire sant/i, "Complémentaire santé"],
    [/^per\b|[ée]pargne retraite/i, "Plan d'épargne retraite (PER)"], [/assurance[- ]vie/i, "Assurance-vie"], [/auto|voiture/i, "Assurance auto"], [/d[ée]cennale/i, "Décennale"],
    [/rc pro|responsabilit[ée] civile/i, "Responsabilité civile professionnelle"], [/^gav|accidents? de la vie/i, "Garantie des accidents de la vie (GAV)"], [/pr[ée]voyance/i, "Prévoyance"]];
  function produitDuCatalogue(nom) {
    for (var i = 0; i < ALIAS_PRODUITS.length; i++) if (ALIAS_PRODUITS[i][0].test(nom)) return ALIAS_PRODUITS[i][1];
    return nom.charAt(0).toUpperCase() + nom.slice(1);
  }
  function editeurBesoins(c, r) {
    var lignes = besoinsDe(c), corps = el("div", { class: "besoins-lignes" }), total = el("span", { class: "besoins-total" });
    var statuts = r.statuts_besoin || ["À étudier", "Devis en cours", "Devis présenté", "Signé", "Refusé"];
    var choixProduit = function (valeur) {
      var connus = [], s = el("select", { class: "cellule", "aria-label": "Produit" }, [el("option", { value: "", text: "Choisir un produit…" })].concat((r.produits || []).map(function (g) {
        return el("optgroup", { label: g.famille }, g.produits.map(function (p) { connus.push(p); return el("option", { value: p, text: p }); }));
      })));
      if (valeur && connus.indexOf(valeur) < 0) s.appendChild(el("option", { value: valeur, text: valeur }));
      s.value = valeur || "";
      return s;
    };
    var majTotal = function () {
      var t = lignes.filter(function (b) { return b.statut !== "Refusé"; }).reduce(function (s, b) { return s + (+b.prime || 0); }, 0);
      total.textContent = t ? "Primes : " + fmtN.format(Math.round(t)) + " € / an" : "";
    };
    var dessinerLignes = function () {
      corps.textContent = "";
      lignes.forEach(function (b, i) {
        var produit = choixProduit(b.produit);
        var assureur = el("input", { type: "text", class: "cellule", value: b.assureur || "", placeholder: "Assureur", list: "assureurs-" + c.id, "aria-label": "Assureur" });
        var prime = el("input", { type: "number", step: "any", class: "cellule", value: b.prime == null ? "" : b.prime, placeholder: "Prime / an €", "aria-label": "Prime par an" });
        var statut = el("select", { class: "cellule statut-besoin", "aria-label": "Statut" }, statuts.map(function (x) { return el("option", { value: x, selected: x === b.statut, text: x }); }));
        statut.dataset.statut = b.statut || statuts[0];
        produit.addEventListener("change", function () { b.produit = produit.value; });
        assureur.addEventListener("input", function () { b.assureur = assureur.value.trim(); });
        prime.addEventListener("input", function () { b.prime = prime.value === "" ? null : +prime.value; majTotal(); });
        statut.addEventListener("change", function () { b.statut = statut.value; statut.dataset.statut = statut.value; majTotal(); });
        corps.appendChild(el("div", { class: "besoin-ligne" }, [produit, assureur, prime, statut,
          el("button", { type: "button", class: "btn-texte danger", "aria-label": "Retirer ce besoin", title: "Retirer", text: "×", onclick: function () { lignes.splice(i, 1); dessinerLignes(); majTotal(); } })]));
      });
      if (!lignes.length) corps.appendChild(el("p", { class: "vide", text: "Aucun besoin noté : ajoutez-en un ci-dessous." }));
    };
    dessinerLignes(); majTotal();
    var bloc = el("div", { class: "besoins" }, [
      el("div", { class: "besoins-tete" }, [el("span", { class: "etiquette", text: "Besoins" }), total]),
      corps,
      el("datalist", { id: "assureurs-" + c.id }, (r.assureurs || []).map(function (x) { return el("option", { value: x }); })),
      el("button", { type: "button", class: "btn-contour petit ajout-besoin", text: "+ Ajouter un besoin", onclick: function () {
        lignes.push({ produit: "", assureur: "", prime: null, statut: statuts[0] }); dessinerLignes();
        var d = corps.querySelectorAll(".besoin-ligne select"); if (d.length) d[d.length - 2].focus();
      } })
    ]);
    return { bloc: bloc, valeur: function () { return lignes.filter(function (b) { return b.produit; }); } };
  }

  // ---------- Production d'Evoa (= sa facturation), au format du « TABLEAU DE PROD » ----------
  var MOIS_LONGS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  var MOIS_COURTS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
  var MONTANTS_PROD = [["pp", "PP"], ["pu_uc", "PU UC"], ["pu_fe", "PU FE"], ["structure", "Structure"], ["iard", "IARD"]];
  // Mêmes calculs que la base (colonnes calculées) pour l'affichage immédiat pendant la saisie
  function calculProd(x) {
    var base = MONTANTS_PROD.reduce(function (t, m) { return t + (+x[m[0]] || 0); }, 0), com = base * (+x.taux || 0), acp = com * (x.taux_acp == null ? 0.1 : +x.taux_acp);
    var commercial = (com - acp) * 0.8, associe = commercial * (+x.taux_associe || 0); // l'associé touche une part de la commission d'Antonin
    return { base: base, com_cab: com, acp: acp, commercial: commercial, evoa: (com - acp) * 0.2, part_associe: associe, net: commercial - associe };
  }
  function sectionProduction(a) {
    var tout = (S.production || []).filter(function (x) { return x.activite_id === a.id; }), an = new Date().getFullYear();
    var annees = Array.from(new Set(tout.map(function (x) { return x.annee; }).concat([an, an + 1]))).sort();
    if (!S.prodAnnee || annees.indexOf(S.prodAnnee) < 0) S.prodAnnee = tout.some(function (x) { return x.annee === an; }) ? an : (tout.length ? tout[tout.length - 1].annee : an);
    var dAnnee = tout.filter(function (x) { return x.annee === S.prodAnnee; });
    var mois = S.prodMois || 0, lignes = mois ? dAnnee.filter(function (x) { return x.mois === mois; }) : dAnnee;
    var somme = function (l, k) { return l.reduce(function (t, x) { var c = calculProd(x); return t + (k in c ? c[k] : +x[k] || 0); }, 0); };
    var euros = function (v) { return fmtN.format(Math.round(v)) + " €"; };
    var periode = (mois ? MOIS_LONGS[mois - 1] + " " : "") + S.prodAnnee;

    var onglets = el("div", { class: "vues" }, annees.map(function (y) {
      return el("button", { type: "button", role: "tab", "aria-selected": y === S.prodAnnee ? "true" : "false", text: String(y), onclick: function () { S.prodAnnee = y; S.prodMois = 0; avecTransition(dessiner, "jour"); } });
    }));
    var puces = el("div", { class: "mois-prod" }, [el("button", { type: "button", "aria-pressed": !mois ? "true" : "false", text: "Toute l'année", onclick: function () { S.prodMois = 0; dessiner(); } })]
      .concat(MOIS_LONGS.map(function (nm, i) {
        var n = dAnnee.filter(function (x) { return x.mois === i + 1; }).length;
        return el("button", { type: "button", class: n ? "plein" : "", "aria-pressed": mois === i + 1 ? "true" : "false", onclick: function () { S.prodMois = i + 1; dessiner(); } },
          [MOIS_COURTS[i], n ? el("small", { text: String(n) }) : null]);
      })));
    var associes = reglages(a).associes || [], versAssocies = somme(lignes, "part_associe");
    var chiffres = el("div", { class: "chiffres-prod" }, [
      ["Primes", euros(somme(lignes, "base")), lignes.length + " contrat" + (lignes.length > 1 ? "s" : "")], ["COM CAB", euros(somme(lignes, "com_cab")), "commission du cabinet"],
      ["Votre part", euros(somme(lignes, "net")), "80 % après ACP" + (versAssocies ? ", moins les associés" : "")], ["Part EVOA", euros(somme(lignes, "evoa")), "20 % après ACP"],
      ["ACP", euros(somme(lignes, "acp")), ""], ["Associés", euros(versAssocies), versAssocies ? "reversé sur vos dossiers" : "aucun dossier partagé"]
    ].map(function (k, i) { return el("div", { class: i === 2 ? "mise-en-avant" : "" }, [el("span", { text: k[0] }), el("b", { text: k[1] }), k[2] ? el("small", { text: k[2] }) : null]); }));
    // Histogramme : votre part mois par mois
    var parMois = MOIS_LONGS.map(function (nm, i) { return somme(dAnnee.filter(function (x) { return x.mois === i + 1; }), "net"); });
    var max = Math.max.apply(null, parMois.concat([1]));
    var histo = el("div", { class: "histo-prod", "aria-label": "Votre part par mois" }, parMois.map(function (v, i) {
      return el("button", { type: "button", class: "barre-mois" + (mois === i + 1 ? " choisie" : ""), title: MOIS_LONGS[i] + " : " + euros(v), onclick: function () { S.prodMois = i + 1; dessiner(); } },
        [el("i", { style: "height:" + Math.max(2, v / max * 100) + "%" }), el("small", { text: MOIS_LONGS[i].slice(0, 1) })]);
    }));

    // Tableau éditable comme l'Excel : chaque case s'enregistre à la sortie, les commissions se recalculent
    var cases = function (x) {
      var calc = calculProd(x), ligne;
      var maj = function (champ, valeur) {
        var m = {}; if (typeof champ === "object") m = champ; else m[champ] = valeur; Object.assign(x, m);
        var c2 = calculProd(x);
        ["com_cab", "acp", "commercial", "evoa", "part_associe", "net"].forEach(function (k) { var td = ligne.querySelector('[data-calc="' + k + '"]'); if (td) td.textContent = c2[k] ? fmtN.format(Math.round(c2[k] * 100) / 100) : "–"; });
        db.from("production").update(m).eq("id", x.id).then(verifier);
      };
      var texte = function (champ, place, liste) {
        return el("td", {}, [el("input", { type: "text", class: "cellule", value: x[champ] || "", placeholder: place, list: liste || null, "aria-label": place, onchange: function (ev) { maj(champ, ev.target.value.trim() || null); } })]);
      };
      var nombre = function (champ, place, pct) {
        var v = x[champ] == null ? "" : pct ? Math.round(x[champ] * 1000) / 10 : x[champ];
        return el("td", { class: "nb" }, [el("input", { type: "number", step: "any", class: "cellule", value: v, "aria-label": place,
          onchange: function (ev) { var t = ev.target.value; maj(champ, t === "" ? null : pct ? +t / 100 : +t); } })]);
      };
      var calcule = function (k) { return el("td", { class: "nb calc", "data-calc": k, text: calc[k] ? fmtN.format(Math.round(calc[k] * 100) / 100) : "–" }); };
      ligne = el("tr", {}, [
        el("td", {}, [el("select", { class: "cellule", "aria-label": "Mois", onchange: function (ev) { maj("mois", +ev.target.value); dessiner(); } },
          MOIS_LONGS.map(function (nm, i) { return el("option", { value: String(i + 1), selected: x.mois === i + 1, text: nm }); }))]),
        texte("client", "Client"), texte("compagnie", "Compagnie", "assureurs-prod"), texte("risque", "Risque", "risques-prod"),
        nombre("pp", "PP"), nombre("pu_uc", "PU UC"), nombre("pu_fe", "PU FE"), nombre("structure", "Structure"), nombre("iard", "IARD"),
        nombre("taux", "Taux %", true), calcule("com_cab"), nombre("taux_acp", "ACP %", true), calcule("acp"), calcule("commercial"), calcule("evoa"),
        // Associé : choisi dans la liste des réglages, son taux habituel se pose tout seul (modifiable)
        el("td", {}, [el("select", { class: "cellule", "aria-label": "Associé", onchange: function (ev) {
          var nom = ev.target.value || null, as = associes.find(function (y) { return y.nom === nom; });
          maj({ associe: nom, taux_associe: nom ? (as ? as.taux : x.taux_associe) : null }); dessiner();
        } }, [el("option", { value: "", text: "—" })].concat(associes.map(function (y) { return y.nom; }).concat(x.associe && !associes.some(function (y) { return y.nom === x.associe; }) ? [x.associe] : [])
          .map(function (nom) { return el("option", { value: nom, selected: x.associe === nom, text: nom }); })))]),
        nombre("taux_associe", "Taux associé %", true), calcule("part_associe"), calcule("net"),
        texte("contrat", "N° contrat"),
        el("td", {}, [el("input", { type: "date", class: "cellule", value: x.date_effet || "", min: "2015-01-01", max: "2099-12-31", "aria-label": "Date d'effet", onchange: function (ev) { maj("date_effet", ev.target.value || null); } })]),
        el("td", {}, [el("button", { type: "button", class: "btn-texte danger", text: "×", title: "Supprimer la ligne", "aria-label": "Supprimer la ligne", onclick: function () {
          if (!confirm("Supprimer la ligne " + (x.client || "") + " " + (x.risque || "") + " ?")) return;
          S.production = S.production.filter(function (y) { return y.id !== x.id; });
          db.from("production").delete().eq("id", x.id).then(verifier); dessiner();
        } })])
      ]);
      return ligne;
    };
    var entetes = ["Période", "Client", "Compagnie", "Risque", "PP", "PU UC", "PU FE", "Structure", "IARD", "Taux", "COM CAB", "Taux ACP", "ACP", "Commercial", "EVOA", "Associé", "Taux assoc.", "Part associé", "Votre net", "N° contrat", "Date effet", ""];
    var totaux = el("tr", { class: "total-prod" }, entetes.map(function (h, j) {
      var k = { 4: "pp", 5: "pu_uc", 6: "pu_fe", 7: "structure", 8: "iard", 10: "com_cab", 12: "acp", 13: "commercial", 14: "evoa", 17: "part_associe", 18: "net" }[j];
      return el("td", { class: k ? "nb" : "", text: j === 0 ? "Total" : k ? fmtN.format(Math.round(somme(lignes, k))) : "" });
    }));
    var risques = Array.from(new Set(tout.map(function (x) { return x.risque; }).filter(Boolean).concat(((reglages(a).produits || []).reduce(function (t, g) { return t.concat(g.produits); }, [])))));
    var assureurs = Array.from(new Set(tout.map(function (x) { return x.compagnie; }).filter(Boolean).concat(reglages(a).assureurs || [])));
    var ajouter = el("button", { type: "button", class: "btn-plein petit", text: "+ Nouvelle ligne", onclick: function () {
      var m = mois || (S.prodAnnee === an ? new Date().getMonth() + 1 : 1);
      db.from("production").insert({ activite_id: a.id, annee: S.prodAnnee, mois: m, taux_acp: 0.1 }).select().single().then(verifier).then(function (r) {
        S.production.push(r.data); dessiner();
        var champs = app.querySelectorAll('.tableau-prod input[aria-label="Client"]'); if (champs.length) champs[champs.length - 1].focus();
      });
    } });
    var exporter = function (seulMois) {
      var l = (seulMois ? dAnnee.filter(function (x) { return x.mois === seulMois; }) : dAnnee).slice().sort(function (x, y) { return x.mois - y.mois; });
      var nomP = (seulMois ? MOIS_LONGS[seulMois - 1] + " " : "") + S.prodAnnee;
      return exporterExcel({
        projet: a.id, titre: "Production " + nomP, fichier: "Production EVOA " + (seulMois ? S.prodAnnee + "-" + String(seulMois).padStart(2, "0") : S.prodAnnee) + ".xlsx",
        sousTitre: "Tableau de production · " + l.length + " contrat" + (l.length > 1 ? "s" : "") + " · exporté le " + fmt(new Date(), { day: "numeric", month: "long", year: "numeric" }),
        chiffres: [["Contrats", l.length], ["COM CAB", euros(somme(l, "com_cab"))], ["Votre part", euros(somme(l, "net"))], ["Part EVOA", euros(somme(l, "evoa"))], ["Associés", euros(somme(l, "part_associe"))]],
        colonnes: [{ titre: "Période", largeur: 12 }, { titre: "Client", largeur: 18 }, { titre: "Compagnie", largeur: 14 }, { titre: "Risque", largeur: 22 },
          { titre: "PP", largeur: 12, type: "euros" }, { titre: "PU UC", largeur: 12, type: "euros" }, { titre: "PU FE", largeur: 12, type: "euros" }, { titre: "Structure", largeur: 12, type: "euros" },
          { titre: "IARD", largeur: 12, type: "euros" }, { titre: "Taux", largeur: 8, type: "pct" }, { titre: "COM CAB", largeur: 13, type: "euros" }, { titre: "Taux ACP", largeur: 9, type: "pct" },
          { titre: "ACP", largeur: 11, type: "euros" }, { titre: "Commercial", largeur: 13, type: "euros" }, { titre: "EVOA", largeur: 12, type: "euros" },
          { titre: "Associé", largeur: 18 }, { titre: "Taux associé", largeur: 10, type: "pct" }, { titre: "Part associé", largeur: 13, type: "euros" }, { titre: "Votre net", largeur: 13, type: "euros" },
          { titre: "N° contrat", largeur: 15 }, { titre: "Date effet", largeur: 12, type: "date" }],
        lignes: l.map(function (x) { var c = calculProd(x); return [MOIS_LONGS[x.mois - 1].toUpperCase(), x.client || "", x.compagnie || "", x.risque || "", x.pp, x.pu_uc, x.pu_fe, x.structure, x.iard,
          x.taux, Math.round(c.com_cab * 100) / 100, x.taux_acp, Math.round(c.acp * 100) / 100, Math.round(c.commercial * 100) / 100, Math.round(c.evoa * 100) / 100,
          x.associe || "", x.associe ? x.taux_associe : null, Math.round(c.part_associe * 100) / 100 || null, Math.round(c.net * 100) / 100, x.contrat || "", x.date_effet || ""]; }),
        total: true
      });
    };
    return el("section", { class: "section", id: "s-production" }, [
      el("div", { class: "entete" }, [el("h2", { text: "Production " + periode }), onglets,
        el("div", { class: "actions-prod" }, [mois ? el("button", { type: "button", class: "btn-contour", text: "Excel du mois", onclick: function () { exporter(mois); } }) : null,
          el("button", { type: "button", class: "btn-contour", text: "Excel de l'année", onclick: function () { exporter(0); } })])]),
      puces, el("div", { class: "prod-haut" }, [chiffres, histo]),
      el("div", { class: "liste-notion tableau-prod" }, [el("table", {}, [
        el("thead", {}, [el("tr", {}, entetes.map(function (h) { return el("th", { text: h }); }))]),
        el("tbody", {}, lignes.length ? lignes.slice().sort(function (x, y) { return x.mois - y.mois; }).map(cases).concat([totaux])
          : [el("tr", {}, [el("td", { class: "vide", colspan: String(entetes.length), text: "Aucune ligne pour " + periode + "." })])])
      ])]),
      el("datalist", { id: "assureurs-prod" }, assureurs.map(function (x) { return el("option", { value: x }); })),
      el("datalist", { id: "risques-prod" }, risques.map(function (x) { return el("option", { value: x }); })),
      ajouter
    ]);
  }

  // ---------- Recommandations (parrainage) : les personnes qu'un client recommande, notées à chaque rendez-vous ----------
  var STATUTS_RECO = { "a-appeler": "À appeler", "contacte": "Contacté", "rdv-pris": "RDV pris", "devenu-client": "Devenu client", "sans-suite": "Sans suite" };
  function majReco(x, champ, valeur) {
    var maj = {}; maj[champ] = valeur === "" ? null : valeur;
    if (champ === "nom" && !valeur) return;
    Object.assign(x, maj);
    db.from("recommandations").update(maj).eq("id", x.id).then(verifier);
  }
  // Tableau au format PRT d'Evoa : Recommandeur | Nom | Prénom | Adresse | Tél. | Appelé | RDV | Commentaire (+ date du rendez-vous)
  function appele(x) { return ["contacte", "rdv-pris", "devenu-client"].indexOf(x.statut) >= 0; }
  function rdvPris(x) { return ["rdv-pris", "devenu-client"].indexOf(x.statut) >= 0; }
  function nomClient(id) { var c = S.clients.filter(function (y) { return y.id === id; })[0]; return c ? c.nom : "—"; }
  function ligneReco(x, avecRecommandeur) {
    var cellule = function (champ, type, place) {
      return el("td", {}, [el("input", { type: type || "text", class: "cellule", value: x[champ] || "", placeholder: place, "aria-label": place,
        onchange: function (ev) { majReco(x, champ, ev.target.value.trim()); } })]);
    };
    var coche = function (classe, actif, titre, siCoche, sinon) {
      return el("td", { class: "case-prt " + classe }, [el("input", { type: "checkbox", class: "coche", checked: actif, "aria-label": titre, title: titre,
        onchange: function (ev) { majReco(x, "statut", ev.target.checked ? siCoche : sinon); dessiner(); } })]);
    };
    return el("tr", { class: "reco " + x.statut }, [
      avecRecommandeur ? el("td", { class: "recommandeur", text: nomClient(x.client_id) }) : null,
      cellule("nom", "text", "Nom"), cellule("prenom", "text", "Prénom"), cellule("adresse", "text", "Adresse"), cellule("contact", "tel", "Tél."),
      coche("prt-appele", appele(x), "Appelé", "contacte", "a-appeler"),
      coche("prt-rdv", rdvPris(x), "RDV pris", "rdv-pris", "contacte"),
      cellule("notes", "text", "Commentaire"), cellule("recue_le", "date", "Reçue le"),
      el("td", { class: "reco-actions" }, [
        el("button", { type: "button", class: "btn-texte", title: "Créer la tâche d'appel", text: "Tâche", onclick: function () {
          creerTache({ titre: "Appeler " + [x.prenom, x.nom].filter(Boolean).join(" ") + " (recommandé par " + nomClient(x.client_id) + ")", activite_id: x.activite_id,
            client_id: x.client_id, echeance: isoJour(new Date()), priorite: "moyenne", notes: [x.contact, x.notes].filter(Boolean).join(" · ") || null });
        } }),
        el("button", { type: "button", class: "btn-texte danger", "aria-label": "Supprimer la recommandation", title: "Supprimer", text: "×", onclick: function () {
          if (!confirm("Supprimer la recommandation « " + [x.prenom, x.nom].filter(Boolean).join(" ") + " » ?")) return;
          S.recommandations = S.recommandations.filter(function (y) { return y.id !== x.id; });
          db.from("recommandations").delete().eq("id", x.id).then(verifier); dessiner();
        } })
      ])
    ]);
  }
  // Ligne de saisie rapide (Entrée pour ajouter) ; dans la vue globale, on choisit le recommandeur.
  function ligneAjoutReco(client, activiteId) {
    var choix = client ? null : el("select", { class: "cellule", "aria-label": "Recommandeur" },
      S.clients.filter(function (c) { return c.activite_id === activiteId; }).map(function (c) { return el("option", { value: c.id, text: c.nom }); }));
    var champ = function (place, type) { return el("input", { type: type || "text", class: "cellule", placeholder: place, "aria-label": place }); };
    var nNom = champ("+ Nom"), nPrenom = champ("Prénom"), nAdresse = champ("Adresse"), nTel = champ("Tél.", "tel"), nNotes = champ("Commentaire"), nDate = champ("Reçue le", "date");
    nDate.value = isoJour(new Date());
    var ajouter = function () {
      if (!nNom.value.trim() && !nPrenom.value.trim()) { nNom.focus(); return; }
      var clientId = client ? client.id : choix && choix.value;
      if (!clientId) { signaler("Choisissez le client qui recommande"); return; }
      db.from("recommandations").insert({ client_id: clientId, activite_id: client ? client.activite_id : activiteId, nom: nNom.value.trim() || nPrenom.value.trim(),
        prenom: nNom.value.trim() ? nPrenom.value.trim() || null : null, adresse: nAdresse.value.trim() || null, contact: nTel.value.trim() || null,
        notes: nNotes.value.trim() || null, recue_le: nDate.value || isoJour(new Date()) }).select().single().then(verifier).then(function (res) {
        S.recommandations.unshift(res.data); dessiner(); signaler("Recommandation ajoutée : " + [res.data.prenom, res.data.nom].filter(Boolean).join(" "));
        var c = document.querySelector(".tableau-prt .ligne-ajout input"); if (c) c.focus();
      });
    };
    [nNom, nPrenom, nAdresse, nTel, nNotes, nDate].forEach(function (i) { i.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); ajouter(); } }); });
    return el("tr", { class: "ligne-ajout" }, [choix ? el("td", {}, [choix]) : null, el("td", {}, [nNom]), el("td", {}, [nPrenom]), el("td", {}, [nAdresse]), el("td", {}, [nTel]),
      el("td", { class: "case-prt prt-appele" }), el("td", { class: "case-prt prt-rdv" }), el("td", {}, [nNotes]), el("td", {}, [nDate]),
      el("td", {}, [el("button", { type: "button", class: "btn-plein petit", text: "Ajouter", onclick: ajouter })])]);
  }
  function tableauPRT(recos, client, activiteId) {
    var global = !client;
    var titres = (global ? ["Recommandeur"] : []).concat(["Nom", "Prénom", "Adresse", "Tél.", "Appelé", "RDV", "Commentaire", "Reçue le", ""]);
    return el("div", { class: "liste-notion tableau-prt" + (global ? " global" : "") }, [el("table", {}, [
      el("thead", {}, [el("tr", {}, titres.map(function (t) { return el("th", { class: t === "Appelé" ? "case-prt prt-appele" : t === "RDV" ? "case-prt prt-rdv" : "", text: t }); }))]),
      el("tbody", {}, recos.map(function (x) { return ligneReco(x, global); }).concat([ligneAjoutReco(client, activiteId)]))
    ])]);
  }
  function compteRecos(recos) {
    var aAppeler = recos.filter(function (x) { return x.statut === "a-appeler"; }).length, rdv = recos.filter(rdvPris).length;
    return recos.length ? recos.length + " recommandation" + (recos.length > 1 ? "s" : "") + (aAppeler ? " · " + aAppeler + " à appeler" : "") + (rdv ? " · " + rdv + " RDV" : "") : "À compléter à chaque rendez-vous";
  }
  function tableauRecommandations(c) {
    var recos = (S.recommandations || []).filter(function (x) { return x.client_id === c.id; });
    return el("div", { class: "recommandations" }, [
      el("div", { class: "reco-tete" }, [el("p", { class: "etiquette", text: "Recommandations" }), el("span", { class: "reco-compte", text: compteRecos(recos) })]),
      tableauPRT(recos, c)
    ]);
  }
  // Vue de toutes les recommandations du projet (le tableau PRT complet), avec export Excel au même format
  // ---------- Exports Excel mis en forme aux couleurs du projet (ExcelJS chargé à la demande) ----------
  // Classeur : bandeau (logo, titre, sous-titre), chiffres clés, tableau à en-tête en dégradé, lignes alternées,
  // filtres, en-tête figé, impression paysage ajustée à la largeur ; feuilles de synthèse en option.
  var MARQUES_EXCEL = {
    "evoa-courtage": { logo: "assets/marques/evoa.png", logoTaille: [168, 63], c1: "204E99", c2: "38297C", fond: "F2F5FB", texte: "2B2B2E", police: "Montserrat",
      signature: "EVOA Courtage · L'assurance qui évolue avec vous" }
  };
  function chargerExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    return new Promise(function (ok, ko) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
      s.onload = function () { ok(window.ExcelJS); }; s.onerror = function () { ko(new Error("bibliothèque Excel non chargée")); };
      document.head.appendChild(s);
    });
  }
  function imageBase64(url) {
    return fetch(url).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
      if (!b) return null;
      return new Promise(function (ok) { var f = new FileReader(); f.onload = function () { ok(String(f.result).split(",")[1]); }; f.readAsDataURL(b); });
    }).catch(function () { return null; });
  }
  // d = { projet, titre, sousTitre, fichier, chiffres: [[libellé, valeur]], colonnes: [{ titre, largeur, type: texte|date|euros|case, fond? }],
  //       lignes: [[…]], surligner?: (ligne) => "RRGGBB", feuilles?: [{ nom, colonnes, lignes }] }
  function exporterExcel(d) {
    var m = MARQUES_EXCEL[d.projet] || { c1: "1D1C19", c2: "4D483E", fond: "F4F3F0", texte: "1D1C19", police: "Calibri", signature: nomActivite(d.projet) };
    var argb = function (h) { return "FF" + h; };
    var police = function (o) { return Object.assign({ name: m.police, color: { argb: argb(m.texte) }, size: 10 }, o || {}); };
    var filet = { style: "thin", color: { argb: "FFDCE1EB" } };
    signaler("Préparation du fichier Excel…");
    return Promise.all([chargerExcelJS(), m.logo ? imageBase64(m.logo) : Promise.resolve(null)]).then(function (r) {
      var ExcelJS = r[0], logo = r[1];
      var wb = new ExcelJS.Workbook(); wb.creator = "Cockpit AR Conseil"; wb.created = new Date();
      var ncol = d.colonnes.length;
      var ws = wb.addWorksheet(d.titre.slice(0, 31), { views: [{ state: "frozen", ySplit: 8, showGridLines: false }],
        pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .4, right: .4, top: .5, bottom: .6, header: .2, footer: .3 } },
        headerFooter: { oddFooter: "&L&8" + m.signature + "&R&8Page &P / &N" } });
      ws.columns = d.colonnes.map(function (c) { return { width: c.largeur || 16 }; });
      // Bandeau : logo à gauche, titre et sous-titre à droite du logo
      ws.getRow(1).height = 26; ws.getRow(2).height = 30; ws.getRow(3).height = 18; ws.getRow(4).height = 10;
      if (logo) ws.addImage(wb.addImage({ base64: logo, extension: "png" }), { tl: { col: 0.15, row: 0.4 }, ext: { width: m.logoTaille[0], height: m.logoTaille[1] } });
      var colTitre = logo ? 3 : 1;
      ws.mergeCells(2, colTitre, 2, ncol); ws.mergeCells(3, colTitre, 3, ncol);
      Object.assign(ws.getCell(2, colTitre), { value: d.titre, font: police({ size: 20, bold: true, color: { argb: argb(m.c1) } }), alignment: { vertical: "middle" } });
      Object.assign(ws.getCell(3, colTitre), { value: d.sousTitre, font: police({ size: 10, color: { argb: "FF7A7F8C" } }) });
      // Liseré dégradé sous le bandeau
      for (var i = 1; i <= ncol; i++) ws.getCell(5, i).fill = { type: "gradient", gradient: "angle", degree: 0,
        stops: [{ position: 0, color: { argb: argb(m.c1) } }, { position: 1, color: { argb: argb(m.c2) } }] };
      ws.getRow(5).height = 4;
      // Chiffres clés : libellé en petit, valeur en grand, sur deux colonnes chacun
      ws.getRow(6).height = 34;
      (d.chiffres || []).slice(0, Math.floor(ncol / 2)).forEach(function (k, j) {
        var c = 1 + j * 2; ws.mergeCells(6, c, 6, c + 1);
        Object.assign(ws.getCell(6, c), { value: { richText: [{ text: k[0].toUpperCase() + "\n", font: police({ size: 8, color: { argb: "FF7A7F8C" } }) },
          { text: String(k[1]), font: police({ size: 15, bold: true, color: { argb: argb(m.c1) } }) }] },
          alignment: { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 },
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: argb(m.fond) } }, border: { left: { style: "medium", color: { argb: argb(m.c1) } } } });
      });
      ws.getRow(7).height = 10;
      // En-tête du tableau (ligne 8) : dégradé de la marque, ou couleur propre à la colonne (cases du PRT)
      var tete = ws.getRow(8); tete.height = 24;
      d.colonnes.forEach(function (c, j) {
        var cell = tete.getCell(j + 1);
        cell.value = c.titre;
        cell.font = police({ bold: true, size: 10, color: { argb: c.fond ? "FF1D1C19" : "FFFFFFFF" } });
        cell.alignment = { vertical: "middle", horizontal: c.type === "case" ? "center" : "left", indent: c.type === "case" ? 0 : 1 };
        cell.fill = c.fond ? { type: "pattern", pattern: "solid", fgColor: { argb: argb(c.fond) } }
          : { type: "gradient", gradient: "angle", degree: 0, stops: [{ position: 0, color: { argb: argb(m.c1) } }, { position: 1, color: { argb: argb(m.c2) } }] };
      });
      // Lignes
      d.lignes.forEach(function (l, k) {
        var row = ws.getRow(9 + k); row.height = 20;
        var teinte = d.surligner && d.surligner(l, k);
        d.colonnes.forEach(function (c, j) {
          var cell = row.getCell(j + 1), v = l[j];
          if (c.type === "case") v = v ? "✓" : "";
          else if (c.type === "date" && v) v = lireJour(v);
          else if ((c.type === "euros" || c.type === "pct") && v !== "" && v != null) v = +v;
          cell.value = v === "" ? null : v;
          cell.font = police(c.type === "case" ? { bold: true, size: 12, color: { argb: argb(m.c1) } } : j === 0 ? { bold: true } : {});
          cell.alignment = { vertical: "middle", horizontal: c.type === "case" ? "center" : c.type === "euros" ? "right" : "left", indent: c.type === "case" ? 0 : 1, wrapText: c.type === "texte-long" };
          if (c.type === "date") cell.numFmt = "dd/mm/yyyy";
          if (c.type === "euros") cell.numFmt = "#,##0.00 €";
          if (c.type === "pct") { cell.numFmt = "0%"; cell.alignment.horizontal = "right"; }
          var fond = teinte || (c.fond ? melanger(c.fond, "FFFFFF", .55) : k % 2 ? m.fond : "FFFFFF");
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(fond) } };
          cell.border = { bottom: filet };
        });
      });
      ws.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8 + d.lignes.length, column: ncol } };
      // Ligne de total (colonnes en euros)
      if (d.total) {
        var rt = ws.getRow(9 + d.lignes.length); rt.height = 22;
        d.colonnes.forEach(function (c, j) {
          var cell = rt.getCell(j + 1);
          if (j === 0) cell.value = "TOTAL";
          else if (c.type === "euros") cell.value = Math.round(d.lignes.reduce(function (t, l) { return t + (+l[j] || 0); }, 0) * 100) / 100 || null;
          cell.font = police({ bold: true, color: { argb: argb(m.c1) } });
          if (c.type === "euros") { cell.numFmt = "#,##0.00 €"; cell.alignment = { horizontal: "right", vertical: "middle" }; }
          cell.border = { top: { style: "medium", color: { argb: argb(m.c1) } } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(m.fond) } };
        });
      }
      ws.pageSetup.printTitlesRow = "8:8";
      // Feuilles de synthèse
      (d.feuilles || []).forEach(function (f) {
        var s2 = wb.addWorksheet(f.nom.slice(0, 31), { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
        s2.columns = f.colonnes.map(function (c) { return { width: c.largeur || 16 }; });
        var t = s2.getRow(1); t.height = 24;
        f.colonnes.forEach(function (c, j) {
          Object.assign(t.getCell(j + 1), { value: c.titre, font: police({ bold: true, color: { argb: "FFFFFFFF" } }), alignment: { vertical: "middle", indent: 1 },
            fill: { type: "gradient", gradient: "angle", degree: 0, stops: [{ position: 0, color: { argb: argb(m.c1) } }, { position: 1, color: { argb: argb(m.c2) } }] } });
        });
        f.lignes.forEach(function (l, k) {
          var row = s2.getRow(2 + k); row.height = 20;
          l.forEach(function (v, j) {
            Object.assign(row.getCell(j + 1), { value: v, font: police(j === 0 ? { bold: true } : {}), alignment: { vertical: "middle", indent: 1, horizontal: typeof v === "number" ? "center" : "left" },
              fill: { type: "pattern", pattern: "solid", fgColor: { argb: argb(k % 2 ? m.fond : "FFFFFF") } }, border: { bottom: filet } });
          });
        });
      });
      return wb.xlsx.writeBuffer();
    }).then(function (buf) {
      var url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      var lien = el("a", { href: url, download: d.fichier }); document.body.appendChild(lien); lien.click(); lien.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      signaler("Fichier Excel prêt : " + d.fichier);
      return buf;
    }).catch(function (e) { signaler("Export impossible : " + e.message); });
  }
  function melanger(h1, h2, t) {
    var a = parseInt(h1, 16), b = parseInt(h2, 16), m = function (s) { return Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t); };
    return [16, 8, 0].map(function (s) { return ("0" + m(s).toString(16)).slice(-2); }).join("").toUpperCase();
  }
  function exporterPRT(a, recos) {
    var tri = recos.slice().sort(function (x, y) { return nomClient(x.client_id).localeCompare(nomClient(y.client_id)) || String(y.recue_le).localeCompare(String(x.recue_le)); });
    var parClient = {};
    tri.forEach(function (x) { var k = nomClient(x.client_id); var p = parClient[k] = parClient[k] || [k, 0, 0, 0]; p[1]++; if (appele(x)) p[2]++; if (rdvPris(x)) p[3]++; });
    var aujourdhui = fmt(new Date(), { day: "numeric", month: "long", year: "numeric" });
    return exporterExcel({
      projet: a.id, titre: "Recommandations clients", fichier: "Recommandations " + nomCourt(a.nom) + " " + isoJour(new Date()) + ".xlsx",
      sousTitre: "Tableau PRT · " + tri.length + " personne" + (tri.length > 1 ? "s" : "") + " recommandée" + (tri.length > 1 ? "s" : "") + " · exporté le " + aujourdhui,
      chiffres: [["Recommandations", tri.length], ["À appeler", tri.filter(function (x) { return !appele(x); }).length],
        ["Appelés", tri.filter(appele).length], ["RDV pris", tri.filter(rdvPris).length], ["Recommandeurs", Object.keys(parClient).length]],
      colonnes: [{ titre: "Recommandeur", largeur: 24 }, { titre: "Nom", largeur: 18 }, { titre: "Prénom", largeur: 16 }, { titre: "Adresse", largeur: 30 },
        { titre: "Tél.", largeur: 16 }, { titre: "Appelé", largeur: 9, type: "case", fond: "BFEFF0" }, { titre: "RDV", largeur: 9, type: "case", fond: "FFF0A3" },
        { titre: "Commentaire", largeur: 34 }, { titre: "Reçue le", largeur: 13, type: "date" }],
      lignes: tri.map(function (x) { return [nomClient(x.client_id), (x.nom || "").toUpperCase(), x.prenom || "", x.adresse || "", x.contact || "", appele(x), rdvPris(x), x.notes || "", x.recue_le || ""]; }),
      surligner: function (l) { return l[6] ? "E6F4EC" : null; },
      feuilles: [{ nom: "Par recommandeur", colonnes: [{ titre: "Recommandeur", largeur: 28 }, { titre: "Recommandations", largeur: 18 }, { titre: "Appelés", largeur: 12 }, { titre: "RDV pris", largeur: 12 }],
        lignes: Object.keys(parClient).map(function (k) { return parClient[k]; }).sort(function (x, y) { return y[1] - x[1]; }) }]
    });
  }
  function sectionRecommandations(a) {
    var toutes = (S.recommandations || []).filter(function (x) { return x.activite_id === a.id; });
    var recos = S.recosAAppeler ? toutes.filter(function (x) { return !appele(x); }) : toutes;
    return el("section", { class: "section", id: "s-recos" }, [
      el("div", { class: "entete" }, [el("h2", { text: "Recommandations" }), el("p", { class: "aside", text: compteRecos(toutes) }),
        el("div", { class: "vues" }, [["toutes", "Toutes"], ["appeler", "À appeler"]].map(function (v) {
          return el("button", { type: "button", role: "tab", "aria-selected": (v[0] === "appeler") === !!S.recosAAppeler ? "true" : "false", text: v[1],
            onclick: function () { S.recosAAppeler = v[0] === "appeler"; avecTransition(dessiner, "jour"); } });
        })),
        el("button", { type: "button", class: "btn-contour", text: "Exporter en Excel", onclick: function () { exporterPRT(a, toutes); } })]),
      tableauPRT(recos, null, a.id)
    ]);
  }

  // ---------- Factures (projets avec reglages.factures : Berkay, Wealthy, Evoa) ----------
  var STATUTS_FACTURE = { "a-emettre": "À émettre", "emise": "Émise", "payee": "Payée", "annulee": "Annulée" };
  function facturesDe(a) { return S.factures.filter(function (f) { return f.activite_id === a.id; }); }
  function factureEnRetard(f) { return f.statut === "emise" && f.echeance && f.echeance < isoJour(new Date()); }
  function ttc(f) { return f.montant_ttc != null ? +f.montant_ttc : (+f.montant_ht || 0) * (1 + (+f.tva || 0) / 100); }
  function resumeFactures(liste) {
    var r = { aEmettre: 0, attente: 0, retard: 0, nbRetard: 0, paye: 0 }, annee = String(new Date().getFullYear());
    liste.forEach(function (f) {
      if (ttc(f) < 0) return; // avoir : il annule une facture déjà marquée « Annulée », ce n'est pas de l'argent rendu
      if (f.statut === "a-emettre") r.aEmettre += ttc(f);
      if (f.statut === "emise") { r.attente += ttc(f); if (factureEnRetard(f)) { r.retard += ttc(f); r.nbRetard++; } }
      if (f.statut === "payee" && (f.payee_le || f.emise_le || "").slice(0, 4) === annee) r.paye += ttc(f);
    });
    return r;
  }
  // L'entreprise individuelle numérote ses factures en une seule suite continue, tous clients confondus.
  function numeroSuivant() {
    var max = 0, largeur = 1; // même présentation que le dernier numéro (Tiime : 28, 29…)
    S.factures.forEach(function (f) { var m = String(f.numero || "").match(/(\d+)\s*$/); if (m && +m[1] >= max) { max = +m[1]; largeur = m[1].length; } });
    return String(max + 1).padStart(largeur, "0");
  }
  function creerFacture(a, base) {
    var reg = reglages(a).factures || {};
    var f = Object.assign({ activite_id: a.id, objet: "Commission", destinataire: reg.destinataire || null, tva: reg.tva || 0, statut: "a-emettre", numero: numeroSuivant() }, base);
    if (f.montant_ht != null && f.montant_ttc == null) f.montant_ttc = Math.round(f.montant_ht * (1 + f.tva / 100) * 100) / 100;
    return db.from("factures").insert(f).select().single().then(verifier).then(function (r) {
      S.factures.unshift(r.data); S.factureOuverte = r.data.id; dessiner(); signaler("Facture " + (r.data.numero || "") + " créée");
      var cible = document.getElementById("s-factures"); if (cible) cible.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  function majFacture(f, maj, a) {
    var reg = reglages(a).factures || {}, auj = isoJour(new Date());
    if (maj.statut === "emise" && !f.emise_le && !maj.emise_le) maj.emise_le = auj;
    if (maj.statut === "emise" && !f.echeance && !maj.echeance) maj.echeance = isoJour(ajouterJours(lireJour(maj.emise_le || f.emise_le || auj), reg.echeance_jours || 30));
    if (maj.statut === "payee" && !f.payee_le && !maj.payee_le) maj.payee_le = auj;
    Object.assign(f, maj);
    db.from("factures").update(maj).eq("id", f.id).then(verifier);
    dessiner();
  }
  function sectionFactures(a) {
    var liste = facturesDe(a).sort(function (x, y) {
      var ordre = { "a-emettre": 0, "emise": 1, "payee": 2, "annulee": 3 };
      return (ordre[x.statut] - ordre[y.statut]) || String(y.emise_le || "").localeCompare(String(x.emise_le || "")) || String(y.numero || "").localeCompare(String(x.numero || ""));
    });
    var r = resumeFactures(liste), argent = function (v) { return fmtN.format(Math.round(v * 100) / 100) + " €"; };
    var objet = el("input", { type: "text", placeholder: "+ Nouvelle facture (objet, ex. Commission d'apporteur d'affaires – novembre 2026)", "aria-label": "Objet de la nouvelle facture" });
    var ajout = el("form", { class: "ajout" }, [objet]);
    ajout.addEventListener("submit", function (ev) { ev.preventDefault(); if (objet.value.trim()) creerFacture(a, { objet: objet.value.trim() }); });
    var lignes = [];
    liste.forEach(function (f) {
      var ouverte = S.factureOuverte === f.id, retard = factureEnRetard(f);
      var statut = el("select", { class: "statut-facture " + f.statut + (retard ? " retard" : ""), "aria-label": "Statut de la facture " + (f.numero || ""),
        onclick: function (ev) { ev.stopPropagation(); }, onchange: function (ev) { majFacture(f, { statut: ev.target.value }, a); } },
        Object.keys(STATUTS_FACTURE).map(function (k) { return el("option", { value: k, selected: k === f.statut, text: STATUTS_FACTURE[k] }); }));
      lignes.push(el("tr", { class: "ligne-affaire" + (ouverte ? " ouverte" : "") + (f.statut === "annulee" ? " abandon" : "") + (S.vientDeBouger === f.id ? " vient-de-bouger" : ""), "data-id": f.id,
        onclick: function () { S.factureOuverte = ouverte ? null : f.id; dessiner(); } }, [
        el("td", { class: "num", text: f.numero || "—" }),
        el("th", { scope: "row" }, [el("button", { type: "button", "aria-expanded": ouverte ? "true" : "false", text: f.objet })]),
        el("td", { text: f.destinataire || "—" }),
        el("td", { text: f.emise_le ? fmt(lireJour(f.emise_le), { day: "numeric", month: "short", year: "numeric" }) : "—" }),
        el("td", { class: retard ? "retard" : "", text: f.statut === "payee" ? (f.payee_le ? "payée le " + fmt(lireJour(f.payee_le), { day: "numeric", month: "short" }) : "payée") : f.echeance ? (retard ? "retard " + (-joursDepuis(lireJour(f.echeance))) + " j" : fmt(lireJour(f.echeance), { day: "numeric", month: "short" })) : "—" }),
        el("td", { class: "nb", text: argent(ttc(f)) }),
        el("td", {}, [statut])
      ]));
      if (ouverte) lignes.push(el("tr", { class: "detail-affaire" }, [el("td", { colspan: "7" }, [formFacture(f, a)])]));
    });
    var tableau = liste.length ? el("div", { class: "tableau-defile", style: "--c:" + a.couleur }, [el("table", { class: "affaires factures" }, [
      el("thead", {}, [el("tr", {}, ["N°", "Objet", "Destinataire", "Émise le", "Échéance", "Montant TTC", "Statut"].map(function (t, i) { return el("th", { scope: "col", class: i === 5 ? "nb" : "", text: t }); }))]),
      el("tbody", {}, lignes)
    ])]) : el("p", { class: "vide", text: "Aucune facture pour l'instant." });
    return el("section", { class: "section", id: "s-factures" }, [
      el("div", { class: "entete" }, [el("h2", { text: "Factures" }), el("p", { class: "aside", text: "prochain numéro : " + numeroSuivant() })]),
      el("div", { class: "resume-factures" }, [
        el("div", {}, [el("span", { class: "etiquette", text: "À émettre" }), el("b", { text: argent(r.aEmettre) })]),
        el("div", { class: r.nbRetard ? "alerte" : "" }, [el("span", { class: "etiquette", text: "À encaisser" }), el("b", { text: argent(r.attente) }),
          r.nbRetard ? el("small", { text: "dont " + argent(r.retard) + " en retard (" + r.nbRetard + ")" }) : null]),
        el("div", {}, [el("span", { class: "etiquette", text: "Encaissé en " + new Date().getFullYear() }), el("b", { text: argent(r.paye) })])
      ]),
      tableau, ajout
    ]);
  }
  function formFacture(f, a) {
    var champ = function (type, v, label, extra) { return el("label", {}, [el("span", { text: label }), el("input", Object.assign({ type: type, value: v == null ? "" : v, "aria-label": label }, extra || {}))]); };
    var cNum = champ("text", f.numero, "N°"), cObj = champ("text", f.objet, "Objet"), cDest = champ("text", f.destinataire, "Destinataire");
    var bornes = { min: "2015-01-01", max: "2099-12-31" }; // évite une année tapée de travers (2926 au lieu de 2026)
    var cEm = champ("date", f.emise_le, "Émise le", bornes), cEch = champ("date", f.echeance, "Échéance", bornes), cPay = champ("date", f.payee_le, "Payée le", bornes);
    var cHt = champ("number", f.montant_ht, "Montant HT €", { step: "any" }), cTva = champ("number", f.tva, "TVA %", { step: "any" });
    var cNotes = el("textarea", { rows: "2", placeholder: "Notes (lien du PDF, mode de paiement…)", "aria-label": "Notes" }); cNotes.value = f.notes || "";
    var v = function (l) { return l.querySelector("input").value.trim(); };
    var form = el("form", { class: "fiche", onclick: function (ev) { ev.stopPropagation(); } }, [
      el("div", { class: "rangee champs" }, [cNum, cObj, cDest]),
      el("div", { class: "rangee champs" }, [cEm, cEch, cPay, cHt, cTva]),
      el("p", { class: "vide", text: (+f.tva ? "" : "TVA non applicable, art. 293 B du CGI. ") + "Montant TTC calculé à l'enregistrement." }),
      cNotes,
      el("div", { class: "rangee" }, [
        el("button", { type: "submit", class: "btn-plein", text: "Enregistrer" }),
        el("button", { type: "button", class: "btn-texte danger", text: "Supprimer la facture", onclick: function () {
          if (!confirm("Supprimer la facture " + (f.numero || "") + " ? Pour garder une numérotation continue, préférez le statut « Annulée ».")) return;
          S.factures = S.factures.filter(function (x) { return x.id !== f.id; });
          db.from("factures").delete().eq("id", f.id).then(verifier); dessiner();
        } })
      ])
    ]);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var ht = v(cHt) === "" ? null : +v(cHt), tva = v(cTva) === "" ? 0 : +v(cTva);
      majFacture(f, { numero: v(cNum) || null, objet: v(cObj) || f.objet, destinataire: v(cDest) || null, emise_le: v(cEm) || null, echeance: v(cEch) || null,
        payee_le: v(cPay) || null, montant_ht: ht, tva: tva, montant_ttc: ht == null ? null : Math.round(ht * (1 + tva / 100) * 100) / 100, notes: cNotes.value.trim() || null }, a);
      // La fiche se referme et la facture reprend sa place dans la liste, mise en évidence
      S.factureOuverte = null; S.vientDeBouger = f.id; dessiner();
      var ligneF = app.querySelector('.ligne-affaire[data-id="' + f.id + '"]');
      if (ligneF) { ligneF.scrollIntoView({ block: "center", behavior: mouvementReduit ? "auto" : "smooth" }); setTimeout(function () { S.vientDeBouger = null; }, 1600); }
      signaler("Facture " + (f.numero || "") + " enregistrée");
      signaler("Facture enregistrée");
    });
    return form;
  }

  // ---------- Rendez-vous : fenêtre de création / modification (écrit dans Google ou Outlook) ----------
  var dlgRdv = document.getElementById("rdv"), rdvCourant = null;
  function agendasEcriture() { return S.agendas.filter(function (g) { return g.actif && g.ecriture && g.compte_id; }); }
  function ouvrirRdv(e, jour) {
    rdvCourant = e || null;
    var $ = function (id) { return document.getElementById(id); };
    var ag = e ? S.agendas.filter(function (g) { return g.id === e.agenda_id; })[0] : null;
    var modifiable = e ? !!e.modifiable : agendasEcriture().length > 0;
    var d = e ? new Date(e.debut) : null, f = e ? new Date(e.fin) : null;
    if (!e) { // nouveau : prochaine demi-heure du jour choisi, une heure
      d = new Date(jour || S.jour); var n = new Date();
      if (jour && (jour.getHours() || jour.getMinutes())) { /* heure choisie d'un clic dans le calendrier */ }
      else if (memeJour(d, n)) d.setHours(n.getHours() + (n.getMinutes() >= 30 ? 1 : 0), n.getMinutes() >= 30 ? 0 : 30, 0, 0); else d.setHours(9, 0, 0, 0);
      f = new Date(d.getTime() + 3600000);
    }
    $("rdv-surtitre").textContent = e ? (modifiable ? "Modifier le rendez-vous" : "Rendez-vous (lecture seule)") : "Nouveau rendez-vous";
    $("rdv-titre").value = e ? e.titre || "" : "";
    $("rdv-jour").value = isoJour(d);
    $("rdv-journee").checked = e ? !!e.journee : false;
    $("rdv-debut").value = hm(d); $("rdv-fin").value = e && e.journee ? "" : hm(f);
    $("rdv-lieu").value = e ? e.lieu || "" : "";
    var selA = $("rdv-agenda"); selA.textContent = "";
    (e ? [ag || { id: "", nom: "Agenda inconnu" }] : agendasEcriture()).forEach(function (g) { selA.appendChild(el("option", { value: g.id, text: g.nom + (g.compte_id ? "" : " (iCal)") })); });
    if (!e) { var parProjet = agendasEcriture().filter(function (g) { return g.activite_id === S.route; })[0]; if (parProjet) selA.value = parProjet.id; }
    selA.disabled = !!e;
    var selP = $("rdv-projet"); selP.textContent = "";
    [el("option", { value: "", text: e ? "Automatique (" + nomActivite(e.activite_id) + ")" : "Automatique" })].concat(optionsActivites(e ? e.activite_forcee : S.route || null)).forEach(function (o) { selP.appendChild(o); });
    if (e && !e.activite_forcee) selP.value = "";
    ["rdv-titre", "rdv-jour", "rdv-debut", "rdv-fin", "rdv-journee", "rdv-lieu"].forEach(function (id) { $(id).disabled = !modifiable; });
    $("rdv-supprimer").hidden = !(e && modifiable);
    $("rdv-ok").disabled = !e && !modifiable;
    $("rdv-info").textContent = !e && !modifiable ? "Pour créer un rendez-vous, connectez d'abord un compte Google ou Outlook (page Agendas)."
      : e && !modifiable ? "Agenda en lecture seule (adresse iCal) : seul le projet se change ici. Connectez ce compte dans la page Agendas pour tout modifier."
      : e && e.serie ? "Rendez-vous récurrent : seule cette date est modifiée." : (ag ? "Agenda : " + ag.nom : "");
    majJournee();
    dlgRdv.showModal();
    if (modifiable) $("rdv-titre").focus();
  }
  function majJournee() {
    var j = document.getElementById("rdv-journee").checked;
    document.getElementById("rdv-debut").parentNode.hidden = j; document.getElementById("rdv-fin").parentNode.hidden = j;
  }
  document.getElementById("rdv-journee").addEventListener("change", majJournee);
  document.getElementById("rdv-annuler").addEventListener("click", function () { dlgRdv.close(); });
  document.getElementById("btn-rdv").addEventListener("click", function () { ouvrirRdv(null); });
  function ecrireRdv(corps, apres) {
    return db.functions.invoke("agenda-ecrire", { body: corps }).then(function (r) {
      var erreur = r.error ? (r.error.context && r.error.context.json ? null : r.error.message) : r.data && r.data.erreur;
      if (r.error && r.error.context && typeof r.error.context.json === "function") {
        return r.error.context.json().then(function (j) { throw new Error(j.erreur || r.error.message); });
      }
      if (erreur) throw new Error(erreur);
      return r.data;
    }).then(apres).catch(function (e) { signaler("Agenda non modifié : " + e.message); chargerTout().then(dessiner); });
  }
  document.getElementById("form-rdv").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var $ = function (id) { return document.getElementById(id); }, e = rdvCourant;
    var projet = $("rdv-projet").value || null;
    if (e && !e.modifiable) { // iCal : seul le projet change, côté cockpit
      e.activite_forcee = projet;
      db.from("evenements").update({ activite_forcee: projet }).eq("id", e.id).then(verifier);
      dlgRdv.close(); dessiner(); return;
    }
    var jour = lireJour($("rdv-jour").value), journee = $("rdv-journee").checked, debut, fin;
    if (journee) { debut = jour; fin = ajouterJours(jour, 1); }
    else {
      var h = function (v) { var p = (v || "00:00").split(":"); var x = new Date(jour); x.setHours(+p[0], +p[1], 0, 0); return x; };
      debut = h($("rdv-debut").value); fin = h($("rdv-fin").value);
      if (fin <= debut) { $("rdv-info").textContent = "La fin doit être après le début."; return; }
    }
    var corps = { action: e ? "modifier" : "creer", agenda_id: e ? e.agenda_id : $("rdv-agenda").value, evenement_id: e ? e.id : undefined,
      titre: $("rdv-titre").value.trim(), debut: debut.toISOString(), fin: fin.toISOString(), journee: journee, lieu: $("rdv-lieu").value.trim() || null, activite_forcee: projet };
    if (!corps.titre) return;
    // Affichage immédiat, puis confirmation par Google / Outlook.
    if (e) Object.assign(e, { titre: corps.titre, debut: corps.debut, fin: corps.fin, journee: journee, lieu: corps.lieu, activite_forcee: projet });
    else S.evenements.push({ id: "temp-" + Date.now(), agenda_id: corps.agenda_id, titre: corps.titre, debut: corps.debut, fin: corps.fin, journee: journee, lieu: corps.lieu, activite_forcee: projet, modifiable: true });
    S.evenements.sort(function (x, y) { return new Date(x.debut) - new Date(y.debut); });
    dlgRdv.close(); dessiner();
    ecrireRdv(corps, function () { signaler(e ? "Rendez-vous modifié dans votre agenda" : "Rendez-vous ajouté à votre agenda"); chargerTout().then(dessiner); });
  });
  // Un même rendez-vous peut exister dans plusieurs agendas (invitation copiée dans « Famille »…) : on supprime toutes les copies modifiables.
  document.getElementById("rdv-supprimer").addEventListener("click", function () {
    var e = rdvCourant;
    if (!e) return;
    var cle = function (x) { return (x.titre || "") + "|" + x.debut + "|" + x.fin; };
    var copies = (S.tousEvenements || [e]).filter(function (x) {
      var g = S.agendas.filter(function (a) { return a.id === x.agenda_id; })[0];
      return x.id === e.id || (cle(x) === cle(e) && x.modifiable && g && g.ecriture);
    });
    var noms = copies.map(function (x) { var g = S.agendas.filter(function (a) { return a.id === x.agenda_id; })[0]; return g ? g.nom : "agenda"; });
    if (!confirm("Supprimer « " + (e.titre || "ce rendez-vous") + " » " + (copies.length > 1 ? "de vos " + copies.length + " agendas (" + noms.join(", ") + ")" : "de votre agenda (" + noms[0] + ")") + " ?")) return;
    var ids = copies.map(function (x) { return x.id; });
    S.evenements = S.evenements.filter(function (x) { return ids.indexOf(x.id) < 0; });
    S.tousEvenements = (S.tousEvenements || []).filter(function (x) { return ids.indexOf(x.id) < 0; });
    dlgRdv.close(); dessiner();
    var restants = copies.length;
    copies.forEach(function (x) {
      ecrireRdv({ action: "supprimer", evenement_id: x.id }, function () {
        if (--restants === 0) signaler(copies.length > 1 ? "Rendez-vous supprimé de " + copies.length + " agendas" : "Rendez-vous supprimé de votre agenda");
      });
    });
  });

  // ---------- Page Agendas : comptes connectés et agendas suivis ----------
  function connecter(fournisseur, usage) {
    db.functions.invoke("agenda-connexion", { body: { fournisseur: fournisseur, usage: usage || "agenda" } }).then(function (r) {
      if (r.error && r.error.context && typeof r.error.context.json === "function") return r.error.context.json().then(function (j) { throw new Error(j.erreur || r.error.message); });
      if (r.error) throw r.error;
      if (r.data.erreur) throw new Error(r.data.erreur);
      location.href = r.data.url;
    }).catch(function (e) { signaler("Connexion impossible : " + e.message); });
  }
  function vueTaches() {
    var f = document.createDocumentFragment(), iso = isoJour(new Date());
    if (S.filtreTaches && !activite(S.filtreTaches)) S.filtreTaches = "";
    var filtre = S.filtreTaches || "", vue = lirePref("vue-taches", "tableau");
    var ts = S.taches.filter(function (t) { return !filtre || t.activite_id === filtre; });
    var ouvertes = ts.filter(function (t) { return t.statut !== "fait"; });
    var retard = ouvertes.filter(function (t) { return t.echeance && t.echeance < iso; }).length;
    var jour = ouvertes.filter(function (t) { return t.echeance === iso; }).length;
    f.appendChild(el("section", { class: "hero-projet", style: "--c:" + (filtre ? couleur(filtre) : "var(--encre-2)") }, [
      el("div", {}, [filtre ? iconeProjet(activite(filtre), true) : icone("taches", "grande"), el("p", { class: "surtitre", text: filtre ? nomActivite(filtre) : "Toutes les activités" }), el("h1", { text: "Tâches" }),
        el("p", { class: "chapo", text: ouvertes.length + " ouvertes · " + jour + " pour aujourd'hui" + (retard ? " · " + retard + " en retard" : "") + ". Glissez une carte d'une colonne à l'autre pour changer son statut." })])
    ]));
    var filtres = [{ id: "", nom: "Toutes", couleur: "var(--encre)" }].concat(S.activites).map(function (a) {
      var n = S.taches.filter(function (t) { return t.statut !== "fait" && (!a.id || t.activite_id === a.id); }).length;
      return el("button", { type: "button", class: "filtre", style: "--c:" + a.couleur, "aria-pressed": a.id === filtre ? "true" : "false", onclick: function () {
        if (a.id === filtre) return;
        S.filtreTaches = a.id; S.edition = null; avecTransition(dessiner, "jour");
      } }, [a.id ? iconeProjet(a) : null, nomCourt(a.nom), el("small", { text: String(n) })]);
    });
    f.appendChild(el("nav", { class: "barre-rubriques barre-vues", "aria-label": "Vues des tâches" }, [el("div", { class: "rubriques" }, [commutateurVue("vue-taches", vue), el("span", { class: "sep" })].concat(filtres))]));
    f.appendChild(el("section", { class: "section section-taches" }, [
      vue === "liste" ? listeNotion(ts, { projet: !filtre }) : tableauTaches(ts, { projet: !filtre, activite: filtre, choixProjet: !filtre })
    ]));
    return f;
  }
  // ---------- Page Tri des boîtes : ce que Victor range chaque matin, et les boîtes qu'il lit ----------
  var PERIODES_TRI = [{ id: "1", nom: "Aujourd'hui" }, { id: "7", nom: "7 jours" }, { id: "30", nom: "30 jours" }];
  function chargerTri() {
    var p = S.triPeriode || "1", cle = p + "|" + Math.floor(Date.now() / 60000);
    if (S.triCle === cle || S.triEnCours) return;
    S.triEnCours = true;
    var depuis = p === "1" ? debutJour(new Date()) : ajouterJours(debutJour(new Date()), -(+p - 1));
    db.rpc("tri_resume", { depuis: depuis.toISOString() }).then(function (r) {
      S.triEnCours = false; verifier(r); S.tri = r.data; S.triCle = cle;
      if (S.route === "mails" && !enSaisie()) dessiner();
    });
  }
  function sectionBoitesMail() {
    var boites = S.comptes.filter(function (c) { return c.usage === "mail"; });
    return el("section", { class: "section" }, [
      el("div", { class: "entete" }, [el("h2", { text: "Boîtes connectées" }),
        el("p", { class: "aside", text: "Chaque matin, Victor lit les boîtes connectées ici (et Harnes, IONOS), puis les range : un dossier par thème, mails marqués comme lus, importants étoilés, publicités à la corbeille (récupérables 30 jours). Il n'envoie jamais rien et n'efface rien définitivement." })]),
      el("div", { class: "liens-boutons rangee" }, [
        el("button", { type: "button", class: "btn-contour", text: "Connecter une boîte Gmail", onclick: function () { connecter("google", "mail"); } }),
        el("button", { type: "button", class: "btn-contour", text: "Connecter une boîte Outlook", onclick: function () { connecter("microsoft", "mail"); } })
      ]),
      el("ul", { class: "agenda" }, boites.length ? boites.map(function (c) {
        var trie = function (x) { return /gmail\.modify|Mail\.ReadWrite/i.test(x.droits || ""); };
        return el("li", { class: "compte" }, [
          el("span", { class: "fournisseur", text: c.fournisseur === "google" ? "G" : "O" }),
          el("div", {}, [el("b", { text: c.email }), el("span", { class: c.derniere_erreur || !trie(c) ? "retard" : "", text: c.derniere_erreur ? "Erreur : " + c.derniere_erreur : trie(c) ? "Mails · lus et rangés par Victor" : "Lecture seule : reconnectez la boîte pour autoriser le tri" })]),
          trie(c) ? null : el("button", { type: "button", class: "btn-contour petit", text: "Autoriser le tri", onclick: function () { connecter(c.fournisseur, "mail"); } }),
          // Outlook : l'envoi des réponses validées dans la page Réponses demande un droit de plus (Mail.Send)
          trie(c) && c.fournisseur === "microsoft" && !/Mail\.Send/i.test(c.droits || "") ? el("button", { type: "button", class: "btn-contour petit", text: "Autoriser l'envoi",
            title: "Pour envoyer depuis le cockpit les réponses que vous avez validées", onclick: function () { connecter("microsoft", "mail"); } }) : null,
          el("button", { type: "button", class: "btn-texte danger", text: "Déconnecter", onclick: function () {
            if (!confirm("Ne plus faire lire " + c.email + " par Victor ?")) return;
            db.from("comptes_agenda").delete().eq("id", c.id).then(verifier).then(function () { chargerTout().then(dessiner); });
          } })
        ]);
      }) : [el("li", { class: "vide", text: "Aucune boîte connectée : Camp (Gmail) et Evoa (Outlook) à connecter ici." })])
    ]);
  }
  // ---------- Réponses préparées par Victor (dictées depuis l'iPhone) : rien ne part sans validation ici ----------
  function agirReponse(x, action, texte, bouton) {
    if (action === "abandonner" && !confirm("Abandonner ce brouillon ? Il sera retiré de la boîte " + x.boite + ".")) return;
    if (bouton) bouton.disabled = true;
    db.functions.invoke("reponses", { body: { id: x.id, action: action, texte: texte } }).then(function (r) {
      if (r.error && r.error.context && typeof r.error.context.json === "function") return r.error.context.json().then(function (j) { throw new Error(j.erreur || r.error.message); });
      if (r.error) throw r.error;
      if (r.data && r.data.erreur) throw new Error(r.data.erreur);
      signaler(action === "envoyer" ? "Envoyé à " + x.destinataire : action === "modifier" ? "Brouillon enregistré" : "Brouillon abandonné");
      chargerTout().then(dessiner);
    }).catch(function (e) { if (bouton) bouton.disabled = false; signaler(e.message); chargerTout().then(dessiner); });
  }
  function carteReponse(x) {
    var quand = function (d) { return fmt(new Date(d), { weekday: "short", day: "numeric", month: "short" }) + " · " + hm(new Date(d)); };
    var zone = el("textarea", { class: "notes reponse-texte", rows: "8", "aria-label": "Texte de la réponse" });
    zone.value = x.texte;
    var compte = S.comptes.filter(function (c) { return c.usage === "mail" && c.email === x.boite; })[0];
    var outlook = x.fournisseur === "microsoft" && !(compte && /Mail\.Send/i.test(compte.droits || "")); // Outlook sans droit d'envoi
    var envoyer = el("button", { type: "button", class: "btn-plein", onclick: function () {
      if (!confirm("Envoyer cette réponse à " + x.destinataire + " depuis " + x.boite + " ?")) return;
      agirReponse(x, "envoyer", zone.value, envoyer);
    } }, ["Envoyer"]);
    var carte = el("article", { class: "reponse" + (S.rubrique === x.id ? " ouverte" : ""), id: "reponse-" + x.id }, [
      el("p", { class: "reponse-tete" }, [el("b", { text: x.destinataire || "" }), el("small", { text: "depuis " + x.boite + " · " + quand(x.cree_le) })]),
      el("p", { class: "reponse-objet", text: x.objet || "" }),
      el("details", { class: "reponse-origine" }, [el("summary", { text: "Mail reçu de " + (x.original_de || "") + (x.original_recu_le ? ", " + quand(x.original_recu_le) : "") }),
        el("p", { text: x.original_extrait || "" })]),
      el("p", { class: "aside", text: "Vous avez dicté : « " + x.consigne + " »" }),
      zone,
      outlook ? el("p", { class: "aside" }, ["Le cockpit n'a pas encore le droit d'envoyer depuis cette boîte Outlook : enregistrez ici si besoin, puis envoyez le brouillon depuis Outlook (dossier Brouillons), ou ",
        el("a", { href: "#agendas", text: "autorisez l'envoi" }), " (page Agendas, Boîtes connectées)."]) : null,
      x.erreur ? el("p", { class: "aside erreur", text: "Dernière erreur : " + x.erreur }) : null,
      el("div", { class: "reponse-actions" }, [
        outlook ? null : envoyer,
        el("button", { type: "button", class: "btn-contour", onclick: function (ev) { agirReponse(x, "modifier", zone.value, ev.currentTarget); } }, [outlook ? "Enregistrer dans Outlook" : "Enregistrer le brouillon"]),
        el("button", { type: "button", class: "btn-texte danger", onclick: function (ev) { agirReponse(x, "abandonner", null, ev.currentTarget); } }, ["Abandonner"])
      ])
    ]);
    return carte;
  }
  function vueReponses() {
    var f = document.createDocumentFragment(), toutes = S.reponses || [];
    var attente = toutes.filter(function (x) { return x.statut === "brouillon"; });
    var journal = toutes.filter(function (x) { return x.statut !== "brouillon"; });
    f.appendChild(el("section", { class: "hero-projet", style: "--c:var(--encre-2)" }, [
      el("div", {}, [icone("mails", "grande"), el("p", { class: "surtitre", text: "Victor" }), el("h1", { text: "Réponses" }),
        el("p", { class: "chapo", text: "Les réponses que vous dictez à Victor depuis l'iPhone. Un mail est déposé en brouillon dans le bon fil : rien ne part avant que vous le validiez ici. Un SMS ou un WhatsApp s'ouvre sur le téléphone, et vous l'envoyez vous-même." })])
    ]));
    f.appendChild(el("section", { class: "section" }, [
      el("div", { class: "entete" }, [el("h2", { text: "À valider" })]),
      attente.length ? el("div", { class: "reponses" }, attente.map(carteReponse))
        : el("p", { class: "vide", text: "Aucun brouillon en attente. Dites par exemple « Tâche pour Victor », puis « Réponds à Toynamics que je passe vendredi »." })
    ]));
    if (journal.length) f.appendChild(el("section", { class: "section" }, [
      el("div", { class: "entete" }, [el("h2", { text: "Journal" }), el("p", { class: "aside", text: "30 derniers jours" })]),
      el("ul", { class: "tri-liste" }, journal.map(function (x) {
        var etat = x.statut === "envoye" ? "envoyé le " + fmt(new Date(x.envoye_le), { day: "numeric", month: "short" }) + " · " + hm(new Date(x.envoye_le))
          : x.statut === "abandonne" ? "abandonné" : (x.canal === "sms" ? "SMS" : "WhatsApp") + " ouvert sur l'iPhone";
        return el("li", {}, [el("small", { text: [x.canal === "mail" ? "Mail" : x.canal === "sms" ? "SMS" : "WhatsApp", x.destinataire, etat].filter(Boolean).join(" · ") }),
          el("span", { text: x.texte })]);
      }))
    ]));
    if (S.rubrique) setTimeout(function () { var c = document.getElementById("reponse-" + S.rubrique); if (c) c.scrollIntoView({ block: "start" }); }, 0);
    return f;
  }
  function vueMails() {
    chargerTri();
    var f = document.createDocumentFragment(), t = S.tri, p = S.triPeriode || "1";
    var nb = function (n) { return (n || 0).toLocaleString("fr-FR"); };
    var jetes = t ? ((t.par_dossier || []).filter(function (x) { return x.dossier === "Corbeille"; })[0] || { n: 0 }).n : 0;
    f.appendChild(el("section", { class: "hero-projet", style: "--c:var(--encre-2)" }, [
      el("div", {}, [icone("mails", "grande"), el("p", { class: "surtitre", text: "Victor" }), el("h1", { text: "Tri des boîtes" }),
        el("p", { class: "chapo", text: "Chaque matin, après son point, Victor lit les mails arrivés dans vos boîtes et les range : un dossier par activité ou par thème, marqués comme lus. Il étoile les importants (drapeau dans Outlook) et met les publicités à la corbeille, où elles restent récupérables 30 jours." })]),
      t ? el("dl", { class: "hero-chiffres" }, [
        el("div", {}, [el("dt", { text: "Rangés" }), el("dd", { text: nb(t.total - jetes) }), el("small", { text: "dans un dossier" })]),
        el("div", {}, [el("dt", { text: "Importants" }), el("dd", { text: nb(t.importants_total) }), el("small", { text: "étoilés" })]),
        el("div", {}, [el("dt", { text: "Publicités" }), el("dd", { text: nb(jetes) }), el("small", { text: "à la corbeille" })])
      ]) : null
    ]));
    f.appendChild(el("nav", { class: "barre-rubriques barre-vues", "aria-label": "Période" }, [el("div", { class: "rubriques" }, PERIODES_TRI.map(function (x) {
      return el("button", { type: "button", class: "filtre", "aria-pressed": x.id === p ? "true" : "false", onclick: function () {
        if (x.id === p) return; S.triPeriode = x.id; S.triCle = null; chargerTri(); dessiner();
      } }, [x.nom]);
    }))]));
    if (!t) f.appendChild(el("section", { class: "section" }, [el("p", { class: "vide", text: "Chargement du bilan…" })]));
    else if (!t.total) f.appendChild(el("section", { class: "section" }, [el("p", { class: "vide", text: "Rien de rangé sur cette période. Victor passe chaque matin, juste après son point de 6 h 30." })]));
    else {
      f.appendChild(el("section", { class: "section" }, [
        el("div", { class: "entete" }, [el("h2", { text: "Par boîte" })]),
        el("div", { class: "tableau-defile", style: "--c:var(--encre)" }, [el("table", { class: "affaires tri-boites" }, [
          el("thead", {}, [el("tr", {}, ["Boîte", "Lus et rangés", "Importants", "Publicités jetées", "Dernier passage"].map(function (x) { return el("th", { scope: "col", text: x }); }))]),
          el("tbody", {}, (t.par_boite || []).map(function (b) {
            return el("tr", {}, [el("th", { scope: "row", text: b.boite }), el("td", { text: nb(b.n - b.jetes) }), el("td", { text: nb(b.importants) }),
              el("td", { text: nb(b.jetes) }), el("td", { class: "suite", text: fmt(new Date(b.dernier), { day: "numeric", month: "short" }) + " · " + hm(new Date(b.dernier)) })]);
          }))])])
      ]));
      f.appendChild(el("section", { class: "section" }, [
        el("div", { class: "entete" }, [el("h2", { text: "Par dossier" })]),
        el("ul", { class: "tri-dossiers" }, (t.par_dossier || []).filter(function (x) { return x.dossier !== "Corbeille"; }).map(function (x) {
          return el("li", {}, [el("span", { text: x.dossier }), el("b", { text: nb(x.n) })]);
        }))
      ]));
      f.appendChild(el("section", { class: "section" }, [
        el("div", { class: "entete" }, [el("h2", { text: "Importants" }), el("p", { class: "aside", text: "reçus ces deux dernières semaines ; ils sont étoilés dans leur dossier" })]),
        (t.importants || []).length ? el("ul", { class: "tri-liste" }, t.importants.map(function (m) {
          return el("li", {}, [el("small", { text: [m.boite, m.de, "rangé dans " + m.dossier, fmt(new Date(m.recu_le), { day: "numeric", month: "short" })].filter(Boolean).join(" · ") }),
            el("b", { text: m.objet || "(sans objet)" }), m.resume ? el("span", { text: m.resume }) : null]);
        })) : el("p", { class: "vide", text: "Aucun mail important récent sur cette période." })
      ]));
      if ((t.corbeille || []).length) f.appendChild(el("section", { class: "section" }, [
        el("div", { class: "entete" }, [el("h2", { text: "Publicités jetées" }), el("p", { class: "aside", text: "les plus récentes ; récupérables 30 jours dans la corbeille de chaque boîte" })]),
        el("details", { class: "tri-corbeille" }, [el("summary", { text: "Voir la liste (" + t.corbeille.length + ")" }),
          el("ul", { class: "tri-liste" }, t.corbeille.map(function (m) { return el("li", {}, [el("small", { text: [m.boite, m.de].filter(Boolean).join(" · ") }), el("span", { text: m.objet || "(sans objet)" })]); }))])
      ]));
    }
    if (S.message) f.appendChild(el("p", { class: "bandeau", role: "status", text: S.message }));
    f.appendChild(sectionBoitesMail());
    return f;
  }
  function vueAgendas() {
    var f = document.createDocumentFragment();
    f.appendChild(el("section", { class: "hero-projet", style: "--c:var(--encre-2)" }, [
      el("div", {}, [icone("agendas", "grande"), el("p", { class: "surtitre", text: "Réglages" }), el("h1", { text: "Agendas" }),
        el("p", { class: "chapo", text: "Connectez vos comptes Google et Outlook pour voir et modifier vos rendez-vous depuis le cockpit. Les changements partent aussitôt dans votre agenda, et ceux faits ailleurs remontent ici chaque minute." })]),
      el("div", { class: "liens-boutons" }, [
        el("button", { type: "button", class: "btn-plein", text: "Connecter un compte Google", onclick: function () { connecter("google"); } }),
        el("button", { type: "button", class: "btn-plein", text: "Connecter Outlook / Microsoft 365", onclick: function () { connecter("microsoft"); } })
      ])
    ]));
    if (S.message) f.appendChild(el("p", { class: "bandeau", role: "status", text: S.message }));
    f.appendChild(el("section", { class: "section" }, [
      el("div", { class: "entete" }, [el("h2", { text: "Comptes connectés" })]),
      el("ul", { class: "agenda" }, S.comptes.filter(function (c) { return c.usage !== "mail"; }).length ? S.comptes.filter(function (c) { return c.usage !== "mail"; }).map(function (c) {
        return el("li", { class: "compte" }, [
          el("span", { class: "fournisseur", text: c.fournisseur === "google" ? "G" : "O" }),
          el("div", {}, [el("b", { text: c.email }), el("span", { class: c.derniere_erreur ? "retard" : "", text: c.derniere_erreur ? "Erreur : " + c.derniere_erreur : (c.fournisseur === "google" ? "Google Agenda" : "Outlook / Microsoft 365") + " · lecture et écriture" })]),
          el("button", { type: "button", class: "btn-texte danger", text: "Déconnecter", onclick: function () {
            if (!confirm("Déconnecter " + c.email + " ? Ses rendez-vous disparaîtront du cockpit (rien n'est supprimé dans votre agenda).")) return;
            db.from("comptes_agenda").delete().eq("id", c.id).then(verifier).then(function () { chargerTout().then(dessiner); });
          } })
        ]);
      }) : [el("li", { class: "vide", text: "Aucun compte connecté pour l'instant." })])
    ]));
    var lignes = S.agendas.map(function (g) {
      var compte = S.comptes.filter(function (c) { return c.id === g.compte_id; })[0];
      var projet = el("select", { "aria-label": "Projet par défaut de " + g.nom, onchange: function (ev) {
        g.activite_id = ev.target.value || null; db.from("agendas").update({ activite_id: g.activite_id }).eq("id", g.id).then(verifier).then(function () { signaler("Projet par défaut enregistré : prochaine synchro dans une minute"); });
      } }, [el("option", { value: "", text: "Selon les mots-clés" })].concat(optionsActivites(g.activite_id)));
      if (!g.activite_id) projet.value = "";
      var actif = el("input", { type: "checkbox", class: "coche", checked: g.actif, "aria-label": "Suivre " + g.nom, onchange: function (ev) {
        g.actif = ev.target.checked; db.from("agendas").update({ actif: g.actif }).eq("id", g.id).then(verifier); dessiner();
      } });
      return el("tr", {}, [
        el("td", {}, [actif]),
        el("th", { scope: "row", text: g.nom }),
        el("td", { text: compte ? compte.email : "Adresse iCal" }),
        el("td", {}, [el("span", { class: "puce" + (g.ecriture && g.compte_id ? " gagne" : ""), text: g.ecriture && g.compte_id ? "Modifiable" : "Lecture seule" })]),
        el("td", {}, [projet]),
        el("td", { class: g.derniere_erreur ? "retard" : "suite", text: g.derniere_erreur ? "Erreur : " + g.derniere_erreur : g.derniere_synchro ? (g.nb_evenements || 0) + " RDV · " + hm(new Date(g.derniere_synchro)) : g.actif ? "en attente" : "non suivi" })
      ]);
    });
    f.appendChild(el("section", { class: "section" }, [
      el("div", { class: "entete" }, [el("h2", { text: "Agendas suivis" }), el("p", { class: "aside", text: "cochez ceux à afficher ; le projet par défaut range les rendez-vous sans mot-clé" })]),
      lignes.length ? el("div", { class: "tableau-defile", style: "--c:var(--encre)" }, [el("table", { class: "affaires" }, [
        el("thead", {}, [el("tr", {}, ["", "Agenda", "Compte", "Droits", "Projet par défaut", "Dernière lecture"].map(function (t) { return el("th", { scope: "col", text: t }); }))]),
        el("tbody", {}, lignes)])]) : el("p", { class: "vide", text: "Aucun agenda : connectez un compte ci-dessus." })
    ]));
    return f;
  }

  // ---------- Fluidité : transitions entre pages, apparition au défilement, rubriques suivies ----------
  var mouvementReduit = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function avecTransition(maj, type) {
    // Premier affichage (après le squelette) : pas de transition, le navigateur n'a encore rien peint à capturer.
    if (mouvementReduit || !document.startViewTransition || !S.dejaDessine) { S.dejaDessine = true; maj(); return; }
    document.documentElement.dataset.transition = type || "page";
    var t = document.startViewTransition(maj);
    t.updateCallbackDone.catch(function () {});
    t.ready.catch(function () {}); // transition annulée (onglet caché, autre transition en cours) : la page est quand même dessinée
    t.finished.catch(function () {}).then(function () { delete document.documentElement.dataset.transition; });
  }
  // Les blocs hors de l'écran apparaissent en douceur quand on descend ; ceux déjà visibles arrivent avec la transition de page.
  function revelerAuDefilement() {
    if (mouvementReduit || !window.IntersectionObserver) return;
    if (S.revelation) S.revelation.disconnect();
    var obs = S.revelation = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("revele"); obs.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -6% 0px" });
    var rang = 0;
    app.querySelectorAll(".section, .panneau, .carte-projet, .chiffre-grand, .bas-bloc").forEach(function (c) {
      if (c.getBoundingClientRect().top < window.innerHeight) return;
      c.classList.add("a-reveler"); c.style.setProperty("--d", (rang++ % 4) * 60 + "ms"); obs.observe(c);
    });
  }
  function suivreRubriques() {
    if (S.espion) S.espion.disconnect();
    var barre = app.querySelector(".barre-rubriques");
    if (!barre || !window.IntersectionObserver) return;
    var boutons = barre.querySelectorAll("button[data-cible]");
    S.espion = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (en) {
        if (en.isIntersecting) boutons.forEach(function (b) { b.classList.toggle("actif", b.dataset.cible === en.target.id); });
      });
    }, { rootMargin: "-35% 0px -60% 0px" });
    boutons.forEach(function (b) { var sec = document.getElementById(b.dataset.cible); if (sec) S.espion.observe(sec); });
  }
  function mesurerNav() { document.documentElement.style.setProperty("--haut-nav", document.getElementById("barre-haut").offsetHeight + "px"); }
  window.addEventListener("resize", mesurerNav);

  // ---------- Rendu ----------
  // Position des zones qui défilent dans la page (colonne « À faire », tableau des tâches…), retrouvées après redessin
  // par leur première classe et leur rang parmi les zones de même classe.
  function cleDefilement(e) {
    if (e.id) return "#" + e.id;
    var c = e.classList[0]; if (!c) return null;
    return "." + c + "|" + Array.prototype.indexOf.call(app.getElementsByClassName(c), e);
  }
  function memoriserDefilements() {
    var m = [];
    app.querySelectorAll("*").forEach(function (e) {
      if (e.scrollTop > 0 || e.scrollLeft > 0) { var k = cleDefilement(e); if (k) m.push([k, e.scrollTop, e.scrollLeft]); }
    });
    return m;
  }
  function restaurerDefilements(m) {
    m.forEach(function (x) {
      var k = x[0], e;
      if (k[0] === "#") e = document.getElementById(k.slice(1));
      else { var p = k.slice(1).split("|"); e = app.getElementsByClassName(p[0])[+p[1]]; }
      if (e && app.contains(e)) { e.scrollTop = x[1]; e.scrollLeft = x[2]; }
    });
  }
  function dessiner() {
    if (!db) return;
    var a = activite(S.route);
    if (S.route && !a && S.route !== "agendas" && S.route !== "taches" && S.route !== "mails" && S.route !== "recherche" && S.route !== "reponses") S.route = "";
    // Un redessin (temps réel, relecture toutes les 5 min) ne doit pas faire remonter les listes qui défilent.
    var cote = document.querySelector(".cote"), coteScroll = cote ? cote.scrollTop : 0, defilements = memoriserDefilements();
    dessinerNav();
    dessinerSynchro();
    var y = window.scrollY, defileAvant = document.getElementById("cal-defile");
    S.calScroll = defileAvant ? defileAvant.scrollTop : null;
    app.textContent = "";
    app.appendChild(a ? vueProjet(a) : S.route === "agendas" ? vueAgendas() : S.route === "mails" ? vueMails() : S.route === "recherche" ? vueRecherche() : S.route === "reponses" ? vueReponses() : S.route === "taches" ? vueTaches() : vueAccueil());
    document.body.style.setProperty("--projet", a ? a.couleur : "var(--encre)");
    var chA = a && CHARTES[a.id];
    app.dataset.projet = a ? a.id : "";
    app.style.setProperty("--marque", a ? a.couleur : "var(--encre)");
    app.style.setProperty("--bouton-marque", chA && chA.bouton || (a ? a.couleur : "var(--encre)"));
    window.scrollTo({ top: y, behavior: "instant" });
    restaurerDefilements(defilements);
    if (cote) cote.scrollTop = coteScroll;
    var defile = document.getElementById("cal-defile"), ligne = document.getElementById("cal-maintenant");
    if (defile && S.calCale !== isoJour(S.jour) + S.route) {
      S.calCale = isoJour(S.jour) + S.route;
      defile.scrollTop = ligne ? Math.max(0, ligne.offsetTop - defile.clientHeight / 3) : (9 - (+defile.firstChild.dataset.h0)) * H_HEURE;
    } else if (defile && S.calScroll != null) defile.scrollTop = S.calScroll;
    // Sur petit écran, la frise défile : on la cale pour que l'heure actuelle soit visible.
    app.querySelectorAll(".frise-defile").forEach(function (d) {
      var c = d.querySelector(".curseur");
      if (c && d.scrollWidth > d.clientWidth) d.scrollLeft = Math.max(0, c.offsetLeft - d.clientWidth / 3);
    });
    var rubT = a && rubriquesDe(a).filter(function (x) { return x.id === S.rubrique; })[0];
    document.title = (a ? (rubT ? rubT.nom + " · " : "") + a.nom : S.route === "agendas" ? "Agendas" : S.route === "mails" ? "Tri des boîtes" : S.route === "recherche" ? "Rechercher un mail" : S.route === "reponses" ? "Réponses" : S.route === "taches" ? "Tâches" : "Aujourd'hui") + " · Cockpit";
    var hh = document.getElementById("horloge-haut"), mt = new Date(); hh.textContent = fmt(mt, { weekday: "long", day: "numeric", month: "long" }) + " · " + hm(mt);
    mesurerNav(); suivreRubriques();
  }
  function router() {
    var h = decodeURIComponent(location.hash.replace(/^#/, "")), m = h.match(/^([^?]*)\?message=(.*)$/);
    S.route = m ? m[1] : h; S.message = m ? m[2] : "";
    // Pages de projet : #palomano (présentation) ou #palomano/taches, #palomano/factures…
    var morceaux = S.route.split("/"); S.route = morceaux[0]; S.rubrique = morceaux[1] || "";
    if (m) history.replaceState(null, "", "#" + m[1]);
    S.edition = null; S.voirFaites = false;
    if (!activite(S.route)) { S.ouvert = null; S.factureOuverte = null; }
    avecTransition(function () {
      dessiner(); window.scrollTo({ top: 0, behavior: "instant" });
      var cible = (S.factureOuverte && document.getElementById("s-factures")) || (S.ouvert && document.querySelector(".client.ouvert, .ligne-affaire.ouverte"));
      if (cible) cible.scrollIntoView({ block: "center" });
      revelerAuDefilement();
    });
  }
  function dessinerSynchro() {
    var etat = document.getElementById("etat-synchro"), bouton = document.getElementById("btn-synchro");
    var dates = S.agendas.filter(function (g) { return g.actif && g.derniere_synchro; }).map(function (g) { return new Date(g.derniere_synchro); });
    var erreurs = S.agendas.filter(function (g) { return g.actif && g.derniere_erreur; });
    var plusAncien = dates.length ? new Date(Math.min.apply(null, dates)) : null;
    var frais = plusAncien && Date.now() - plusAncien < 15 * 60000;
    bouton.className = "direct" + (erreurs.length || !S.agendas.length ? " alerte" : frais ? "" : " ancien");
    etat.textContent = !S.agendas.length ? "Aucun agenda" : erreurs.length ? erreurs.length + " agenda(s) en erreur" : plusAncien ? "En direct · " + duree(Date.now() - plusAncien) : "Jamais synchronisé";
    bouton.title = "Cliquer pour relire tous les agendas maintenant\n" + S.agendas.map(function (g) {
      return g.nom + " : " + (g.derniere_erreur ? "erreur (" + g.derniere_erreur + ")" : g.derniere_synchro ? (g.nb_evenements || 0) + " rendez-vous, lu à " + hm(new Date(g.derniere_synchro)) : "jamais lu");
    }).join("\n");
  }

  // Horloge, phrase du moment et curseur de la frise : toutes les 20 s, sans redessiner la page.
  function tic() {
    if (!db || barre.hidden) return;
    var n = new Date();
    var h = document.getElementById("grande-heure"); if (h) h.textContent = hm(n);
    document.getElementById("horloge-haut").textContent = fmt(n, { weekday: "long", day: "numeric", month: "long" }) + " · " + hm(n);
    if (!enSaisie()) { var p = document.getElementById("phrase"); if (p) p.replaceWith(phraseDuMoment()); }
    if (!enSaisie()) { var bm = document.getElementById("bloc-maintenant"); if (bm) bm.replaceWith(blocMaintenant()); }
    var cm = document.getElementById("cal-maintenant");
    if (cm) { cm.style.top = (hDec(n) - +cm.parentNode.dataset.h0) * H_HEURE + "px"; cm.firstChild.textContent = hm(n); }
    var c = document.getElementById("curseur");
    if (c) {
      var h0 = +c.dataset.h0, h1 = +c.dataset.h1;
      c.style.left = ((hDec(n) - h0) / (h1 - h0) * 100) + "%"; c.firstChild.textContent = hm(n);
      document.querySelectorAll("#frise .rdv").forEach(function (b) { b.classList.toggle("passe", false); });
    }
    dessinerSynchro();
  }
  var dernierJour = isoJour(new Date()), derniereMinute = -1;
  setInterval(function () {
    tic();
    var n = new Date(), j = isoJour(n);
    if (j !== dernierJour && db) { if (isoJour(S.jour) === dernierJour) S.jour = debutJour(n); dernierJour = j; chargerTout().then(dessiner); return; }
    // Toutes les 5 minutes : on redessine pour faire passer les rendez-vous terminés en grisé.
    if (n.getMinutes() % 5 === 0 && n.getMinutes() !== derniereMinute && db && !enSaisie()) { derniereMinute = n.getMinutes(); dessiner(); }
  }, 20000);

  function synchroniser() {
    var b = document.getElementById("btn-synchro"), etat = document.getElementById("etat-synchro");
    b.disabled = true; etat.textContent = "Lecture des agendas…";
    db.functions.invoke("sync-agendas").then(function (r) {
      if (r.error) throw r.error;
      var nb = (r.data.bilan || []).reduce(function (s, x) { return s + (x.evenements || 0); }, 0);
      var err = (r.data.bilan || []).filter(function (x) { return x.erreur; });
      signaler(err.length ? err.length + " agenda(s) en erreur : " + err.map(function (x) { return x.agenda; }).join(", ") : nb + " rendez-vous à jour");
      return chargerTout().then(dessiner);
    }).catch(function (e) { signaler("Synchronisation impossible : " + e.message); dessinerSynchro(); })
      .then(function () { b.disabled = false; });
  }

  // ---------- Saisie rapide et raccourcis ----------
  var dialogue = document.getElementById("ajout-rapide");
  function ouvrirAjout() {
    var sel = document.getElementById("ajout-activite");
    sel.textContent = "";
    optionsActivites(S.route || (S.activites[0] && S.activites[0].id)).forEach(function (o) { sel.appendChild(o); });
    document.getElementById("ajout-echeance").value = isoJour(S.route ? new Date() : S.jour);
    document.getElementById("ajout-titre").value = "";
    dialogue.showModal();
    document.getElementById("ajout-titre").focus();
  }
  document.getElementById("form-ajout").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = document.getElementById("ajout-titre").value.trim();
    if (!t) return;
    creerTache({ titre: t, activite_id: document.getElementById("ajout-activite").value,
      echeance: document.getElementById("ajout-echeance").value || null, priorite: document.getElementById("ajout-priorite").value });
    dialogue.close();
  });
  document.getElementById("ajout-annuler").addEventListener("click", function () { dialogue.close(); });
  document.getElementById("btn-ajout").addEventListener("click", ouvrirAjout);
  document.getElementById("btn-ajout-mobile").addEventListener("click", ouvrirAjout);
  document.getElementById("btn-synchro").addEventListener("click", synchroniser);
  document.addEventListener("keydown", function (ev) {
    if (!db || barre.hidden || dialogue.open || dlgRdv.open || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
      if (ev.key === "Escape") { t.blur(); if (S.edition) { S.edition = null; dessiner(); } }
      return;
    }
    if (ev.key === "/") { ev.preventDefault(); victorChamp.focus(); return; }
    if (/^[0-9]$/.test(ev.key)) {
      var i = +ev.key, cible = i === 0 ? "" : S.activites[i - 1] && S.activites[i - 1].id;
      if (cible != null) { location.hash = cible; ev.preventDefault(); }
    } else if (ev.key === "n" || ev.key === "N") { ev.preventDefault(); ouvrirAjout(); }
    else if (ev.key === "r" || ev.key === "R") { ev.preventDefault(); ouvrirRdv(null); }
    else if (!S.route && ev.key === "ArrowLeft") changerJour(ajouterJours(S.jour, -1));
    else if (!S.route && ev.key === "ArrowRight") changerJour(ajouterJours(S.jour, 1));
    else if (ev.key === "Escape" && activite(S.route) && S.rubrique) location.hash = S.route;
    else if (activite(S.route) && S.rubrique && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
      var rs = rubriquesDe(activite(S.route)), k = rs.findIndex(function (x) { return x.id === S.rubrique; }) + (ev.key === "ArrowRight" ? 1 : -1);
      if (rs[k]) location.hash = S.route + "/" + rs[k].id;
    }
    else if (ev.key === "b" || ev.key === "B") location.hash = "taches";
    else if (ev.key === "f" || ev.key === "F") { ev.preventDefault(); location.hash = "recherche"; }
    else if (ev.key === "t" || ev.key === "T") { location.hash = ""; changerJour(new Date()); }
  });

  // ---------- Connexion et temps réel ----------
  var ecranConnexion = document.getElementById("connexion");
  var formConnexion = document.getElementById("form-connexion");
  var message = document.getElementById("message-connexion");
  var canal = null, attenteSaisie = false;

  function afficherConnexion(texte) {
    barre.hidden = true; app.hidden = true; ecranConnexion.hidden = false;
    message.textContent = texte || "";
    if (canal) { db.removeChannel(canal); canal = null; }
  }
  var afficheDepuisCache = false;
  function ouvrirCockpit() {
    ecranConnexion.hidden = true; barre.hidden = false; app.hidden = false;
    if (afficheDepuisCache) { chargerTout().then(function () { if (!enSaisie()) dessiner(); abonner(); }); return; }
    app.textContent = "";
    app.appendChild(el("div", { class: "squelette", "aria-label": "Chargement", role: "status" }, [
      el("i", { class: "s-titre" }), el("div", { class: "s-grille" }, [el("i", { class: "s-bloc grand" }), el("div", { class: "s-pile" }, [el("i", { class: "s-bloc" }), el("i", { class: "s-bloc" }), el("i", { class: "s-bloc" })])])
    ]));
    chargerTout().then(function () {
      router();
      abonner();
    }).catch(function (e) {
      app.textContent = ""; app.appendChild(el("p", { class: "chargement erreur", text: "Impossible de charger le cockpit : " + e.message }));
    });
  }
  function abonner() {
      if (!canal) {
        canal = db.channel("cockpit");
        ["evenements", "taches", "clients", "suivis", "activites", "factures", "briefings", "propositions", "recommandations", "production", "reponses"].forEach(function (table) {
          canal.on("postgres_changes", { event: "*", schema: "public", table: table }, function () {
            if (enSaisie() || dialogue.open || dlgRdv.open || S.glisse) { attenteSaisie = true; return; }
            rechargerPuisDessiner();
          });
        });
        canal.subscribe();
      }
  }
  // Une modification arrivée pendant une saisie est appliquée dès que le champ est quitté.
  function appliquerAttente() {
    setTimeout(function () { if (attenteSaisie && !enSaisie() && !dialogue.open) { attenteSaisie = false; rechargerPuisDessiner(); } }, 300);
  }
  document.addEventListener("focusout", appliquerAttente);
  document.addEventListener("submit", function () { setTimeout(appliquerAttente, 400); }, true); // fiche enregistrée et refermée
  document.addEventListener("click", function () { setTimeout(appliquerAttente, 400); }); // fiche annulée
  // Filet de sécurité si le temps réel se coupe (veille de l'ordinateur) : relecture toutes les 5 min et au retour sur l'onglet.
  setInterval(function () { if (db && !barre.hidden && !enSaisie()) rechargerPuisDessiner(); }, 300000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && db && !barre.hidden && !enSaisie()) rechargerPuisDessiner(); });

  formConnexion.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var b = formConnexion.querySelector("button[type=submit]");
    b.disabled = true; message.textContent = "Connexion…";
    db.auth.signInWithPassword({ email: document.getElementById("email").value.trim(), password: document.getElementById("mot-de-passe").value })
      .then(function (r) {
        if (r.error) { message.textContent = "E-mail ou mot de passe incorrect."; return; }
        document.getElementById("mot-de-passe").value = ""; message.textContent = "";
      }).then(function () { b.disabled = false; });
  });
  document.getElementById("oubli").addEventListener("click", function () {
    var email = document.getElementById("email").value.trim();
    if (!email) { message.textContent = "Saisis d'abord ton e-mail."; return; }
    db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(function (r) {
      message.textContent = r.error ? r.error.message : "Un e-mail de réinitialisation vient d'être envoyé.";
    });
  });
  document.getElementById("deconnexion").addEventListener("click", function () { try { localStorage.removeItem(CLE_CACHE); } catch (e) { /* rien */ } afficheDepuisCache = false; db.auth.signOut(); });

  if (!CFG.url || !CFG.cle || !window.supabase) {
    ecranConnexion.hidden = false;
    message.textContent = "Cockpit pas encore relié à Supabase (assets/config.js).";
    formConnexion.querySelector("button[type=submit]").disabled = true;
    return;
  }
  db = window.supabase.createClient(CFG.url, CFG.cle, { auth: { persistSession: true, autoRefreshToken: true } });
  window.addEventListener("hashchange", function () { if (!barre.hidden) router(); });
  (function () {
    var sessionLocale = false;
    try { sessionLocale = Object.keys(localStorage).some(function (k) { return /^sb-.*-auth-token$/.test(k); }); } catch (e) { /* stockage indisponible */ }
    var d = sessionLocale && donneesMemorisees();
    if (!d) return;
    try {
      appliquerDonnees(d);
      ecranConnexion.hidden = true; barre.hidden = false; app.hidden = false;
      afficheDepuisCache = true; router();
    } catch (e) { afficheDepuisCache = false; }
  })();
  db.auth.onAuthStateChange(function (evenement, session) {
    // Sortir du rappel avant de relire la base (sinon supabase-js peut se bloquer sur son verrou de session).
    setTimeout(function () {
      if (evenement === "PASSWORD_RECOVERY") {
        var nouveau = prompt("Nouveau mot de passe (10 caractères minimum) :");
        if (nouveau) db.auth.updateUser({ password: nouveau }).then(function (r) { signaler(r.error ? r.error.message : "Mot de passe changé"); });
      }
      if (session && (barre.hidden || (afficheDepuisCache && !canal))) ouvrirCockpit();
      if (!session) afficherConnexion(evenement === "SIGNED_OUT" ? "À bientôt." : "");
    }, 0);
  });
})();
