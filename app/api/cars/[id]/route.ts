import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { serializeCarWithCounts } from "@/lib/cars-server";

export const dynamic = "force-dynamic";

/**
 * PUT /api/cars/[id] — renomme une voiture (et/ou ajuste ses paramètres).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.car.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Voiture introuvable." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "Le nom ne peut pas être vide." }, { status: 400 });
      }
      if (name.length > 40) {
        return NextResponse.json(
          { error: "Le nom de la voiture est trop long (40 caractères maximum)." },
          { status: 400 }
        );
      }
      data.name = name;
    }
    for (const field of ["carPriceUsd", "exchangeRate", "dailyRevenue", "weeklySavingsTarget"]) {
      if (body[field] !== undefined) {
        const n = Number(body[field]);
        if (!Number.isFinite(n) || n <= 0) {
          return NextResponse.json(
            { error: "Les montants doivent être des nombres positifs." },
            { status: 400 }
          );
        }
        data[field] = n;
      }
    }
    if (body.activeDaysPerWeek !== undefined) {
      const d = Number(body.activeDaysPerWeek);
      if (!Number.isInteger(d) || d < 1 || d > 7) {
        return NextResponse.json(
          { error: "Les jours actifs doivent être un entier entre 1 et 7." },
          { status: 400 }
        );
      }
      data.activeDaysPerWeek = d;
    }
    if (typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
      data.startDate = new Date(`${body.startDate}T12:00:00.000Z`);
    }
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

    const car = await db.car.update({
      where: { id },
      data,
      include: { _count: { select: { weeks: true, withdrawals: true } } },
    });
    return NextResponse.json(serializeCarWithCounts(car));
  } catch (error) {
    console.error("PUT /api/cars/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de modifier la voiture." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cars/[id] — supprime un compte voiture VIDE
 * (aucune semaine ni retrait). La dernière voiture ne peut pas être supprimée.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const existing = await db.car.findUnique({
      where: { id },
      include: {
        _count: { select: { weeks: true, withdrawals: true, cashMovements: true, loans: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Voiture introuvable." }, { status: 404 });
    }
    if (
      existing._count.weeks > 0 ||
      existing._count.withdrawals > 0 ||
      existing._count.cashMovements > 0 ||
      existing._count.loans > 0
    ) {
      return NextResponse.json(
        {
          error:
            "Cette voiture contient encore des semaines, retraits, mouvements de caisse ou prêts. Supprimez-les d'abord pour pouvoir supprimer la voiture.",
        },
        { status: 409 }
      );
    }
    const total = await db.car.count();
    if (total <= 1) {
      return NextResponse.json(
        { error: "Vous devez garder au moins une voiture." },
        { status: 400 }
      );
    }

    await db.car.delete({ where: { id } });

    // Si la voiture supprimée était active → basculer sur la première restante
    const settings = await db.settings.findUnique({ where: { id: "settings" } });
    if (settings?.activeCarId === id) {
      const next = await db.car.findFirst({ orderBy: { createdAt: "asc" } });
      if (next) {
        await db.settings.update({
          where: { id: "settings" },
          data: { activeCarId: next.id },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/cars/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de supprimer la voiture." },
      { status: 500 }
    );
  }
}
