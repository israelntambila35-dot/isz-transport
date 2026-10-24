"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, PiggyBank, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import { formatFC, formatISODateLong, formatWeekRange } from "@/lib/format";
import {
  applyLocal,
  isOfflineError,
  isOfflineResponse,
  queueOp,
} from "@/lib/offline";
import { weekSavedTotal } from "@/lib/weeks";
import type { WeeklyEntry } from "@/lib/types";

interface DayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Semaine qui contient ce jour */
  week: WeeklyEntry | null;
  /** Date du jour cliqué "YYYY-MM-DD" */
  dateISO: string;
  onSaved: () => void;
}

/**
 * Dialogue « Jour individuel » : on clique une date du calendrier
 * (le 16, le 17, le 18…) et on saisit le montant versé par le
 * chauffeur ce jour-là. Le total de la semaine se recalcule tout seul.
 */
export function DayDialog({ open, onOpenChange, week, dateISO, onSaved }: DayDialogProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingDay = useMemo(
    () => (week?.days ?? []).find((d) => d.date.slice(0, 10) === dateISO) ?? null,
    [week, dateISO]
  );

  // Remplissage à chaque ouverture
  useEffect(() => {
    if (!open) return;
    setError(null);
    setAmount(existingDay ? String(existingDay.savedAmount) : "");
    setNote(existingDay?.note ?? "");
  }, [open, existingDay]);

  if (!week || !dateISO) {
    return null;
  }

  const hasAmount = amount.trim() !== "" && Number(amount) > 0;

  /** Applique la mutation au cache local + file d'attente (hors ligne) */
  function saveOffline() {
    if (!week) return;
    const saved = Number(amount.replace(",", ".")) || 0;
    if (saved > 0) {
      queueOp({
        kind: "day-upsert",
        payload: { weekId: week.id, day: { date: dateISO, savedAmount: saved, note: note.trim() || null } },
      });
      applyLocal({
        kind: "day-upsert",
        payload: { weekId: week.id, day: { date: dateISO, savedAmount: saved, note: note.trim() || null } },
      });
      toast({
        title: "Montant du jour enregistré hors ligne",
        description: `${formatFC(saved)} le ${formatISODateLong(dateISO)} — synchronisé dès le retour de la connexion.`,
      });
    } else {
      queueOp({ kind: "day-delete", payload: { weekId: week.id, date: dateISO } });
      applyLocal({ kind: "day-delete", payload: { weekId: week.id, date: dateISO } });
      toast({
        title: "Montant du jour effacé hors ligne",
        description: "La suppression sera synchronisée dès le retour de la connexion.",
      });
    }
    setSaving(false);
    onOpenChange(false);
    onSaved();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const saved = amount.trim() === "" ? NaN : Number(amount.replace(",", "."));
    if (!Number.isFinite(saved) || saved < 0) {
      setError("Le montant versé doit être un nombre positif.");
      return;
    }

    setSaving(true);
    let res: Response;
    try {
      if (saved === 0 && existingDay) {
        // Montant vidé → on efface le jour
        res = await fetch(`/api/weeks/${week.id}/days?date=${encodeURIComponent(dateISO)}`, {
          method: "DELETE",
        });
      } else {
        res = await fetch(`/api/weeks/${week.id}/days`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: dateISO, savedAmount: saved, note: note.trim() }),
        });
      }
    } catch (err) {
      if (isOfflineError(err)) {
        saveOffline();
        return;
      }
      const message = err instanceof Error ? err.message : "Erreur inconnue.";
      setError(message);
      toast({ title: "Erreur", description: message, variant: "destructive" });
      setSaving(false);
      return;
    }
    if (isOfflineResponse(res)) {
      saveOffline();
      return;
    }
    try {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de l'enregistrement.");
      }
      const newTotal = weekSavedTotal(data as WeeklyEntry);
      toast({
        title: saved > 0 ? "Montant du jour enregistré" : "Montant du jour effacé",
        description: `${formatISODateLong(dateISO)} — total de la semaine : ${formatFC(newTotal)}`,
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue.";
      setError(message);
      toast({ title: "Erreur", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existingDay) return;
    setDeleting(true);
    const finishOffline = () => {
      queueOp({ kind: "day-delete", payload: { weekId: week.id, date: dateISO } });
      applyLocal({ kind: "day-delete", payload: { weekId: week.id, date: dateISO } });
      toast({
        title: "Montant du jour effacé hors ligne",
        description: "La suppression sera synchronisée dès le retour de la connexion.",
      });
      setDeleting(false);
      onOpenChange(false);
      onSaved();
    };
    try {
      const res = await fetch(`/api/weeks/${week.id}/days?date=${encodeURIComponent(dateISO)}`, {
        method: "DELETE",
      });
      if (isOfflineResponse(res)) {
        finishOffline();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la suppression.");
      toast({
        title: "Montant du jour effacé",
        description: `${formatISODateLong(dateISO)} — le total de la semaine a été recalculé.`,
      });
      onOpenChange(false);
      onSaved();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            {formatISODateLong(dateISO)}
          </DialogTitle>
          <DialogDescription>
            Semaine du {formatWeekRange(week.weekStart.slice(0, 10), week.weekEnd ? week.weekEnd.slice(0, 10) : null)} —
            saisissez le montant versé par le chauffeur ce jour-là.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="day-amount" className="flex items-center gap-1.5">
              <PiggyBank className="h-4 w-4 text-primary" />
              Montant versé ce jour (FC) *
            </Label>
            <Input
              id="day-amount"
              type="number"
              min="0"
              step="any"
              inputMode="numeric"
              placeholder="Ex : 30000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              className="font-money text-lg"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="day-note">Note du jour (facultatif)</Label>
            <Input
              id="day-note"
              type="text"
              placeholder="Ex : course matin, panne…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* Total de la semaine mis à jour en direct */}
          <p className="rounded-md bg-muted/40 px-3 py-2 text-sm font-money">
            Total déjà saisi dans la semaine :{" "}
            <span className="font-semibold text-primary">
              {formatFC(weekSavedTotal({
                ...week,
                days: (week.days ?? []).some((d) => d.date.slice(0, 10) === dateISO)
                  ? (week.days ?? []).map((d) =>
                      d.date.slice(0, 10) === dateISO
                        ? { ...d, savedAmount: Number(amount.replace(",", ".")) || 0 }
                        : d
                    )
                  : hasAmount
                    ? [
                        ...(week.days ?? []),
                        {
                          id: "preview",
                          weekId: week.id,
                          dayIndex: 0,
                          date: `${dateISO}T12:00:00.000Z`,
                          revenue: 0,
                          savedAmount: Number(amount.replace(",", ".")) || 0,
                          expense: 0,
                          note: null,
                        },
                      ]
                    : week.days,
              }))}
            </span>
          </p>

          <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
            {existingDay ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleDelete}
                disabled={saving || deleting}
                className="min-h-11 text-destructive hover:text-destructive"
              >
                {deleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Effacer ce jour
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="min-h-11"
              >
                <X className="mr-2 h-4 w-4" />
                Annuler
              </Button>
              <Button type="submit" disabled={saving} className="min-h-11">
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Enregistrer
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
