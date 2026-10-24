"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Fuel,
  Loader2,
  PiggyBank,
  Receipt,
  Save,
  User,
  Wrench,
  X,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatFC, formatWeekRange } from "@/lib/format";
import {
  applyLocal,
  isOfflineError,
  isOfflineResponse,
  localEntryId,
  queueOp,
} from "@/lib/offline";
import { weekEndISO, weekSavedTotal } from "@/lib/weeks";
import { Banknote, Landmark } from "lucide-react";
import type { AppSettings, PaymentMethod, WeeklyEntry } from "@/lib/types";

interface WeekDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings | null;
  /** Semaine à modifier (null = création) */
  editing: WeeklyEntry | null;
  /** Dates pré-choisies en cliquant sur le calendrier (création) */
  initialStart?: string;
  initialEnd?: string;
  onSaved: () => void;
}

/**
 * Dialogue « Créer / Modifier une semaine » :
 * l'utilisateur choisit lui-même le jour de début et le jour de fin,
 * la recette, les dépenses et (sans détail par jour) le montant versé.
 */
export function WeekDialog({
  open,
  onOpenChange,
  settings,
  editing,
  initialStart,
  initialEnd,
  onSaved,
}: WeekDialogProps) {
  const { toast } = useToast();
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [revenueWeek, setRevenueWeek] = useState("");
  const [savedAmount, setSavedAmount] = useState("");
  const [fuelExpense, setFuelExpense] = useState("0");
  const [maintenanceExpense, setMaintenanceExpense] = useState("0");
  const [driverSaturday, setDriverSaturday] = useState("0");
  const [otherExpenses, setOtherExpenses] = useState("0");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("especes");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDayDetail = (editing?.days ?? []).length > 0;
  const computedTotal = useMemo(
    () => (editing ? weekSavedTotal(editing) : 0),
    [editing]
  );

  // Remplissage à chaque ouverture
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setWeekStart(editing.weekStart.slice(0, 10));
      setWeekEnd(weekEndISO(editing));
      setRevenueWeek(String(editing.revenueWeek));
      setSavedAmount(String(editing.savedAmount));
      setFuelExpense(String(editing.fuelExpense));
      setMaintenanceExpense(String(editing.maintenanceExpense));
      setDriverSaturday(String(editing.driverSaturday));
      setOtherExpenses(String(editing.otherExpenses));
      setNote(editing.note ?? "");
      setPaymentMethod(editing.paymentMethod === "banque" ? "banque" : "especes");
      return;
    }
    const start = initialStart || "";
    const end = initialEnd || (start ? weekEndISO({ weekStart: start, weekEnd: null }) : "");
    setWeekStart(start);
    setWeekEnd(end);
    setRevenueWeek(
      settings ? String(Math.round(settings.dailyRevenue * settings.activeDaysPerWeek)) : "150000"
    );
    setSavedAmount(settings ? String(Math.round(settings.weeklySavingsTarget)) : "100000");
    setFuelExpense("0");
    setMaintenanceExpense("0");
    setDriverSaturday("0");
    setOtherExpenses("0");
    setNote("");
    setPaymentMethod("especes");
  }, [open, editing, initialStart, initialEnd, settings]);

  // Total des dépenses affiché en direct
  const totalExpenses = useMemo(() => {
    const n = (v: string) => (v.trim() === "" ? 0 : Number(v) || 0);
    return n(fuelExpense) + n(maintenanceExpense) + n(driverSaturday) + n(otherExpenses);
  }, [fuelExpense, maintenanceExpense, driverSaturday, otherExpenses]);

  /** Enregistre la mutation dans le cache local + la file de synchronisation */
  function saveOffline(payload: {
    weekStart: string;
    weekEnd: string;
    revenueWeek: number;
    savedAmount: number;
    fuelExpense: number;
    maintenanceExpense: number;
    driverSaturday: number;
    otherExpenses: number;
    paymentMethod: PaymentMethod;
    note: string;
  }) {
    const nowISO = new Date().toISOString();
    if (editing) {
      const data = { ...payload, weekEnd: payload.weekEnd || null };
      queueOp({ kind: "week-update", payload: { id: editing.id, data } });
      applyLocal({ kind: "week-update", payload: { id: editing.id, data } });
      toast({
        title: "Modification enregistrée hors ligne",
        description: `Semaine du ${formatWeekRange(payload.weekStart, payload.weekEnd)} — synchronisée dès le retour de la connexion.`,
      });
    } else {
      const entry: WeeklyEntry = {
        id: localEntryId(),
        carId: settings?.carId ?? "",
        ...payload,
        weekEnd: payload.weekEnd || null,
        days: [],
        createdAt: nowISO,
        updatedAt: nowISO,
      };
      queueOp({ kind: "week-upsert", payload: entry });
      applyLocal({ kind: "week-upsert", payload: entry });
      toast({
        title: "Semaine créée hors ligne",
        description: `Semaine du ${formatWeekRange(payload.weekStart, payload.weekEnd)} — synchronisée dès le retour de la connexion.`,
      });
    }
    setSaving(false);
    onOpenChange(false);
    onSaved();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      setError("Veuillez choisir le jour de début de la semaine.");
      return;
    }
    if (!weekEnd || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
      setError("Veuillez choisir le jour de fin de la semaine.");
      return;
    }
    if (new Date(weekEnd).getTime() < new Date(weekStart).getTime()) {
      setError("Le jour de fin doit être après (ou le jour même du) début.");
      return;
    }
    const values = { revenueWeek, savedAmount, fuelExpense, maintenanceExpense, driverSaturday, otherExpenses };
    for (const v of Object.values(values)) {
      const num = v.trim() === "" ? 0 : Number(v);
      if (!Number.isFinite(num) || num < 0) {
        setError("Tous les montants doivent être des nombres positifs.");
        return;
      }
    }

    const payload = {
      weekStart,
      weekEnd,
      revenueWeek: Number(values.revenueWeek) || 0,
      // Avec un détail par jour, le total vient des jours : on renvoie la valeur stockée
      savedAmount: hasDayDetail ? (editing?.savedAmount ?? 0) : Number(values.savedAmount) || 0,
      fuelExpense: Number(values.fuelExpense) || 0,
      maintenanceExpense: Number(values.maintenanceExpense) || 0,
      driverSaturday: Number(values.driverSaturday) || 0,
      otherExpenses: Number(values.otherExpenses) || 0,
      paymentMethod,
      note,
    };

    setSaving(true);
    const isEdit = Boolean(editing);
    let res: Response;
    try {
      res = await fetch(isEdit ? `/api/weeks/${editing!.id}` : "/api/weeks", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (isOfflineError(err)) {
        saveOffline(payload);
        return;
      }
      const message = err instanceof Error ? err.message : "Erreur inconnue.";
      setError(message);
      toast({ title: "Erreur", description: message, variant: "destructive" });
      setSaving(false);
      return;
    }
    if (isOfflineResponse(res)) {
      saveOffline(payload);
      return;
    }
    try {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de l'enregistrement.");
      }
      toast({
        title: isEdit ? "Semaine mise à jour" : "Semaine créée",
        description: `Semaine du ${formatWeekRange(weekStart, weekEnd)} enregistrée. Cliquez maintenant sur chaque jour pour saisir les montants versés.`,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" />
            {editing ? "Modifier la semaine" : "Créer une semaine"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Ajustez les dates, la recette et les dépenses de cette semaine."
              : "Choisissez le jour de début et le jour de fin, puis enregistrez pour pouvoir saisir le montant de chaque jour."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {/* Dates début / fin choisies par l'utilisateur */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wk-start">Jour de début *</Label>
              <Input
                id="wk-start"
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wk-end">Jour de fin *</Label>
              <Input
                id="wk-end"
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                required
                min={weekStart || undefined}
              />
            </div>
          </div>
          {weekStart && weekEnd && (
            <p className="text-xs text-muted-foreground">
              Période : {formatWeekRange(weekStart, weekEnd)}
            </p>
          )}

          {/* Mode d'encaissement : espèces ou banque */}
          <div className="space-y-1.5">
            <Label>Encaissé en…</Label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Mode d'encaissement">
              <Button
                type="button"
                variant={paymentMethod === "especes" ? "default" : "outline"}
                className="min-h-11"
                aria-pressed={paymentMethod === "especes"}
                onClick={() => setPaymentMethod("especes")}
              >
                <Banknote className="mr-2 h-4 w-4" />
                Espèces (caisse)
              </Button>
              <Button
                type="button"
                variant={paymentMethod === "banque" ? "default" : "outline"}
                className="min-h-11"
                aria-pressed={paymentMethod === "banque"}
                onClick={() => setPaymentMethod("banque")}
              >
                <Landmark className="mr-2 h-4 w-4" />
                Banque
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sert à savoir combien vous avez encaissé en espèces et combien en banque
              (onglet « Caisse »).
            </p>
          </div>

          {/* Recette + montant versé */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wk-revenue">Recette de la semaine (FC)</Label>
              <Input
                id="wk-revenue"
                type="number"
                min="0"
                step="any"
                inputMode="numeric"
                value={revenueWeek}
                onChange={(e) => setRevenueWeek(e.target.value)}
                className="font-money"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wk-saved" className="flex items-center gap-1.5">
                <PiggyBank className="h-4 w-4 text-primary" />
                Montant versé (FC)
              </Label>
              <Input
                id="wk-saved"
                type="number"
                min="0"
                step="any"
                inputMode="numeric"
                value={hasDayDetail ? String(computedTotal) : savedAmount}
                onChange={(e) => setSavedAmount(e.target.value)}
                disabled={hasDayDetail}
                className="font-money"
              />
              {hasDayDetail ? (
                <p className="text-xs text-muted-foreground">
                  Somme des {editing?.days?.length} jour(s) saisis dans le calendrier —
                  modifiez les jours pour changer ce total.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Total direct. Vous pouvez aussi saisir chaque jour dans le calendrier.
                </p>
              )}
            </div>
          </div>

          {/* Dépenses */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wk-fuel" className="flex items-center gap-1.5">
                <Fuel className="h-4 w-4 text-primary" />
                Carburant (FC)
              </Label>
              <Input
                id="wk-fuel"
                type="number"
                min="0"
                step="any"
                inputMode="numeric"
                value={fuelExpense}
                onChange={(e) => setFuelExpense(e.target.value)}
                className="font-money"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wk-maint" className="flex items-center gap-1.5">
                <Wrench className="h-4 w-4 text-primary" />
                Entretien (FC)
              </Label>
              <Input
                id="wk-maint"
                type="number"
                min="0"
                step="any"
                inputMode="numeric"
                value={maintenanceExpense}
                onChange={(e) => setMaintenanceExpense(e.target.value)}
                className="font-money"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wk-driver" className="flex items-center gap-1.5">
                <User className="h-4 w-4 text-primary" />
                Chauffeur samedi (FC)
              </Label>
              <Input
                id="wk-driver"
                type="number"
                min="0"
                step="any"
                inputMode="numeric"
                value={driverSaturday}
                onChange={(e) => setDriverSaturday(e.target.value)}
                className="font-money"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wk-other" className="flex items-center gap-1.5">
                <Receipt className="h-4 w-4 text-primary" />
                Autres dépenses (FC)
              </Label>
              <Input
                id="wk-other"
                type="number"
                min="0"
                step="any"
                inputMode="numeric"
                value={otherExpenses}
                onChange={(e) => setOtherExpenses(e.target.value)}
                className="font-money"
              />
            </div>
          </div>

          <p className="text-sm font-money">
            Total des dépenses de la semaine :{" "}
            <span className="font-semibold">{formatFC(totalExpenses)}</span>
          </p>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="wk-note">Note (facultatif)</Label>
            <Textarea
              id="wk-note"
              placeholder="Ex : panne réparée, contrôle technique…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
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
              {editing ? "Mettre à jour" : "Créer la semaine"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
