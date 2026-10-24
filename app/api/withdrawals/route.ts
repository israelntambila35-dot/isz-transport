import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { parsePaymentMethod, resolveCar } from "@/lib/cars-server";

export const dynamic = "force-dynamic";

/** Sérialise un retrait pour le JSON (dates en ISO) */
function serialize(w: {
  id: string;
  carId?: string | null;
  date: Date;
  amount: number;
  paymentMethod?: string;
  note: string | null;
  createdAt: Date;
}) {
  return {
    ...w,
    carId: w.carId ?? "",
    paymentMethod: w.paymentMethod === "banque" ? "banque" : "especes",
    date: w.date.toISOString(),
    createdAt: w.createdAt.toISOString(),
  };
}

/** GET /api/withdrawals?carId=… — retraits de la voiture (plus récents d'abord) */
export async function GET(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const car = await resolveCar(url.searchParams.get("carId"));
    const withdrawals = await db.withdrawal.findMany({
      where: { carId: car.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json(withdrawals.map(serialize));
  } catch (error) {
    console.error("GET /api/withdrawals:", error);
    return NextResponse.json(
      { error: "Impossible de charger les retraits." },
      { status: 500 }
    );
  }
}

/** POST /api/withdrawals — enregistre un retrait sur une date individuelle */
export async function POST(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const car = await resolveCar(body.carId);
    const paymentMethod = parsePaymentMethod(body.paymentMethod);

    if (!body.date || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json(
        { error: "La date du retrait est invalide (format attendu AAAA-MM-JJ)." },
        { status: 400 }
      );
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Le montant du retrait doit être un nombre positif." },
        { status: 400 }
      );
    }

    const date = new Date(`${body.date}T12:00:00.000Z`);
    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

    const withdrawal = await db.withdrawal.create({
      data: { carId: car.id, date, amount, paymentMethod, note },
    });

    return NextResponse.json(serialize(withdrawal), { status: 201 });
  } catch (error) {
    console.error("POST /api/withdrawals:", error);
    return NextResponse.json(
      { error: "Impossible d'enregistrer le retrait." },
      { status: 500 }
    );
  }
}
