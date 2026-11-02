// Lecture d'un flux iCal : déplie les récurrences dans une fenêtre de dates et applique les exceptions.
// ICAL (ical.js) est passé en paramètre pour pouvoir tester ce fichier hors de Supabase.

export type Occurrence = {
  uid: string;
  debut: string; // ISO UTC
  fin: string;
  journee: boolean;
  titre: string | null;
  lieu: string | null;
  description: string | null;
};

const MAX_PAR_SERIE = 1000;

// Heure « flottante » (sans fuseau) ou date seule : on la lit comme une heure de Paris.
function versIso(ICAL: any, t: any): string {
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone && t.zone.tzid !== "floating") {
    return t.toJSDate().toISOString();
  }
  const utc = Date.UTC(t.year, t.month - 1, t.day, t.isDate ? 0 : t.hour, t.isDate ? 0 : t.minute, t.isDate ? 0 : t.second);
  return new Date(utc - decalageParis(utc)).toISOString();
}

function decalageParis(utcMs: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const v = (k: string) => Number(p.find((x) => x.type === k)!.value);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - utcMs;
}

function texte(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 2000) : null;
}

export function extraireOccurrences(ICAL: any, ics: string, debutFenetre: Date, finFenetre: Date): Occurrence[] {
  const racine = new ICAL.Component(ICAL.parse(ics));
  for (const tz of racine.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(tz); } catch (_) { /* fuseau déjà connu */ }
  }

  // Regroupe la série principale et ses exceptions (RECURRENCE-ID) par UID.
  const series = new Map<string, { maitre: any; exceptions: any[] }>();
  for (const comp of racine.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(comp);
    const uid = ev.uid || `${ev.summary}-${comp.getFirstPropertyValue("dtstart")}`;
    const s = series.get(uid) ?? { maitre: null, exceptions: [] };
    if (ev.isRecurrenceException()) s.exceptions.push(ev); else s.maitre = ev;
    series.set(uid, s);
  }

  const debutMs = debutFenetre.getTime(), finMs = finFenetre.getTime();
  const sortie: Occurrence[] = [];
  const ajouter = (uid: string, item: any, start: any, end: any) => {
    const statut = String(item.component.getFirstPropertyValue("status") || "").toUpperCase();
    if (statut === "CANCELLED") return;
    const debut = versIso(ICAL, start);
    const fin = end ? versIso(ICAL, end) : debut;
    if (Date.parse(fin) < debutMs || Date.parse(debut) > finMs) return;
    sortie.push({
      uid, debut, fin, journee: !!start.isDate,
      titre: texte(item.summary), lieu: texte(item.location), description: texte(item.description),
    });
  };

  for (const [uid, { maitre, exceptions }] of series) {
    if (!maitre) { // exception orpheline : on la garde telle quelle
      for (const ex of exceptions) ajouter(uid, ex, ex.startDate, ex.endDate);
      continue;
    }
    if (!maitre.isRecurring()) { ajouter(uid, maitre, maitre.startDate, maitre.endDate); continue; }
    for (const ex of exceptions) maitre.relateException(ex);
    const it = maitre.iterator();
    for (let i = 0, t = it.next(); t && i < MAX_PAR_SERIE; i++, t = it.next()) {
      if (Date.parse(versIso(ICAL, t)) > finMs) break;
      const d = maitre.getOccurrenceDetails(t);
      ajouter(uid, d.item, d.startDate, d.endDate);
    }
  }
  return sortie;
}
