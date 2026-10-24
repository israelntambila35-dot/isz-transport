"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  History as HistoryIcon,
  Loader2,
  MousePointerClick,
  Pencil,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatFC, formatISODateLong, formatWeekRange, monthLabel, toISODateUTC } from "@/lib/format";
import {
  applyLocal,
  isOfflineError,
  isOfflineResponse,
  queueOp,
} from "@/lib/offline";
import {
  MAX_WEEK_LENGTH_DAYS,
  dayShortLabel,
  sortDays,
  weekContainingDate,
  weekSavedTotal,
} from "@/lib/weeks";
import type { AppSettings, WeeklyEntry, Withdrawal } from "@/lib/types";
import { DayDialog } from "@/components/app/day-dialog";
import { WeekDialog } from "@/components/app/week-dialog";

const nfCompact = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const WEEKDAYS_HEAD = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

/** Construit les 42 cellules (6 semaines) d'une grille mensuelle lundi → dimanche */
function buildMonthCells(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // lundi = 0
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - offset);
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    cells.push(toISODateUTC(d));
  }
  return cells;
}

interface CalendarViewProps {
  weeks: WeeklyEntry[];
  withdrawals: Withdrawal[];
  settings: AppSettings | null;
  onChanged: () => void;
  /** Semaine à ouvrir en modification (envoyée depuis l'Historique) */
  editingWeek: WeeklyEntry | null;
  onEditingWeekHandled: () => void;
}

/**
 * Onglet « Calendrier » :
 *  1. L'utilisateur crée lui-même ses semaines en cliquant le jour de DÉBUT
 *     puis le jour de FIN dans le calendrier.
 *  2. Il clique ensuite chaque jour (le 16, le 17, le 18…) pour saisir le
 *     montant versé par le chauffeur — le total de la semaine se calcule seul.
 */
