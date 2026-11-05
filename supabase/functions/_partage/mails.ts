// Outils communs aux fonctions qui lisent les mails : décodage MIME et connexion IMAP minimale (IONOS).
export const sansHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

export function decoder(octets: Uint8Array, charset = "utf-8") {
  try { return new TextDecoder(charset.toLowerCase().replace(/^(us-ascii|ascii)$/, "utf-8")).decode(octets); } catch { return new TextDecoder().decode(octets); }
}
export const binaire = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
export const qp = (s: string) => binaire(s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))));
export const base64 = (s: string) => { try { return binaire(atob(s.replace(/[^A-Za-z0-9+/=]/g, ""))); } catch { return new Uint8Array(); } };
// En-têtes encodés (=?UTF-8?B?…?= ou =?ISO-8859-1?Q?…?=)
export const enTete = (v: string) => v.replace(/\r?\n\s+/g, " ").replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=\s*/gi, (_, cs, e, t) =>
  decoder(e.toUpperCase() === "B" ? base64(t) : qp(t.replace(/_/g, " ")), cs));
export function entetes(bloc: string) {
  const h: Record<string, string> = {};
  for (const l of bloc.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) { const i = l.indexOf(":"); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }
  return h;
}
// Texte lisible d'un corps MIME : la partie text/plain (sinon text/html sans balises), décodée.
export function texteMime(corps: string, type: string, cte: string): string {
  const frontiere = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/multipart\//i.test(type) && frontiere) {
    const parties = corps.split("--" + frontiere).slice(1).map((p) => {
      const i = p.search(/\r?\n\r?\n/); const h = entetes(p.slice(0, i)); return { h, c: p.slice(i).replace(/^\r?\n\r?\n/, "") };
    });
    const choisie = parties.find((p) => /text\/plain/i.test(p.h["content-type"] ?? "")) ?? parties.find((p) => /multipart|text\/html/i.test(p.h["content-type"] ?? ""));
    return choisie ? texteMime(choisie.c, choisie.h["content-type"] ?? "", choisie.h["content-transfer-encoding"] ?? "") : "";
  }
  const cs = /charset="?([^";]+)"?/i.exec(type)?.[1] ?? "utf-8";
  const octets = /base64/i.test(cte) ? base64(corps) : /quoted-printable/i.test(cte) ? qp(corps) : binaire(corps);
  const t = decoder(octets, cs);
  return /text\/html/i.test(type) ? sansHtml(t) : t;
}

// Connexion IMAP (TLS, port 993) : cmd() envoie une commande et renvoie la réponse complète, ou lève l'erreur du serveur.
export async function connexionImap(hote: string, utilisateur: string, motDePasse: string) {
  const conn = await Deno.connectTls({ hostname: hote, port: 993 });
  const enc = new TextEncoder(), dec = new TextDecoder("latin1"); // octets bruts : décodés plus tard selon le charset
  let tampon = "", n = 0;
  const lire = async (fin: RegExp) => {
    const buf = new Uint8Array(65536);
    for (;;) {
      const m = fin.exec(tampon);
      if (m) { const rep = tampon.slice(0, m.index + m[0].length); tampon = tampon.slice(m.index + m[0].length); return { rep, m }; }
      const lu = await conn.read(buf);
      if (lu === null) throw new Error("connexion IMAP fermée");
      tampon += dec.decode(buf.subarray(0, lu), { stream: true });
    }
  };
  const cmd = async (c: string) => {
    const tag = "V" + (++n);
    await conn.write(enc.encode(`${tag} ${c}\r\n`));
    const { rep, m } = await lire(new RegExp(`(^|\r\n)${tag} (OK|NO|BAD)[^\r\n]*\r\n`));
    if (m[2] !== "OK") throw new Error(`IMAP : ${m[0].trim().replace(/^V\d+ /, "")}`);
    return rep;
  };
  const cite = (s: string) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  try { await lire(/\r\n/); await cmd(`LOGIN ${cite(utilisateur)} ${cite(motDePasse)}`); }
  catch (e) { try { conn.close(); } catch { /* déjà fermée */ } throw e; }
  const fermer = async () => { await cmd("LOGOUT").catch(() => null); try { conn.close(); } catch { /* déjà fermée */ } };
  return { cmd, cite, fermer };
}

// Lecture d'un FETCH (une seule réponse) : date, drapeaux, en-têtes demandés et début du texte décodé.
export function lireFetch(r: string) {
  const date = /INTERNALDATE "([^"]+)"/.exec(r)?.[1];
  const drapeaux = /FLAGS \(([^)]*)\)/.exec(r)?.[1] ?? "";
  const iH = r.indexOf("HEADER.FIELDS"), debutH = r.indexOf("}\r\n", iH) + 3;
  const h: Record<string, string> = iH < 0 ? {} : entetes(r.slice(debutH, r.indexOf("\r\n\r\n", debutH)));
  const iT = r.search(/BODY\[TEXT\](<0>)? \{\d+\}\r\n/);
  const corps = iT < 0 ? "" : r.slice(r.indexOf("}\r\n", iT) + 3).replace(/\)\r\nV\d+ OK[^\r\n]*\r\n$/, "");
  return { recu: date ? new Date(date.replace(/^(\d+)-(\w+)-(\d+) /, "$2 $1 $3 ")) : new Date(), drapeaux, h,
    texte: texteMime(corps, h["content-type"] ?? "text/plain", h["content-transfer-encoding"] ?? "") };
}
