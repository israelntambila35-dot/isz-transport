import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { parsePaymentMethod } from "@/lib/cars-server";
import { parseDays, parseWeekRange, serializeWeek } from "@/lib/weeks-server";

export const dynamic = "force-dynamic";

/** PUT /api/weeks/[id] — modifie une semaine existante (dates, montants, détail par jour) */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.weeklyEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Semaine introuvable." }, { status: 404 });
    }

    // Début + fin : on garde les valeurs existantes si non fournies
    const range = parseWeekRange(
      body.weekStart ?? existing.weekStart.toISOString().slice(0, 10),
      body.weekEnd !== undefined ? body.weekEnd : (existing.weekEnd?.toISOString().slice(0, 10) ?? null)
    );
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

    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

    // Mode d'encaissement : espèces ou banque (si fourni)
    const paymentMethod =
      body.paymentMethod !== undefined ? parsePaymentMethod(body.paymentMethod) : undefined;

    const updated = await db.$transaction(async (tx) => {
      await tx.weeklyEntry.update({
        where: { id },
        data: {
          weekStart,
          weekEnd,
          revenueWeek,
          savedAmount,
          fuelExpense,
          maintenanceExpense,
          driverSaturday,
          otherExpenses,
          ...(paymentMethod ? { paymentMethod } : {}),
          note,
        },
      });

      // Le détail des jours est remplacé (s'il est fourni)
      if (Array.isArray(body.days)) {
        await tx.dayEntry.deleteMany({ where: { weekId: id } });
        if (parsedDays.days.length > 0) {
          await tx.dayEntry.createMany({
            data: parsedDays.days.map((d) => ({
              weekId: id,
              dayIndex: d.dayIndex,
              date: d.date,
              revenue: d.revenue,
              savedAmount: d.savedAmount,
              expense: d.expense,
              note: d.note,
            })),
          });
        }
      }

      return tx.weeklyEntry.findUniqueOrThrow({
        where: { id },
        include: { days: { orderBy: { dayIndex: "asc" } } },
      });
    });

    return NextResponse.json(serializeWeek(updated));
  } catch (error) {
    console.error("PUT /api/weeks/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de modifier la semaine." },
      { status: 500 }
    );
  }
}

/** DELETE /api/weeks/[id] — supprime une semaine (et son détail par jour, en cascade) */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const existing = await db.weeklyEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Semaine introuvable." }, { status: 404 });
    }
    await db.weeklyEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/weeks/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de supprimer la semaine." },
      { status: 500 }
    );
  }
}