export function CalendarView({
  weeks,
  withdrawals,
  settings,
  onChanged,
  editingWeek,
  onEditingWeekHandled,
}: CalendarViewProps) {
  const { toast } = useToast();
  const todayISO = toISODateUTC(new Date());
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Mode création : 1er clic = début, 2e clic = fin
  const [selectionMode, setSelectionMode] = useState(false);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // Dialogues
  const [weekDialog, setWeekDialog] = useState<{
    open: boolean;
    editing: WeeklyEntry | null;
    start: string | null;
    end: string | null;
  }>({ open: false, editing: null, start: null, end: null });
  const [dayDialog, setDayDialog] = useState<{ open: boolean; week: WeeklyEntry | null; date: string }>({
    open: false,
    week: null,
    date: "",
  });
  const [toDelete, setToDelete] = useState<WeeklyEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  // « Modifier » déclenché depuis l'Historique
  useEffect(() => {
    if (editingWeek) {
      setWeekDialog({ open: true, editing: editingWeek, start: null, end: null });
      onEditingWeekHandled();
    }
  }, [editingWeek, onEditingWeekHandled]);

  /** date → entrée du jour (avec sa semaine) */
  const dayMap = useMemo(() => {
    const map = new Map<string, { weekId: string; savedAmount: number; note: string | null }>();
    for (const w of weeks) {
      for (const d of w.days ?? []) {
        map.set(d.date.slice(0, 10), { weekId: w.id, savedAmount: d.savedAmount, note: d.note });
      }
    }
    return map;
  }, [weeks]);

  /** date → total des retraits ce jour (point rouge) */
  const withdrawalMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const wd of withdrawals) {
      const key = wd.date.slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + wd.amount);
    }
    return map;
  }, [withdrawals]);

  const cells = useMemo(() => buildMonthCells(view.year, view.month), [view]);
  const monthKey = `${view.year}-${String(view.month + 1).padStart(2, "0")}`;

  // Plage survolée en mode sélection (aperçu du début → jour survolé)
  const previewRange = useMemo(() => {
    if (!selectionMode || !pendingStart || !hoverDate) return null;
    const lo = pendingStart <= hoverDate ? pendingStart : hoverDate;
    const hi = pendingStart <= hoverDate ? hoverDate : pendingStart;
    return { lo, hi };
  }, [selectionMode, pendingStart, hoverDate]);

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(Date.UTC(v.year, v.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  function toggleSelectionMode() {
    setSelectionMode((s) => !s);
    setPendingStart(null);
    setHoverDate(null);
  }

  function handleDayClick(iso: string) {
    if (selectionMode) {
      if (!pendingStart) {
        setPendingStart(iso);
        return;
      }
      // 2e clic : fin de la semaine
      const start = pendingStart <= iso ? pendingStart : iso;
      const end = pendingStart <= iso ? iso : pendingStart;
      const lengthDays =
        Math.round(
          (new Date(`${end}T12:00:00.000Z`).getTime() - new Date(`${start}T12:00:00.000Z`).getTime()) /
            86_400_000
        ) + 1;
      if (lengthDays > MAX_WEEK_LENGTH_DAYS) {
        toast({
          title: "Période trop longue",
          description: `Une semaine ne peut pas dépasser ${MAX_WEEK_LENGTH_DAYS} jours. Choisissez un jour de fin plus proche.`,
          variant: "destructive",
        });
        return;
      }
      setSelectionMode(false);
      setPendingStart(null);
      setHoverDate(null);
      setWeekDialog({ open: true, editing: null, start, end });
      return;
    }

    // Mode normal : ouvrir le jour s'il appartient à une semaine
    const week = weekContainingDate(iso, weeks);
    if (week) {
      const fresh = weeks.find((w) => w.id === week.id) ?? null;
      setDayDialog({ open: true, week: fresh, date: iso });
    } else {
      toast({
        title: "Aucune semaine sur ce jour",
        description: "Cliquez d'abord sur « Créer une semaine », puis choisissez le début et la fin.",
      });
    }
  }

  async function handleDeleteWeek() {
    if (!toDelete) return;
    setDeleting(true);
    const deleted = toDelete;
    const finishOffline = () => {
      queueOp({ kind: "week-delete", payload: { id: deleted.id } });
      applyLocal({ kind: "week-delete", payload: { id: deleted.id } });
      toast({
        title: "Semaine supprimée hors ligne",
        description: `Semaine du ${formatWeekRange(deleted.weekStart.slice(0, 10), deleted.weekEnd ?? undefined)} — la suppression sera synchronisée.`,
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
        description: `Semaine du ${formatWeekRange(deleted.weekStart.slice(0, 10), deleted.weekEnd ?? undefined)}`,
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

  const sortedWeeks = useMemo(
    () =>
      [...weeks].sort(
        (a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime()
      ),
    [weeks]
  );

  return (
    <div className="space-y-6">
      {/* ---------- CALENDRIER ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Calendrier des versements
          </CardTitle>
          <CardDescription>
            Créez vos semaines en cliquant le jour de <strong>début</strong> puis le jour de{" "}
            <strong>fin</strong>. Cliquez ensuite chaque jour (le 16, le 17, le 18…) pour saisir le
            montant versé par le chauffeur — le total de la semaine se calcule tout seul.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Barre d'outils */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => shiftMonth(-1)}
                aria-label="Mois précédent"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <p className="min-w-36 text-center text-sm font-semibold capitalize">
                {monthLabel(monthKey)}
              </p>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => shiftMonth(1)}
                aria-label="Mois suivant"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 min-h-9"
                onClick={() => {
                  const now = new Date();
                  setView({ year: now.getFullYear(), month: now.getMonth() });
                }}
              >
                Aujourd&apos;hui
              </Button>
            </div>
            <Button
              onClick={toggleSelectionMode}
              variant={selectionMode ? "secondary" : "default"}
              className="min-h-11"
            >
              {selectionMode ? (
                <>
                  <X className="mr-2 h-4 w-4" />
                  Annuler la sélection
                </>
              ) : (
                <>
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  Créer une semaine
                </>
              )}
            </Button>
          </div>

          {/* Consigne de sélection */}
          {selectionMode && (
            <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-accent/50 px-3 py-2 text-sm">
              <MousePointerClick className="h-4 w-4 shrink-0 text-primary" />
              {pendingStart ? (
                <span>
                  Début choisi : <strong>{formatISODateLong(pendingStart)}</strong> — cliquez
                  maintenant le jour de <strong>FIN</strong> de la semaine.
                </span>
              ) : (
                <span>
                  Cliquez dans le calendrier le jour du <strong>DÉBUT</strong> de la semaine.
                </span>
              )}
            </div>
          )}

          {/* Grille */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">
            {WEEKDAYS_HEAD.map((d) => (
              <span key={d} className="py-1">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((iso) => {
              const dayNum = Number(iso.slice(8, 10));
              const inMonth = Number(iso.slice(5, 7)) === view.month + 1;
              const week = weekContainingDate(iso, weeks);
              const dayEntry = dayMap.get(iso);
              const wdTotal = withdrawalMap.get(iso);
              const isToday = iso === todayISO;
              const isStart = pendingStart === iso;
              const isPreview =
                previewRange !== null && iso >= previewRange.lo && iso <= previewRange.hi;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => handleDayClick(iso)}
                  onMouseEnter={() => setHoverDate(iso)}
                  onFocus={() => setHoverDate(iso)}
                  aria-label={`${formatISODateLong(iso)}${
                    dayEntry && dayEntry.savedAmount > 0
                      ? `, ${formatFC(dayEntry.savedAmount)} versés`
                      : week
                        ? ", semaine — cliquez pour saisir le montant"
                        : ""
                  }${wdTotal ? `, retrait de ${formatFC(wdTotal)}` : ""}`}
                  className={cn(
                    "relative flex min-h-14 flex-col items-center justify-start rounded-md border p-1 transition-colors sm:min-h-20",
                    week
                      ? "border-primary/40 bg-primary/5 hover:bg-primary/15"
                      : "border-border/60 hover:bg-muted/60",
                    !inMonth && "opacity-40",
                    isPreview && "border-primary bg-primary/15",
                    isStart && "border-primary bg-primary/20 ring-2 ring-primary/40",
                    isToday && "ring-1 ring-primary/60"
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-medium sm:text-sm",
                      isToday && "text-primary",
                      !inMonth && "text-muted-foreground"
                    )}
                  >
                    {dayNum}
                  </span>
                  {dayEntry && dayEntry.savedAmount > 0 && (
                    <span className="mt-0.5 rounded bg-primary/15 px-1 text-[9px] font-semibold text-primary sm:text-[10px]">
                      {nfCompact.format(dayEntry.savedAmount)}
                    </span>
                  )}
                  {week && (!dayEntry || dayEntry.savedAmount <= 0) && (
                    <span className="mt-0.5 hidden text-[10px] leading-none text-muted-foreground/60 sm:block">
                      ＋
                    </span>
                  )}
                  {wdTotal ? (
                    <span
                      className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500"
                      title={`Retrait : ${formatFC(wdTotal)}`}
                    />
                  ) : null}
                  {isToday && (
                    <span className="absolute inset-x-3 bottom-1 h-0.5 rounded-full bg-primary/70" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Légende */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-primary/40 bg-primary/10" />
              Jour dans une semaine
            </span>
            <span className="flex items-center gap-1.5">
              <span className="rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                30 k
              </span>
              Montant versé ce jour
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Retrait d&apos;argent
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded ring-1 ring-primary/60" />
              Aujourd&apos;hui
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ---------- MES SEMAINES ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HistoryIcon className="h-5 w-5 text-primary" />
            Mes semaines ({sortedWeeks.length})
          </CardTitle>
          <CardDescription>
            Chaque semaine a été créée par vous : cliquez sur un jour pour corriger son montant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedWeeks.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
              <CalendarPlus className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Aucune semaine pour le moment — cliquez sur « Créer une semaine » ci-dessus.
              </p>
            </div>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
              {sortedWeeks.map((w) => {
                const total = weekSavedTotal(w);
                const filledDays = (w.days ?? []).filter((d) => d.savedAmount > 0).length;
                const expenses =
                  w.fuelExpense + w.maintenanceExpense + w.driverSaturday + w.otherExpenses;
                const target = settings?.weeklySavingsTarget ?? 0;
                const pct = target > 0 ? Math.min(100, (total / target) * 100) : 0;
                return (
                  <div key={w.id} className="space-y-2 rounded-lg border p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          Semaine du{" "}
                          {formatWeekRange(w.weekStart.slice(0, 10), w.weekEnd ?? undefined)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {(w.days ?? []).length > 0
                            ? `${filledDays} jour(s) avec montant saisi`
                            : "Total saisi directement (sans détail par jour)"}
                          {w.revenueWeek > 0 && ` · recette ${formatFC(w.revenueWeek)}`}
                          {expenses > 0 && ` · dépenses ${formatFC(expenses)}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setWeekDialog({ open: true, editing: w, start: null, end: null })}
                          aria-label={`Modifier la semaine du ${formatWeekRange(w.weekStart.slice(0, 10), w.weekEnd ?? undefined)}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setToDelete(w)}
                          aria-label={`Supprimer la semaine du ${formatWeekRange(w.weekStart.slice(0, 10), w.weekEnd ?? undefined)}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="text-lg font-bold font-money text-primary">
                        {formatFC(total)}
                      </p>
                      <p className="text-xs text-muted-foreground">versés par le chauffeur</p>
                      {target > 0 && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "gap-1 text-[10px]",
                            total >= target
                              ? "border-primary/50 text-primary"
                              : "border-amber-500/50 text-amber-600"
                          )}
                        >
                          {total >= target ? "objectif atteint" : `${Math.round(pct)} % de l'objectif`}
                        </Badge>
                      )}
                    </div>
                    {target > 0 && <Progress value={pct} className="h-1.5" />}

                    {/* Détail jour par jour — cliquable pour corriger */}
                    {(w.days ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {sortDays(w.days!).map((d) => {
                          const iso = d.date.slice(0, 10);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => setDayDialog({ open: true, week: w, date: iso })}
                              className={cn(
                                "rounded-md border bg-background px-2 py-1 text-[11px] transition-colors hover:border-primary/60 hover:bg-primary/5",
                                d.savedAmount <= 0 && "text-muted-foreground"
                              )}
                              aria-label={`Modifier le montant du ${formatISODateLong(iso)}`}
                            >
                              <span className="font-medium">{dayShortLabel(iso)}</span>
                              <span className="ml-1.5 font-money font-semibold text-primary">
                                {d.savedAmount > 0 ? nfCompact.format(d.savedAmount) : "—"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {w.note && <p className="text-xs italic text-muted-foreground">{w.note}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- DIALOGUES ---------- */}
      <WeekDialog
        open={weekDialog.open}
        onOpenChange={(open) => setWeekDialog((s) => ({ ...s, open }))}
        settings={settings}
        editing={
          weekDialog.editing
            ? weeks.find((w) => w.id === weekDialog.editing!.id) ?? weekDialog.editing
            : null
        }
        initialStart={weekDialog.start ?? undefined}
        initialEnd={weekDialog.end ?? undefined}
        onSaved={onChanged}
      />

      <DayDialog
        open={dayDialog.open}
        onOpenChange={(open) => setDayDialog((s) => ({ ...s, open }))}
        week={
          dayDialog.week
            ? weeks.find((w) => w.id === dayDialog.week!.id) ?? dayDialog.week
            : null
        }
        dateISO={dayDialog.date}
        onSaved={onChanged}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette semaine ?</AlertDialogTitle>
            <AlertDialogDescription>
              La semaine du{" "}
              {toDelete
                ? formatWeekRange(toDelete.weekStart.slice(0, 10), toDelete.weekEnd ?? undefined)
                : ""}{" "}
              sera définitivement supprimée avec tous ses jours. Les totaux et le suivi du
              remboursement seront recalculés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteWeek();
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

      {/* Indication retraits (renvoi vers l'onglet) */}
      {withdrawals.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wallet className="h-3.5 w-3.5" />
          Astuce : les retraits d&apos;argent se saisissent dans l&apos;onglet « Retraits » — ils
          apparaissent ensuite comme des points rouges dans le calendrier.
        </p>
      )}
    </div>
  );
}
