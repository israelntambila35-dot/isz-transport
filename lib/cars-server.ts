/**
 * Gestion multi-voitures (côté serveur).
 * L'application reste privée et individuelle : une seule personne gère
 * plusieurs comptes voiture. Au premier lancement, la voiture par défaut
 * est créée à partir des valeurs historiques de la ligne Settings.
 */

import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings-server";
import type { Car, CarWithCounts } from "@/lib/types";

type CarRow = {
  id: string;
  name: string;
  carPriceUsd: number;
  exchangeRate: number;
  dailyRevenue: number;
  activeDaysPerWeek: number;
  weeklySavingsTarget: number;
  startDate: Date;
  openingEspeces: number;
  openingBanque: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Garantit qu'au moins une voiture existe et que la voiture active est
 * valide ; assigne les semaines/retraits orphelins (carId null) à la
 * voiture par défaut. Retourne la voiture active.
 */
export async function ensureCars(): Promise<CarRow> {
  const settings = await getSettings();

  let car: CarRow | null = null;
  if (settings.activeCarId && settings.activeCarId !== "default") {
    car = await db.car.findUnique({ where: { id: settings.activeCarId } });
  }
  if (!car) {
    car = await db.car.findFirst({ orderBy: { createdAt: "asc" } });
  }
  if (!car) {
    // Premier lancement : créer la voiture par défaut à partir des
    // paramètres historiques du cahier des charges.
    car = await db.car.create({
      data: {
        name: "Ma voiture",
        carPriceUsd: settings.carPriceUsd,
        exchangeRate: settings.exchangeRate,
        dailyRevenue: settings.dailyRevenue,
        activeDaysPerWeek: settings.activeDaysPerWeek,
        weeklySavingsTarget: settings.weeklySavingsTarget,
        startDate: settings.startDate,
      },
    });
  }

  // Migration des anciennes données sans voiture
  const orphans = await db.weeklyEntry.count({ where: { carId: null } });
  if (orphans > 0) {
    await db.weeklyEntry.updateMany({ where: { carId: null }, data: { carId: car.id } });
  }
  const orphanWd = await db.withdrawal.count({ where: { carId: null } });
  if (orphanWd > 0) {
    await db.withdrawal.updateMany({ where: { carId: null }, data: { carId: car.id } });
  }

  if (settings.activeCarId !== car.id) {
    await db.settings.update({ where: { id: "settings" }, data: { activeCarId: car.id } });
  }
  return car;
}

/** Résout la voiture demandée (?carId=) ou retombe sur la voiture active */
export async function resolveCar(carIdParam: string | null | undefined): Promise<CarRow> {
  const active = await ensureCars();
  if (carIdParam) {
    const found = await db.car.findUnique({ where: { id: carIdParam } });
    if (found) return found;
  }
  return active;
}

/** Sérialise une voiture pour le JSON */
export function serializeCar(car: CarRow): Car {
  return {
    id: car.id,
    name: car.name,
    carPriceUsd: car.carPriceUsd,
    exchangeRate: car.exchangeRate,
    dailyRevenue: car.dailyRevenue,
    activeDaysPerWeek: car.activeDaysPerWeek,
    weeklySavingsTarget: car.weeklySavingsTarget,
    startDate: car.startDate.toISOString(),
    openingEspeces: car.openingEspeces,
    openingBanque: car.openingBanque,
    createdAt: car.createdAt.toISOString(),
    updatedAt: car.updatedAt.toISOString(),
  };
}

/** Sérialise une voiture + ses compteurs (pour le sélecteur / la gestion) */
export function serializeCarWithCounts(car: CarRow & {
  _count?: { weeks?: number; withdrawals?: number };
}): CarWithCounts {
  return {
    ...serializeCar(car),
    weeksCount: car._count?.weeks ?? 0,
    withdrawalsCount: car._count?.withdrawals ?? 0,
  };
}

/** Liste de toutes les voitures (avec compteurs), plus ancienne d'abord */
export async function listCars(): Promise<Array<CarRow & { _count: { weeks: number; withdrawals: number } }>> {
  return db.car.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { weeks: true, withdrawals: true } } },
  });
}

/** Validation d'un mode de paiement (especes | banque) */
export function parsePaymentMethod(raw: unknown): "especes" | "banque" {
  return raw === "banque" ? "banque" : "especes";
}

/** Validation d'un sens de mouvement de caisse (entree | sortie) */
export function parseCashDirection(raw: unknown): "entree" | "sortie" {
  return raw === "sortie" ? "sortie" : "entree";
}

/** Validation d'un type de prêt (pret | emprunt) */
export function parseLoanKind(raw: unknown): "pret" | "emprunt" {
  return raw === "emprunt" ? "emprunt" : "pret";
}
