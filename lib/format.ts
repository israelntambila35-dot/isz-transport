/**
 * Utilitaires de formatage et de dates (côté client et serveur).
 * Devise principale : FC (Franc Congolais). Devise secondaire : USD.
 */

const nfFC = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nfUSD = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const nfPct = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Formate un montant en FC : 7 050 000 FC */
export function formatFC(amount: number): string {
  if (!Number.isFinite(amount)) return "0 FC";
  return `${nfFC.format(Math.round(amount))} FC`;
}

/** Formate un montant en USD : 3 000 USD */
export function formatUSD(amount: number): string {
  if (!Number.isFinite(amount)) return "0 USD";
  return `${nfUSD.format(amount)} USD`;
}

/** Formate un pourcentage : 42,5 % */
export function formatPercent(pct: number): string {
  if (!Number.isFinite(pct)) return "0 %";
  return `${nfPct.format(pct)} %`;
}

/** Formate un nombre simple : 70,5 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return nfPct.format(n);
}

/** Formate un taux de change sans décimales : 2 350 */
export function formatRate(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return nfFC.format(n);
}

/**
 * Retourne le lundi de la semaine contenant la date donnée, en ISO "YYYY-MM-DD".
 * (Semaine : lundi → dimanche)
 */
export function getMonday(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay(); // 0 = dimanche, 1 = lundi...
  const diff = day === 0 ? -6 : 1 - day; // ramener au lundi
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

/** Date -> "YYYY-MM-DD" (locale, pas d'UTC pour rester cohérent avec la saisie) */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Convertit une date ISO en Date sans décalage de fuseau.
 * Accepte "YYYY-MM-DD" et l'ISO complet ("2026-01-06T12:00:00.000Z").
 * On utilise une date UTC à midi pour éviter tout problème de TZ.
 */
export function parseISODate(iso: string): Date {
  if (iso.includes("T")) return new Date(iso);
  return new Date(`${iso}T12:00:00.000Z`);
}

/** "2025-01-06" -> "lun. 06/01/2025" */
export function formatISODateFr(iso: string): string {
  const d = parseISODate(iso);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** "2025-01-06" -> "6 janvier 2025" */
export function formatISODateLong(iso: string): string {
  const d = parseISODate(iso);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Intervalle lisible d'une semaine : "06/01 → 12/01/2025".
 * weekEndISO est facultatif : sinon fin = début + 6 jours.
 */
export function formatWeekRange(weekStartISO: string, weekEndISO?: string | null): string {
  const start = parseISODate(weekStartISO);
  const end = weekEndISO ? parseISODate(weekEndISO) : new Date(start);
  if (!weekEndISO) end.setUTCDate(end.getUTCDate() + 6);
  const endStr = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  const startStr = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(start);
  return `${startStr} → ${endStr}`;
}

/** Nom du mois : "2025-01" -> "janvier 2025" */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Nombre de semaines (décimales) entre deux dates ISO */
export function weeksBetween(startISO: string, endISO: string): number {
  const ms = parseISODate(endISO).getTime() - parseISODate(startISO).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24 * 7));
}

/** Ajoute n semaines (décimales autorisées) à une date ISO, retour ISO */
export function addWeeksISO(startISO: string, weeks: number): string {
  const d = parseISODate(startISO);
  d.setUTCDate(d.getUTCDate() + Math.ceil(weeks * 7));
  return toISODateUTC(d);
}

/** Date -> "YYYY-MM-DD" en UTC */
export function toISODateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
