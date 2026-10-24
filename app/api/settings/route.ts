import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { ensureCars } from "@/lib/cars-server";

export const dynamic = "force-dynamic";

/** Réponse de /api/settings : les paramètres de la voiture ACTIVE */
function carSettings(car: {
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
}) {
  return {
    carId: car.id,
    carName: car.name,
    carPriceUsd: car.carPriceUsd,
    exchangeRate: car.exchangeRate,
    dailyRevenue: car.dailyRevenue,
    activeDaysPerWeek: car.activeDaysPerWeek,
    weeklySavingsTarget: car.weeklySavingsTarget,
    startDate: car.startDate.toISOString(),
    openingEspeces: car.openingEspeces,
    openingBanque: car.openingBanque,
  };
}

/** GET /api/settings — paramètres de la voiture active */
export async function GET(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const car = await ensureCars();
    return NextResponse.json(carSettings(car));
  } catch (error) {
    console.error("GET /api/settings:", error);
    return NextResponse.json(
      { error: "Impossible de charger les paramètres." },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings — deux usages :
 *  - { activeCarId } → change la voiture active ;
 *  - { carPriceUsd, … } → met à jour les paramètres de la voiture active.
 * (les deux peuvent être combinés)
 */
export async function PUT(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const activeCar = await ensureCars();

    // 1. Changement de voiture active
    if (typeof body.activeCarId === "string" && body.activeCarId) {
      const car = await db.car.findUnique({ where: { id: body.activeCarId } });
      if (!car) {
        return NextResponse.json({ error: "Voiture introuvable." }, { status: 404 });
      }
      await db.settings.update({
        where: { id: "settings" },
        data: { activeCarId: car.id },
      });
      if (Object.keys(body).length === 1) {
        return NextResponse.json(carSettings(car));
      }
    }

    // 2. Mise à jour des paramètres de la voiture active
    const carPriceUsd = Number(body.carPriceUsd);
    const exchangeRate = Number(body.exchangeRate);
    const dailyRevenue = Number(body.dailyRevenue);
    const activeDaysPerWeek = Number(body.activeDaysPerWeek);
    const weeklySavingsTarget = Number(body.weeklySavingsTarget);
    const startDate = body.startDate ? new Date(`${body.startDate}T12:00:00.000Z`) : null;

    // Règles métier : tous les montants doivent être positifs
    if (!Number.isFinite(carPriceUsd) || carPriceUsd <= 0) {
      return NextResponse.json({ error: "Le prix de la voiture doit être positif." }, { status: 400 });
    }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      return NextResponse.json({ error: "Le taux de change doit être positif." }, { status: 400 });
    }
    if (!Number.isFinite(dailyRevenue) || dailyRevenue <= 0) {
      return NextResponse.json({ error: "La recette journalière doit être positive." }, { status: 400 });
    }
    if (!Number.isFinite(activeDaysPerWeek) || activeDaysPerWeek < 1 || activeDaysPerWeek > 7 || !Number.isInteger(activeDaysPerWeek)) {
      return NextResponse.json({ error: "Les jours actifs doivent être un nombre entier entre 1 et 7." }, { status: 400 });
    }
    if (!Number.isFinite(weeklySavingsTarget) || weeklySavingsTarget <= 0) {
      return NextResponse.json({ error: "L'épargne hebdomadaire cible doit être positive." }, { status: 400 });
    }
    if (!startDate || isNaN(startDate.getTime())) {
      return NextResponse.json({ error: "La date de début est invalide." }, { status: 400 });
    }

    // Soldes de départ de la caisse (facultatifs, ≥ 0)
    const data: Record<string, unknown> = {
      carPriceUsd,
      exchangeRate,
      dailyRevenue,
      activeDaysPerWeek,
      weeklySavingsTarget,
      startDate,
    };
    for (const field of ["openingEspeces", "openingBanque"] as const) {
      if (body[field] !== undefined) {
        const n = Number(body[field]);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: "Les soldes de départ doivent être des nombres positifs ou nuls." },
            { status: 400 }
          );
        }
        data[field] = n;
      }
    }

    const updated = await db.car.update({
      where: { id: activeCar.id },
      data,
    });

    return NextResponse.json(carSettings(updated));
  } catch (error) {
    console.error("PUT /api/settings:", error);
    return NextResponse.json(
      { error: "Impossible d'enregistrer les paramètres." },
      { status: 500 }
    );
  }
}
