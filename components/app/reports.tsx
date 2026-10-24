"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarHeart, Download, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatFC, formatWeekRange, getMonday, monthLabel, parseISODate, toISODateUTC } from "@/lib/format";
import { weekSavedTotal } from "@/lib/weeks";
import type { AppSettings, StatsResponse, WeeklyEntry, Withdrawal } from "@/lib/types";

const nfCompact = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

interface ReportsProps {
  weeks: WeeklyEntry[];
  withdrawals: Withdrawal[];
  stats: StatsResponse | null;
  settings: AppSettings | null;
}

/** Tooltip personnalisé */
function MonthlyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 shadow-md text-sm">
      <p className="font-medium mb-1.5 capitalize">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 font-money">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name} :</span>
          <span className="font-medium">{formatFC(p.value ?? 0)}</span>
        </p>
      ))}
    </div>
  );
}

export function Reports({ weeks, withdrawals, stats, settings }: ReportsProps) {
  // Regroupement mensuel (dépenses et retraits fusionnés dans la même série)
  const monthly = useMemo(() => {
    const map = new Map<
      string,
      { saved: number; expenses: number; revenue: number; count: number }
    >();
    for (const w of weeks) {
      const d = parseISODate(w.weekStart);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const cur = map.get(key) ?? { saved: 0, expenses: 0, revenue: 0, count: 0 };
      cur.saved += weekSavedTotal(w);
      cur.expenses += w.fuelExpense + w.maintenanceExpense + w.driverSaturday + w.otherExpenses;
      cur.revenue += w.revenueWeek;
      cur.count += 1;
      map.set(key, cur);
    }
    // Les retraits sont fusionnés avec les dépenses du mois (une seule série)
    for (const wd of withdrawals) {
      const d = parseISODate(wd.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const cur = map.get(key) ?? { saved: 0, expenses: 0, revenue: 0, count: 0 };
      cur.expenses += wd.amount;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        label: monthLabel(key),
        ...v,
      }));
  }, [weeks, withdrawals]);

  // Résumé par année
  const yearly = useMemo(() => {
    const map = new Map<
      number,
      { revenue: number; saved: number; fuel: number; maintenance: number; driver: number; other: number; weeks: number }
    >();
    for (const w of weeks) {
      const year = parseISODate(w.weekStart).getUTCFullYear();
      const cur =
        map.get(year) ??
        { revenue: 0, saved: 0, fuel: 0, maintenance: 0, driver: 0, other: 0, weeks: 0 };
      cur.revenue += w.revenueWeek;
      cur.saved += weekSavedTotal(w);
      cur.fuel += w.fuelExpense;
      cur.maintenance += w.maintenanceExpense;
      cur.driver += w.driverSaturday;
      cur.other += w.otherExpenses;
      cur.weeks += 1;
      map.set(year, cur);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [weeks]);

  const totalExpenses = weeks.reduce(
    (s, w) => s + w.fuelExpense + w.maintenanceExpense + w.driverSaturday + w.otherExpenses,
    0
  );

  // --- Calendrier de chaleur : les 52 dernières semaines comparées à l'objectif ---
  const heatCalendar = useMemo(() => {
    if (!settings) return null;
    const target = settings.weeklySavingsTarget;
    const byWeek = new Map<string, number>();
    for (const w of weeks) {
      // Ramène chaque semaine (même à début personnalisé) sur son lundi pour la grille
      byWeek.set(getMonday(w.weekStart.slice(0, 10)), weekSavedTotal(w));
    }
    const currentMonday = getMonday();
    const cells: Array<{ iso: string; saved: number | null; ratio: number | null }> = [];
    for (let i = 51; i >= 0; i--) {
      const d = parseISODate(currentMonday);
      d.setUTCDate(d.getUTCDate() - 7 * i);
      const iso = toISODateUTC(d);
      const saved = byWeek.has(iso) ? byWeek.get(iso)! : null;
      cells.push({
        iso,
        saved,
        ratio: saved == null ? null : target > 0 ? saved / target : 0,
      });
    }
    return {
      cells,
      stats: cells.reduce(
        (acc, c) => {
          if (c.ratio == null) acc.missing += 1;
          else if (c.ratio === 0) acc.zero += 1;
          else if (c.ratio < 1) acc.below += 1;
          else acc.onTarget += 1;
          return acc;
        },
        { onTarget: 0, below: 0, zero: 0, missing: 0 }
      ),
    };
  }, [weeks, settings]);

  return (
    <div className="space-y-6">
      {/* Boutons d'export */}
      <div className="flex flex-wrap gap-3 no-print">
        <Button asChild className="min-h-11">
          <a href="/api/export/csv" download>
            <Download className="mr-2 h-4 w-4" />
            Exporter en CSV
          </a>
        </Button>
        <Button variant="outline" onClick={() => window.print()} className="min-h-11">
          <Printer className="mr-2 h-4 w-4" />
          Imprimer / Enregistrer en PDF
        </Button>
      </div>

      {/* Graphique mensuel */}
      <Card className="print-break-avoid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Graphique mensuel
          </CardTitle>
          <CardDescription>
            Versements et sorties (dépenses + retraits fusionnés) regroupés par mois.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {monthly.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
              <FileText className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Aucune donnée à afficher. Enregistrez des semaines pour générer les rapports.
              </p>
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0 0 / 20%)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} className="capitalize" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    width={52}
                    tickFormatter={(v: number) => nfCompact.format(v)}
                  />
                  <Tooltip content={<MonthlyTooltip />} />
                  <Legend />
                  <Bar
                    dataKey="saved"
                    name="Versés"
                    fill="var(--chart-1)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Dépenses & retraits"
                    fill="var(--chart-2)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calendrier de chaleur de l'épargne */}
      {heatCalendar && (
        <Card className="print-break-avoid">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarHeart className="h-5 w-5 text-primary" />
              Calendrier des versements
            </CardTitle>
            <CardDescription>
              Les 52 dernières semaines : chaque carré vaut une semaine, comparée à l&apos;objectif
              hebdomadaire ({formatFC(settings?.weeklySavingsTarget ?? 0)}).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {heatCalendar.cells.map((c) => {
                let cls = "bg-muted";
                let label = "";
                if (c.ratio == null) {
                  cls = "bg-muted border border-dashed";
                  label = `${formatWeekRange(c.iso)} : aucune saisie`;
                } else if (c.ratio === 0) {
                  cls = "bg-destructive/35";
                  label = `${formatWeekRange(c.iso)} : rien versé`;
                } else if (c.ratio < 0.5) {
                  cls = "bg-primary/25";
                  label = `${formatWeekRange(c.iso)} : ${formatFC(c.saved ?? 0)} (${Math.round(c.ratio * 100)} % de l'objectif)`;
                } else if (c.ratio < 1) {
                  cls = "bg-primary/55";
                  label = `${formatWeekRange(c.iso)} : ${formatFC(c.saved ?? 0)} (${Math.round(c.ratio * 100)} % de l'objectif)`;
                } else {
                  cls = "bg-primary";
                  label = `${formatWeekRange(c.iso)} : ${formatFC(c.saved ?? 0)} (objectif atteint !)`;
                }
                return (
                  <span
                    key={c.iso}
                    title={label}
                    aria-label={label}
                    className={`h-5 w-5 rounded-sm ${cls} transition-transform hover:scale-125 hover:ring-2 hover:ring-ring/40`}
                  />
                );
              })}
            </div>

            {/* Légende */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-muted border border-dashed" /> aucune saisie
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-destructive/35" /> rien versé
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-primary/25" /> &lt; 50 %
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-primary/55" /> 50–99 %
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-primary" /> objectif atteint
              </span>
            </div>

            {/* Bilan des 52 semaines */}
            <p className="text-sm">
              Bilan :{" "}
              <span className="font-semibold text-primary">{heatCalendar.stats.onTarget} semaine{heatCalendar.stats.onTarget > 1 ? "s" : ""}</span>{" "}
              sur objectif,{" "}
              <span className="font-semibold text-amber-600">{heatCalendar.stats.below + heatCalendar.stats.zero} semaine{heatCalendar.stats.below + heatCalendar.stats.zero > 1 ? "s" : ""}</span>{" "}
              en dessous,{" "}
              <span className="font-semibold">{heatCalendar.stats.missing} semaine{heatCalendar.stats.missing > 1 ? "s" : ""}</span>{" "}
              sans saisie.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Résumé global */}
      {stats && (
        <Card className="print-break-avoid">
          <CardHeader>
            <CardTitle>Résumé global</CardTitle>
            <CardDescription>
              {stats.entriesCount === 0
                ? "Aucune semaine enregistrée."
                : `Basé sur ${stats.entriesCount} semaine${stats.entriesCount > 1 ? "s" : ""} enregistrée${stats.entriesCount > 1 ? "s" : ""}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Total recettes (lun-ven)</p>
                <p className="mt-1 text-xl font-bold font-money">{formatFC(stats.totalRevenue)}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Total versé par le chauffeur</p>
                <p className="mt-1 text-xl font-bold font-money text-primary">
                  {formatFC(stats.totalSaved)}
                </p>
                {stats.totalWithdrawn > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground font-money">
                    − {formatFC(stats.totalWithdrawn)} de retraits ={" "}
                    <span className="font-semibold text-foreground">
                      {formatFC(stats.netSaved)} disponibles
                    </span>
                  </p>
                )}
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Total dépenses</p>
                <p className="mt-1 text-xl font-bold font-money">{formatFC(totalExpenses)}</p>
                {totalExpenses > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground font-money">
                    Carburant {formatFC(stats.totalFuel)} · Entretien {formatFC(stats.totalMaintenance)}{" "}
                    · Chauffeur {formatFC(stats.totalDriver)} · Autres {formatFC(stats.totalOther)}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Résumé annuel */}
      {yearly.length > 0 && (
        <Card className="print-break-avoid">
          <CardHeader>
            <CardTitle>Résumé annuel</CardTitle>
            <CardDescription>Totaux par année civile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {yearly.map(([year, y]) => (
              <div key={year} className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-lg font-bold">{year}</p>
                  <p className="text-sm text-muted-foreground">
                    {y.weeks} semaine{y.weeks > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">Recettes</p>
                    <p className="font-semibold font-money">{formatFC(y.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Versé</p>
                    <p className="font-semibold font-money text-primary">{formatFC(y.saved)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Dépenses</p>
                    <p className="font-semibold font-money">
                      {formatFC(y.fuel + y.maintenance + y.driver + y.other)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Moyenne versée / semaine</p>
                    <p className="font-semibold font-money">{formatFC(y.saved / y.weeks)}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pied de rapport imprimé */}
      {settings && (
        <p className="text-xs text-muted-foreground font-money">
          Prix de référence : {formatFC(stats?.carPriceFc ?? 0)} ({settings.carPriceUsd} USD ×{" "}
          {settings.exchangeRate} FC/USD) · Objectif de versement :{" "}
          {formatFC(settings.weeklySavingsTarget)}/semaine · Données générées le{" "}
          {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}.
        </p>
      )}
    </div>
  );
}
