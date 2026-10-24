"use client";

import { useMemo, useState } from "react";
import { CalendarCheck2, FlaskConical, Gift, RotateCcw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  addWeeksISO,
  formatFC,
  formatNumber,
  formatRate,
  formatUSD,
  getMonday,
  parseISODate,
  toISODateUTC,
  weeksBetween,
} from "@/lib/format";
import type { AppSettings, StatsResponse } from "@/lib/types";

interface SimulatorProps {
  stats: StatsResponse | null;
  settings: AppSettings | null;
}

export function Simulator({ stats, settings }: SimulatorProps) {
  const [weeklySim, setWeeklySim] = useState<number>(settings?.weeklySavingsTarget ?? 100000);
  const [rateSim, setRateSim] = useState<number>(settings?.exchangeRate ?? 2350);
  const [bonusSim, setBonusSim] = useState<number>(0);
  const [targetDate, setTargetDate] = useState<string>("");

  const todayISO = getMonday();

  // --- Simulation directe : et si j'épargnais X FC/sem avec un taux Y et une prime Z ? ---
  const sim = useMemo(() => {
    if (!stats || !settings) return null;
    const carPriceFcSim = settings.carPriceUsd * rateSim;
    const totalSavedSim = stats.netSaved + bonusSim;
    const remainingSim = Math.max(0, carPriceFcSim - totalSavedSim);
    const weeksSim = weeklySim > 0 ? remainingSim / weeklySim : Number.POSITIVE_INFINITY;
    const endDateSim = Number.isFinite(weeksSim) ? addWeeksISO(todayISO, weeksSim) : null;

    // Comparaison avec le rythme réel actuel
    const currentWeeks = stats.remainingWeeks;
    const deltaWeeks = Number.isFinite(weeksSim) ? currentWeeks - weeksSim : Number.NEGATIVE_INFINITY;

    return {
      carPriceFcSim,
      totalSavedSim,
      remainingSim,
      weeksSim,
      endDateSim,
      deltaWeeks,
      paidPercentSim: carPriceFcSim > 0 ? Math.min(100, (totalSavedSim / carPriceFcSim) * 100) : 0,
    };
  }, [stats, settings, weeklySim, rateSim, bonusSim, todayISO]);

  // --- Planificateur inverse : quelle date viser ? ---
  const reverse = useMemo(() => {
    if (!sim) return null;
    if (!targetDate) return { state: "empty" as const };
    const weeksAvailable = weeksBetween(todayISO, targetDate);
    if (weeksAvailable <= 0) {
      return { state: "past" as const };
    }
    if (sim.remainingSim <= 0) {
      return { state: "done" as const };
    }
    const required = sim.remainingSim / weeksAvailable;
    const enough = weeklySim >= required;
    const diff = Math.abs(weeklySim - required);
    return { state: "ok" as const, weeksAvailable, required, enough, diff };
  }, [sim, targetDate, weeklySim, todayISO]);

  function resetSimulation() {
    if (!settings) return;
    setWeeklySim(settings.weeklySavingsTarget);
    setRateSim(settings.exchangeRate);
    setBonusSim(0);
    setTargetDate("");
  }

  if (!stats || !settings || !sim) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <FlaskConical className="h-5 w-5 text-primary" />
            Simulateur « Et si… ? »
          </h2>
          <p className="text-sm text-muted-foreground">
            Testez des scénarios sans modifier vos données : elles ne changent que si vous
            enregistrez vraiment.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={resetSimulation} className="min-h-11 shrink-0">
          <RotateCcw className="mr-2 h-4 w-4" />
          Réinitialiser
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --- Réglages du scénario --- */}
        <Card>
          <CardHeader>
            <CardTitle>Votre scénario</CardTitle>
            <CardDescription>Déplacez les curseurs pour explorer les possibilités.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Épargne hebdomadaire simulée</Label>
                <span className="text-sm font-semibold font-money text-primary">
                  {formatFC(weeklySim)}
                </span>
              </div>
              <Slider
                value={[weeklySim]}
                min={10000}
                max={400000}
                step={5000}
                onValueChange={(v) => setWeeklySim(v[0])}
                aria-label="Épargne hebdomadaire simulée"
              />
              <p className="text-xs text-muted-foreground font-money">
                Objectif actuel : {formatFC(settings.weeklySavingsTarget)} · moyenne réelle :{" "}
                {formatFC(stats.avgWeeklySavings)}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Taux de change simulé (FC / USD)</Label>
                <span className="text-sm font-semibold font-money text-primary">
                  {formatRate(rateSim)}
                </span>
              </div>
              <Slider
                value={[rateSim]}
                min={1500}
                max={4000}
                step={50}
                onValueChange={(v) => setRateSim(v[0])}
                aria-label="Taux de change simulé"
              />
              <p className="text-xs text-muted-foreground font-money">
                Taux actuel : {formatRate(settings.exchangeRate)} FC/USD
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <Gift className="h-4 w-4 text-primary" />
                  Prime exceptionnelle (apport immédiat)
                </Label>
                <span className="text-sm font-semibold font-money text-primary">
                  {formatFC(bonusSim)}
                </span>
              </div>
              <Slider
                value={[bonusSim]}
                min={0}
                max={3000000}
                step={50000}
                onValueChange={(v) => setBonusSim(v[0])}
                aria-label="Prime exceptionnelle"
              />
              <p className="text-xs text-muted-foreground">
                Ex. : une prime, un héritage, un emprunt familial… ajouté à votre épargne
                disponible ({formatFC(stats.netSaved)}).
              </p>
            </div>
          </CardContent>
        </Card>

        {/* --- Résultats du scénario --- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Résultat du scénario
            </CardTitle>
            <CardDescription>Calculé en direct à partir de vos curseurs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Prix voiture au taux simulé</p>
                <p className="text-lg font-bold font-money">{formatFC(sim.carPriceFcSim)}</p>
                <p className="text-xs text-muted-foreground font-money">
                  {formatUSD(settings.carPriceUsd)} × {formatRate(rateSim)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Reste à rembourser (avec prime)</p>
                <p className="text-lg font-bold font-money">{formatFC(sim.remainingSim)}</p>
                <p className="text-xs text-muted-foreground font-money">
                  {formatPercentSim(sim.paidPercentSim)} déjà couvert
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Semaines restantes</p>
                <p className="text-lg font-bold font-money">
                  {Number.isFinite(sim.weeksSim) ? formatNumber(sim.weeksSim) : "—"}
                </p>
                <p className="text-xs text-muted-foreground font-money">
                  à {formatFC(weeklySim)}/semaine
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Date de fin estimée</p>
                <p className="text-lg font-bold">
                  {sim.endDateSim
                    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(
                        parseISODate(sim.endDateSim)
                      )
                    : "Jamais"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sim.remainingSim <= 0 ? "objectif atteint !" : `+${Math.ceil(sim.weeksSim) * 7} jours`}
                </p>
              </div>
            </div>

            {/* Comparaison avec le rythme réel */}
            <div
              className={`rounded-lg border p-4 ${
                sim.remainingSim <= 0
                  ? "border-primary/40 bg-accent/50"
                  : sim.deltaWeeks >= 0
                    ? "border-primary/40 bg-accent/50"
                    : "border-amber-500/40 bg-amber-50 dark:bg-amber-950"
              }`}
            >
              {sim.remainingSim <= 0 ? (
                <p className="text-sm font-medium">
                  Avec cette prime, la voiture est entièrement couverte. Félicitations !
                </p>
              ) : Number.isFinite(sim.deltaWeeks) ? (
                <p className="text-sm font-medium font-money">
                  {sim.deltaWeeks >= 0.05 ? (
                    <>
                      Vous gagnez <span className="font-bold">{formatNumber(sim.deltaWeeks)} semaines</span>{" "}
                      par rapport à votre rythme actuel.
                    </>
                  ) : sim.deltaWeeks <= -0.05 ? (
                    <>
                      Ce scénario ajoute{" "}
                      <span className="font-bold">{formatNumber(Math.abs(sim.deltaWeeks))} semaines</span>{" "}
                      par rapport à votre rythme actuel.
                    </>
                  ) : (
                    <>Ce scénario correspond à peu près à votre rythme actuel.</>
                  )}
                </p>
              ) : (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-200">
                  Avec une épargne de 0 FC/semaine, la voiture ne serait jamais remboursée.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* --- Planificateur inverse --- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck2 className="h-5 w-5 text-primary" />
            Planificateur inverse : « Je veux finir avant telle date »
          </CardTitle>
          <CardDescription>
            Choisissez une date butoir : l&apos;application calcule l&apos;épargne hebdomadaire
            nécessaire pour y arriver.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="targetDate">Date butoir souhaitée</Label>
            <Input
              id="targetDate"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="max-w-xs"
            />
          </div>

          {reverse && reverse.state !== "empty" && (
            <div className="rounded-lg border bg-accent/40 p-4">
              {reverse.state === "past" && (
                <p className="text-sm text-amber-700 dark:text-amber-200">
                  La date choisie est déjà passée. Choisissez une date future (après le{" "}
                  {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(
                    parseISODate(todayISO)
                  )}
                  ).
                </p>
              )}
              {reverse.state === "done" && (
                <p className="text-sm font-medium text-primary">
                  Avec ce scénario, la voiture est déjà entièrement remboursée : n&apos;importe
                  quelle date fonctionne !
                </p>
              )}
              {reverse.state === "ok" && (
                <div className="space-y-2 text-sm">
                  <p className="font-money">
                    Il reste {formatFC(sim.remainingSim)} à couvrir en{" "}
                    <span className="font-semibold">{formatNumber(reverse.weeksAvailable)} semaines</span>{" "}
                    (du {new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(parseISODate(todayISO))}{" "}
                    au {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "UTC" }).format(parseISODate(targetDate))}).
                  </p>
                  <p className="font-money">
                    Épargne nécessaire :{" "}
                    <span className="font-bold text-primary">{formatFC(reverse.required)} / semaine</span>
                  </p>
                  <Separator />
                  {reverse.enough ? (
                    <p className="font-medium text-primary">
                      Objectif atteignable : votre réglage actuel ({formatFC(weeklySim)}/semaine)
                      dépasse le nécessaire de {formatFC(reverse.diff)}. Vous finirez même en avance.
                    </p>
                  ) : (
                    <p className="font-medium text-amber-700 dark:text-amber-200 font-money">
                      Il manque {formatFC(reverse.diff)} par semaine par rapport à votre réglage
                      actuel ({formatFC(weeklySim)}). Augmentez l&apos;épargne ou choisissez une date
                      plus lointaine.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatPercentSim(pct: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(pct) + " %";
}
