// Lecture d'un message MIME brut (IMAP, octets lus en latin1) : en-têtes, texte, HTML et pièces jointes, à toute profondeur.
import { base64, binaire, decoder, enTete, entetes, qp } from "./mails.ts";

export type Piece = { index: number; nom: string; type: string; taille: number; cid: string | null; octets: Uint8Array };
export type Analyse = { h: Record<string, string>; texte: string; html: string; pieces: Piece[] };

const param = (v: string, nom: string) => {
  const m = new RegExp(`${nom}\\*?=(?:"([^"]*)"|([^;\\s]*))`, "i").exec(v);
  if (!m) return "";
  const brut = m[1] ?? m[2] ?? "";
  const rfc2231 = /^([^']*)'[^']*'(.*)$/.exec(brut);   // nom*=utf-8''Facture%20n%C2%B01.pdf
  if (rfc2231 && new RegExp(`${nom}\\*=`, "i").test(v)) { try { return decodeURIComponent(rfc2231[2]); } catch { return rfc2231[2]; } }
  return enTete(brut);
};
const decoderCorps = (corps: string, cte: string) => /base64/i.test(cte) ? base64(corps) : /quoted-printable/i.test(cte) ? qp(corps) : binaire(corps);

export function analyser(brut: string): Analyse {
  const sortie: Analyse = { h: {}, texte: "", html: "", pieces: [] };
  let n = 0;
  const visiter = (bloc: string, racine: boolean) => {
    const i = bloc.search(/\r?\n\r?\n/);
    const h = entetes(i < 0 ? bloc : bloc.slice(0, i)), corps = i < 0 ? "" : bloc.slice(i).replace(/^\r?\n\r?\n/, "");
    if (racine) sortie.h = h;
    const type = h["content-type"] ?? "text/plain", cte = h["content-transfer-encoding"] ?? "", dispo = h["content-disposition"] ?? "";
    const frontiere = param(type, "boundary");
    if (/^multipart\//i.test(type) && frontiere) {
      const morceaux = corps.split("--" + frontiere);
      for (const m of morceaux.slice(1)) { if (m.startsWith("--")) break; visiter(m.replace(/^\r?\n/, ""), false); }
      return;
    }
    if (/^message\/rfc822/i.test(type) && !/attachment/i.test(dispo)) { visiter(corps, false); return; }
    const nom = param(dispo, "filename") || param(type, "name");
    const cid = (h["content-id"] ?? "").replace(/^<|>$/g, "") || null;
    if (!nom && /^text\/plain/i.test(type) && !sortie.texte && !/attachment/i.test(dispo)) { sortie.texte = decoder(decoderCorps(corps, cte), param(type, "charset") || "utf-8"); return; }
    if (!nom && /^text\/html/i.test(type) && !sortie.html && !/attachment/i.test(dispo)) { sortie.html = decoder(decoderCorps(corps, cte), param(type, "charset") || "utf-8"); return; }
    if (nom || cid || /attachment/i.test(dispo)) {
      const octets = decoderCorps(corps, cte);
      sortie.pieces.push({ index: n++, nom: nom || (cid ? `image-${n}` : `piece-${n}`), type: type.split(";")[0].trim().toLowerCase(), taille: octets.length, cid, octets });
    }
  };
  visiter(brut, true);
  return sortie;
}
