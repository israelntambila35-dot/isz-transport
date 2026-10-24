import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { parseLoanKind } from "@/lib/cars-server";

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

/** PUT /api/loans/[id] — modifie un prêt / emprunt (ou enregistre un remboursement) */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const existing = await db.loan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Prêt / emprunt introuvable." }, { status: 404 });
    }

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.kind !== undefined) data.kind = parseLoanKind(body.kind);
    if (body.person !== undefined) {
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
      data.person = person;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json(
          { error: "Le montant doit être un nombre positif." },
          { status: 400 }
        );
      }
      data.amount = amount;
    }
    if (body.date !== undefined) {
      if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        return NextResponse.json(
          { error: "La date est invalide (format attendu AAAA-MM-JJ)." },
          { status: 400 }
        );
      }
      data.date = new Date(`${body.date}T12:00:00.000Z`);
    }
    if (body.dueDate !== undefined) {
      if (body.dueDate == null || body.dueDate === "") {
        data.dueDate = null;
      } else if (typeof body.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
        data.dueDate = new Date(`${body.dueDate}T12:00:00.000Z`);
      } else {
        return NextResponse.json(
          { error: "La date d'échéance est invalide (format attendu AAAA-MM-JJ)." },
          { status: 400 }
        );
      }
    }
    if (body.repaidAmount !== undefined) {
      const repaid = Number(body.repaidAmount);
      if (!Number.isFinite(repaid) || repaid < 0) {
        return NextResponse.json(
          { error: "Le montant remboursé doit être un nombre positif ou nul." },
          { status: 400 }
        );
      }
      data.repaidAmount = repaid;
    }
    if (body.note !== undefined) {
      data.note =
        typeof body.note === "string" && body.note.trim()
          ? body.note.trim().slice(0, 200)
          : null;
    }

    const updated = await db.loan.update({ where: { id }, data });
    return NextResponse.json(serialize(updated));
  } catch (error) {
    console.error("PUT /api/loans/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de modifier le prêt / emprunt." },
      { status: 500 }
    );
  }
}

/** DELETE /api/loans/[id] — supprime un prêt / emprunt */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const existing = await db.loan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Prêt / emprunt introuvable." }, { status: 404 });
    }
    await db.loan.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/loans/[id]:", error);
    return NextResponse.json(
      { error: "Impossible de supprimer le prêt / emprunt." },
      { status: 500 }
    );
  }
}
