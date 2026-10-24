"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CalendarPlus,
  Calculator,
  Check,
  Copy,
  Flame,
  HandCoins,
  Hourglass,
  Landmark,
  Medal,
  MessageCircle,
  PartyPopper,
  PiggyBank,
  Share2,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AppSettings,
  CashMovement,
  Loan,
  StatsResponse,
  WeeklyEntry,
  Withdrawal,
} from "@/lib/types";
import {
  formatFC,
  formatISODateLong,
  formatNumber,
  formatPercent,
  formatRate,
  formatUSD,
  parseISODate,
  toISODateUTC,
} from "@/lib/format";
import { weekEndISO, weekSavedTotal } from "@/lib/weeks";

const nfCompact = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const JALONS = [
  { pct: 25, label: "¼ du chemin" },
  { pct: 50, label: "À moitié" },
  { pct: 75, label: "3/4 du chemin" },
  { pct: 100, label: "Remboursée !" },
];

/** Tooltip personnalisé du graphique */
function ChartTooltip({
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
      <p className="font-medium mb-1.5">{label}</p>
      {payload
        .filter((p) => p.value != null)
        .map((p, i) => (
          <p key={i} className="flex items-center gap-2 font-money">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-muted-foreground">{p.name} :</span>
            <span className="font-medium">{formatFC(p.value ?? 0)}</span>
          </p>
        ))}
    </div>
  );
}

