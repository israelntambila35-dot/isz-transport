import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { parsePaymentMethod } from "@/lib/cars-server";

export const dynamic = "force-dynamic";

/**
 * PUT /api/withdrawals/[id] — modifie un retrait (date, montant, note, mode).
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

    const existing = await db.withdrawal.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Retrait introuvable." }, { status: 404 });
    }

    if (!body.date || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "La date du retrait est invalide." }, { status: 400 });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Le montant du retrait doit être un nombre positif." },
        { status: 400 }
      );
    }

    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
    const paymentMethod =
      body.paymentMethod !== undefined ? parsePaymentMethod(body.paymentMethod) : undefined;

    const updated = await db.withdrawal.update({
      where: { id },
      data: {
        date: new Date(`${body.date}T12:00:00.000Z`),
        amount,
        ...(paymentMethod ? { paymentMethod } : {}),
        note,
      },
    });

    return NextResponse.json({
      ...updated,
      paymentMethod: updated.paymentMethod === "banque" ? "banque" : "especes",
      date: updated.date.toISOString(),
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("PUT /api/withdrawals/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de modifier le retrait." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/withdrawals/[id] — supprime un retrait.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const existing = await db.withdrawal.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Retrait introuvable." }, { status: 404 });
    }
    await db.withdrawal.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/withdrawals/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de supprimer le retrait." },
      { status: 500 }
    );
  }
}
