import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import {
  parseCashDirection,
  parsePaymentMethod,
  resolveCar,
} from "@/lib/cars-server";

export const dynamic = "force-dynamic";

/** Sérialise un mouvement de caisse pour le JSON (dates en ISO) */
function serialize(m: {
  id: string;
  carId?: string | null;
  date: Date;
  mode?: string;
  direction?: string;
  amount: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...m,
    carId: m.carId ?? "",
    mode: m.mode === "banque" ? "banque" : "especes",
    direction: m.direction === "sortie" ? "sortie" : "entree",
    date: m.date.toISOString(),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/** GET /api/cash?carId=… — mouvements manuels de caisse (plus récents d'abord) */
export async function GET(request: Request) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const car = await resolveCar(url.searchParams.get("carId"));
    const movements = await db.cashMovement.findMany({
      where: { carId: car.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json(movements.map(serialize));
  } catch (error) {
    console.error("GET /api/cash:", error);
    return NextResponse.json(
      { error: "Impossible de charger les mouvements de caisse." },
      { status: 500 }
    );
  }
}

/** POST /api/cash — enregistre un mouvement manuel (entrée ou sortie, espèces ou banque) */
export async function POST(request: Request) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const car = await resolveCar(body.carId);
    const mode = parsePaymentMethod(body.mode);
    const direction = parseCashDirection(body.direction);

    if (!body.date || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json(
        { error: "La date du mouvement est invalide (format attendu AAAA-MM-JJ)." },
        { status: 400 }
      );
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Le montant du mouvement doit être un nombre positif." },
        { status: 400 }
      );
    }

    const date = new Date(`${body.date}T12:00:00.000Z`);
    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;

    const movement = await db.cashMovement.create({
      data: { carId: car.id, date, amount, mode, direction, note },
    });

    return NextResponse.json(serialize(movement), { status: 201 });
  } catch (error) {
    console.error("POST /api/cash:", error);
    return NextResponse.json(
      { error: "Impossible d'enregistrer le mouvement de caisse." },
      { status: 500 }
    );
  }
}
