import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { parsePaymentMethod, resolveCar } from "@/lib/cars-server";
import { parseDays, parseWeekRange, serializeWeek } from "@/lib/weeks-server";

export const dynamic = "force-dynamic";

/** GET /api/weeks?carId=… — semaines de la voiture (plus récentes d'abord) */
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
      orderBy: { weekStart: "desc" },
      include: { days: { orderBy: { dayIndex: "asc" } } },
    });
    return NextResponse.json(weeks.map(serializeWeek));
  } catch (error) {
    console.error("GET /api/weeks:", error);
    return NextResponse.json(
      { error: "Impossible de charger l'historique." },
      { status: 500 }
    );
  }
}

/** POST /api/weeks — crée une semaine (ou remplace si le début existe déjà) + son détail par jour */
export async function POST(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const car = await resolveCar(body.carId);
    const paymentMethod = parsePaymentMethod(body.paymentMethod);

    // Début + fin choisis par l'utilisateur sur le calendrier
    const range = parseWeekRange(body.weekStart, body.weekEnd ?? null);
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }
    const { weekStart, weekEnd } = range;

    const num = (v: unknown, label: string) => {
      const n = Number(v ?? 0);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${label} doit être un montant positif.`);
      }
      return n;
    };

    let revenueWeek: number, savedAmount: number, fuelExpense: number, maintenanceExpense: number, driverSaturday: number, otherExpenses: number;
    try {
      revenueWeek = num(body.revenueWeek, "La recette de la semaine");
      savedAmount = num(body.savedAmount, "Le montant versé par le chauffeur");
      fuelExpense = num(body.fuelExpense, "Les dépenses carburant");
      maintenanceExpense = num(body.maintenanceExpense, "Les dépenses d'entretien");
      driverSaturday = num(body.driverSaturday, "Le montant du chauffeur");
      otherExpenses = num(body.otherExpenses, "Les autres dépenses");
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    const parsedDays = parseDays(body.days, { weekStart });
    if (!parsedDays.ok) {
      return NextResponse.json({ error: parsedDays.error }, { status: 400 });
    }

    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

    // Upsert de la semaine (par voiture + début) + remplacement du détail des jours
    const week = await db.$transaction(async (tx) => {
      const entry = await tx.weeklyEntry.upsert({
        where: { carId_weekStart: { carId: car.id, weekStart } },
        update: {
          weekEnd,
          revenueWeek,
          savedAmount,
          fuelExpense,
          maintenanceExpense,
          driverSaturday,
          otherExpenses,
          paymentMethod,
          note,
        },
        create: {
          carId: car.id,
          weekStart,
          weekEnd,
          revenueWeek,
          savedAmount,
          fuelExpense,
          maintenanceExpense,
          driverSaturday,
          otherExpenses,
          paymentMethod,
          note,
        },
      });

      if (parsedDays.days.length > 0) {
        await tx.dayEntry.deleteMany({ where: { weekId: entry.id } });
        await tx.dayEntry.createMany({
          data: parsedDays.days.map((d) => ({
            weekId: entry.id,
            dayIndex: d.dayIndex,
            date: d.date,
            revenue: d.revenue,
            savedAmount: d.savedAmount,
            expense: d.expense,
            note: d.note,
          })),
        });
      }

      return tx.weeklyEntry.findUniqueOrThrow({
        where: { id: entry.id },
        include: { days: { orderBy: { dayIndex: "asc" } } },
      });
    });

    return NextResponse.json(serializeWeek(week), { status: 201 });
  } catch (error) {
    console.error("POST /api/weeks:", error);
    return NextResponse.json(
      { error: "Impossible d'enregistrer la semaine." },
      { status: 500 }
    );
  }
}
