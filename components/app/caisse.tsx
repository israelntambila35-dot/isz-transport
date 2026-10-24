"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  BanknoteArrowDown,
  CalendarRange,
  Landmark,
  Loader2,
  Pencil,
  Receipt,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatFC, formatISODateLong, formatWeekRange, monthLabel } from "@/lib/format";
import {
  applyLocal,
  isOfflineError,
  isOfflineResponse,
  queueOp,
} from "@/lib/offline";
import { weekEndISO, weekSavedTotal } from "@/lib/weeks";
import { CashMovements } from "@/components/app/cash-movements";
import type { AppSettings, CashMovement, WeeklyEntry, Withdrawal } from "@/lib/types";

interface CaisseProps {
  weeks: WeeklyEntry[];
  withdrawals: Withdrawal[];
  cashMovements: CashMovement[];
  settings: AppSettings | null;
  onChanged: () => void;
}

interface MonthRow {
  key: string; // "2026-10"
  recette: number;
  verseEsp: number;
  verseBan: number;
  retEsp: number;
  retBan: number;
  mvtNet: number;
  net: number;
  soldeFinDeMois: number;
}

interface WeekRow {
  key: string;
  label: string;
  method: string;
  verse: number;
  retrait: number;
  solde: number;
}

/** Une opération affichée dans le journal (retrait ou mouvement manuel) */
interface JournalEntry {
  key: string;
  kind: "retrait" | "entree" | "sortie";
  dateLabel: string;
  mode: "especes" | "banque";
  amount: number;
  note: string | null;
  sortTs: number;
}

/**
 * Onglet « Caisse » : combien vous avez en espèces et combien en banque.
 * - Soldes de départ saisis manuellement (épargne bancaire / espèces disponibles) ;
 * - Mouvements manuels (entrées / sorties) ;
 * - Versements du chauffeur et retraits (mode choisi à chaque opération) ;
 * - Détail hebdomadaire avec colonne « Retrait » ;
 * - Journal des opérations + historique mois par mois.
 */
