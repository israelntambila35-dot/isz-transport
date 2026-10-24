import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import {
  parseCashDirection,
  parsePaymentMethod,
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

/** PUT /api/cash/[id] — modifie un mouvement manuel de caisse */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const existing = await db.cashMovement.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Mouvement introuvable." }, { status: 404 });
    }

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.date !== undefined) {
      if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        return NextResponse.json(
          { error: "La date du mouvement est invalide (format attendu AAAA-MM-JJ)." },
          { status: 400 }
        );
      }
      data.date = new Date(`${body.date}T12:00:00.000Z`);
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json(
          { error: "Le montant du mouvement doit être un nombre positif." },
          { status: 400 }
        );
      }
      data.amount = amount;
    }
    if (body.mode !== undefined) data.mode = parsePaymentMethod(body.mode);
    if (body.direction !== undefined) data.direction = parseCashDirection(body.direction);
    if (body.note !== undefined) {
      data.note =
        typeof body.note === "string" && body.note.trim()
          ? body.note.trim().slice(0, 200)
          : null;
    }

    const updated = await db.cashMovement.update({ where: { id }, data });
    return NextResponse.json(serialize(updated));
  } catch (error) {
    console.error("PUT /api/cash/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de modifier le mouvement de caisse." },
      { status: 500 }
    );
  }
}

/** DELETE /api/cash/[id] — supprime un mouvement manuel de caisse */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const existing = await db.cashMovement.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Mouvement introuvable." }, { status: 404 });
    }
    await db.cashMovement.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/cash/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de supprimer le mouvement de caisse." },
      { status: 500 }
    );
  }
}
