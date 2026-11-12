// Envoi d'un mail par SMTP (TLS, port 465, AUTH LOGIN) : boîte IONOS de Harnes (secrets IONOS_EMAIL / IONOS_MOT_DE_PASSE).
// Utilisé seulement pour les invitations d'agenda qu'Antonin demande (fonction invitation-harnes).
const enc = new TextEncoder(), dec = new TextDecoder();

export async function envoyerSmtp(hote: string, utilisateur: string, motDePasse: string, de: string, a: string[], message: string) {
  const conn = await Deno.connectTls({ hostname: hote, port: 465 });
  let tampon = "";
  const lire = async () => {          // une réponse complète (lignes « 250-… » puis « 250 … »)
    const buf = new Uint8Array(8192);
    for (;;) {
      const m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(tampon);
      if (m) { const r = tampon; tampon = ""; return { code: +m[2], texte: r.trim() }; }
      const n = await conn.read(buf);
      if (n === null) throw new Error("SMTP : connexion fermée");
      tampon += dec.decode(buf.subarray(0, n));
    }
  };
  const cmd = async (ligne: string, attendu: number[]) => {
    await conn.write(enc.encode(ligne + "\r\n"));
    const r = await lire();
    if (!attendu.includes(r.code)) throw new Error(`SMTP : ${r.texte.split("\r\n").pop()}`);
    return r;
  };
  const b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
  try {
    const accueil = await lire();
    if (accueil.code !== 220) throw new Error(`SMTP : ${accueil.texte}`);
    await cmd("EHLO cockpit.ar-conseil", [250]);
    await cmd("AUTH LOGIN", [334]);
    await cmd(b64(utilisateur), [334]);
    await cmd(b64(motDePasse), [235]);
    await cmd(`MAIL FROM:<${de}>`, [250]);
    for (const x of a) await cmd(`RCPT TO:<${x}>`, [250, 251]);
    await cmd("DATA", [354]);
    const corps = message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    await cmd(corps + "\r\n.", [250]);
    await cmd("QUIT", [221]).catch(() => null);
  } finally {
    try { conn.close(); } catch { /* déjà fermée */ }
  }
}

// En-tête encodé (objet, nom) en UTF-8, et corps en base64 coupé à 76 caractères
export const enteteUtf8 = (t: string) => /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${btoa(String.fromCharCode(...enc.encode(t)))}?=`;
export const base64Lignes = (t: string) => btoa(String.fromCharCode(...enc.encode(t))).replace(/.{1,76}/g, "$&\r\n").trim();
