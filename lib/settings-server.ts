import { db } from "@/lib/db";
import type { AppSettings } from "@/lib/types";
import { toISODateUTC } from "@/lib/format";

/**
 * Récupère les paramètres ; les crée avec les valeurs par défaut
 * du cahier des charges s'ils n'existent pas encore.
 */
export async function getSettings() {
  let settings = await db.settings.findUnique({ where: { id: "settings" } });
  if (!settings) {
    settings = await db.settings.create({
      data: {
        id: "settings",
        carPriceUsd: 3000,
        exchangeRate: 2350,
        dailyRevenue: 30000,
        activeDaysPerWeek: 5,
        weeklySavingsTarget: 100000,
        startDate: new Date(),
      },
    });
  }
  return settings;
}

/** Sérialise les paramètres pour le client */
export function serializeSettings(s: {
  carPriceUsd: number;
  exchangeRate: number;
  dailyRevenue: number;
  activeDaysPerWeek: number;
  weeklySavingsTarget: number;
  startDate: Date;
}): AppSettings {
  return {
    carPriceUsd: s.carPriceUsd,
    exchangeRate: s.exchangeRate,
    dailyRevenue: s.dailyRevenue,
    activeDaysPerWeek: s.activeDaysPerWeek,
    weeklySavingsTarget: s.weeklySavingsTarget,
    startDate: toISODateUTC(s.startDate),
  };
}
