// Wispr Flow : OAuth (PKCE, client décrit par un document public, sans inscription) et client MCP en lecture seule.
// Repris du connecteur du logiciel Evoa (EVOA-outils/depot-devis/app/wispr.py), qui l'utilise en production.
// deno-lint-ignore-file no-explicit-any
export const MCP = "https://api.wisprflow.ai/connect/mcp";
export const AUTORISATION = "https://mcp-auth.wisprflow.com/oauth2/authorize";
export const JETON = "https://mcp-auth.wisprflow.com/oauth2/token";
export const PORTEE = "openid offline_access";
export const CLIENT_ID = "https://ar-conseil.github.io/cockpit/wispr/client.json";
export const RETOUR = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wispr-connexion`;
const VERSION = "2025-06-18";

export async function formulaire(url: string, champs: Record<string, string>) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(champs) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `HTTP ${r.status}`), { status: r.status });
  return j;
}

export class ClientMCP {
  session: string | null = null; n = 0;
  constructor(private jeton: string) {}
  private async envoyer(corps: Record<string, unknown>, attendre = true) {
    const entetes: Record<string, string> = { Authorization: `Bearer ${this.jeton}`, "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", "MCP-Protocol-Version": VERSION };
    if (this.session) entetes["Mcp-Session-Id"] = this.session;
    const r = await fetch(MCP, { method: "POST", headers: entetes, body: JSON.stringify(corps) });
    this.session = r.headers.get("Mcp-Session-Id") ?? this.session;
    if (r.status === 401) throw Object.assign(new Error("Wispr : jeton refusé"), { status: 401 });
    if (r.status === 429) throw Object.assign(new Error("Wispr : trop de demandes"), { status: 429 });
    const brut = await r.text();
    if (!attendre) return null;
    let rep: any = {};
    if ((r.headers.get("Content-Type") ?? "").includes("text/event-stream")) {
      const msgs = brut.split(/\r?\n/).filter((l) => l.startsWith("data:") && l.slice(5).trim()).map((l) => JSON.parse(l.slice(5).trim()));
      rep = msgs.find((m) => m.id === corps.id) ?? msgs[msgs.length - 1] ?? {};
    } else if (brut.trim()) rep = JSON.parse(brut);
    if (rep.error) throw new Error(`Wispr : ${rep.error.message ?? JSON.stringify(rep.error)}`);
    return rep.result;
  }
  appeler(methode: string, params: Record<string, unknown> = {}) { return this.envoyer({ jsonrpc: "2.0", id: ++this.n, method: methode, params }); }
  async ouvrir() {
    await this.appeler("initialize", { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: "Cockpit Antonin Rouzier", version: "1.0" } });
    await this.envoyer({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
    return this;
  }
  async outil(nom: string, args: Record<string, unknown> = {}) {
    const res: any = (await this.appeler("tools/call", { name: nom, arguments: args })) ?? {};
    if (res.isError) throw new Error("Wispr : " + (res.content ?? []).map((c: any) => c.text ?? "").join(" ").slice(0, 200));
    if (res.structuredContent != null) return res.structuredContent;
    const t = (res.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    try { return JSON.parse(t); } catch { return t; }
  }
}

export function listeDicts(d: any): any[] {
  if (Array.isArray(d)) return d.filter((x) => x && typeof x === "object");
  if (d && typeof d === "object") for (const v of Object.values(d)) { const l = listeDicts(v); if (l.length) return l; }
  return [];
}
export const idDe = (m: any) => String(m.id ?? m.meeting_id ?? m.meetingId ?? m.note_id ?? m.uuid ?? "") || null;

// Transcription d'une note (les lignes techniques « <<< … >>> » retirées)
export async function transcription(mcp: ClientMCP, ref: string): Promise<string> {
  const res: any = await mcp.outil("get_meeting", { meeting_id: ref, view_transcript: { start_char: 0, char_limit: 40000 } });
  if (typeof res !== "object" || !res) return String(res ?? "");
  let t = res.transcript;
  if (t && typeof t === "object") t = t.text ?? t.content ?? "";
  return String(t ?? "").split(/\r?\n/).filter((l) => !/^\s*<<<.*>>>\s*$/.test(l) && !/start_char\D{0,12}\d+/.test(l)).join("\n").trim();
}

// Une note pour Victor commence par « Victor » (après l'éventuel « Speaker 1: ») ; renvoie la demande sans l'appel, sinon null
export function demandePourVictor(texte: string): string | null {
  const sans = texte.split(/\r?\n/).map((l) => l.replace(/^\s*[^\n:]{1,40}:\s*/, "")).join(" ").replace(/\s+/g, " ").trim();
  const m = /^(?:(?:hey|hé|eh|ok|okay|dis|allo|allô)[\s,]+)?victor\b[\s,.:;!?-]*/i.exec(sans);
  return m ? sans.slice(m[0].length).trim() || null : null;
}
