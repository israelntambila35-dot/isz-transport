import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { resolveCar } from "@/lib/cars-server";
import { toISODateUTC } from "@/lib/format";
import { weekSavedTotal } from "@/lib/weeks";
import type { StatsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats — tous les calculs automatiques du tableau de bord :
 *  1. Prix de la voiture en FC = prix USD × taux de change
 *  2. Totaux cumulés (épargne, recettes, dépenses)
 *  3. Reste à rembourser = prix FC − total épargné
 *  4. Pourcentage remboursé
 *  5. Semaines estimées avec la MOYENNE RÉELLE d'épargne
 *  6. Semaines restantes + date de fin estimée
 *  7. Alerte si l'épargne moyenne est inférieure à l'objectif
 */
export async function GET(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const car = await resolveCar(url.searchParams.get("carId"));
    const weeks = await db.weeklyEntry.findMany({
      where: { carId: car.id },
      orderBy: { weekStart: "asc" },
      include: { days: { orderBy: { dayIndex: "asc" } } },
    });
    const withdrawals = await db.withdrawal.findMany({
      where: { carId: car.id },
      orderBy: { date: "asc" },
    });

    // 1. Prix de la voiture en FC (le taux changeable recalcule ce prix)
    const carPriceFc = car.carPriceUsd * car.exchangeRate;

    // 2. Totaux — le montant versé d'une semaine = somme des jours saisis
    // (le 16, le 17, le 18…) ou total direct pour les anciennes semaines.
    const totalSaved = weeks.reduce((s, w) => s + weekSavedTotal(w), 0);
    const totalRevenue = weeks.reduce((s, w) => s + w.revenueWeek, 0);
    const totalFuel = weeks.reduce((s, w) => s + w.fuelExpense, 0);
    const totalMaintenance = weeks.reduce((s, w) => s + w.maintenanceExpense, 0);
    const totalDriver = weeks.reduce((s, w) => s + w.driverSaturday, 0);
    const totalOther = weeks.reduce((s, w) => s + w.otherExpenses, 0);
    const totalExpenses = totalFuel + totalMaintenance + totalDriver + totalOther;

    // 2 bis. Retraits : argent sorti de l'épargne → épargne NETTE disponible
    const totalWithdrawn = withdrawals.reduce((s, w) => s + w.amount, 0);
    const netSaved = totalSaved - totalWithdrawn;

    // 3 & 4. Reste à rembourser et pourcentage (basés sur l'épargne nette)
    const remaining = Math.max(0, carPriceFc - netSaved);
    const paidPercent =
      carPriceFc > 0 ? Math.max(0, Math.min(100, (netSaved / carPriceFc) * 100)) : 0;

    // 5. Moyenne réelle versée : total versé / nombre de semaines enregistrées.
    //    Si aucune semaine : on utilise l'objectif.
    const entriesCount = weeks.length;
    const avgWeeklySavings =
      entriesCount > 0 ? totalSaved / entriesCount : car.weeklySavingsTarget;

    // Semaines totales estimées (moyenne réelle) vs objectif théorique
    const estimatedTotalWeeks =
      avgWeeklySavings > 0 ? carPriceFc / avgWeeklySavings : 0;
    const estimatedTotalWeeksTarget =
      car.weeklySavingsTarget > 0
        ? carPriceFc / car.weeklySavingsTarget
        : 0;

    // 6. Semaines restantes + date de fin estimée (base : aujourd'hui)
    const remainingWeeks =
      avgWeeklySavings > 0 && remaining > 0 ? remaining / avgWeeklySavings : 0;
    const now = new Date();
    const endDate = new Date(now);
    endDate.setUTCDate(endDate.getUTCDate() + Math.ceil(remainingWeeks * 7));

    // Semaines écoulées depuis la date de début
    const startMs = car.startDate.getTime();
    const weeksElapsed = Math.max(0, (now.getTime() - startMs) / (1000 * 60 * 60 * 24 * 7));

    // 7. Alerte : versement moyen < objectif ?
    const onTrack = avgWeeklySavings >= car.weeklySavingsTarget;

    const stats: StatsResponse = {
      carPriceFc,
      carPriceUsd: car.carPriceUsd,
      exchangeRate: car.exchangeRate,

      totalSaved,
      totalRevenue,
      totalFuel,
      totalMaintenance,
      totalDriver,
      totalOther,
      totalExpenses,

      totalWithdrawn,
      netSaved,
      withdrawalsCount: withdrawals.length,

      remaining,
      paidPercent,
      remainingPercent: Math.max(0, 100 - paidPercent),

      weeksElapsed,
      avgWeeklySavings,
      estimatedTotalWeeks,
      estimatedTotalWeeksTarget,
      remainingWeeks,
      estimatedEndDate: toISODateUTC(endDate),
      onTrack,

      entriesCount,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("GET /api/stats:", error);
    return NextResponse.json(
      { error: "Impossible de calculer les statistiques." },
      { status: 500 }
    );
  }
}
