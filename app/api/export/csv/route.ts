import { NextResponse } from "next/server";
import { guardAccess } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { resolveCar } from "@/lib/cars-server";
import { weekSavedTotal } from "@/lib/weeks";

export const dynamic = "force-dynamic";

/** Échappe une valeur CSV (guillemets, séparateurs) */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Date en format lisible FR */
function frDate(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Libellé du mode d'encaissement */
function modeLabel(m: string): string {
  return m === "banque" ? "Banque" : "Espèces";
}

/** Clé de mois "AAAA-MM" d'une date */
function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Libellé du mois en français : "2026-10" → "octobre 2026" */
function frMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * GET /api/export/csv?carId=… — télécharge l'historique complet de la voiture :
 * semaines (début/fin, mode espèces/banque), détail jour par jour, retraits,
 * mouvements de caisse manuels, prêts & emprunts et un RÉSUMÉ MENSUEL.
 * Séparateur ";" + BOM UTF-8 pour ouverture directe dans Excel.
 */
export async function GET(
  request: Request
) {
  const denied = await guardAccess(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const car = await resolveCar(url.searchParams.get("carId"));
    const settings = car;
    const weeks = await db.weeklyEntry.findMany({
      where: { carId: car.id },
      orderBy: { weekStart: "asc" },
      include: { days: { orderBy: { dayIndex: "asc" } } },
    });
    const withdrawals = await db.withdrawal.findMany({
      where: { carId: car.id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    const cashMovements = await db.cashMovement.findMany({
      where: { carId: car.id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    const loans = await db.loan.findMany({
      where: { carId: car.id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    const carPriceFc = settings.carPriceUsd * settings.exchangeRate;
    const totalSaved = weeks.reduce((s, w) => s + weekSavedTotal(w), 0);
    const totalWithdrawn = withdrawals.reduce((s, w) => s + w.amount, 0);
    const netSaved = totalSaved - totalWithdrawn;

    const lines: string[] = [];

    // En-tête de contexte
    lines.push([`Rapport - ISZTRANSPORT - ${car.name}`].map(csvCell).join(";"));
    lines.push(
      [
        `Prix voiture (USD);Taux (FC/USD);Prix voiture (FC);Objectif versement/semaine (FC);Total versé (FC);Total retiré (FC);Versements nets (FC);Reste à rembourser (FC)`,
      ]
        .map(csvCell)
        .join(";")
    );
    lines.push(
      [
        fmt(settings.carPriceUsd),
        fmt(settings.exchangeRate),
        fmt(carPriceFc),
        fmt(settings.weeklySavingsTarget),
        fmt(totalSaved),
        fmt(totalWithdrawn),
        fmt(netSaved),
        fmt(Math.max(0, carPriceFc - netSaved)),
      ]
        .map(csvCell)
        .join(";")
    );
    lines.push("");

    // Détail des semaines (début et fin choisis par l'utilisateur)
    lines.push(
      [
        "Semaine du",
        "au",
        "Recette semaine (FC)",
        "Versé (FC)",
        "Solde restant après (FC)",
        "Mode d'encaissement",
        "Carburant (FC)",
        "Entretien (FC)",
        "Chauffeur samedi (FC)",
        "Autres dépenses (FC)",
        "Total dépenses (FC)",
        "Reste à rembourser après semaine (FC)",
        "Note",
      ]
        .map(csvCell)
        .join(";")
    );

    const withdrawalsAsc = [...withdrawals].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
    let cumulative = 0;
    for (const w of weeks) {
      const saved = weekSavedTotal(w);
      cumulative += saved;
      // Retraits effectués jusqu'à la fin de la semaine (inclus)
      const weekEndTime = w.weekEnd
        ? w.weekEnd.getTime()
        : w.weekStart.getTime() + 6 * 86_400_000;
      const withdrawnSoFar = withdrawalsAsc
        .filter((wd) => wd.date.getTime() <= weekEndTime)
        .reduce((s, wd) => s + wd.amount, 0);
      const solde = cumulative - withdrawnSoFar;
      const expenses = w.fuelExpense + w.maintenanceExpense + w.driverSaturday + w.otherExpenses;
      lines.push(
        [
          frDate(w.weekStart),
          w.weekEnd ? frDate(w.weekEnd) : "",
          fmt(w.revenueWeek),
          fmt(saved),
          fmt(solde),
          modeLabel(w.paymentMethod),
          fmt(w.fuelExpense),
          fmt(w.maintenanceExpense),
          fmt(w.driverSaturday),
          fmt(w.otherExpenses),
          fmt(expenses),
          fmt(Math.max(0, carPriceFc - solde)),
          w.note ?? "",
        ]
          .map(csvCell)
          .join(";")
      );
    }

    // Totaux
    if (weeks.length > 0) {
      lines.push("");
      const t = {
        revenue: weeks.reduce((s, w) => s + w.revenueWeek, 0),
        saved: totalSaved,
        espèces: weeks
          .filter((w) => w.paymentMethod !== "banque")
          .reduce((s, w) => s + weekSavedTotal(w), 0),
        banque: weeks
          .filter((w) => w.paymentMethod === "banque")
          .reduce((s, w) => s + weekSavedTotal(w), 0),
        fuel: weeks.reduce((s, w) => s + w.fuelExpense, 0),
        maint: weeks.reduce((s, w) => s + w.maintenanceExpense, 0),
        driver: weeks.reduce((s, w) => s + w.driverSaturday, 0),
        other: weeks.reduce((s, w) => s + w.otherExpenses, 0),
      };
      lines.push(
        [
          "TOTAUX",
          "",
          fmt(t.revenue),
          fmt(t.saved),
          fmt(netSaved),
          "",
          fmt(t.fuel),
          fmt(t.maint),
          fmt(t.driver),
          fmt(t.other),
          fmt(t.fuel + t.maint + t.driver + t.other),
          fmt(Math.max(0, carPriceFc - netSaved)),
          "",
        ]
          .map(csvCell)
          .join(";")
      );
    }

    // Détail jour par jour (montants versés individuellement : le 16, le 17, le 18…)
    const allDays = weeks.flatMap((w) =>
      (w.days ?? []).map((d) => ({ week: w, day: d }))
    );
    lines.push("");
    lines.push(["VERSEMENTS PAR JOUR"].map(csvCell).join(";"));
    if (allDays.length > 0) {
      lines.push(["Date", "Semaine du", "Versé ce jour (FC)", "Recette du jour (FC)", "Dépense du jour (FC)", "Note"].map(csvCell).join(";"));
      for (const { week, day } of allDays) {
        lines.push(
          [
            frDate(day.date),
            frDate(week.weekStart),
            fmt(day.savedAmount),
            fmt(day.revenue),
            fmt(day.expense),
            day.note ?? "",
          ]
            .map(csvCell)
            .join(";")
        );
      }
    } else {
      lines.push(["Aucun détail par jour enregistré"].map(csvCell).join(";"));
    }

    // Section des retraits (dates individuelles) avec solde restant après retrait
    lines.push("");
    lines.push(["RETRAITS"].map(csvCell).join(";"));
    if (withdrawals.length > 0) {
      lines.push(
        ["Date", "Montant (FC)", "Pris en", "Solde restant après retrait (FC)", "Motif"]
          .map(csvCell)
          .join(";")
      );
      let cumulOut = 0;
      for (const wd of withdrawalsAsc) {
        cumulOut += wd.amount;
        const cumulIn = weeks
          .filter((w) => w.weekStart.getTime() <= wd.date.getTime())
          .reduce((s, w) => s + weekSavedTotal(w), 0);
        lines.push(
          [frDate(wd.date), fmt(wd.amount), modeLabel(wd.paymentMethod), fmt(cumulIn - cumulOut), wd.note ?? ""]
            .map(csvCell)
            .join(";")
        );
      }
      lines.push(
        ["TOTAL RETRAITS", fmt(totalWithdrawn), "", fmt(netSaved), ""]
          .map(csvCell)
          .join(";")
      );
    } else {
      lines.push(["Aucun retrait enregistré"].map(csvCell).join(";"));
    }

    // RÉSUMÉ MENSUEL : encaissements et retraits par mois
    const months = new Map<
      string,
      { recette: number; verseEsp: number; verseBan: number; retEsp: number; retBan: number }
    >();
    const ensureMonth = (key: string) => {
      let m = months.get(key);
      if (!m) {
        m = { recette: 0, verseEsp: 0, verseBan: 0, retEsp: 0, retBan: 0 };
        months.set(key, m);
      }
      return m;
    };
    for (const w of weeks) {
      const m = ensureMonth(monthKey(w.weekStart));
      m.recette += w.revenueWeek;
      if (w.paymentMethod === "banque") m.verseBan += weekSavedTotal(w);
      else m.verseEsp += weekSavedTotal(w);
    }
    for (const wd of withdrawals) {
      const m = ensureMonth(monthKey(wd.date));
      if (wd.paymentMethod === "banque") m.retBan += wd.amount;
      else m.retEsp += wd.amount;
    }
    lines.push("");
    lines.push(["RÉSUMÉ MENSUEL"].map(csvCell).join(";"));
    if (months.size > 0) {
      lines.push(
        [
          "Mois",
          "Recette (FC)",
          "Versé en espèces (FC)",
          "Versé en banque (FC)",
          "Total versé (FC)",
          "Retraits espèces (FC)",
          "Retraits banque (FC)",
          "Net du mois (FC)",
        ]
          .map(csvCell)
          .join(";")
      );
      let cumul = 0;
      const sorted = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [key, m] of sorted) {
        const verse = m.verseEsp + m.verseBan;
        const ret = m.retEsp + m.retBan;
        cumul += verse - ret;
        lines.push(
          [
            frMonth(key),
            fmt(m.recette),
            fmt(m.verseEsp),
            fmt(m.verseBan),
            fmt(verse),
            fmt(m.retEsp),
            fmt(m.retBan),
            fmt(verse - ret),
          ]
            .map(csvCell)
            .join(";")
        );
      }
      lines.push(
        ["CUMUL FINAL", "", "", "", "", "", "", fmt(cumul)].map(csvCell).join(";")
      );
    } else {
      lines.push(["Aucune donnée mensuelle"].map(csvCell).join(";"));
    }

    // CAISSE : soldes de départ + mouvements manuels (espèces / banque)
    lines.push("");
    lines.push(["CAISSE - MOUVEMENTS MANUELS"].map(csvCell).join(";"));
    lines.push(
      [`Solde de départ espèces (FC);Solde de départ banque (FC)`]
        .map(csvCell)
        .join(";")
    );
    lines.push([fmt(settings.openingEspeces), fmt(settings.openingBanque)].map(csvCell).join(";"));
    if (cashMovements.length > 0) {
      lines.push(
        ["Date", "Compte", "Sens", "Montant (FC)", "Note"].map(csvCell).join(";")
      );
      let totalEnt = 0;
      let totalSor = 0;
      for (const m of cashMovements) {
        if (m.direction === "entree") totalEnt += m.amount;
        else totalSor += m.amount;
        lines.push(
          [
            frDate(m.date),
            modeLabel(m.mode),
            m.direction === "entree" ? "Entrée" : "Sortie",
            fmt(m.amount),
            m.note ?? "",
          ]
            .map(csvCell)
            .join(";")
        );
      }
      lines.push(
        ["TOTAUX", "", "Entrées", fmt(totalEnt), "Sorties", fmt(totalSor)]
          .map(csvCell)
          .join(";")
      );
    } else {
      lines.push(["Aucun mouvement manuel enregistré"].map(csvCell).join(";"));
    }

    // PRÊTS & EMPRUNTS
    lines.push("");
    lines.push(["PRÊTS & EMPRUNTS"].map(csvCell).join(";"));
    if (loans.length > 0) {
      lines.push(
        [
          "Type",
          "Personne",
          "Montant (FC)",
          "Date",
          "Échéance",
          "Remboursé (FC)",
          "Reste (FC)",
          "Note",
        ]
          .map(csvCell)
          .join(";")
      );
      let totalPret = 0;
      let totalEmprunt = 0;
      let totalRemb = 0;
      for (const l of loans) {
        if (l.kind === "emprunt") totalEmprunt += l.amount;
        else totalPret += l.amount;
        totalRemb += l.repaidAmount;
        lines.push(
          [
            l.kind === "emprunt" ? "Emprunt" : "Prêt",
            l.person,
            fmt(l.amount),
            frDate(l.date),
            l.dueDate ? frDate(l.dueDate) : "",
            fmt(l.repaidAmount),
            fmt(Math.max(0, l.amount - l.repaidAmount)),
            l.note ?? "",
          ]
            .map(csvCell)
            .join(";")
        );
      }
      lines.push(
        [
          "TOTAUX",
          `Prêts ${fmt(totalPret)} / Emprunts ${fmt(totalEmprunt)}`,
          fmt(totalPret + totalEmprunt),
          "",
          "",
          fmt(totalRemb),
          fmt(totalPret + totalEmprunt - totalRemb),
          "",
        ]
          .map(csvCell)
          .join(";")
      );
    } else {
      lines.push(["Aucun prêt ni emprunt enregistré"].map(csvCell).join(";"));
    }

    const csv = "\uFEFF" + lines.join("\r\n");
    const dateStr = new Intl.DateTimeFormat("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replaceAll("/", "-");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rapport-${car.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${dateStr}.csv"`,
      },
    });
  } catch (error) {
    console.error("GET /api/export/csv:", error);
    return NextResponse.json(
      { error: "Impossible de générer le CSV." },
      { status: 500 }
    );
  }
}
