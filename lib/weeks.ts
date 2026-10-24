/**
 * Utilitaires « semaines » partagés client/serveur.
 * Une semaine est définie par l'utilisateur : jour de début (weekStart)
 * et jour de fin (weekEnd) choisis en cliquant sur le calendrier.
 * Le montant versé par le chauffeur est saisi jour par jour (DayEntry) ;
 * le total de la semaine = somme des jours (ou total direct si aucun détail).
 */

import { parseISODate, toISODateUTC } from "@/lib/format";
import type { DayEntry, WeeklyEntry } from "@/lib/types";

/** Nombre de jours maximum d'une semaine créée sur le calendrier (~2 mois) */
export const MAX_WEEK_LENGTH_DAYS = 62;

/** Ajoute n jours à une date ISO "YYYY-MM-DD" → "YYYY-MM-DD" */
export function addDaysISO(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODateUTC(d);
}

/**
 * Date de fin effective de la semaine : weekEnd choisi par l'utilisateur,
 * sinon weekStart + 6 (semaine classique de 7 jours).
 */
export function weekEndISO(week: Pick<WeeklyEntry, "weekStart" | "weekEnd">): string {
  if (week.weekEnd) return week.weekEnd.slice(0, 10);
  return addDaysISO(week.weekStart.slice(0, 10), 6);
}

/** Nombre de jours de la semaine (début et fin inclus) */
export function weekLengthDays(week: Pick<WeeklyEntry, "weekStart" | "weekEnd">): number {
  const start = parseISODate(week.weekStart.slice(0, 10)).getTime();
  const end = parseISODate(weekEndISO(week)).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

/**
 * Total « montant versé par le chauffeur » d'une semaine :
 * - si la semaine contient un détail jour par jour → somme des jours ;
 * - sinon → le total saisi directement (semaines anciennes).
 */
export function weekSavedTotal(
  week: Pick<WeeklyEntry, "weekStart" | "weekEnd" | "savedAmount" | "days">
): number {
  const days = week.days ?? [];
  if (days.length > 0) {
    return days.reduce((s, d) => s + (Number(d.savedAmount) || 0), 0);
  }
  return Number(week.savedAmount) || 0;
}

/** La date "YYYY-MM-DD" est-elle dans la semaine (bornes incluses) ? */
export function dateInWeek(
  dateISO: string,
  week: Pick<WeeklyEntry, "weekStart" | "weekEnd">
): boolean {
  const t = parseISODate(dateISO).getTime();
  return (
    t >= parseISODate(week.weekStart.slice(0, 10)).getTime() &&
    t <= parseISODate(weekEndISO(week)).getTime()
  );
}

/** Retrouve la semaine qui contient une date donnée (ou null) */
export function weekContainingDate(
  dateISO: string,
  weeks: Array<Pick<WeeklyEntry, "id" | "weekStart" | "weekEnd">>
): Pick<WeeklyEntry, "id" | "weekStart" | "weekEnd"> | null {
  return weeks.find((w) => dateInWeek(dateISO, w)) ?? null;
}

/** Jour de la semaine (0 = lundi … 6 = dimanche) d'une date ISO */
export function weekdayIndex(dateISO: string): number {
  const day = parseISODate(dateISO).getUTCDay(); // 0 = dimanche
  return day === 0 ? 6 : day - 1;
}

/** Libellés courts des jours : "lun.", "mar."… */
export const WEEKDAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
export const WEEKDAY_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** "2025-10-16" → "jeu. 16" */
export function dayShortLabel(dateISO: string): string {
  const d = parseISODate(dateISO);
  const wd = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" }).format(d);
  const num = new Intl.DateTimeFormat("fr-FR", { day: "numeric", timeZone: "UTC" }).format(d);
  return `${wd.replace(".", "")}. ${num}`;
}

/** "2025-10-16" → "Jeudi 16 octobre 2025" */
export function dayLongLabel(dateISO: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseISODate(dateISO));
}

/** Tri des jours d'une semaine par date croissante */
export function sortDays(days: DayEntry[]): DayEntry[] {
  return [...days].sort(
    (a, b) => parseISODate(a.date.slice(0, 10)).getTime() - parseISODate(b.date.slice(0, 10)).getTime()
  );
}
