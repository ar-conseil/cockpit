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
  function enSaisie() {
    var a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT") && app.contains(a);
  }
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
      db.from("comptes_agenda").select("id, fournisseur, email, derniere_erreur, cree_le").order("cree_le")
    ]).then(function (r) {
      r.forEach(verifier);
      S.activites = r[0].data; S.agendas = r[1].data;
      // Un même rendez-vous présent dans deux agendas (invitation partagée) n'apparaît qu'une fois ;
      // on garde la copie modifiable, puis celle d'un agenda sans projet imposé.
      var vus = {};
      S.evenements = r[2].data.filter(function (e) { return !e.annule; })
        .sort(function (x, y) {
          var imposeX = (S.agendas.filter(function (g) { return g.id === x.agenda_id; })[0] || {}).activite_id ? 1 : 0;
          var imposeY = (S.agendas.filter(function (g) { return g.id === y.agenda_id; })[0] || {}).activite_id ? 1 : 0;
          return ((x.activite_forcee ? 0 : 1) - (y.activite_forcee ? 0 : 1)) || (imposeX - imposeY) || (y.modifiable - x.modifiable);
        })
        .filter(function (e) { var k = (e.titre || "") + "|" + e.debut + "|" + e.fin; if (vus[k]) return false; vus[k] = true; return true; })
        .sort(function (x, y) { return new Date(x.debut) - new Date(y.debut); });
      S.taches = r[3].data; S.clients = r[4].data; S.suivis = r[5].data; S.semaine = r[6].data; S.factures = r[7].data; S.comptes = r[8].data;
    });
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
    "berkay": { police: 'Arial, "Helvetica Neue", var(--sans)', style: "italique", couverture: "linear-gradient(115deg, #123208, #2a5a1c)" },
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
    agendas: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>'
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
      lienCote("#agendas", S.route === "agendas", [icone("agendas"), el("span", { text: "Agendas" })])
    ]));
    navProjets.appendChild(el("div", { class: "cote-groupe" }, [el("p", { class: "cote-titre", text: "Projets" })].concat(S.activites.map(function (a, i) {
      var n = S.taches.filter(function (t) { return t.activite_id === a.id && t.statut !== "fait"; }).length;
      return lienCote("#" + a.id, a.id === S.route, [iconeProjet(a), el("span", { text: a.nom })], n, String(i + 1));
    }))));
    // Fil d'Ariane de la barre du haut
    var fil = document.getElementById("fil"), a = activite(S.route);
    fil.textContent = "";
    fil.append(el("a", { href: "#", text: "Cockpit" }), el("span", { class: "fil-sep", text: "/" }),
      a ? el("span", { class: "fil-page" }, [iconeProjet(a), a.nom]) : el("span", { class: "fil-page", text: S.route === "taches" ? "Tâches" : S.route === "agendas" ? "Agendas" : "Aujourd'hui" }));
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
        reste > 0 ? el("a", { class: "retards-lien", href: "#" + a.id, text: "et " + reste + " autre" + (reste > 1 ? "s" : "") + " →" }) : null,
        champAjout(a.id, new Date(iso), "+ Tâche pour aujourd'hui")
      ]),
      rel.length ? el("div", { class: "bloc" }, [
        el("p", { class: "etiquette", text: "À relancer" }),
        el("ul", { class: "relances" }, rel.slice(0, 4).map(function (c) {
          return el("li", {}, [el("a", { href: "#" + a.id, onclick: function () { S.ouvert = c.id; } }, [el("b", { text: c.nom }), el("span", { text: c.prochaine_action || quand(lireJour(c.prochaine_action_le)) })])]);
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
        return el("li", { style: "--c:" + couleur(c.activite_id) }, [el("a", { href: "#" + c.activite_id, onclick: function () { S.ouvert = c.id; } }, [
          el("i"), el("b", { text: c.nom }), el("span", { text: (c.prochaine_action || "Relancer") }), el("em", { class: j < 0 ? "retard" : "", text: quand(lireJour(c.prochaine_action_le)) })])]);
      }))]));
    if (facts.length) parties.push(el("div", { class: "groupe" }, [
      el("p", { class: "groupe-titre" }, [el("span", { class: "pastille-compte retard", text: String(facts.length) }), "Factures en retard"]),
      el("ul", { class: "relances" }, facts.map(function (fa) {
        return el("li", { style: "--c:" + couleur(fa.activite_id) }, [el("a", { href: "#" + fa.activite_id, onclick: function () { S.factureOuverte = fa.id; } }, [
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
    var onglets = [["s-taches", "Tâches"], avecClients ? ["s-clients", r.titre_clients || "Clients"] : null, r.factures ? ["s-factures", "Factures"] : null,
      kpisProjet(a).length ? ["s-chiffres", "Chiffres"] : null, ["s-notes", "Notes"]].filter(Boolean);
    return el("nav", { class: "barre-rubriques", style: "--c:" + a.couleur, "aria-label": "Rubriques du projet" }, [el("div", { class: "rubriques" }, [
      el("span", { class: "rubriques-nom" }, [el("i"), a.nom])
    ].concat(onglets.map(function (o) {
      return el("button", { type: "button", "data-cible": o[0], text: o[1], onclick: function () {
        var c = document.getElementById(o[0]); if (c) c.scrollIntoView({ behavior: mouvementReduit ? "auto" : "smooth", block: "start" });
      } });
    })))]);
  }
  function vueProjet(a) {
    var f = document.createDocumentFragment(), n = new Date(), iso = isoJour(n);
    var ouvertes = trierTaches(S.taches.filter(function (t) { return t.activite_id === a.id && t.statut !== "fait"; }));
    var rdv = prochainRdv(a.id);
    var ch = CHARTES[a.id] || {};
    f.appendChild(el("div", { class: "couverture", style: "--couverture:" + couvertureDe(a), "aria-hidden": "true" }));
    f.appendChild(el("section", { class: "hero-projet avec-couverture" + (ch.style ? " titre-" + ch.style : ""), style: "--c:" + a.couleur + (ch.police ? ";--police-marque:" + ch.police : "") }, [
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
        reglages(a).factures ? (function () {
          var rf = resumeFactures(facturesDe(a));
          return el("div", {}, [el("dt", { text: "À encaisser" }), el("dd", { class: "petit", text: fmtN.format(Math.round(rf.attente)) + " €" }),
            el("small", { class: rf.nbRetard ? "retard" : "", text: rf.nbRetard ? rf.nbRetard + " facture(s) en retard" : rf.aEmettre ? fmtN.format(Math.round(rf.aEmettre)) + " € à émettre" : "à jour" })]);
        })() : null
      ]),
      (a.liens || []).length ? boutonsLiens(a.liens) : null
    ]));

    f.appendChild(ongletsProjet(a));

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
    if (vueT === "tableau") {
      f.appendChild(el("section", { class: "section", id: "s-taches" }, [enteteTaches, tableauTaches(tachesProjet, { activite: a.id })]));
      f.appendChild(sectionFrise);
      f.appendChild(el("section", { class: "section" }, [blocAgenda]));
    } else {
      f.appendChild(el("section", { class: "section deux", id: "s-taches" }, [
        el("div", {}, [enteteTaches, listeNotion(tachesProjet, {}), champAjout(a.id, null, "+ Ajouter une tâche (sans date)")]),
        blocAgenda
      ]));
      f.appendChild(sectionFrise);
    }

    if (reglages(a).champs || (a.etapes || []).length || S.clients.some(function (c) { return c.activite_id === a.id; })) f.appendChild(sectionClients(a));
    if (reglages(a).factures) f.appendChild(sectionFactures(a));

    var kpis = kpisProjet(a);
    if (kpis.length) {
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
    f.appendChild(el("section", { class: "section", id: "s-notes" }, [el("div", { class: "entete" }, [el("h2", { text: "Notes" })]), notes]));
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
        var ix = etapes.indexOf(x.etape), iy = etapes.indexOf(y.etape);
        if (ix !== iy) return iy - ix;
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
      return el("td", { class: ch.type === "euros" ? "nb" : "", text: ch.type === "euros" ? argent(+v) : (v || "–") });
    };
    var nbCol = 4 + visibles.length + (r.total ? 1 : 0);
    var corps = [];
    clients.forEach(function (c) {
      var ouvert = S.ouvert === c.id;
      corps.push(el("tr", { class: "ligne-affaire" + (ouvert ? " ouverte" : "") + (estAbandonne(c) ? " abandon" : ""), onclick: function () { S.ouvert = ouvert ? null : c.id; dessiner(); } }, [
        el("th", { scope: "row" }, [el("button", { type: "button", "aria-expanded": ouvert ? "true" : "false", text: c.nom })]),
        el("td", {}, [el("span", { class: "puce" + ((r.etapes_gagnees || []).indexOf(c.etape) >= 0 ? " gagne" : ""), text: c.etape || "—" })])
      ].concat(visibles.filter(function (ch) { return ch.type !== "euros"; }).map(function (ch) { return cellule(ch, c); }),
        [el("td", { class: "nb", text: argent(+c.montant) })],
        visibles.filter(function (ch) { return ch.type === "euros"; }).map(function (ch) { return cellule(ch, c); }),
        r.total ? [el("td", { class: "nb total", text: argent(totalClient(a, c)) })] : [],
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
      .concat(visibles.filter(function (ch) { return ch.type !== "euros"; }).map(function () { return el("td"); }),
        [el("td", { class: "nb", text: argent(somme(function (c) { return c.montant; })) })],
        visibles.filter(function (ch) { return ch.type === "euros"; }).map(function (ch) { return el("td", { class: "nb", text: argent(somme(function (c) { return valeurChamp(c, ch.cle); })) }); }),
        r.total ? [el("td", { class: "nb total", text: argent(somme(function (c) { return totalClient(a, c); })) })] : [], [el("td")]));
    var tete = el("tr", {}, [el("th", { scope: "col", text: "Client" }), el("th", { scope: "col", text: "Étape" })]
      .concat(visibles.filter(function (ch) { return ch.type !== "euros"; }).map(function (ch) { return el("th", { scope: "col", text: ch.label }); }),
        [el("th", { scope: "col", class: "nb", text: r.libelle_montant || "Montant" })],
        visibles.filter(function (ch) { return ch.type === "euros"; }).map(function (ch) { return el("th", { scope: "col", class: "nb", text: ch.label }); }),
        r.total ? [el("th", { scope: "col", class: "nb", text: r.total.label })] : [], [el("th", { scope: "col", text: r.libelle_relance || "Relance" })]));
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
    if (!ouvert) return el("li", { class: "client" }, [tete]);
    return el("li", { class: "client ouvert" }, [tete, ficheClient(c, etapes, a)]);
  }

  function ficheClient(c, etapes, a) {
    var r = reglages(a);
    var etape = el("select", { "aria-label": "Étape" }, [el("option", { value: "", text: "Étape" })].concat(etapes.map(function (e) { return el("option", { value: e, selected: e === c.etape, text: e }); })));
    var type = el("select", { "aria-label": "Type" }, ["prospect", "client", "partenaire", "fournisseur", "autre"].map(function (t) { return el("option", { value: t, selected: t === c.type, text: t }); }));
    var montant = el("input", { type: "number", step: "any", value: c.montant == null ? "" : c.montant, placeholder: (r.libelle_montant || "Montant") + " €", "aria-label": r.libelle_montant || "Montant" });
    var champs = (r.champs || []).map(function (ch) {
      var v = (c.donnees || {})[ch.cle];
      var aide = ch.taux ? " (vide = " + fmtN.format(ch.taux * 100) + " % du prix)" : "";
      return { ch: ch, input: el("input", { type: ch.type === "euros" ? "number" : ch.type === "date" ? "date" : "text", step: "any", value: v == null ? "" : v, placeholder: ch.label + (ch.type === "euros" ? " €" : "") + aide, "aria-label": ch.label, title: ch.label + aide }) };
    });
    var contact = el("input", { type: "text", value: c.contact || "", placeholder: "Contact (nom, téléphone, e-mail)", "aria-label": "Contact" });
    var action = el("input", { type: "text", value: c.prochaine_action || "", placeholder: "Prochaine action", "aria-label": "Prochaine action" });
    var actionLe = el("input", { type: "date", value: c.prochaine_action_le || "", "aria-label": "Date de la prochaine action" });
    var notes = el("textarea", { rows: "3", placeholder: "Notes", "aria-label": "Notes" }); notes.value = c.notes || "";
    var fiche = el("form", { class: "fiche" }, [
      el("div", { class: "rangee" }, [etape, r.champs ? null : type, montant]),
      champs.length ? el("div", { class: "rangee champs" }, champs.map(function (x) { return el("label", {}, [el("span", { text: x.ch.label }), x.input]); })) : null,
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
      champs.forEach(function (x) {
        var v = x.input.value.trim();
        // Commission laissée vide : calculée avec le taux du projet si le prix est connu.
        if (v === "" && x.ch.taux && prix) v = String(Math.round(prix * x.ch.taux));
        if (v === "") delete donnees[x.ch.cle]; else donnees[x.ch.cle] = x.ch.type === "euros" ? +v : v;
      });
      var maj = { etape: etape.value || null, type: type.value, montant: prix, contact: contact.value.trim() || null, donnees: donnees,
        prochaine_action: action.value.trim() || null, prochaine_action_le: actionLe.value || null, notes: notes.value.trim() || null };
      Object.assign(c, maj);
      db.from("clients").update(maj).eq("id", c.id).then(verifier).then(function () { signaler("Fiche enregistrée"); });
      dessiner();
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
    return el("div", { class: "client-corps", onclick: function (ev) { ev.stopPropagation(); } }, [fiche, el("div", { class: "historique" }, [el("p", { class: "etiquette", text: "Historique" }), formS, journal])]);
  }

  // ---------- Factures (projets avec reglages.factures : Berkay, Wealthy, Evoa) ----------
  var STATUTS_FACTURE = { "a-emettre": "À émettre", "emise": "Émise", "payee": "Payée", "annulee": "Annulée" };
  function facturesDe(a) { return S.factures.filter(function (f) { return f.activite_id === a.id; }); }
  function factureEnRetard(f) { return f.statut === "emise" && f.echeance && f.echeance < isoJour(new Date()); }
  function ttc(f) { return f.montant_ttc != null ? +f.montant_ttc : (+f.montant_ht || 0) * (1 + (+f.tva || 0) / 100); }
  function resumeFactures(liste) {
    var r = { aEmettre: 0, attente: 0, retard: 0, nbRetard: 0, paye: 0 }, annee = String(new Date().getFullYear());
    liste.forEach(function (f) {
      if (f.statut === "a-emettre") r.aEmettre += ttc(f);
      if (f.statut === "emise") { r.attente += ttc(f); if (factureEnRetard(f)) { r.retard += ttc(f); r.nbRetard++; } }
      if (f.statut === "payee" && (f.payee_le || f.emise_le || "").slice(0, 4) === annee) r.paye += ttc(f);
    });
    return r;
  }
  // L'entreprise individuelle numérote ses factures en une seule suite continue, tous clients confondus.
  function numeroSuivant() {
    var max = 0, largeur = 3;
    S.factures.forEach(function (f) { var m = String(f.numero || "").match(/(\d+)\s*$/); if (m) { max = Math.max(max, +m[1]); largeur = Math.max(largeur, m[1].length); } });
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
      lignes.push(el("tr", { class: "ligne-affaire" + (ouverte ? " ouverte" : "") + (f.statut === "annulee" ? " abandon" : ""), onclick: function () { S.factureOuverte = ouverte ? null : f.id; dessiner(); } }, [
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
    var cEm = champ("date", f.emise_le, "Émise le"), cEch = champ("date", f.echeance, "Échéance"), cPay = champ("date", f.payee_le, "Payée le");
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
  document.getElementById("rdv-supprimer").addEventListener("click", function () {
    var e = rdvCourant;
    if (!e || !confirm("Supprimer « " + (e.titre || "ce rendez-vous") + " » de votre agenda ?")) return;
    S.evenements = S.evenements.filter(function (x) { return x.id !== e.id; });
    dlgRdv.close(); dessiner();
    ecrireRdv({ action: "supprimer", evenement_id: e.id }, function () { signaler("Rendez-vous supprimé de votre agenda"); });
  });

  // ---------- Page Agendas : comptes connectés et agendas suivis ----------
  function connecter(fournisseur) {
    db.functions.invoke("agenda-connexion", { body: { fournisseur: fournisseur } }).then(function (r) {
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
      el("ul", { class: "agenda" }, S.comptes.length ? S.comptes.map(function (c) {
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
  function dessiner() {
    if (!db) return;
    var a = activite(S.route);
    if (S.route && !a && S.route !== "agendas" && S.route !== "taches") S.route = "";
    dessinerNav();
    dessinerSynchro();
    var y = window.scrollY, defileAvant = document.getElementById("cal-defile");
    S.calScroll = defileAvant ? defileAvant.scrollTop : null;
    var tabAvant = app.querySelector(".tableau-taches"), tabScroll = tabAvant ? tabAvant.scrollLeft : 0;
    app.textContent = "";
    app.appendChild(a ? vueProjet(a) : S.route === "agendas" ? vueAgendas() : S.route === "taches" ? vueTaches() : vueAccueil());
    document.body.style.setProperty("--projet", a ? a.couleur : "var(--encre)");
    var chA = a && CHARTES[a.id];
    app.dataset.projet = a ? a.id : "";
    app.style.setProperty("--marque", a ? a.couleur : "var(--encre)");
    app.style.setProperty("--bouton-marque", chA && chA.bouton || (a ? a.couleur : "var(--encre)"));
    window.scrollTo({ top: y, behavior: "instant" });
    var tabApres = app.querySelector(".tableau-taches"); if (tabApres && tabScroll) tabApres.scrollLeft = tabScroll;
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
    document.title = (a ? a.nom : S.route === "agendas" ? "Agendas" : S.route === "taches" ? "Tâches" : "Aujourd'hui") + " · Cockpit";
    var hh = document.getElementById("horloge-haut"), mt = new Date(); hh.textContent = fmt(mt, { weekday: "long", day: "numeric", month: "long" }) + " · " + hm(mt);
    mesurerNav(); suivreRubriques();
  }
  function router() {
    var h = decodeURIComponent(location.hash.replace(/^#/, "")), m = h.match(/^([^?]*)\?message=(.*)$/);
    S.route = m ? m[1] : h; S.message = m ? m[2] : "";
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
    if (/^[0-9]$/.test(ev.key)) {
      var i = +ev.key, cible = i === 0 ? "" : S.activites[i - 1] && S.activites[i - 1].id;
      if (cible != null) { location.hash = cible; ev.preventDefault(); }
    } else if (ev.key === "n" || ev.key === "N") { ev.preventDefault(); ouvrirAjout(); }
    else if (ev.key === "r" || ev.key === "R") { ev.preventDefault(); ouvrirRdv(null); }
    else if (!S.route && ev.key === "ArrowLeft") changerJour(ajouterJours(S.jour, -1));
    else if (!S.route && ev.key === "ArrowRight") changerJour(ajouterJours(S.jour, 1));
    else if (ev.key === "b" || ev.key === "B") location.hash = "taches";
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
  function ouvrirCockpit() {
    ecranConnexion.hidden = true; barre.hidden = false; app.hidden = false;
    app.textContent = "";
    app.appendChild(el("div", { class: "squelette", "aria-label": "Chargement", role: "status" }, [
      el("i", { class: "s-titre" }), el("div", { class: "s-grille" }, [el("i", { class: "s-bloc grand" }), el("div", { class: "s-pile" }, [el("i", { class: "s-bloc" }), el("i", { class: "s-bloc" }), el("i", { class: "s-bloc" })])])
    ]));
    chargerTout().then(function () {
      router();
      if (!canal) {
        canal = db.channel("cockpit");
        ["evenements", "taches", "clients", "suivis", "activites", "factures"].forEach(function (table) {
          canal.on("postgres_changes", { event: "*", schema: "public", table: table }, function () {
            if (enSaisie() || dialogue.open || dlgRdv.open || S.glisse) { attenteSaisie = true; return; }
            rechargerPuisDessiner();
          });
        });
        canal.subscribe();
      }
    }).catch(function (e) {
      app.textContent = ""; app.appendChild(el("p", { class: "chargement erreur", text: "Impossible de charger le cockpit : " + e.message }));
    });
  }
  // Une modification arrivée pendant une saisie est appliquée dès que le champ est quitté.
  document.addEventListener("focusout", function () {
    setTimeout(function () { if (attenteSaisie && !enSaisie() && !dialogue.open) { attenteSaisie = false; rechargerPuisDessiner(); } }, 300);
  });
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
  document.getElementById("deconnexion").addEventListener("click", function () { db.auth.signOut(); });

  if (!CFG.url || !CFG.cle || !window.supabase) {
    ecranConnexion.hidden = false;
    message.textContent = "Cockpit pas encore relié à Supabase (assets/config.js).";
    formConnexion.querySelector("button[type=submit]").disabled = true;
    return;
  }
  db = window.supabase.createClient(CFG.url, CFG.cle, { auth: { persistSession: true, autoRefreshToken: true } });
  window.addEventListener("hashchange", function () { if (!barre.hidden) router(); });
  db.auth.onAuthStateChange(function (evenement, session) {
    // Sortir du rappel avant de relire la base (sinon supabase-js peut se bloquer sur son verrou de session).
    setTimeout(function () {
      if (evenement === "PASSWORD_RECOVERY") {
        var nouveau = prompt("Nouveau mot de passe (10 caractères minimum) :");
        if (nouveau) db.auth.updateUser({ password: nouveau }).then(function (r) { signaler(r.error ? r.error.message : "Mot de passe changé"); });
      }
      if (session && barre.hidden) ouvrirCockpit();
      if (!session) afficherConnexion(evenement === "SIGNED_OUT" ? "À bientôt." : "");
    }, 0);
  });
})();
