import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { serializeWeek } from "@/lib/weeks-server";
import { MAX_WEEK_LENGTH_DAYS } from "@/lib/weeks";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/** Retrouve la semaine complète (avec ses jours) après mutation */
async function weekWithDays(weekId: string) {
  return db.weeklyEntry.findUniqueOrThrow({
    where: { id: weekId },
    include: { days: { orderBy: { dayIndex: "asc" } } },
  });
}

/**
 * POST /api/weeks/[id]/days — ajoute ou modifie le montant versé UN jour
 * donné de la semaine (ex : le 16, le 17, le 18…).
 * Corps : { date: "YYYY-MM-DD", savedAmount, revenue?, expense?, note? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();

    const week = await db.weeklyEntry.findUnique({ where: { id } });
    if (!week) {
      return NextResponse.json({ error: "Semaine introuvable." }, { status: 404 });
    }

    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json(
        { error: "La date du jour est invalide (format attendu AAAA-MM-JJ)." },
        { status: 400 }
      );
    }
    const date = new Date(`${body.date}T12:00:00.000Z`);
    const dayIndex = Math.round((date.getTime() - week.weekStart.getTime()) / DAY_MS);
    if (dayIndex < 0 || dayIndex > MAX_WEEK_LENGTH_DAYS) {
      return NextResponse.json(
        { error: "Ce jour ne fait pas partie de la semaine choisie." },
        { status: 400 }
      );
    }

    const num = (v: unknown) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const savedAmount = num(body.savedAmount);
    if (savedAmount === null) {
      return NextResponse.json(
        { error: "Le montant versé doit être un nombre positif." },
        { status: 400 }
      );
    }
    const revenue = num(body.revenue) ?? 0;
    const expense = num(body.expense) ?? 0;
    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

    await db.dayEntry.upsert({
      where: { weekId_dayIndex: { weekId: id, dayIndex } },
      update: { date, revenue, savedAmount, expense, note },
      create: { weekId: id, dayIndex, date, revenue, savedAmount, expense, note },
    });

    const updated = await weekWithDays(id);
    return NextResponse.json(serializeWeek(updated), { status: 201 });
  } catch (error) {
    console.error("POST /api/weeks/[id]/days:", error);
    return NextResponse.json(
      { error: "Impossible d'enregistrer le jour." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/weeks/[id]/days?date=YYYY-MM-DD — efface le montant d'un jour
 * (le jour redevient vide dans le calendrier).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const dateRaw = url.searchParams.get("date");

    const week = await db.weeklyEntry.findUnique({ where: { id } });
    if (!week) {
      return NextResponse.json({ error: "Semaine introuvable." }, { status: 404 });
    }
    if (!dateRaw || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return NextResponse.json(
        { error: "La date du jour est invalide (format attendu AAAA-MM-JJ)." },
        { status: 400 }
      );
    }

    const date = new Date(`${dateRaw}T12:00:00.000Z`);
    const dayIndex = Math.round((date.getTime() - week.weekStart.getTime()) / DAY_MS);

    await db.dayEntry.deleteMany({ where: { weekId: id, dayIndex } });

    const updated = await weekWithDays(id);
    return NextResponse.json(serializeWeek(updated));
  } catch (error) {
    console.error("DELETE /api/weeks/[id]/days:", error);
    return NextResponse.json(
      { error: "Impossible de supprimer le jour." },
      { status: 500 }
    );
  }
}
