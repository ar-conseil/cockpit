/* Cockpit AR Conseil : déchiffre data/coffre.json avec l'identifiant et le mot de passe,
   puis dessine la vue d'ensemble (#) et une page par activité (#palomano, ...). Aucune dépendance.
   Chiffrement : PBKDF2-SHA256 -> AES-GCM 256 (même format que outils/coffre.mjs). */
(function () {
  "use strict";

  var COFFRE = "data/coffre.json";
  var CLE_STOCKAGE = "cockpit-cle";

  var app = document.getElementById("app");
  var tabs = document.getElementById("tabs");
  var aujourdhui = debutJour(new Date());
  var activites = [];
  var coffre = null;

  document.getElementById("today").textContent = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date());

  // ---------- Utilitaires ----------
  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "style") n.setAttribute("style", attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (enfants || []).forEach(function (e) {
      if (e == null) return;
      n.appendChild(typeof e === "string" ? document.createTextNode(e) : e);
    });
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function debutJour(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function lireDate(s) {
    if (!s) return null;
    var p = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!p) return null;
    return new Date(+p[1], +p[2] - 1, +p[3], +(p[4] || 0), +(p[5] || 0));
  }
  function joursEntre(d) { return Math.round((debutJour(d) - aujourdhui) / 86400000); }
  var fmtNombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  function nombre(v, unite) {
    if (v == null || v === "") return "—";
    if (typeof v !== "number") return String(v);
    return fmtNombre.format(v) + (unite ? (unite === "%" ? " %" : " " + unite) : "");
  }
  function compact(v) {
    if (Math.abs(v) >= 10000) return fmtNombre.format(Math.round(v / 100) / 10) + " k";
    return fmtNombre.format(v);
  }
  function quandTexte(d, avecHeure) {
    var j = joursEntre(d);
    var base = j === 0 ? "aujourd'hui" : j === 1 ? "demain" : j === -1 ? "hier"
      : j < 0 ? "en retard de " + (-j) + " j"
      : j < 7 ? new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(d)
      : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(d);
    if (avecHeure && (d.getHours() || d.getMinutes())) {
      base += " · " + String(d.getHours()).padStart(2, "0") + "h" + String(d.getMinutes()).padStart(2, "0");
    }
    return base;
  }
  var LIBELLE_STATUT = { "a-faire": "À faire", "en-cours": "En cours", "fait": "Fait", "bloque": "Bloqué" };
  var POIDS_PRIO = { haute: 0, moyenne: 1, basse: 2 };

  // ---------- Briques d'affichage ----------
  function titreSection(texte, aside) {
    return el("h2", { class: "section-titre" }, [texte, aside ? el("small", { text: aside }) : null]);
  }

  function tuileKpi(k, couleur) {
    var pied = [];
    if (typeof k.valeur === "number" && typeof k.precedent === "number" && k.precedent !== 0) {
      var ecart = (k.valeur - k.precedent) / Math.abs(k.precedent) * 100;
      pied.push(el("span", { class: "delta " + (ecart >= 0 ? "hausse" : "baisse"),
        text: (ecart >= 0 ? "▲ +" : "▼ ") + fmtNombre.format(Math.round(ecart)) + " %" }));
      pied.push(el("span", { text: "vs " + nombre(k.precedent, k.unite) }));
    }
    if (k.detail) pied.push(el("span", { text: k.detail }));
    var jauge = null;
    if (typeof k.objectif === "number" && k.objectif > 0 && typeof k.valeur === "number") {
      var pct = Math.max(0, Math.min(100, k.valeur / k.objectif * 100));
      pied.push(el("span", { text: "objectif " + nombre(k.objectif, k.unite) + " (" + Math.round(pct) + " %)" }));
      jauge = el("div", { class: "jauge", role: "img", "aria-label": Math.round(pct) + " % de l'objectif" },
        [el("i", { style: "width:" + pct + "%" })]);
    }
    var valeur = el("div", { class: "kpi-valeur" }, [
      typeof k.valeur === "number" ? fmtNombre.format(k.valeur) : String(k.valeur == null ? "—" : k.valeur),
      k.unite ? el("small", { text: k.unite }) : null
    ]);
    return el("div", { class: "kpi" + (k.alerte ? " alerte" : ""), style: "--c:" + couleur }, [
      el("div", { class: "kpi-label", text: k.label }), valeur, jauge,
      pied.length ? el("div", { class: "kpi-pied" }, pied) : null
    ]);
  }

  function sparkline(points, couleur) {
    var s = svg("svg", { viewBox: "0 0 200 44", preserveAspectRatio: "none", "aria-hidden": "true" });
    if (!points || points.length < 2) return s;
    var vals = points.map(function (p) { return +p.valeur || 0; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var xy = vals.map(function (v, i) {
      return [i / (vals.length - 1) * 196 + 2, 40 - (v - min) / span * 34];
    });
    var d = xy.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    s.appendChild(svg("path", { d: d + " L198 44 L2 44 Z", fill: couleur, "fill-opacity": "0.12" }));
    s.appendChild(svg("path", { d: d, fill: "none", stroke: couleur, "stroke-width": "2", "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }));
    var fin = xy[xy.length - 1];
    s.appendChild(svg("circle", { cx: fin[0], cy: fin[1], r: "3", fill: couleur }));
    return s;
  }

  function graphiqueBarres(serie, couleur) {
    var bloc = el("div", { class: "graphique", style: "--c:" + couleur });
    var pts = (serie && serie.points) || [];
    if (!pts.length) { bloc.appendChild(el("p", { class: "statut", text: "Pas encore de données." })); return bloc; }
    var etroit = window.innerWidth < 600;
    var W = etroit ? 360 : 640, H = etroit ? 220 : 240, m = { h: 24, b: 28, g: 8, d: 8 };
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": serie.titre || "Graphique" });
    var max = Math.max.apply(null, pts.map(function (p) { return +p.valeur || 0; })) || 1;
    var pas = Math.pow(10, Math.floor(Math.log10(max)));
    var haut = Math.ceil(max / pas) * pas;
    if (haut / pas < 3) { pas /= 2; }
    var y = function (v) { return H - m.b - v / haut * (H - m.h - m.b); };
    for (var t = 0; t <= haut + 1e-9; t += pas) {
      s.appendChild(svg("line", { class: "grille", x1: m.g, x2: W - m.d, y1: y(t), y2: y(t) }));
    }
    var larg = (W - m.g - m.d) / pts.length;
    var bulle = el("div", { class: "bulle", hidden: "" });
    pts.forEach(function (p, i) {
      var v = +p.valeur || 0, x = m.g + i * larg, bw = Math.min(56, larg * 0.6);
      var dernier = i === pts.length - 1;
      var r = svg("rect", { x: x + (larg - bw) / 2, y: y(v), width: bw, height: Math.max(0, y(0) - y(v)), rx: 2,
        fill: couleur, "fill-opacity": dernier ? "1" : "0.45" });
      var lab = svg("text", { x: x + larg / 2, y: H - 8, "text-anchor": "middle" }); lab.textContent = p.label;
      var val = svg("text", { x: x + larg / 2, y: y(v) - 7, "text-anchor": "middle", class: dernier ? "val" : "" });
      val.textContent = compact(v);
      var zone = svg("rect", { x: x, y: m.h, width: larg, height: H - m.h - m.b, fill: "transparent" });
      zone.addEventListener("pointerenter", function () {
        r.setAttribute("fill-opacity", "1");
        bulle.textContent = p.label + " : " + nombre(v, serie.unite);
        var box = s.getBoundingClientRect(), k = box.width / W;
        var left = (x + larg / 2) * k + 16;
        left = Math.max(70, Math.min(bloc.clientWidth - 70, left));
        bulle.style.left = left + "px"; bulle.style.top = (y(v) * k + 16) + "px";
        bulle.hidden = false;
      });
      zone.addEventListener("pointerleave", function () { r.setAttribute("fill-opacity", dernier ? "1" : "0.45"); bulle.hidden = true; });
      s.appendChild(r); s.appendChild(lab); s.appendChild(val); s.appendChild(zone);
    });
    bloc.appendChild(s); bloc.appendChild(bulle);
    return bloc;
  }

  function listeTaches(taches, avecActivite) {
    var ul = el("ul", { class: "liste" });
    if (!taches.length) { ul.appendChild(el("li", { class: "vide", text: "Rien d'urgent. Bien joué." })); return ul; }
    taches.forEach(function (t) {
      var d = lireDate(t.echeance), j = d ? joursEntre(d) : null;
      var cls = "quand" + (j != null && j < 0 ? " retard" : j != null && j <= 2 ? " bientot" : "");
      var sous = [];
      if (avecActivite) sous.push(t._activite.nom);
      sous.push(LIBELLE_STATUT[t.statut] || t.statut || "À faire");
      ul.appendChild(el("li", {}, [
        el("span", { class: "prio " + (t.priorite || "moyenne"), title: "Priorité " + (t.priorite || "moyenne") }),
        el("span", { class: "titre" }, [t.titre, el("small", { text: sous.join(" · ") })]),
        el("span", { class: cls, text: d ? quandTexte(d) : "sans date" })
      ]));
    });
    return ul;
  }

  function listeAgenda(evts, avecActivite) {
    var ul = el("ul", { class: "liste" });
    if (!evts.length) { ul.appendChild(el("li", { class: "vide", text: "Aucun rendez-vous prévu." })); return ul; }
    evts.forEach(function (e) {
      var d = e._date;
      ul.appendChild(el("li", {}, [
        el("span", { class: "date-bloc" }, [
          el("b", { text: String(d.getDate()) }),
          el("span", { text: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(d).replace(".", "") })
        ]),
        el("span", { class: "titre" }, [e.titre, avecActivite ? el("small", { text: e._activite.nom }) : null]),
        el("span", { class: "quand", text: quandTexte(d, true) })
      ]));
    });
    return ul;
  }

  // ---------- Données dérivées ----------
  function tachesOuvertes(a) {
    return (a.taches || []).filter(function (t) { return t.statut !== "fait"; })
      .map(function (t) { return Object.assign({ _activite: a }, t); });
  }
  function trierTaches(ts) {
    return ts.sort(function (x, y) {
      var dx = lireDate(x.echeance), dy = lireDate(y.echeance);
      if (dx && dy && +dx !== +dy) return dx - dy;
      if (!dx !== !dy) return dx ? -1 : 1;
      return (POIDS_PRIO[x.priorite] || 1) - (POIDS_PRIO[y.priorite] || 1);
    });
  }
  function evenements(a, jours) {
    return (a.agenda || []).map(function (e) { return Object.assign({ _activite: a, _date: lireDate(e.date) }, e); })
      .filter(function (e) { var j = e._date && joursEntre(e._date); return e._date && j >= 0 && (jours == null || j <= jours); });
  }

  // ---------- Vues ----------
  function vueEnsemble() {
    var frag = document.createDocumentFragment();

    var urgentes = trierTaches([].concat.apply([], activites.map(tachesOuvertes)).filter(function (t) {
      var d = lireDate(t.echeance);
      return t.priorite === "haute" || (d && joursEntre(d) <= 7);
    }));
    var agenda = [].concat.apply([], activites.map(function (a) { return evenements(a, 14); }))
      .sort(function (x, y) { return x._date - y._date; });

    var cartes = el("div", { class: "cartes" });
    activites.forEach(function (a) {
      var kpis = (a.kpis || []).slice(0, 3).map(function (k) {
        return el("div", { class: "ligne-kpi" }, [
          el("span", { text: k.label }),
          el("strong", { class: k.alerte ? "alerte" : "", text: nombre(k.valeur, k.unite) })
        ]);
      });
      var nbTaches = tachesOuvertes(a).length, nbRetard = tachesOuvertes(a).filter(function (t) {
        var d = lireDate(t.echeance); return d && joursEntre(d) < 0;
      }).length;
      cartes.appendChild(el("a", { class: "carte", href: "#" + a.id, style: "--c:" + a.couleur }, [
        el("div", { class: "carte-titre" }, [el("span", { class: "pastille" }), a.nom, el("span", { class: "fleche", text: "→" })]),
        el("div", { class: "carte-kpis" }, kpis),
        a.serie ? sparkline(a.serie.points, a.couleur) : null,
        el("div", { class: "carte-pied" }, [
          el("span", { class: "badge", text: nbTaches + " tâche" + (nbTaches > 1 ? "s" : "") + " ouverte" + (nbTaches > 1 ? "s" : "") }),
          nbRetard ? el("span", { class: "badge exemple", text: nbRetard + " en retard" }) : null,
          a.exemple ? el("span", { class: "badge exemple", text: "exemple" }) : null
        ])
      ]));
    });

    frag.appendChild(el("section", { class: "section" }, [titreSection("Mes activités", activites.length + " dashboards"), cartes]));
    frag.appendChild(el("div", { class: "deux-colonnes" }, [
      el("section", { class: "section" }, [titreSection("À traiter en priorité", "priorité haute ou échéance sous 7 jours"), listeTaches(urgentes, true)]),
      el("section", { class: "section" }, [titreSection("Agenda", "14 prochains jours"), listeAgenda(agenda, true)])
    ]));
    return frag;
  }

  function vueActivite(a) {
    var frag = document.createDocumentFragment();
    var maj = lireDate(a.miseAJour);
    frag.appendChild(el("div", { class: "entete-activite", style: "--c:" + a.couleur }, [
      el("div", {}, [
        el("h1", {}, [el("span", { class: "pastille" }), a.nom]),
        a.description ? el("p", { text: a.description }) : null
      ]),
      el("div", { class: "meta" }, [
        a.exemple ? el("span", { class: "badge exemple", text: "Données d'exemple" }) : null,
        maj ? el("span", { class: "badge", text: "Mis à jour le " + new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(maj) }) : null,
        (a.sources || []).length ? el("span", { class: "badge", text: "Sources : " + a.sources.join(", ") }) : null
      ])
    ]));

    var kpis = el("div", { class: "kpis" });
    (a.kpis || []).forEach(function (k) { kpis.appendChild(tuileKpi(k, a.couleur)); });
    frag.appendChild(el("section", { class: "section" }, [titreSection("Indicateurs"), kpis]));

    var colGauche = el("section", { class: "section" }, [titreSection(a.serie ? a.serie.titre : "Évolution"), graphiqueBarres(a.serie, a.couleur)]);
    var colDroite = null;
    if (a.pipeline && a.pipeline.length) {
      var maxP = Math.max.apply(null, a.pipeline.map(function (p) { return p.nombre || 0; })) || 1;
      var pipe = el("div", { class: "pipeline", style: "--c:" + a.couleur });
      a.pipeline.forEach(function (p) {
        pipe.appendChild(el("div", { class: "etape" }, [
          el("span", { text: p.etape }),
          el("div", { class: "barre" }, [el("i", { style: "width:" + (p.nombre / maxP * 100) + "%" })]),
          el("strong", { text: String(p.nombre) })
        ]));
      });
      colDroite = el("section", { class: "section" }, [titreSection("Pipeline"), pipe]);
    } else {
      colDroite = el("section", { class: "section" }, [titreSection("Agenda"), listeAgenda(evenements(a).sort(function (x, y) { return x._date - y._date; }))]);
    }
    frag.appendChild(el("div", { class: "deux-colonnes" }, [colGauche, colDroite]));

    var bas = [el("section", { class: "section" }, [titreSection("Tâches", tachesOuvertes(a).length + " ouvertes"), listeTaches(trierTaches(tachesOuvertes(a)))])];
    if (a.pipeline && a.pipeline.length) {
      bas.push(el("section", { class: "section" }, [titreSection("Agenda"), listeAgenda(evenements(a).sort(function (x, y) { return x._date - y._date; }))]));
    } else {
      var extra = [];
      if ((a.liens || []).length) extra.push(titreSection("Raccourcis"), lienBloc(a));
      if (a.notes) extra.push(titreSection("Notes"), el("p", { class: "notes", text: a.notes }));
      if (extra.length) bas.push(el("section", { class: "section" }, extra));
    }
    frag.appendChild(el("div", { class: "deux-colonnes" }, bas));

    if (a.pipeline && a.pipeline.length && ((a.liens || []).length || a.notes)) {
      var fin = [];
      if ((a.liens || []).length) fin.push(el("section", { class: "section" }, [titreSection("Raccourcis"), lienBloc(a)]));
      if (a.notes) fin.push(el("section", { class: "section" }, [titreSection("Notes"), el("p", { class: "notes", text: a.notes })]));
      frag.appendChild(el("div", { class: "deux-colonnes" }, fin));
    }
    return frag;
  }
  function lienBloc(a) {
    var d = el("div", { class: "liens" });
    a.liens.forEach(function (l) { d.appendChild(el("a", { class: "bouton", href: l.url, target: "_blank", rel: "noopener", text: l.label + " ↗" })); });
    return d;
  }

  // ---------- Navigation ----------
  function dessinerOnglets(courant) {
    tabs.textContent = "";
    var tout = [{ id: "", nom: "Vue d'ensemble", couleur: "var(--or)" }].concat(activites);
    tout.forEach(function (a) {
      var t = el("a", { class: "tab", href: "#" + a.id, style: "--c:" + a.couleur }, [el("span", { class: "pastille" }), a.nom]);
      if (a.id === courant) t.setAttribute("aria-current", "page");
      tabs.appendChild(t);
    });
  }
  function router() {
    var id = decodeURIComponent(location.hash.replace(/^#/, ""));
    var a = activites.filter(function (x) { return x.id === id; })[0];
    if (!a) id = "";
    dessinerOnglets(id);
    app.textContent = "";
    app.appendChild(a ? vueActivite(a) : vueEnsemble());
    document.title = (a ? a.nom + " · " : "") + "Cockpit AR Conseil";
    var actif = tabs.querySelector('[aria-current="page"]');
    if (actif && actif.scrollIntoView) actif.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---------- Coffre chiffré et connexion ----------
  function deb64(t) { var b = atob(t), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64(buf) { var u = new Uint8Array(buf), t = ""; for (var i = 0; i < u.length; i++) t += String.fromCharCode(u[i]); return btoa(t); }
  function lireStockage() {
    try { return sessionStorage.getItem(CLE_STOCKAGE) || localStorage.getItem(CLE_STOCKAGE); } catch (e) { return null; }
  }
  function ecrireStockage(valeur, durable) {
    try {
      sessionStorage.removeItem(CLE_STOCKAGE); localStorage.removeItem(CLE_STOCKAGE);
      if (valeur) (durable ? localStorage : sessionStorage).setItem(CLE_STOCKAGE, valeur);
    } catch (e) { /* navigation privée : on redemandera le mot de passe */ }
  }
  function deriverCle(identifiant, motDePasse) {
    var secret = new TextEncoder().encode(identifiant.trim().toLowerCase() + "\n" + motDePasse);
    return crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: deb64(coffre.sel), iterations: coffre.iterations, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
    });
  }
  function dechiffrer(cle) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: deb64(coffre.iv) }, cle, deb64(coffre.donnees))
      .then(function (clair) { return JSON.parse(new TextDecoder().decode(clair)); });
  }

  var ecranConnexion = document.getElementById("connexion");
  var formulaire = document.getElementById("form-connexion");
  var messageConnexion = document.getElementById("message-connexion");
  var boutonDeconnexion = document.getElementById("deconnexion");

  function afficherConnexion(message) {
    activites = [];
    tabs.textContent = "";
    tabs.hidden = true;
    app.hidden = true;
    boutonDeconnexion.hidden = true;
    ecranConnexion.hidden = false;
    messageConnexion.textContent = message || "";
    document.title = "Cockpit AR Conseil";
    var champ = document.getElementById("identifiant");
    if (champ && !champ.value) champ.focus();
  }

  var ecouteursPoses = false;
  function ouvrirCockpit(contenu) {
    activites = (contenu.activites || []).map(function (a) { a.couleur = a.couleur || "#c9a24b"; return a; });
    ecranConnexion.hidden = true;
    tabs.hidden = false;
    app.hidden = false;
    boutonDeconnexion.hidden = false;
    if (!ecouteursPoses) {
      ecouteursPoses = true;
      window.addEventListener("hashchange", function () { if (activites.length) { router(); window.scrollTo(0, 0); } });
      var etroitAvant = window.innerWidth < 600;
      window.addEventListener("resize", function () {
        var e = window.innerWidth < 600;
        if (e !== etroitAvant && activites.length) { etroitAvant = e; router(); }
      });
    }
    router();
  }

  formulaire.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var bouton = formulaire.querySelector("button");
    var identifiant = document.getElementById("identifiant").value;
    var motDePasse = document.getElementById("mot-de-passe").value;
    var durable = document.getElementById("rester").checked;
    if (!identifiant || !motDePasse) { messageConnexion.textContent = "Saisis ton identifiant et ton mot de passe."; return; }
    bouton.disabled = true; messageConnexion.textContent = "Vérification…";
    var cleTrouvee;
    deriverCle(identifiant, motDePasse).then(function (cle) {
      cleTrouvee = cle;
      return dechiffrer(cle);
    }).then(function (contenu) {
      return crypto.subtle.exportKey("raw", cleTrouvee).then(function (brut) {
        ecrireStockage(b64(brut), durable);
        document.getElementById("mot-de-passe").value = "";
        messageConnexion.textContent = "";
        ouvrirCockpit(contenu);
      });
    }).catch(function () {
      messageConnexion.textContent = "Identifiant ou mot de passe incorrect.";
    }).then(function () { bouton.disabled = false; });
  });

  boutonDeconnexion.addEventListener("click", function () {
    ecrireStockage(null);
    afficherConnexion("Tu es déconnecté.");
  });

  fetch(COFFRE, { cache: "no-store" }).then(function (r) {
    if (!r.ok) throw new Error(COFFRE + " : " + r.status);
    return r.json();
  }).then(function (c) {
    coffre = c;
    var memorisee = lireStockage();
    if (!memorisee) return afficherConnexion();
    return crypto.subtle.importKey("raw", deb64(memorisee), { name: "AES-GCM" }, false, ["decrypt"])
      .then(dechiffrer)
      .then(ouvrirCockpit)
      .catch(function () { ecrireStockage(null); afficherConnexion("Le mot de passe a changé : reconnecte-toi."); });
  }).catch(function (e) {
    app.hidden = false;
    app.textContent = "";
    app.appendChild(el("p", { class: "erreur", text: "Impossible de charger le cockpit (" + e.message + "). Ouvre le site via son adresse en ligne ou un serveur local." }));
  });
})();
