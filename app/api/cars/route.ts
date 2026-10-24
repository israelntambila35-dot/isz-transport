import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { ensureCars, listCars, serializeCarWithCounts } from "@/lib/cars-server";

export const dynamic = "force-dynamic";

/** GET /api/cars — liste des voitures (comptes) + voiture active */
export async function GET(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const active = await ensureCars();
    const cars = await listCars();
    return NextResponse.json({
      activeCarId: active.id,
      cars: cars.map(serializeCarWithCounts),
    });
  } catch (error) {
    console.error("GET /api/cars:", error);
    return NextResponse.json(
      { error: "Impossible de charger les voitures." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cars — crée un nouveau compte voiture.
 * Les paramètres de départ sont copiés depuis la voiture active
 * (modifiables ensuite dans l'onglet Paramètres).
 */
export async function POST(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Veuillez donner un nom à la voiture." },
        { status: 400 }
      );
    }
    if (name.length > 40) {
      return NextResponse.json(
        { error: "Le nom de la voiture est trop long (40 caractères maximum)." },
        { status: 400 }
      );
    }

    const active = await ensureCars();
    const car = await db.car.create({
      data: {
        name,
        carPriceUsd: active.carPriceUsd,
        exchangeRate: active.exchangeRate,
        dailyRevenue: active.dailyRevenue,
        activeDaysPerWeek: active.activeDaysPerWeek,
        weeklySavingsTarget: active.weeklySavingsTarget,
        startDate: active.startDate,
      },
      include: { _count: { select: { weeks: true, withdrawals: true } } },
    });

    return NextResponse.json(serializeCarWithCounts(car), { status: 201 });
  } catch (error) {
    console.error("POST /api/cars:", error);
    return NextResponse.json(
      { error: "Impossible de créer la voiture." },
      { status: 500 }
    );
  }
}
