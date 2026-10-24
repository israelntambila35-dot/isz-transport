/**
 * Validation partagée du détail jour par jour d'une semaine (côté serveur).
 * Chaque jour peut être fourni avec :
 *  - `date` ("YYYY-MM-DD") — le jourIndex est alors calculé depuis le début ;
 *  - ou `dayIndex` (0 = premier jour de la semaine, 1 = le suivant…).
 * Les montants : revenue (recette du jour), savedAmount (montant versé par
 * le chauffeur ce jour), expense (dépense du jour).
 */

import { MAX_WEEK_LENGTH_DAYS } from "@/lib/weeks";

export interface ParsedDay {
  dayIndex: number;
  date: Date;
  revenue: number;
  savedAmount: number;
  expense: number;
  note: string | null;
}

export function parseDays(
  raw: unknown,
  opts: { weekStart: Date }
): { ok: true; days: ParsedDay[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, days: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Le détail des jours est invalide." };
  }

  const startMs = opts.weekStart.getTime();
  const byIndex = new Map<number, ParsedDay>();

  for (const d of raw) {
    let dayIndex: number;
    let date: Date;

    if (typeof d?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      date = new Date(`${d.date}T12:00:00.000Z`);
      dayIndex = Math.round((date.getTime() - startMs) / 86_400_000);
    } else {
      dayIndex = Number(d?.dayIndex);
      if (!Number.isInteger(dayIndex)) {
        return { ok: false, error: "Chaque jour doit avoir une date ou un index valide." };
      }
      date = new Date(opts.weekStart);
      date.setUTCDate(date.getUTCDate() + dayIndex);
    }

    if (dayIndex < 0 || dayIndex > MAX_WEEK_LENGTH_DAYS) {
      return {
        ok: false,
        error: `Chaque jour doit se trouver dans la semaine choisie (0 à ${MAX_WEEK_LENGTH_DAYS} jours après le début).`,
      };
    }

    const revenue = Number(d?.revenue ?? 0);
    const savedAmount = Number(d?.savedAmount ?? 0);
    const expense = Number(d?.expense ?? 0);
    if (![revenue, savedAmount, expense].every((n) => Number.isFinite(n) && n >= 0)) {
      return { ok: false, error: "Les montants quotidiens doivent être des nombres positifs." };
    }
    const note = typeof d?.note === "string" && d.note.trim() ? d.note.trim() : null;

    // Un seul enregistrement par jour (le dernier fourni gagne)
    byIndex.set(dayIndex, { dayIndex, date, revenue, savedAmount, expense, note });
  }

  const days = [...byIndex.values()].sort((a, b) => a.dayIndex - b.dayIndex);
  return { ok: true, days };
}

/** Valide et convertit les dates de début/fin d'une semaine choisie par l'utilisateur */
export function parseWeekRange(
  weekStartRaw: unknown,
  weekEndRaw: unknown
): { ok: true; weekStart: Date; weekEnd: Date | null } | { ok: false; error: string } {
  if (typeof weekStartRaw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw)) {
    return { ok: false, error: "La date de début de la semaine est invalide." };
  }
  const weekStart = new Date(`${weekStartRaw}T12:00:00.000Z`);

  if (weekEndRaw == null || weekEndRaw === "") {
    return { ok: true, weekStart, weekEnd: null };
  }
  if (typeof weekEndRaw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(weekEndRaw)) {
    return { ok: false, error: "La date de fin de la semaine est invalide." };
  }
  const weekEnd = new Date(`${weekEndRaw}T12:00:00.000Z`);
  if (weekEnd.getTime() < weekStart.getTime()) {
    return { ok: false, error: "La fin de la semaine doit être après (ou le jour même du) début." };
  }
  const lengthDays = Math.round((weekEnd.getTime() - weekStart.getTime()) / 86_400_000) + 1;
  if (lengthDays > MAX_WEEK_LENGTH_DAYS) {
    return {
      ok: false,
      error: `Une semaine ne peut pas dépasser ${MAX_WEEK_LENGTH_DAYS} jours.`,
    };
  }
  return { ok: true, weekStart, weekEnd };
}

/** Sérialise une semaine (avec ses jours) pour le JSON */
export function serializeWeek(entry: {
  id: string;
  carId?: string | null;
  weekStart: Date;
  weekEnd: Date | null;
  revenueWeek: number;
  savedAmount: number;
  fuelExpense: number;
  maintenanceExpense: number;
  driverSaturday: number;
  otherExpenses: number;
  paymentMethod?: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  days?: Array<{
    id: string;
    weekId: string;
    dayIndex: number;
    date: Date;
    revenue: number;
    savedAmount: number;
    expense: number;
    note: string | null;
  }>;
}) {
  return {
    ...entry,
    carId: entry.carId ?? "",
    paymentMethod: entry.paymentMethod === "banque" ? "banque" : "especes",
    weekStart: entry.weekStart.toISOString(),
    weekEnd: entry.weekEnd ? entry.weekEnd.toISOString() : null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    days: (entry.days ?? []).map((d) => ({
      ...d,
      date: d.date.toISOString(),
    })),
  };
}
