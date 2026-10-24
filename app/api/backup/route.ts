import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { ensureCars } from "@/lib/cars-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/backup — télécharge une sauvegarde complète (voitures + semaines + retraits
 * + mouvements de caisse + prêts/emprunts) en JSON.
 * v5 : caisse manuelle (soldes de départ, mouvements) + prêts & emprunts.
 */
export async function GET(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    await ensureCars();
    const settings = await db.settings.findUnique({ where: { id: "settings" } });
    const cars = await db.car.findMany({ orderBy: { createdAt: "asc" } });
    const weeks = await db.weeklyEntry.findMany({
      orderBy: { weekStart: "asc" },
      include: { days: { orderBy: { dayIndex: "asc" } } },
    });
    const withdrawals = await db.withdrawal.findMany({
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    const cashMovements = await db.cashMovement.findMany({
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    const loans = await db.loan.findMany({
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    const backup = {
      application: "ISZTRANSPORT",
      version: 5,
      exportedAt: new Date().toISOString(),
      activeCarIndex: Math.max(0, cars.findIndex((c) => c.id === (settings?.activeCarId ?? ""))),
      activeCarId: settings?.activeCarId ?? null,
      cars: cars.map((c) => ({
        name: c.name,
        carPriceUsd: c.carPriceUsd,
        exchangeRate: c.exchangeRate,
        dailyRevenue: c.dailyRevenue,
        activeDaysPerWeek: c.activeDaysPerWeek,
        weeklySavingsTarget: c.weeklySavingsTarget,
        startDate: c.startDate.toISOString().slice(0, 10),
        openingEspeces: c.openingEspeces,
        openingBanque: c.openingBanque,
      })),
      weeks: weeks.map((w) => ({
        carIndex: Math.max(0, cars.findIndex((c) => c.id === w.carId)),
        weekStart: w.weekStart.toISOString().slice(0, 10),
        weekEnd: w.weekEnd ? w.weekEnd.toISOString().slice(0, 10) : null,
        revenueWeek: w.revenueWeek,
        savedAmount: w.savedAmount,
        fuelExpense: w.fuelExpense,
        maintenanceExpense: w.maintenanceExpense,
        driverSaturday: w.driverSaturday,
        otherExpenses: w.otherExpenses,
        paymentMethod: w.paymentMethod === "banque" ? "banque" : "especes",
        note: w.note,
        days: w.days.map((d) => ({
          dayIndex: d.dayIndex,
          revenue: d.revenue,
          savedAmount: d.savedAmount,
          expense: d.expense,
          note: d.note,
        })),
      })),
      withdrawals: withdrawals.map((w) => ({
        carIndex: Math.max(0, cars.findIndex((c) => c.id === w.carId)),
        date: w.date.toISOString().slice(0, 10),
        amount: w.amount,
        paymentMethod: w.paymentMethod === "banque" ? "banque" : "especes",
        note: w.note,
      })),
      cashMovements: cashMovements.map((m) => ({
        carIndex: Math.max(0, cars.findIndex((c) => c.id === m.carId)),
        date: m.date.toISOString().slice(0, 10),
        mode: m.mode === "banque" ? "banque" : "especes",
        direction: m.direction === "sortie" ? "sortie" : "entree",
        amount: m.amount,
        note: m.note,
      })),
      loans: loans.map((l) => ({
        carIndex: Math.max(0, cars.findIndex((c) => c.id === l.carId)),
        kind: l.kind === "emprunt" ? "emprunt" : "pret",
        person: l.person,
        amount: l.amount,
        date: l.date.toISOString().slice(0, 10),
        dueDate: l.dueDate ? l.dueDate.toISOString().slice(0, 10) : null,
        repaidAmount: l.repaidAmount,
        note: l.note,
      })),
    };

    const dateStr = backup.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="isztransport-sauvegarde-${dateStr}.json"`,
      },
    });
  } catch (error) {
    console.error("GET /api/backup:", error);
    return NextResponse.json(
      { error: "Impossible de générer la sauvegarde." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/backup — restaure une sauvegarde : remplace TOUTES les voitures,
 * les semaines, les retraits, les mouvements de caisse et les prêts/emprunts
 * par le contenu du fichier.
 * Rétrocompatible v1–v4 (une seule voiture implicite, sections facultatives).
 */
export async function POST(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();

    // --- Validation des paramètres (v1–v3 : section unique ; v4 : facultative) ---
    const s = body?.settings;
    if (!s || typeof s !== "object") {
      // v4 sans section settings : les paramètres viennent des voitures
      if (!Array.isArray(body?.cars) || body.cars.length === 0) {
        return NextResponse.json({ error: "Sauvegarde invalide : paramètres manquants." }, { status: 400 });
      }
    }
    const num = (v: unknown) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const validDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

    // Section settings héritée (sert aussi de base pour l'import v1–v3)
    const legacy = s && typeof s === "object" ? s : {};
    const legacySettings = {
      carPriceUsd: num(legacy.carPriceUsd) ?? 3000,
      exchangeRate: num(legacy.exchangeRate) ?? 2350,
      dailyRevenue: num(legacy.dailyRevenue) ?? 30000,
      activeDaysPerWeek: Number.isInteger(Number(legacy.activeDaysPerWeek))
        ? Math.min(7, Math.max(1, Number(legacy.activeDaysPerWeek)))
        : 5,
      weeklySavingsTarget: num(legacy.weeklySavingsTarget) ?? 100000,
      startDate: validDate(legacy.startDate) ? legacy.startDate : new Date().toISOString().slice(0, 10),
    };

    // --- Validation des voitures (v4, facultatif) ---
    const parsedCars: Array<{
      name: string;
      carPriceUsd: number;
      exchangeRate: number;
      dailyRevenue: number;
      activeDaysPerWeek: number;
      weeklySavingsTarget: number;
      startDate: Date;
      openingEspeces: number;
      openingBanque: number;
    }> = [];
    if (Array.isArray(body.cars) && body.cars.length > 0) {
      for (const c of body.cars) {
        const name = typeof c?.name === "string" && c.name.trim() ? c.name.trim() : "";
        if (!name || name.length > 40) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : nom de voiture incorrect." },
            { status: 400 }
          );
        }
        const fields = {
          carPriceUsd: num(c.carPriceUsd),
          exchangeRate: num(c.exchangeRate),
          dailyRevenue: num(c.dailyRevenue),
          weeklySavingsTarget: num(c.weeklySavingsTarget),
        };
        if (Object.values(fields).some((v) => v === null)) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : paramètres de voiture incorrects." },
            { status: 400 }
          );
        }
        const days = Number(c.activeDaysPerWeek);
        parsedCars.push({
          name,
          carPriceUsd: fields.carPriceUsd!,
          exchangeRate: fields.exchangeRate!,
          dailyRevenue: fields.dailyRevenue!,
          activeDaysPerWeek: Number.isInteger(days) ? Math.min(7, Math.max(1, days)) : 5,
          weeklySavingsTarget: fields.weeklySavingsTarget!,
          startDate: new Date(
            `${validDate(c.startDate) ? c.startDate : legacySettings.startDate}T12:00:00.000Z`
          ),
          openingEspeces: num(c.openingEspeces) ?? 0,
          openingBanque: num(c.openingBanque) ?? 0,
        });
      }
    } else {
      // Sauvegarde v1–v3 : une seule voiture issue de la section settings
      parsedCars.push({
        name: "Ma voiture",
        ...legacySettings,
        startDate: new Date(`${legacySettings.startDate}T12:00:00.000Z`),
        openingEspeces: 0,
        openingBanque: 0,
      });
    }

    // --- Validation des semaines ---
    if (!Array.isArray(body.weeks)) {
      return NextResponse.json({ error: "Sauvegarde invalide : liste des semaines manquante." }, { status: 400 });
    }
    const parsedWeeks: Array<{
      carIndex: number;
      weekStart: Date;
      weekEnd: Date | null;
      revenueWeek: number;
      savedAmount: number;
      fuelExpense: number;
      maintenanceExpense: number;
      driverSaturday: number;
      otherExpenses: number;
      paymentMethod: string;
      note: string | null;
      days: Array<{ dayIndex: number; revenue: number; savedAmount: number; expense: number; note: string | null }>;
    }> = [];
    for (const w of body.weeks) {
      const weekStart = typeof w?.weekStart === "string" ? w.weekStart : "";
      if (!validDate(weekStart)) {
        return NextResponse.json({ error: "Sauvegarde invalide : date de semaine incorrecte." }, { status: 400 });
      }
      const values = {
        revenueWeek: num(w.revenueWeek),
        savedAmount: num(w.savedAmount),
        fuelExpense: num(w.fuelExpense),
        maintenanceExpense: num(w.maintenanceExpense),
        driverSaturday: num(w.driverSaturday),
        otherExpenses: num(w.otherExpenses),
      };
      if (Object.values(values).some((v) => v === null)) {
        return NextResponse.json(
          { error: "Sauvegarde invalide : les montants doivent être des nombres positifs." },
          { status: 400 }
        );
      }
      let weekEnd: Date | null = null;
      if (w.weekEnd != null && w.weekEnd !== "") {
        if (!validDate(w.weekEnd)) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : date de fin de semaine incorrecte." },
            { status: 400 }
          );
        }
        weekEnd = new Date(`${w.weekEnd}T12:00:00.000Z`);
        if (weekEnd.getTime() < new Date(`${weekStart}T12:00:00.000Z`).getTime()) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : la fin de semaine est avant le début." },
            { status: 400 }
          );
        }
      }
      const carIndex = Number.isInteger(Number(w.carIndex))
        ? Math.min(parsedCars.length - 1, Math.max(0, Number(w.carIndex)))
        : 0;
      parsedWeeks.push({
        carIndex,
        weekStart: new Date(`${weekStart}T12:00:00.000Z`),
        weekEnd,
        ...values,
        revenueWeek: values.revenueWeek!,
        savedAmount: values.savedAmount!,
        fuelExpense: values.fuelExpense!,
        maintenanceExpense: values.maintenanceExpense!,
        driverSaturday: values.driverSaturday!,
        otherExpenses: values.otherExpenses!,
        paymentMethod: w.paymentMethod === "banque" ? "banque" : "especes",
        note: typeof w.note === "string" && w.note.trim() ? w.note.trim() : null,
        days: (Array.isArray(w.days) ? w.days : []).map(
          (d: Record<string, unknown>, i: number) => {
            const dayIndex = Number(d?.dayIndex ?? i);
            if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 62) {
              throw new Error("jour");
            }
            const revenue = num(d?.revenue);
            const savedDay = num(d?.savedAmount);
            const expense = num(d?.expense);
            if (revenue === null || savedDay === null || expense === null) {
              throw new Error("montant-jour");
            }
            return {
              dayIndex,
              revenue,
              savedAmount: savedDay,
              expense,
              note: typeof d?.note === "string" && d.note.trim() ? d.note.trim() : null,
            };
          }
        ),
      });
    }

    // --- Validation des retraits (facultatifs — rétrocompatible v1) ---
    const parsedWithdrawals: Array<{
      carIndex: number;
      date: Date;
      amount: number;
      paymentMethod: string;
      note: string | null;
    }> = [];
    if (body.withdrawals != null) {
      if (!Array.isArray(body.withdrawals)) {
        return NextResponse.json(
          { error: "Sauvegarde invalide : liste des retraits incorrecte." },
          { status: 400 }
        );
      }
      for (const wd of body.withdrawals) {
        if (!validDate(wd?.date)) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : date de retrait incorrecte." },
            { status: 400 }
          );
        }
        const amount = Number(wd?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : les montants des retraits doivent être positifs." },
            { status: 400 }
          );
        }
        parsedWithdrawals.push({
          carIndex: Number.isInteger(Number(wd.carIndex))
            ? Math.min(parsedCars.length - 1, Math.max(0, Number(wd.carIndex)))
            : 0,
          date: new Date(`${wd.date}T12:00:00.000Z`),
          amount,
          paymentMethod: wd.paymentMethod === "banque" ? "banque" : "especes",
          note: typeof wd?.note === "string" && wd.note.trim() ? wd.note.trim() : null,
        });
      }
    }

    // --- Validation des mouvements de caisse (facultatifs — rétrocompatible v4) ---
    const parsedMovements: Array<{
      carIndex: number;
      date: Date;
      mode: string;
      direction: string;
      amount: number;
      note: string | null;
    }> = [];
    if (body.cashMovements != null) {
      if (!Array.isArray(body.cashMovements)) {
        return NextResponse.json(
          { error: "Sauvegarde invalide : liste des mouvements de caisse incorrecte." },
          { status: 400 }
        );
      }
      for (const m of body.cashMovements) {
        if (!validDate(m?.date)) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : date de mouvement de caisse incorrecte." },
            { status: 400 }
          );
        }
        const amount = Number(m?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : les montants des mouvements doivent être positifs." },
            { status: 400 }
          );
        }
        parsedMovements.push({
          carIndex: Number.isInteger(Number(m.carIndex))
            ? Math.min(parsedCars.length - 1, Math.max(0, Number(m.carIndex)))
            : 0,
          date: new Date(`${m.date}T12:00:00.000Z`),
          mode: m.mode === "banque" ? "banque" : "especes",
          direction: m.direction === "sortie" ? "sortie" : "entree",
          amount,
          note: typeof m?.note === "string" && m.note.trim() ? m.note.trim() : null,
        });
      }
    }

    // --- Validation des prêts / emprunts (facultatifs — rétrocompatible v4) ---
    const parsedLoans: Array<{
      carIndex: number;
      kind: string;
      person: string;
      amount: number;
      date: Date;
      dueDate: Date | null;
      repaidAmount: number;
      note: string | null;
    }> = [];
    if (body.loans != null) {
      if (!Array.isArray(body.loans)) {
        return NextResponse.json(
          { error: "Sauvegarde invalide : liste des prêts/emprunts incorrecte." },
          { status: 400 }
        );
      }
      for (const l of body.loans) {
        if (!validDate(l?.date)) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : date de prêt/emprunt incorrecte." },
            { status: 400 }
          );
        }
        const amount = Number(l?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : les montants des prêts doivent être positifs." },
            { status: 400 }
          );
        }
        const person =
          typeof l?.person === "string" && l.person.trim() ? l.person.trim().slice(0, 60) : "";
        if (!person) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : nom de personne manquant sur un prêt/emprunt." },
            { status: 400 }
          );
        }
        const repaid = Number(l?.repaidAmount ?? 0);
        if (!Number.isFinite(repaid) || repaid < 0) {
          return NextResponse.json(
            { error: "Sauvegarde invalide : montant remboursé incorrect." },
            { status: 400 }
          );
        }
        let dueDate: Date | null = null;
        if (l?.dueDate != null && l.dueDate !== "") {
          if (!validDate(l.dueDate)) {
            return NextResponse.json(
              { error: "Sauvegarde invalide : échéance de prêt incorrecte." },
              { status: 400 }
            );
          }
          dueDate = new Date(`${l.dueDate}T12:00:00.000Z`);
        }
        parsedLoans.push({
          carIndex: Number.isInteger(Number(l.carIndex))
            ? Math.min(parsedCars.length - 1, Math.max(0, Number(l.carIndex)))
            : 0,
          kind: l.kind === "emprunt" ? "emprunt" : "pret",
          person,
          amount,
          date: new Date(`${l.date}T12:00:00.000Z`),
          dueDate,
          repaidAmount: repaid,
          note: typeof l?.note === "string" && l.note.trim() ? l.note.trim() : null,
        });
      }
    }

    // --- Restauration dans une transaction : tout remplace ou rien ---
    await ensureCars();
    await db.$transaction(async (tx) => {
      await tx.dayEntry.deleteMany();
      await tx.weeklyEntry.deleteMany();
      await tx.withdrawal.deleteMany();
      await tx.cashMovement.deleteMany();
      await tx.loan.deleteMany();
      await tx.car.deleteMany();

      const createdCars = [];
      for (const c of parsedCars) {
        createdCars.push(await tx.car.create({ data: c }));
      }

      // Mettre à jour la ligne settings héritée (compat) + voiture active
      const activeIndex = Number.isInteger(Number(body.activeCarIndex))
        ? Math.min(createdCars.length - 1, Math.max(0, Number(body.activeCarIndex)))
        : 0;
      const activeCar = createdCars[activeIndex] ?? createdCars[0];
      await tx.settings.update({
        where: { id: "settings" },
        data: {
          activeCarId: activeCar.id,
          carPriceUsd: activeCar.carPriceUsd,
          exchangeRate: activeCar.exchangeRate,
          dailyRevenue: activeCar.dailyRevenue,
          activeDaysPerWeek: activeCar.activeDaysPerWeek,
          weeklySavingsTarget: activeCar.weeklySavingsTarget,
          startDate: activeCar.startDate,
        },
      });

      if (parsedWithdrawals.length > 0) {
        await tx.withdrawal.createMany({
          data: parsedWithdrawals.map((w) => ({
            carId: createdCars[w.carIndex].id,
            date: w.date,
            amount: w.amount,
            paymentMethod: w.paymentMethod,
            note: w.note,
          })),
        });
      }
      if (parsedMovements.length > 0) {
        await tx.cashMovement.createMany({
          data: parsedMovements.map((m) => ({
            carId: createdCars[m.carIndex].id,
            date: m.date,
            amount: m.amount,
            mode: m.mode,
            direction: m.direction,
            note: m.note,
          })),
        });
      }
      if (parsedLoans.length > 0) {
        await tx.loan.createMany({
          data: parsedLoans.map((l) => ({
            carId: createdCars[l.carIndex].id,
            kind: l.kind,
            person: l.person,
            amount: l.amount,
            date: l.date,
            dueDate: l.dueDate,
            repaidAmount: l.repaidAmount,
            note: l.note,
          })),
        });
      }
      for (const w of parsedWeeks) {
        const { days, carIndex, ...weekData } = w;
        const created = await tx.weeklyEntry.create({
          data: { ...weekData, carId: createdCars[carIndex].id },
        });
        if (days.length > 0) {
          await tx.dayEntry.createMany({
            data: days.map((d) => {
              const date = new Date(created.weekStart);
              date.setUTCDate(date.getUTCDate() + d.dayIndex);
              return { ...d, weekId: created.id, date };
            }),
          });
        }
      }
    });

    return NextResponse.json({
      ok: true,
      restoredCars: parsedCars.length,
      restoredWeeks: parsedWeeks.length,
      restoredWithdrawals: parsedWithdrawals.length,
      restoredCashMovements: parsedMovements.length,
      restoredLoans: parsedLoans.length,
    });
  } catch (error) {
    console.error("POST /api/backup:", error);
    return NextResponse.json(
      { error: "Impossible de restaurer la sauvegarde." },
      { status: 500 }
    );
  }
}
