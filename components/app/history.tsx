"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BanknoteArrowDown,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  History as HistoryIcon,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { applyLocal, isOfflineError, isOfflineResponse, queueOp } from "@/lib/offline";
import { dayShortLabel, weekSavedTotal } from "@/lib/weeks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Loan, WeeklyEntry, Withdrawal } from "@/lib/types";

interface HistoryProps {
  weeks: WeeklyEntry[];
  withdrawals: Withdrawal[];
  loans: Loan[];
  carPriceFc: number;
  onEdit: (entry: WeeklyEntry) => void;
  onChanged: () => void;
}

/** Une ligne du registre chronologique : semaine, retrait ou prêt/emprunt */
type LedgerRow =
  | {
      kind: "week";
      key: string;
      date: string; // "YYYY-MM-DD" (début de semaine)
      week: WeeklyEntry;
      solde: number; // Argent disponible restant après l'événement
      reste: number; // Reste à rembourser après l'événement
    }
  | {
      kind: "withdrawal";
      key: string;
      date: string; // "YYYY-MM-DD" (date individuelle du retrait)
      withdrawal: Withdrawal;
      solde: number;
      reste: number;
    }
  | {
      kind: "loan";
      key: string;
      date: string; // "YYYY-MM-DD" (date individuelle du prêt/emprunt)
      loan: Loan;
      solde: number;
      reste: number;
    };