export function Caisse({ weeks, withdrawals, cashMovements, settings, onChanged }: CaisseProps) {
  const { toast } = useToast();
  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingEsp, setOpeningEsp] = useState("");
  const [openingBan, setOpeningBan] = useState("");
  const [savingOpening, setSavingOpening] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);

  const startEsp = settings?.openingEspeces ?? 0;
  const startBan = settings?.openingBanque ?? 0;

  const sums = useMemo(() => {
    let verseEsp = 0;
    let verseBan = 0;
    let retEsp = 0;
    let retBan = 0;
    let entEsp = 0;
    let entBan = 0;
    let sorEsp = 0;
    let sorBan = 0;

    const map = new Map<
      string,
      { recette: number; verseEsp: number; verseBan: number; retEsp: number; retBan: number; mvtNet: number }
    >();
    const ensureMonth = (key: string) => {
      let m = map.get(key);
      if (!m) {
        m = { recette: 0, verseEsp: 0, verseBan: 0, retEsp: 0, retBan: 0, mvtNet: 0 };
        map.set(key, m);
      }
      return m;
    };

    for (const w of weeks) {
      const v = weekSavedTotal(w);
      const m = ensureMonth(w.weekStart.slice(0, 7));
      m.recette += w.revenueWeek;
      if (w.paymentMethod === "banque") {
        verseBan += v;
        m.verseBan += v;
      } else {
        verseEsp += v;
        m.verseEsp += v;
      }
    }
    for (const wd of withdrawals) {
      const m = ensureMonth(wd.date.slice(0, 7));
      if (wd.paymentMethod === "banque") {
        retBan += wd.amount;
        m.retBan += wd.amount;
      } else {
        retEsp += wd.amount;
        m.retEsp += wd.amount;
      }
    }
    for (const mv of cashMovements) {
      const m = ensureMonth(mv.date.slice(0, 7));
      const signed = mv.direction === "entree" ? mv.amount : -mv.amount;
      m.mvtNet += signed;
      if (mv.mode === "banque") {
        if (mv.direction === "entree") entBan += mv.amount;
        else sorBan += mv.amount;
      } else {
        if (mv.direction === "entree") entEsp += mv.amount;
        else sorEsp += mv.amount;
      }
    }

    // Solde cumulé (soldes de départ inclus), affichage du plus récent au plus ancien
    const rowsAsc: MonthRow[] = [];
    let runningSolde = startEsp + startBan;
    for (const [key, m] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const net = m.verseEsp + m.verseBan - m.retEsp - m.retBan + m.mvtNet;
      runningSolde += net;
      rowsAsc.push({ key, ...m, net, soldeFinDeMois: runningSolde });
    }
    const months = rowsAsc.reverse();

    return { verseEsp, verseBan, retEsp, retBan, entEsp, entBan, sorEsp, sorBan, months };
  }, [weeks, withdrawals, cashMovements, startEsp, startBan]);

  // Détail hebdomadaire : chaque semaine avec sa colonne « Retrait »
  const weekRows = useMemo<WeekRow[]>(() => {
    const timeOf = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00.000Z`).getTime();
    const chrono = [...weeks].sort(
      (a, b) => new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime()
    );
    const rows: WeekRow[] = [];
    let running = 0;
    for (const w of chrono) {
      const startTs = timeOf(w.weekStart);
      const endTs = timeOf(weekEndISO(w));
      const retrait = withdrawals
        .filter((wd) => {
          const t = timeOf(wd.date);
          return t >= startTs && t <= endTs;
        })
        .reduce((s, wd) => s + wd.amount, 0);
      const verse = weekSavedTotal(w);
      running += verse - retrait;
      rows.push({
        key: w.id,
        label: formatWeekRange(w.weekStart.slice(0, 10)),
        method: w.paymentMethod === "banque" ? "banque" : "especes",
        verse,
        retrait,
        solde: running,
      });
    }
    return rows;
  }, [weeks, withdrawals]);

  // Journal des opérations : retraits + mouvements manuels, du plus récent au plus ancien
  const journal = useMemo<JournalEntry[]>(() => {
    const entries: JournalEntry[] = [];
    for (const wd of withdrawals) {
      entries.push({
        key: `wd-${wd.id}`,
        kind: "retrait",
        dateLabel: formatISODateLong(wd.date.slice(0, 10)),
        mode: wd.paymentMethod === "banque" ? "banque" : "especes",
        amount: wd.amount,
        note: wd.note ?? null,
        sortTs: new Date(wd.date).getTime(),
      });
    }
    for (const m of cashMovements) {
      entries.push({
        key: `mvt-${m.id}`,
        kind: m.direction === "entree" ? "entree" : "sortie",
        dateLabel: formatISODateLong(m.date.slice(0, 10)),
        mode: m.mode === "banque" ? "banque" : "especes",
        amount: m.amount,
        note: m.note ?? null,
        sortTs: new Date(m.date).getTime(),
      });
    }
    return entries.sort((a, b) => b.sortTs - a.sortTs);
  }, [withdrawals, cashMovements]);

  const soldeEsp = startEsp + sums.verseEsp + sums.entEsp - sums.retEsp - sums.sorEsp;
  const soldeBan = startBan + sums.verseBan + sums.entBan - sums.retBan - sums.sorBan;
  const totalVerse = sums.verseEsp + sums.verseBan;
  const soldeTotal = soldeEsp + soldeBan;
  const hasData =
    weeks.length > 0 || withdrawals.length > 0 || cashMovements.length > 0 || startEsp > 0 || startBan > 0;

  /** Ouvre le dialogue des soldes de départ avec les valeurs actuelles */
  function openOpeningDialog() {
    setOpeningEsp(String(startEsp));
    setOpeningBan(String(startBan));
    setOpeningError(null);
    setOpeningOpen(true);
  }

  /** Enregistre les soldes de départ (épargne bancaire / espèces disponibles) */
  async function saveOpening(e: React.FormEvent) {
    e.preventDefault();
    setOpeningError(null);
    if (!settings?.carId) {
      setOpeningError("Voiture introuvable.");
      return;
    }
    const espNum = openingEsp.trim() === "" ? NaN : Number(openingEsp.replace(",", "."));
    const banNum = openingBan.trim() === "" ? NaN : Number(openingBan.replace(",", "."));
    if (!Number.isFinite(espNum) || espNum < 0 || !Number.isFinite(banNum) || banNum < 0) {
      setOpeningError("Les soldes doivent être des nombres positifs ou nuls.");
      return;
    }
    const payload = { openingEspeces: espNum, openingBanque: banNum };
    setSavingOpening(true);

    const finishOffline = () => {
      queueOp({ kind: "car-update", payload: { id: settings.carId, data: payload } });
      applyLocal({
        kind: "car-update",
        payload: { id: settings.carId, data: { ...payload, carId: settings.carId } },
      });
      toast({
        title: "Soldes enregistrés hors ligne",
        description: "Sera synchronisé dès le retour de la connexion.",
      });
      setSavingOpening(false);
      setOpeningOpen(false);
      onChanged();
    };

    let res: Response;
    try {
      res = await fetch(`/api/cars/${settings.carId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      setSavingOpening(false);
      setOpeningError("Impossible d'enregistrer. Réessayez.");
      return;
    }
    if (isOfflineResponse(res)) {
      finishOffline();
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setSavingOpening(false);
      setOpeningError(data?.error ?? "Impossible d'enregistrer les soldes.");
      return;
    }
    setSavingOpening(false);
    setOpeningOpen(false);
    toast({
      title: "Soldes de départ enregistrés",
      description: `Espèces : ${formatFC(espNum)} · Banque : ${formatFC(banNum)}`,
    });
    onChanged();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Caisse — espèces &amp; banque
          </CardTitle>
          <CardDescription>
            {settings ? `Voiture « ${settings.carName} » : ` : ""}vos espèces disponibles et
            votre épargne bancaire : soldes de départ saisis manuellement, versements du
            chauffeur, retraits (en banque ou en espèces, visibles ci-dessous) et
            mouvements manuels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!hasData ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
              <Wallet className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Aucune donnée — saisissez vos soldes de départ, créez une semaine dans le
                calendrier ou ajoutez un mouvement manuel.
              </p>
            </div>
          ) : (
            <>
              {/* Deux colonnes : Espèces / Banque */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border bg-accent/40 p-4">
                  <p className="mb-3 flex items-center gap-2 font-semibold">
                    <Banknote className="h-5 w-5 text-primary" />
                    Espèces (caisse)
                  </p>
                  <ul className="space-y-1.5 text-sm font-money">
                    <Line label="Solde de départ" value={formatFC(startEsp)} />
                    <Line label="Versements encaissés" value={`+${formatFC(sums.verseEsp)}`} positive />
                    <Line label="Entrées manuelles" value={`+${formatFC(sums.entEsp)}`} positive />
                    <Line label="Retraits" value={`−${formatFC(sums.retEsp)}`} negative />
                    <Line label="Sorties manuelles" value={`−${formatFC(sums.sorEsp)}`} negative />
                    <li className="flex items-center justify-between gap-2 border-t pt-1.5">
                      <span className="font-medium">Espèces disponibles</span>
                      <span
                        className={`font-bold ${soldeEsp < 0 ? "text-destructive" : "text-foreground"}`}
                      >
                        {formatFC(soldeEsp)}
                      </span>
                    </li>
                  </ul>
                </div>
                <div className="rounded-lg border bg-accent/40 p-4">
                  <p className="mb-3 flex items-center gap-2 font-semibold">
                    <Landmark className="h-5 w-5 text-primary" />
                    Épargne bancaire
                  </p>
                  <ul className="space-y-1.5 text-sm font-money">
                    <Line label="Solde de départ" value={formatFC(startBan)} />
                    <Line label="Versements encaissés" value={`+${formatFC(sums.verseBan)}`} positive />
                    <Line label="Entrées manuelles" value={`+${formatFC(sums.entBan)}`} positive />
                    <Line label="Retraits" value={`−${formatFC(sums.retBan)}`} negative />
                    <Line label="Sorties manuelles" value={`−${formatFC(sums.sorBan)}`} negative />
                    <li className="flex items-center justify-between gap-2 border-t pt-1.5">
                      <span className="font-medium">Solde en banque</span>
                      <span
                        className={`font-bold ${soldeBan < 0 ? "text-destructive" : "text-foreground"}`}
                      >
                        {formatFC(soldeBan)}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Soldes de départ + totaux */}
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">Total encaissé (versements)</p>
                  <p className="font-money text-lg font-bold text-primary">
                    +{formatFC(totalVerse)}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">Total retiré</p>
                  <p className="font-money text-lg font-bold text-destructive">
                    −{formatFC(sums.retEsp + sums.retBan)}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">Disponible (net)</p>
                  <p
                    className={`font-money text-lg font-bold ${soldeTotal < 0 ? "text-destructive" : "text-foreground"}`}
                  >
                    {formatFC(soldeTotal)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openOpeningDialog}
                  className="flex min-h-11 flex-col items-start justify-center rounded-lg border border-dashed p-4 text-left transition-colors hover:bg-accent/50"
                  aria-label="Modifier les soldes de départ"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Pencil className="h-3 w-3" />
                    Soldes de départ
                  </span>
                  <span className="text-sm font-medium">
                    Modifier mes soldes manuels
                  </span>
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Saisie manuelle : mouvements espèces / banque */}
      <CashMovements movements={cashMovements} onChanged={onChanged} />

      {/* Détail hebdomadaire (avec colonne Retrait) */}
      {weekRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="h-4 w-4 text-primary" />
              Détail hebdomadaire
            </CardTitle>
            <CardDescription>
              Chaque semaine avec son versement et les retraits effectués pendant
              cette semaine, et le solde cumulé semaine après semaine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Semaine</TableHead>
                    <TableHead className="whitespace-nowrap">Mode</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Versé (FC)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Retrait</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Solde cumulé</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weekRows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="whitespace-nowrap font-medium">{r.label}</TableCell>
                      <TableCell>
                        {r.method === "banque" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-primary">
                            <Landmark className="h-3 w-3" /> Banque
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                            <Banknote className="h-3 w-3" /> Espèces
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap font-semibold text-primary">
                        {formatFC(r.verse)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap">
                        {r.retrait > 0 ? (
                          <span className="font-semibold text-destructive">
                            −{formatFC(r.retrait)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-money whitespace-nowrap ${
                          r.solde < 0 ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {formatFC(r.solde)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Totaux</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-money font-bold whitespace-nowrap text-primary">
                      {formatFC(totalVerse)}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap text-destructive">
                      −{formatFC(weekRows.reduce((s, r) => s + r.retrait, 0))}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap">
                      {formatFC(weekRows[weekRows.length - 1]?.solde ?? 0)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Les retraits effectués hors des semaines listées (et les soldes de départ,
              mouvements manuels) ne figurent pas dans ce tableau : ils sont visibles
              dans le journal des opérations et comptent dans les soldes ci-dessus.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Journal des opérations (retraits + mouvements) */}
      {journal.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4 text-primary" />
              Journal des opérations
            </CardTitle>
            <CardDescription>
              Tous les retraits (en banque ou en espèces) et les mouvements manuels,
              du plus récent au plus ancien.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {journal.map((j) => (
                <li
                  key={j.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-sm whitespace-nowrap">{j.dateLabel}</span>
                    {j.kind === "retrait" && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                        <BanknoteArrowDown className="h-3 w-3" />
                        Retrait
                      </span>
                    )}
                    {j.kind === "entree" && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                        <ArrowDownLeft className="h-3 w-3" />
                        Entrée manuelle
                      </span>
                    )}
                    {j.kind === "sortie" && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-600/40 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        <ArrowUpRight className="h-3 w-3" />
                        Sortie manuelle
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      {j.mode === "banque" ? (
                        <>
                          <Landmark className="h-3 w-3" /> Banque
                        </>
                      ) : (
                        <>
                          <Banknote className="h-3 w-3" /> Espèces
                        </>
                      )}
                    </span>
                    {j.note && (
                      <span className="max-w-52 truncate text-xs italic text-muted-foreground" title={j.note}>
                        {j.note}
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-money text-sm font-semibold whitespace-nowrap ${
                      j.kind === "retrait" || j.kind === "sortie"
                        ? "text-destructive"
                        : "text-primary"
                    }`}
                  >
                    {j.kind === "entree" ? "+" : "−"}
                    {formatFC(j.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Détail mois par mois */}
      {sums.months.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4 text-primary" />
              Historique mois par mois
            </CardTitle>
            <CardDescription>
              Encaissements, retraits et mouvements manuels de chaque mois, avec le
              solde cumulé en fin de mois (soldes de départ inclus).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Mois</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Recette</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Versé espèces</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Versé banque</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Total versé</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Retraits espèces</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Retraits banque</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Mouvements manuels</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Net du mois</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Solde fin de mois</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sums.months.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {monthLabel(m.key)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-muted-foreground">
                        {formatFC(m.recette)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-primary">
                        {m.verseEsp > 0 ? formatFC(m.verseEsp) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-primary">
                        {m.verseBan > 0 ? formatFC(m.verseBan) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap font-semibold">
                        {formatFC(m.verseEsp + m.verseBan)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-destructive">
                        {m.retEsp > 0 ? `−${formatFC(m.retEsp)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-destructive">
                        {m.retBan > 0 ? `−${formatFC(m.retBan)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap">
                        {m.mvtNet !== 0 ? (
                          <span className={m.mvtNet > 0 ? "text-primary" : "text-destructive"}>
                            {m.mvtNet > 0 ? "+" : "−"}
                            {formatFC(Math.abs(m.mvtNet))}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-money whitespace-nowrap font-semibold ${
                          m.net < 0 ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {m.net < 0 ? `−${formatFC(-m.net)}` : formatFC(m.net)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-money whitespace-nowrap ${
                          m.soldeFinDeMois < 0 ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {m.soldeFinDeMois < 0 ? `−${formatFC(-m.soldeFinDeMois)}` : formatFC(m.soldeFinDeMois)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">Totaux</TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap">
                      {formatFC(sums.months.reduce((s, m) => s + m.recette, 0))}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold text-primary whitespace-nowrap">
                      {formatFC(sums.verseEsp)}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold text-primary whitespace-nowrap">
                      {formatFC(sums.verseBan)}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap">
                      {formatFC(totalVerse)}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold text-destructive whitespace-nowrap">
                      −{formatFC(sums.retEsp)}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold text-destructive whitespace-nowrap">
                      −{formatFC(sums.retBan)}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap">
                      {formatFC(sums.entEsp + sums.entBan - sums.sorEsp - sums.sorBan)}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap">
                      {formatFC(soldeTotal - startEsp - startBan)}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap">
                      {formatFC(soldeTotal)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialogue des soldes de départ */}
      <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mes soldes de départ</DialogTitle>
            <DialogDescription>
              Saisissez ici votre épargne bancaire et vos espèces disponibles de
              départ. Les versements, retraits et mouvements s&apos;ajoutent ensuite
              par-dessus. Mettez 0 si vous partez de zéro.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveOpening} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="opening-esp" className="flex items-center gap-2">
                <Banknote className="h-4 w-4" />
                Espèces disponibles (FC)
              </Label>
              <Input
                id="opening-esp"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={openingEsp}
                onChange={(e) => setOpeningEsp(e.target.value)}
                required
                className="font-money"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opening-ban" className="flex items-center gap-2">
                <Landmark className="h-4 w-4" />
                Épargne bancaire (FC)
              </Label>
              <Input
                id="opening-ban"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={openingBan}
                onChange={(e) => setOpeningBan(e.target.value)}
                required
                className="font-money"
              />
            </div>
            {openingError && <p className="text-sm text-destructive">{openingError}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpeningOpen(false)}
                disabled={savingOpening}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={savingOpening} className="min-h-11">
                {savingOpening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Ligne de détail dans les cartes espèces / banque */
function Line({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-semibold ${
          positive ? "text-primary" : negative ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </li>
  );
}
