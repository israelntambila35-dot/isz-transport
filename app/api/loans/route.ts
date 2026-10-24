import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { parseLoanKind, resolveCar } from "@/lib/cars-server";

export const dynamic = "force-dynamic";

/** Sérialise un prêt / emprunt pour le JSON (dates en ISO) */
function serialize(l: {
  id: string;
  carId?: string | null;
  kind?: string;
  person: string;
  amount: number;
  date: Date;
  dueDate: Date | null;
  repaidAmount: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...l,
    carId: l.carId ?? "",
    kind: l.kind === "emprunt" ? "emprunt" : "pret",
    date: l.date.toISOString(),
    dueDate: l.dueDate ? l.dueDate.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

/** GET /api/loans?carId=… — prêts et emprunts de la voiture (plus récents d'abord) */
export async function GET(request: Request) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const car = await resolveCar(url.searchParams.get("carId"));
    const loans = await db.loan.findMany({
      where: { carId: car.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json(loans.map(serialize));
  } catch (error) {
    console.error("GET /api/loans:", error);
    return NextResponse.json(
      { error: "Impossible de charger les prêts et emprunts." },
      { status: 500 }
    );
  }
}

/** POST /api/loans — enregistre un prêt (argent donné) ou un emprunt (argent reçu) */
export async function POST(request: Request) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const car = await resolveCar(body.carId);
    const kind = parseLoanKind(body.kind);

    const person =
      typeof body.person === "string" && body.person.trim()
        ? body.person.trim().slice(0, 60)
        : "";
    if (!person) {
      return NextResponse.json(
        { error: "Veuillez indiquer le nom de la personne." },
        { status: 400 }
      );
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Le montant doit être un nombre positif." },
        { status: 400 }
      );
    }

    if (!body.date || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json(
        { error: "La date est invalide (format attendu AAAA-MM-JJ)." },
        { status: 400 }
      );
    }
    const date = new Date(`${body.date}T12:00:00.000Z`);

    let dueDate: Date | null = null;
    if (body.dueDate != null && body.dueDate !== "") {
      if (typeof body.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
        return NextResponse.json(
          { error: "La date d'échéance est invalide (format attendu AAAA-MM-JJ)." },
          { status: 400 }
        );
      }
      dueDate = new Date(`${body.dueDate}T12:00:00.000Z`);
    }

    const repaidAmount = body.repaidAmount !== undefined ? Number(body.repaidAmount) : 0;
    if (!Number.isFinite(repaidAmount) || repaidAmount < 0) {
      return NextResponse.json(
        { error: "Le montant remboursé doit être un nombre positif ou nul." },
        { status: 400 }
      );
    }

    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;

    const loan = await db.loan.create({
      data: { carId: car.id, kind, person, amount, date, dueDate, repaidAmount, note },
    });

    return NextResponse.json(serialize(loan), { status: 201 });
  } catch (error) {
    console.error("POST /api/loans:", error);
    return NextResponse.json(
      { error: "Impossible d'enregistrer le prêt / emprunt." },
      { status: 500 }
    );
  }
}
