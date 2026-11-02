#!/usr/bin/env node
// Coffre du cockpit : chiffre / déchiffre les données (data/coffre.json).
// Format identique à assets/app.js : PBKDF2-SHA256 (identifiant en minuscules + "\n" + mot de passe) -> AES-GCM 256.
//
//   node outils/coffre.mjs ouvrir    déchiffre data/coffre.json vers .donnees/ (dossier ignoré par git)
//   node outils/coffre.mjs fermer    rechiffre .donnees/ vers data/coffre.json (garde le même sel :
//                                    les appareils restés connectés le restent)
//   node outils/coffre.mjs changer   rechiffre avec un nouvel identifiant / mot de passe
//                                    (COCKPIT_NOUVEL_IDENTIFIANT, COCKPIT_NOUVEAU_MOT_DE_PASSE) : déconnecte tout le monde
//
// Identifiants : variables COCKPIT_IDENTIFIANT et COCKPIT_MOT_DE_PASSE, sinon demandés au clavier.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { webcrypto as crypto } from "node:crypto";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const COFFRE = join(RACINE, "data", "coffre.json");
const CLAIR = join(RACINE, ".donnees");
const ITERATIONS = 310000;

const b64 = (u) => Buffer.from(u).toString("base64");
const deb64 = (t) => new Uint8Array(Buffer.from(t, "base64"));

async function demander(question, variable) {
  if (process.env[variable]) return process.env[variable];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(question);
  rl.close();
  return r;
}
async function cle(identifiant, motDePasse, sel, iterations) {
  const base = await crypto.subtle.importKey("raw",
    new TextEncoder().encode(identifiant.trim().toLowerCase() + "\n" + motDePasse), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sel, iterations, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function identifiants(prefixe = "") {
  const id = await demander("Identifiant : ", "COCKPIT_" + (prefixe ? "NOUVEL_" : "") + "IDENTIFIANT");
  const mdp = await demander("Mot de passe : ", "COCKPIT_" + (prefixe ? "NOUVEAU_" : "") + "MOT_DE_PASSE");
  if (!id || !mdp) throw new Error("Identifiant et mot de passe obligatoires.");
  return [id, mdp];
}
function lireClair() {
  const ordre = JSON.parse(readFileSync(join(CLAIR, "activites.json"), "utf8"));
  const activites = ordre.activites.map((id) => {
    const a = JSON.parse(readFileSync(join(CLAIR, id + ".json"), "utf8"));
    a.id = a.id || id;
    return a;
  });
  return { societe: ordre.societe, activites };
}
async function chiffrer(contenu, k, sel, iterations) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const donnees = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(contenu)));
  const coffre = { version: 1, algorithme: "PBKDF2-SHA256 + AES-GCM-256", iterations, sel: b64(sel), iv: b64(iv), donnees: b64(donnees) };
  writeFileSync(COFFRE, JSON.stringify(coffre, null, 1) + "\n");
  console.log("Coffre écrit : data/coffre.json (" + contenu.activites.length + " activités).");
}

const commande = process.argv[2];
if (commande === "ouvrir") {
  const c = JSON.parse(readFileSync(COFFRE, "utf8"));
  const [id, mdp] = await identifiants();
  const k = await cle(id, mdp, deb64(c.sel), c.iterations);
  let contenu;
  try {
    contenu = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deb64(c.iv) }, k, deb64(c.donnees))));
  } catch { console.error("Identifiant ou mot de passe incorrect."); process.exit(1); }
  mkdirSync(CLAIR, { recursive: true });
  writeFileSync(join(CLAIR, "activites.json"),
    JSON.stringify({ societe: contenu.societe, activites: contenu.activites.map((a) => a.id) }, null, 2) + "\n");
  for (const a of contenu.activites) writeFileSync(join(CLAIR, a.id + ".json"), JSON.stringify(a, null, 2) + "\n");
  console.log("Données déchiffrées dans .donnees/ : " + readdirSync(CLAIR).join(", "));
} else if (commande === "fermer" || commande === "changer") {
  const contenu = lireClair();
  let sel, iterations = ITERATIONS, id, mdp;
  if (commande === "fermer" && existsSync(COFFRE)) {
    const c = JSON.parse(readFileSync(COFFRE, "utf8"));
    sel = deb64(c.sel); iterations = c.iterations;
    [id, mdp] = await identifiants();
    const k = await cle(id, mdp, sel, iterations);
    try { await crypto.subtle.decrypt({ name: "AES-GCM", iv: deb64(c.iv) }, k, deb64(c.donnees)); }
    catch { console.error("Identifiant ou mot de passe incorrect (utilise « changer » pour en définir de nouveaux)."); process.exit(1); }
    await chiffrer(contenu, k, sel, iterations);
  } else {
    [id, mdp] = await identifiants(commande === "changer" ? "nouveau" : "");
    sel = crypto.getRandomValues(new Uint8Array(16));
    await chiffrer(contenu, await cle(id, mdp, sel, iterations), sel, iterations);
  }
} else {
  console.log("Usage : node outils/coffre.mjs ouvrir | fermer | changer");
  process.exit(1);
}