export function History({
  weeks,
  withdrawals,
  loans,
  carPriceFc,
  onEdit,
  onChanged,
}: HistoryProps) {
  const { toast } = useToast();
  const [toDelete, setToDelete] = useState<WeeklyEntry | null>(null);
  const [toDeleteWd, setToDeleteWd] = useState<Withdrawal | null>(null);
  const [toDeleteLoan, setToDeleteLoan] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>("all");

  // Plage lisible d'une semaine (début → fin choisis par l'utilisateur)
  const rangeOf = (w: WeeklyEntry) =>
    formatWeekRange(w.weekStart.slice(0, 10), w.weekEnd ?? undefined);

  const timeOf = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00.000Z`).getTime();

  /**
   * Registre chronologique fusionné : semaines + retraits + prêts/emprunts,
   * triés par date. Pour chaque événement on calcule :
   *  - « Solde restant » = Σ versements + Σ emprunts − Σ retraits − Σ prêts
   *    (argent disponible : un prêt sort de la caisse, un emprunt y entre) ;
   *  - « Reste après » = prix voiture − solde (reste à rembourser).
   * À date égale : versement → retrait → prêt/emprunt.
   */
  const { ledger, totals, totalWithdrawn, totalPrets, totalEmprunts, months } = useMemo(() => {
    const events: LedgerRow[] = [];
    for (const w of weeks) {
      events.push({
        kind: "week",
        key: `w-${w.id}`,
        date: w.weekStart.slice(0, 10),
        week: w,
        solde: 0,
        reste: 0,
      });
    }
    for (const wd of withdrawals) {
      events.push({
        kind: "withdrawal",
        key: `d-${wd.id}`,
        date: wd.date.slice(0, 10),
        withdrawal: wd,
        solde: 0,
        reste: 0,
      });
    }
    for (const l of loans) {
      events.push({
        kind: "loan",
        key: `l-${l.id}`,
        date: l.date.slice(0, 10),
        loan: l,
        solde: 0,
        reste: 0,
      });
    }
    const rank = { week: 0, withdrawal: 1, loan: 2 } as const;
    events.sort((a, b) => {
      const diff = timeOf(a.date) - timeOf(b.date);
      if (diff !== 0) return diff;
      return rank[a.kind] - rank[b.kind];
    });

    let cumulIn = 0; // Σ versements
    let cumulOut = 0; // Σ retraits
    let cumulPrets = 0; // Σ prêts (argent prêté, sorti de la caisse)
    let cumulEmprunts = 0; // Σ emprunts (argent reçu)
    for (const e of events) {
      if (e.kind === "week") cumulIn += weekSavedTotal(e.week);
      else if (e.kind === "withdrawal") cumulOut += e.withdrawal.amount;
      else if (e.loan.kind === "emprunt") cumulEmprunts += e.loan.amount;
      else cumulPrets += e.loan.amount;
      const solde = cumulIn + cumulEmprunts - cumulOut - cumulPrets;
      e.solde = solde;
      // « Reste après » = reste à rembourser pour la voiture, calculé sur
      // l'épargne nette (versements − retraits), comme le Tableau de bord :
      // l'argent prêté doit revenir et l'emprunt devra être rendu, ils ne
      // changent donc pas l'avancement du remboursement de la voiture.
      e.reste = Math.max(0, carPriceFc - (cumulIn - cumulOut));
    }

    const t = {
      revenue: 0,
      saved: 0,
      fuel: 0,
      maintenance: 0,
      driver: 0,
      other: 0,
      expenses: 0,
    };
    for (const w of weeks) {
      t.revenue += w.revenueWeek;
      t.saved += weekSavedTotal(w);
      t.fuel += w.fuelExpense;
      t.maintenance += w.maintenanceExpense;
      t.driver += w.driverSaturday;
      t.other += w.otherExpenses;
    }
    t.expenses = t.fuel + t.maintenance + t.driver + t.other;
    const withdrawn = withdrawals.reduce((s, w) => s + w.amount, 0);
    let prets = 0; // Σ prêts (argent sorti)
    let emprunts = 0; // Σ emprunts (argent reçu)
    for (const l of loans) {
      if (l.kind === "emprunt") emprunts += l.amount;
      else prets += l.amount;
    }

    // --- Agrégation MOIS PAR MOIS (calculée sur l'ordre chronologique) ---
    const monthAgg = new Map<
      string,
      {
        recette: number;
        verse: number;
        depenses: number;
        retraits: number;
        prets: number;
        emprunts: number;
      }
    >();
    const monthSolde = new Map<string, number>();
    const monthOrderAsc: string[] = [];
    for (const e of events) {
      const key = e.date.slice(0, 7);
      if (!monthAgg.has(key)) {
        monthAgg.set(key, {
          recette: 0,
          verse: 0,
          depenses: 0,
          retraits: 0,
          prets: 0,
          emprunts: 0,
        });
        monthOrderAsc.push(key);
      }
      const m = monthAgg.get(key)!;
      if (e.kind === "week") {
        m.recette += e.week.revenueWeek;
        m.verse += weekSavedTotal(e.week);
        m.depenses +=
          e.week.fuelExpense +
          e.week.maintenanceExpense +
          e.week.driverSaturday +
          e.week.otherExpenses;
      } else if (e.kind === "withdrawal") {
        m.retraits += e.withdrawal.amount;
      } else if (e.loan.kind === "emprunt") {
        m.emprunts += e.loan.amount;
      } else {
        m.prets += e.loan.amount;
      }
      // Le solde du dernier événement du mois gagne
      monthSolde.set(key, e.solde);
    }
    const months = monthOrderAsc
      .map((key) => {
        const m = monthAgg.get(key)!;
        return {
          key,
          ...m,
          net: m.verse + m.emprunts - m.retraits - m.prets,
          solde: monthSolde.get(key) ?? 0,
        };
      })
      .reverse();

    // Affichage : plus récents en premier
    return {
      ledger: [...events].reverse(),
      totals: t,
      totalWithdrawn: withdrawn,
      totalPrets: prets,
      totalEmprunts: emprunts,
      months,
    };
  }, [weeks, withdrawals, loans, carPriceFc]);

  // Registre filtré par mois (optionnel)
  const displayedLedger =
    monthFilter === "all"
      ? ledger
      : ledger.filter((e) => e.date.slice(0, 7) === monthFilter);

  /** Suppression d'une semaine */
  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const deleted = toDelete;
    const finishOffline = () => {
      queueOp({ kind: "week-delete", payload: { id: deleted.id } });
      applyLocal({ kind: "week-delete", payload: { id: deleted.id } });
      toast({
        title: "Semaine supprimée hors ligne",
        description: `Semaine du ${rangeOf(deleted)} — la suppression sera synchronisée dès le retour de la connexion.`,
      });
      setToDelete(null);
      setDeleting(false);
      onChanged();
    };
    try {
      const res = await fetch(`/api/weeks/${deleted.id}`, { method: "DELETE" });
      if (isOfflineResponse(res)) {
        finishOffline();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la suppression.");
      toast({
        title: "Semaine supprimée",
        description: `Semaine du ${rangeOf(deleted)}`,
      });
      setToDelete(null);
      onChanged();
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  /** Suppression d'un retrait directement depuis le registre */
  async function handleDeleteWithdrawal() {
    if (!toDeleteWd) return;
    setDeleting(true);
    const deleted = toDeleteWd;
    const finishOffline = () => {
      queueOp({ kind: "withdrawal-delete", payload: { id: deleted.id } });
      applyLocal({ kind: "withdrawal-delete", payload: { id: deleted.id } });
      toast({
        title: "Retrait supprimé hors ligne",
        description: "La suppression sera synchronisée dès le retour de la connexion.",
      });
      setToDeleteWd(null);
      setDeleting(false);
      onChanged();
    };
    try {
      const res = await fetch(`/api/withdrawals/${deleted.id}`, { method: "DELETE" });
      if (isOfflineResponse(res)) {
        finishOffline();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la suppression.");
      toast({
        title: "Retrait supprimé",
        description: `${formatFC(deleted.amount)} du ${formatISODateLong(deleted.date.slice(0, 10))} ont été annulés.`,
      });
      setToDeleteWd(null);
      onChanged();
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  /** Suppression d'un prêt/emprunt directement depuis le registre */
  async function handleDeleteLoan() {
    if (!toDeleteLoan) return;
    setDeleting(true);
    const deleted = toDeleteLoan;
    const finishOffline = () => {
      queueOp({ kind: "loan-delete", payload: { id: deleted.id } });
      applyLocal({ kind: "loan-delete", payload: { id: deleted.id } });
      toast({
        title:
          deleted.kind === "emprunt" ? "Emprunt supprimé hors ligne" : "Prêt supprimé hors ligne",
        description: "La suppression sera synchronisée dès le retour de la connexion.",
      });
      setToDeleteLoan(null);
      setDeleting(false);
      onChanged();
    };
    try {
      const res = await fetch(`/api/loans/${deleted.id}`, { method: "DELETE" });
      if (isOfflineResponse(res)) {
        finishOffline();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la suppression.");
      toast({
        title: deleted.kind === "emprunt" ? "Emprunt supprimé" : "Prêt supprimé",
        description: `${formatFC(deleted.amount)} — ${deleted.person}.`,
      });
      setToDeleteLoan(null);
      onChanged();
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  const hasData = weeks.length > 0 || withdrawals.length > 0 || loans.length > 0;
  const finalSolde = totals.saved + totalEmprunts - totalWithdrawn - totalPrets;
  // Effet net des prêts & emprunts sur le solde (positif = argent sorti)
  const netPrets = totalPrets - totalEmprunts;

  // Totaux du résumé mensuel
  const monthsTotals = months.reduce(
    (acc, m) => ({
      recette: acc.recette + m.recette,
      verse: acc.verse + m.verse,
      depenses: acc.depenses + m.depenses,
      retraits: acc.retraits + m.retraits,
      prets: acc.prets + m.prets,
      emprunts: acc.emprunts + m.emprunts,
      net: acc.net + m.net,
    }),
    { recette: 0, verse: 0, depenses: 0, retraits: 0, prets: 0, emprunts: 0, net: 0 }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="h-5 w-5 text-primary" />
          Historique des semaines, retraits et prêts
        </CardTitle>
        <CardDescription>
          {hasData
            ? `${weeks.length} semaine${weeks.length > 1 ? "s" : ""} · ${withdrawals.length} retrait${withdrawals.length > 1 ? "s" : ""} (−${formatFC(totalWithdrawn)}) · ${loans.length} prêt${loans.length > 1 ? "s" : ""}/emprunt${loans.length > 1 ? "s" : ""}. Le solde restant diminue après chaque retrait ou prêt (et augmente après un emprunt) ; le reste à rembourser diminue après chaque versement.`
            : "Aucune semaine, retrait ni prêt enregistré pour le moment."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <HistoryIcon className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Commencez par créer une semaine dans l&apos;onglet « Calendrier ».
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Résumé mensuel */}
            {months.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <CalendarRange className="h-4 w-4 text-primary" />
                  Calcul historique mois par mois
                </p>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Mois</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Recette</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Versé</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Dépenses</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Retraits</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Prêts &amp; emprunts</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Net du mois</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Solde fin de mois</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {months.map((m) => (
                        <TableRow
                          key={m.key}
                          className={
                            monthFilter === m.key ? "bg-accent/60" : undefined
                          }
                        >
                          <TableCell className="whitespace-nowrap font-medium">
                            {monthLabel(m.key)}
                          </TableCell>
                          <TableCell className="text-right font-money whitespace-nowrap text-muted-foreground">
                            {formatFC(m.recette)}
                          </TableCell>
                          <TableCell className="text-right font-money whitespace-nowrap font-semibold text-primary">
                            {formatFC(m.verse)}
                          </TableCell>
                          <TableCell className="text-right font-money whitespace-nowrap text-muted-foreground">
                            {formatFC(m.depenses)}
                          </TableCell>
                          <TableCell className="text-right font-money whitespace-nowrap text-destructive">
                            {m.retraits > 0 ? `−${formatFC(m.retraits)}` : "—"}
                          </TableCell>
                          <TableCell
                            className={`text-right font-money whitespace-nowrap ${
                              m.prets - m.emprunts > 0
                                ? "text-amber-600 dark:text-amber-400"
                                : m.prets - m.emprunts < 0
                                  ? "text-primary"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {m.prets - m.emprunts > 0
                              ? `−${formatFC(m.prets - m.emprunts)}`
                              : m.prets - m.emprunts < 0
                                ? `+${formatFC(m.emprunts - m.prets)}`
                                : "—"}
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
                              m.solde < 0 ? "text-destructive" : "text-foreground"
                            }`}
                          >
                            {m.solde < 0 ? `−${formatFC(-m.solde)}` : formatFC(m.solde)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-bold">Totaux</TableCell>
                        <TableCell className="text-right font-money font-bold whitespace-nowrap">
                          {formatFC(monthsTotals.recette)}
                        </TableCell>
                        <TableCell className="text-right font-money font-bold text-primary whitespace-nowrap">
                          {formatFC(monthsTotals.verse)}
                        </TableCell>
                        <TableCell className="text-right font-money font-bold whitespace-nowrap">
                          {formatFC(monthsTotals.depenses)}
                        </TableCell>
                        <TableCell className="text-right font-money font-bold text-destructive whitespace-nowrap">
                          −{formatFC(monthsTotals.retraits)}
                        </TableCell>
                        <TableCell className="text-right font-money font-bold whitespace-nowrap">
                          {netPrets > 0
                            ? `−${formatFC(netPrets)}`
                            : netPrets < 0
                              ? `+${formatFC(-netPrets)}`
                              : "—"}
                        </TableCell>
                        <TableCell className="text-right font-money font-bold whitespace-nowrap">
                          {monthsTotals.net < 0
                            ? `−${formatFC(-monthsTotals.net)}`
                            : formatFC(monthsTotals.net)}
                        </TableCell>
                        <TableCell className="text-right font-money font-bold whitespace-nowrap">
                          {finalSolde < 0 ? `−${formatFC(-finalSolde)}` : formatFC(finalSolde)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </div>
            )}

            {/* Détail : registre chronologique (+ filtre par mois) */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Détail semaine par semaine</p>
                {months.length > 0 && (
                  <Select value={monthFilter} onValueChange={setMonthFilter}>
                    <SelectTrigger className="h-9 w-52" aria-label="Filtrer par mois">
                      <SelectValue placeholder="Tous les mois" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les mois</SelectItem>
                      {months.map((m) => (
                        <SelectItem key={m.key} value={m.key}>
                          {monthLabel(m.key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="whitespace-nowrap">Semaine / Date</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Recette</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Versé (FC)</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Retrait</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Prêt / Emprunt</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Solde restant</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Carburant</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Entretien</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Chauffeur</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Autres</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Dépenses</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Reste après</TableHead>
                  <TableHead>Note / Motif</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedLedger.map((e) => {
                  if (e.kind === "withdrawal") {
                    const wd = e.withdrawal;
                    const wdDate = wd.date.slice(0, 10);
                    return (
                      <TableRow
                        key={e.key}
                        className="bg-destructive/5 hover:bg-destructive/10"
                      >
                        <TableCell className="whitespace-nowrap font-medium">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className="gap-1 border-destructive/40 px-1.5 py-0 text-[10px] text-destructive"
                              title="Retrait d'argent sur date individuelle"
                            >
                              <BanknoteArrowDown className="h-3 w-3" />
                              Retrait
                            </Badge>
                            <span>{formatISODateLong(wdDate)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right font-money whitespace-nowrap font-semibold text-destructive">
                          −{formatFC(wd.amount)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell
                          className={`text-right font-money whitespace-nowrap font-semibold ${
                            e.solde < 0 ? "text-destructive" : "text-foreground"
                          }`}
                        >
                          {e.solde < 0 ? `−${formatFC(-e.solde)}` : formatFC(e.solde)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right font-money whitespace-nowrap">
                          {formatFC(e.reste)}
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-sm">
                          {wd.note ? (
                            <span
                              className="italic text-destructive"
                              title={`Motif du retrait : ${wd.note}`}
                            >
                              {wd.note}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setToDeleteWd(wd)}
                              aria-label={`Supprimer le retrait du ${formatISODateLong(wdDate)}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  if (e.kind === "loan") {
                    const l = e.loan;
                    const lDate = l.date.slice(0, 10);
                    const isEmprunt = l.kind === "emprunt";
                    return (
                      <TableRow
                        key={e.key}
                        className={
                          isEmprunt
                            ? "bg-primary/5 hover:bg-primary/10"
                            : "bg-amber-500/5 hover:bg-amber-500/10"
                        }
                      >
                        <TableCell className="whitespace-nowrap font-medium">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={
                                isEmprunt
                                  ? "gap-1 border-primary/40 px-1.5 py-0 text-[10px] text-primary"
                                  : "gap-1 border-amber-500/40 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                              }
                              title={
                                isEmprunt
                                  ? "Emprunt : argent reçu de quelqu'un"
                                  : "Prêt : argent donné à quelqu'un"
                              }
                            >
                              {isEmprunt ? (
                                <ArrowDownLeft className="h-3 w-3" />
                              ) : (
                                <ArrowUpRight className="h-3 w-3" />
                              )}
                              {isEmprunt ? "Emprunt" : "Prêt"}
                            </Badge>
                            <span>{formatISODateLong(lDate)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell
                          className={`text-right font-money whitespace-nowrap font-semibold ${
                            isEmprunt ? "text-primary" : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {isEmprunt ? `+${formatFC(l.amount)}` : `−${formatFC(l.amount)}`}
                        </TableCell>
                        <TableCell
                          className={`text-right font-money whitespace-nowrap font-semibold ${
                            e.solde < 0 ? "text-destructive" : "text-foreground"
                          }`}
                        >
                          {e.solde < 0 ? `−${formatFC(-e.solde)}` : formatFC(e.solde)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right font-money whitespace-nowrap">
                          {formatFC(e.reste)}
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-sm">
                          <span
                            className={
                              isEmprunt
                                ? "font-medium"
                                : "font-medium text-amber-700 dark:text-amber-400"
                            }
                            title={`${isEmprunt ? "Reçu de" : "Prêté à"} ${l.person}${l.note ? ` — ${l.note}` : ""}`}
                          >
                            {isEmprunt ? `Reçu de ${l.person}` : `Prêté à ${l.person}`}
                          </span>
                          {l.note && (
                            <span className="italic text-muted-foreground"> — {l.note}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setToDeleteLoan(l)}
                              aria-label={`Supprimer ${isEmprunt ? "l'emprunt" : "le prêt"} de ${l.person} du ${formatISODateLong(lDate)}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  const w = e.week;
                  const info = { solde: e.solde, reste: e.reste };
                  const expenses =
                    w.fuelExpense + w.maintenanceExpense + w.driverSaturday + w.otherExpenses;
                  const hasDays = (w.days ?? []).length > 0;
                  const isExpanded = expandedId === w.id;
                  return (
                    <Fragment key={e.key}>
                    <TableRow>
                      <TableCell className="whitespace-nowrap font-medium">
                        <div className="flex items-center gap-1.5">
                          {hasDays && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => setExpandedId(isExpanded ? null : w.id)}
                              aria-label={isExpanded ? "Masquer le détail des jours" : "Voir le détail des jours"}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          )}
                          <span>{rangeOf(w)}</span>
                          {hasDays && (
                            <Badge variant="outline" className="ml-1 gap-1 px-1.5 py-0 text-[10px]" title="Cette semaine contient un détail jour par jour">
                              <CalendarRange className="h-3 w-3" />
                              {w.days!.length} j
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap">
                        {formatFC(w.revenueWeek)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap font-semibold text-primary">
                        {formatFC(weekSavedTotal(w))}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                      <TableCell
                        className={`text-right font-money whitespace-nowrap font-semibold ${
                          e.solde < 0 ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {info.solde < 0 ? `−${formatFC(-info.solde)}` : formatFC(info.solde)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-muted-foreground">
                        {formatFC(w.fuelExpense)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-muted-foreground">
                        {formatFC(w.maintenanceExpense)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-muted-foreground">
                        {formatFC(w.driverSaturday)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap text-muted-foreground">
                        {formatFC(w.otherExpenses)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap">
                        {formatFC(expenses)}
                      </TableCell>
                      <TableCell className="text-right font-money whitespace-nowrap">
                        {formatFC(info.reste)}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm text-muted-foreground">
                        {w.note || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => onEdit(w)}
                            aria-label={`Modifier la semaine du ${rangeOf(w)}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setToDelete(w)}
                            aria-label={`Supprimer la semaine du ${rangeOf(w)}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {/* Détail jour par jour (dépliable) */}
                    {isExpanded && (
                      <TableRow key={`${w.id}-days`} className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={14} className="p-0">
                          <div className="px-4 py-3">
                            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              <CalendarRange className="h-3.5 w-3.5 text-primary" />
                              Détail jour par jour — semaine du {rangeOf(w)}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {(w.days ?? []).map((d) => (
                                <div
                                  key={d.id}
                                  className="rounded-md border bg-background px-3 py-2 text-xs"
                                >
                                  <p className="font-semibold text-foreground">
                                    {dayShortLabel(d.date.slice(0, 10))}
                                  </p>
                                  {d.revenue > 0 && (
                                    <p className="mt-0.5 font-money text-muted-foreground">
                                      Recette : <span className="text-foreground">{formatFC(d.revenue)}</span>
                                    </p>
                                  )}
                                  <p className="font-money text-muted-foreground">
                                    Versé : <span className="font-medium text-primary">{formatFC(d.savedAmount)}</span>
                                  </p>
                                  {d.expense > 0 && (
                                    <p className="font-money text-muted-foreground">
                                      Dépense : <span className="text-foreground">{formatFC(d.expense)}</span>
                                    </p>
                                  )}
                                  {d.note && <p className="mt-0.5 italic text-muted-foreground">{d.note}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Totaux (semaines)</TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    {formatFC(totals.revenue)}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold text-primary whitespace-nowrap">
                    {formatFC(totals.saved)}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold text-destructive whitespace-nowrap">
                    −{formatFC(totalWithdrawn)}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    {netPrets > 0
                      ? `−${formatFC(netPrets)}`
                      : netPrets < 0
                        ? `+${formatFC(-netPrets)}`
                        : "—"}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    {finalSolde < 0 ? `−${formatFC(-finalSolde)}` : formatFC(finalSolde)}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    {formatFC(totals.fuel)}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    {formatFC(totals.maintenance)}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    {formatFC(totals.driver)}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    {formatFC(totals.other)}
                  </TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    {formatFC(totals.expenses)}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            </Table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Solde restant = argent disponible : les versements et les emprunts
                l&apos;augmentent, les retraits et les prêts le diminuent. Reste après = reste à
                rembourser pour la voiture (versements − retraits) : les prêts et emprunts
                n&apos;y changent rien.
              </p>
            </div>
          </div>
        )}
      </CardContent>

      {/* Confirmation de suppression — semaine */}
      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette semaine ?</AlertDialogTitle>
            <AlertDialogDescription>
              La semaine du {toDelete ? rangeOf(toDelete) : ""} sera définitivement
              supprimée. Les totaux et le suivi du remboursement seront recalculés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation de suppression — retrait */}
      <AlertDialog
        open={toDeleteWd !== null}
        onOpenChange={(open) => !open && setToDeleteWd(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce retrait ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le retrait de {toDeleteWd ? formatFC(toDeleteWd.amount) : ""} du{" "}
              {toDeleteWd ? formatISODateLong(toDeleteWd.date.slice(0, 10)) : ""} sera
              définitivement supprimé et le solde restant sera recalculé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteWithdrawal();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation de suppression — prêt / emprunt */}
      <AlertDialog
        open={toDeleteLoan !== null}
        onOpenChange={(open) => !open && setToDeleteLoan(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toDeleteLoan?.kind === "emprunt" ? "Supprimer cet emprunt ?" : "Supprimer ce prêt ?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toDeleteLoan
                ? `${toDeleteLoan.kind === "emprunt" ? "L'emprunt reçu de" : "Le prêt donné à"} ${toDeleteLoan.person} d'un montant de ${formatFC(toDeleteLoan.amount)} le ${formatISODateLong(toDeleteLoan.date.slice(0, 10))} sera définitivement supprimé et le solde restant sera recalculé.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteLoan();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