export function Dashboard({
  stats,
  weeks,
  settings,
  withdrawals = [],
  cashMovements = [],
  loans = [],
  onGoToCalendrier,
}: {
  stats: StatsResponse | null;
  weeks: WeeklyEntry[];
  settings: AppSettings | null;
  withdrawals?: Withdrawal[];
  cashMovements?: CashMovement[];
  loans?: Loan[];
  onGoToCalendrier?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!stats || !settings) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-40" />
              <Skeleton className="mt-2 h-3 w-24" />
            </CardContent>
          </Card>
        ))}
        <Card className="md:col-span-2 lg:col-span-4">
          <CardContent className="pt-6">
            <Skeleton className="h-72 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Données du graphique : cumul NET de l'épargne (épargne − retraits) semaine par semaine
  const chrono = [...weeks].sort(
    (a, b) => parseISODate(a.weekStart).getTime() - parseISODate(b.weekStart).getTime()
  );
  const chartData = chrono.reduce<Array<{ label: string; cumul: number | null; objectif: number | null; projection: number | null; savedCumul: number }>>(
    (acc, w, i) => {
      const prev = acc[acc.length - 1];
      const verse = weekSavedTotal(w);
      const savedCumul = (prev?.savedCumul ?? 0) + verse;
      // Retraits datés dans cette semaine (début → fin) ou avant
      const weekEnd = parseISODate(weekEndISO(w));
      const withdrawnSoFar = withdrawals
        .filter((wd) => new Date(wd.date).getTime() <= weekEnd.getTime())
        .reduce((s, wd) => s + wd.amount, 0);
      return [
        ...acc,
        {
          label: new Intl.DateTimeFormat("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            timeZone: "UTC",
          }).format(parseISODate(w.weekStart)),
          cumul: Math.max(0, savedCumul - withdrawnSoFar),
          objectif: Math.round(settings.weeklySavingsTarget * (i + 1)),
          projection: null,
          savedCumul,
        },
      ];
    },
    []
  );

  // Projection future : prolonge la courbe avec la moyenne réelle jusqu'au prix de la voiture
  const lastCumul = chartData.length > 0 ? (chartData[chartData.length - 1].cumul ?? 0) : 0;
  const pace = stats.avgWeeklySavings > 0 ? stats.avgWeeklySavings : settings.weeklySavingsTarget;
  const weeksToFinish =
    pace > 0 && lastCumul < stats.carPriceFc
      ? Math.ceil((stats.carPriceFc - lastCumul) / pace)
      : 0;
  const projectionWeeks = Math.min(weeksToFinish, 60);
  const lastWeekISO = chrono.length > 0 ? chrono[chrono.length - 1].weekStart.slice(0, 10) : null;
  for (let i = 1; i <= projectionWeeks; i++) {
    const d = parseISODate(lastWeekISO ?? toISODateUTC(new Date()));
    d.setUTCDate(d.getUTCDate() + 7 * i);
    chartData.push({
      label: new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      }).format(d),
      cumul: null,
      objectif: null,
      projection: Math.min(stats.carPriceFc, lastCumul + pace * i),
    });
  }

  // --- Aperçu caisse & prêts (espèces / banque / restes à recevoir et à rembourser) ---
  const caisse = (() => {
    let verseEsp = 0;
    let verseBan = 0;
    let retEsp = 0;
    let retBan = 0;
    for (const w of weeks) {
      if (w.paymentMethod === "banque") verseBan += weekSavedTotal(w);
      else verseEsp += weekSavedTotal(w);
    }
    for (const wd of withdrawals) {
      if (wd.paymentMethod === "banque") retBan += wd.amount;
      else retEsp += wd.amount;
    }
    let entEsp = 0;
    let entBan = 0;
    let sorEsp = 0;
    let sorBan = 0;
    for (const m of cashMovements) {
      const signed = m.direction === "entree" ? m.amount : -m.amount;
      if (m.mode === "banque") {
        if (signed >= 0) entBan += signed;
        else sorBan += -signed;
      } else {
        if (signed >= 0) entEsp += signed;
        else sorEsp += -signed;
      }
    }
    return {
      especes: (settings?.openingEspeces ?? 0) + verseEsp + entEsp - retEsp - sorEsp,
      banque: (settings?.openingBanque ?? 0) + verseBan + entBan - retBan - sorBan,
    };
  })();
  const pretReste = loans
    .filter((l) => l.kind !== "emprunt")
    .reduce((s, l) => s + Math.max(0, l.amount - l.repaidAmount), 0);
  const empruntReste = loans
    .filter((l) => l.kind === "emprunt")
    .reduce((s, l) => s + Math.max(0, l.amount - l.repaidAmount), 0);

  // --- Rappel : la semaine en cours (celle qui contient aujourd'hui) n'est pas encore créée ? ---
  const todayMs = Date.now();
  const currentWeekExists = weeks.some((w) => {
    const start = parseISODate(w.weekStart.slice(0, 10)).getTime();
    const end = parseISODate(weekEndISO(w)).getTime();
    return todayMs >= start && todayMs <= end;
  });

  // --- Série de réussite : semaines consécutives à l'objectif (de la plus récente saisie) ---
  const sortedDesc = [...chrono].reverse();
  let currentStreak = 0;
  for (const w of sortedDesc) {
    if (weekSavedTotal(w) >= settings.weeklySavingsTarget) currentStreak += 1;
    else break;
  }
  let bestStreak = 0;
  let run = 0;
  for (const w of sortedDesc) {
    if (weekSavedTotal(w) >= settings.weeklySavingsTarget) {
      run += 1;
      bestStreak = Math.max(bestStreak, run);
    } else {
      run = 0;
    }
  }
  const streakRank =
    bestStreak >= 10 ? "Or 🥇" : bestStreak >= 5 ? "Argent 🥈" : bestStreak >= 3 ? "Bronze 🥉" : null;

  // --- Résumé texte pour le partage (WhatsApp, copie, Web Share) ---
  const shareLines = [
    "🚕 ISZTRANSPORT — Résumé de mon projet",
    `💰 Prix de la voiture : ${formatFC(stats.carPriceFc)}`,
    `✅ Déjà versé par le chauffeur : ${formatFC(stats.totalSaved)}${stats.totalWithdrawn > 0 ? ` (− ${formatFC(stats.totalWithdrawn)} retirés)` : ""}`,
    `💎 Versements disponibles : ${formatFC(stats.netSaved)} (${formatPercent(stats.paidPercent)})`,
    `⏳ Reste à rembourser : ${formatFC(stats.remaining)}`,
    `📈 Rythme réel : ${formatFC(stats.avgWeeklySavings)}/semaine (objectif ${formatFC(settings.weeklySavingsTarget)})`,
    `📅 Fin estimée : ${formatISODateLong(stats.estimatedEndDate)} (${formatNumber(stats.remainingWeeks)} semaines)`,
  ];
  const shareText = shareLines.join("\n");

  function copySummary() {
    void navigator.clipboard
      .writeText(shareText)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
    setTimeout(() => setCopied(false), 2000);
  }
  async function nativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "ISZTRANSPORT", text: shareText });
      } catch {
        /* partage annulé */
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Rappel : semaine en cours non créée */}
      {!currentWeekExists && stats.paidPercent < 100 && (
        <Alert className="border-primary/40 bg-accent/50 no-print">
          <CalendarPlus className="h-4 w-4 !text-primary" />
          <AlertTitle>La semaine en cours n&apos;est pas encore créée</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            Créez la semaine actuelle dans le calendrier et saisissez les montants versés par le
            chauffeur jour par jour.
            {onGoToCalendrier && (
              <Button size="sm" className="mt-1 min-h-11" onClick={onGoToCalendrier}>
                <CalendarPlus className="mr-2 h-4 w-4" />
                Ouvrir le calendrier
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Célébration à 100 % */}
      {stats.paidPercent >= 100 ? (
        <Alert className="border-primary/50 bg-accent">
          <PartyPopper className="h-4 w-4 !text-primary" />
          <AlertTitle>Félicitations ! 🎉</AlertTitle>
          <AlertDescription>
            Le prix de la voiture ({formatFC(stats.carPriceFc)}) est entièrement couvert par votre
            épargne. Pensez à mettre à jour vos paramètres pour un nouveau projet !
          </AlertDescription>
        </Alert>
      ) : !stats.onTrack && stats.entriesCount > 0 ? (
        /* Alerte si l'épargne est en dessous de l'objectif */
        <Alert className="border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 !text-amber-600" />
          <AlertTitle>Alerte versements</AlertTitle>
          <AlertDescription>
            Le versement moyen réel ({formatFC(stats.avgWeeklySavings)}/semaine) est
            inférieur à l&apos;objectif ({formatFC(settings.weeklySavingsTarget)}/semaine).
            Le remboursement sera plus long que prévu.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* KPI principaux */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Banknote className="h-4 w-4 text-primary" />
              Prix de la voiture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money">{formatFC(stats.carPriceFc)}</p>
            <p className="mt-1 text-xs text-muted-foreground font-money">
              {formatUSD(stats.carPriceUsd)} × {formatRate(stats.exchangeRate)} FC/USD
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <PiggyBank className="h-4 w-4 text-primary" />
              Épargne disponible
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money text-primary">
              {formatFC(stats.netSaved)}
            </p>
            {stats.totalWithdrawn > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground font-money">
                {formatFC(stats.totalSaved)} versés − {formatFC(stats.totalWithdrawn)} retirés
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                sur {stats.entriesCount} semaine{stats.entriesCount > 1 ? "s" : ""} enregistrée
                {stats.entriesCount > 1 ? "s" : ""}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet className="h-4 w-4 text-primary" />
              Reste à rembourser
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money">{formatFC(stats.remaining)}</p>
            <p className="mt-1 text-xs text-muted-foreground font-money">
              soit {formatUSD(stats.remaining / stats.exchangeRate)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              Pourcentage remboursé
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money">{formatPercent(stats.paidPercent)}</p>
            <Progress value={stats.paidPercent} className="mt-2 h-2.5" />
            {/* Jalons de progression */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {JALONS.map((jalon) => {
                const reached = stats.paidPercent >= jalon.pct;
                return (
                  <motion.span
                    key={jalon.pct}
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: reached ? 1 : 0.9, opacity: reached ? 1 : 0.45 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <Badge
                      variant={reached ? "default" : "outline"}
                      className="text-[10px] px-1.5 py-0"
                      title={`${jalon.pct} % — ${jalon.label}`}
                    >
                      {reached ? "★ " : ""}{jalon.pct} %
                    </Badge>
                  </motion.span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Aperçu caisse & prêts */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Banknote className="h-4 w-4 text-primary" />
              Espèces disponibles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold font-money ${caisse.especes < 0 ? "text-destructive" : ""}`}
            >
              {formatFC(caisse.especes)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Caisse — onglet « Caisse »</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Landmark className="h-4 w-4 text-primary" />
              Solde en banque
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold font-money ${caisse.banque < 0 ? "text-destructive" : ""}`}
            >
              {formatFC(caisse.banque)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Épargne bancaire — onglet « Caisse »</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <HandCoins className="h-4 w-4 text-primary" />
              Reste à recevoir
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money">{formatFC(pretReste)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Prêts en cours</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet className="h-4 w-4 text-primary" />
              Reste à rembourser (emprunts)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money">{formatFC(empruntReste)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Emprunts en cours</p>
          </CardContent>
        </Card>
      </div>

      {/* Estimations de temps */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="h-4 w-4 text-primary" />
              Semaines restantes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money">
              {formatNumber(stats.remainingWeeks)} sem.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Fin estimée : {formatISODateLong(stats.estimatedEndDate)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Target className="h-4 w-4 text-primary" />
              Versement moyen réel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money">
              {formatFC(stats.avgWeeklySavings)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground font-money">
              objectif : {formatFC(settings.weeklySavingsTarget)}/sem.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Hourglass className="h-4 w-4 text-primary" />
              Durée totale estimée
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-money">
              {formatNumber(stats.estimatedTotalWeeks)} sem.
            </p>
            <p className="mt-1 text-xs text-muted-foreground font-money">
              à l&apos;objectif : {formatNumber(stats.estimatedTotalWeeksTarget)} sem.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Graphique d'évolution avec projection */}
      <Card>
        <CardHeader>
          <CardTitle>Évolution &amp; projection des versements</CardTitle>
          <p className="text-sm text-muted-foreground">
            Versements nets cumulés — versés moins retraits (trait plein), projection future
            (pointillés) au rythme réel de {formatFC(stats.avgWeeklySavings)}/semaine, jusqu&apos;au
            prix de la voiture ({formatFC(stats.carPriceFc)}).
          </p>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
              <PiggyBank className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Aucune semaine enregistrée pour le moment.
              </p>
              <p className="text-xs text-muted-foreground">
                Commencez par créer une semaine dans l&apos;onglet « Calendrier » pour voir la
                courbe apparaître.
              </p>
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0 0 / 20%)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    width={52}
                    tickFormatter={(v: number) => nfCompact.format(v)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine
                    y={stats.carPriceFc}
                    stroke="oklch(0.577 0.245 27.325)"
                    strokeDasharray="6 4"
                    label={{
                      value: "Prix voiture",
                      position: "insideTopRight",
                      fontSize: 11,
                      fill: "oklch(0.577 0.245 27.325)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumul"
                    name="Versements nets cumulés"
                    stroke="var(--chart-1)"
                    fill="var(--chart-1)"
                    fillOpacity={0.18}
                    strokeWidth={2.5}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="objectif"
                    name="Rythme objectif"
                    stroke="var(--chart-2)"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="projection"
                    name="Projection"
                    stroke="var(--chart-3)"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {chartData.length > 0 && projectionWeeks > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Projection sur {projectionWeeks} semaine{projectionWeeks > 1 ? "s" : ""}
              {weeksToFinish > 60 && " (tronquée à 60 semaines pour la lisibilité)"} — fin estimée
              le {formatISODateLong(stats.estimatedEndDate)} si le rythme actuel se maintient.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Partage du résumé + Série de réussite */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="no-print">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-primary" />
              Partager mon avancement
            </CardTitle>
            <CardDescription>
              Envoyez le résumé de votre projet à un proche, un partenaire ou votre chauffeur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
              {shareText}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="min-h-11">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  WhatsApp
                </a>
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={nativeShare}
                hidden={typeof navigator !== "undefined" && !navigator.share}
              >
                <Share2 className="mr-2 h-4 w-4" />
                Autre application
              </Button>
              <Button variant="outline" className="min-h-11" onClick={copySummary}>
                {copied ? (
                  <Check className="mr-2 h-4 w-4 text-primary" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied ? "Copié !" : "Copier le résumé"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-primary" />
              Série de réussite
            </CardTitle>
            <CardDescription>
              Semaines d&apos;affilée où votre épargne a atteint l&apos;objectif (
              {formatFC(settings.weeklySavingsTarget)}).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {weeks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Saisissez votre première semaine pour lancer votre série !
              </p>
            ) : currentStreak > 0 ? (
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Flame className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="text-3xl font-bold font-money">
                    {currentStreak} semaine{currentStreak > 1 ? "s" : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    consécutivement à l&apos;objectif — continuez comme ça ! 🔥
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                La dernière semaine saisie est en dessous de l&apos;objectif. Reprenez la série dès
                cette semaine !
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Badge variant="outline" className="gap-1">
                <Medal className="h-3 w-3" />
                Record : {bestStreak} semaine{bestStreak > 1 ? "s" : ""}
              </Badge>
              {streakRank && (
                <Badge className="bg-primary text-primary-foreground">Rang {streakRank}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Exemple de calcul (cahier des charges) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4 text-primary" />
            Exemple de calcul
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm font-money">
            <li>
              Prix voiture : {formatUSD(settings.carPriceUsd)} ×{" "}
              {formatRate(settings.exchangeRate)} ={" "}
              <span className="font-semibold">{formatFC(stats.carPriceFc)}</span>
            </li>
            <li>
              Durée à l&apos;objectif : {formatFC(stats.carPriceFc)} ÷{" "}
              {formatFC(settings.weeklySavingsTarget)} ={" "}
              <span className="font-semibold">
                {formatNumber(stats.estimatedTotalWeeksTarget)} semaines
              </span>{" "}
              (soit {Math.ceil(stats.estimatedTotalWeeksTarget)} semaines complètes)
            </li>
            <li>
              Durée avec la moyenne réelle :{" "}
              <span className="font-semibold">{formatNumber(stats.estimatedTotalWeeks)} semaines</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
