"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  BanknoteArrowDown,
  CalendarDays,
  Landmark,
  Loader2,
  Plus,
  Trash2,
  Wallet,
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
import { formatFC, formatISODateLong, toISODateUTC } from "@/lib/format";
import {
  applyLocal,
  isOfflineError,
  isOfflineResponse,
  localEntryId,
  queueOp,
} from "@/lib/offline";
import { weekSavedTotal } from "@/lib/weeks";
import type { PaymentMethod, WeeklyEntry, Withdrawal } from "@/lib/types";

interface WithdrawalsSectionProps {
  withdrawals: Withdrawal[];
  weeks: WeeklyEntry[]; // Pour calculer le solde restant après chaque retrait
  onChanged: () => void;
}

/**
 * Section « Retraits » : enregistrement d'argent sorti de l'épargne
 * sur une date individuelle (ex : le 12/02/2004 → retrait de 300 000 FC).
 */
export function WithdrawalsSection({ withdrawals, weeks, onChanged }: WithdrawalsSectionProps) {
  const { toast } = useToast();
  const [date, setDate] = useState<string>(toISODateUTC(new Date()));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("especes");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Withdrawal | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Date par défaut = aujourd'hui (côté client uniquement, évite le mismatch SSR)
  useEffect(() => {
    setDate(toISODateUTC(new Date()));
  }, []);

  const total = useMemo(() => withdrawals.reduce((s, w) => s + w.amount, 0), [withdrawals]);

  const timeOf = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00.000Z`).getTime();

  /**
   * Solde restant après chaque retrait :
   *   Σ versements (semaines débutant avant ou à la date du retrait)
   * − Σ retraits effectués jusqu'à celui-ci (inclus).
   * Map id → solde ; les retraits sont traités par ordre chronologique.
   */
  const { soldeMap, rows, totalVersements } = useMemo(() => {
    const chrono = [...withdrawals].sort((a, b) => timeOf(a.date) - timeOf(b.date));
    const map = new Map<string, number>();
    let cumulOut = 0;
    for (const wd of chrono) {
      cumulOut += wd.amount;
      const cumulIn = weeks.reduce(
        (s, w) => (timeOf(w.weekStart) <= timeOf(wd.date) ? s + weekSavedTotal(w) : s),
        0
      );
      map.set(wd.id, cumulIn - cumulOut);
    }
    const totalIn = weeks.reduce((s, w) => s + weekSavedTotal(w), 0);
    // Affichage : plus récents en premier
    const display = [...withdrawals].sort((a, b) => timeOf(b.date) - timeOf(a.date));
    return { soldeMap: map, rows: display, totalVersements: totalIn };
  }, [withdrawals, weeks]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Veuillez choisir la date du retrait.");
      return;
    }
    const amountNum = amount.trim() === "" ? NaN : Number(amount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Le montant du retrait doit être un nombre positif.");
      return;
    }

    const payload = { date, amount: amountNum, note: note.trim(), paymentMethod: method };
    setSaving(true);

    const finishOffline = () => {
      const wd: Withdrawal = {
        id: localEntryId(),
        carId: "",
        date: new Date(`${payload.date}T12:00:00.000Z`).toISOString(),
        amount: payload.amount,
        paymentMethod: payload.paymentMethod,
        note: payload.note || null,
        createdAt: new Date().toISOString(),
      };
      queueOp({ kind: "withdrawal-create", payload: wd });
      applyLocal({ kind: "withdrawal-create", payload: wd });
      toast({
        title: "Retrait enregistré hors ligne",
        description: `${formatFC(payload.amount)} le ${formatISODateLong(payload.date)} — sera synchronisé dès le retour de la connexion.`,
      });
      setAmount("");
      setNote("");
      setSaving(false);
      onChanged();
    };

    let res: Response;
    try {
      res = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      const message = err instanceof Error ? err.message : "Erreur inconnue.";
      setError(message);
      toast({ title: "Erreur", description: message, variant: "destructive" });
      setSaving(false);
      return;
    }
    if (isOfflineResponse(res)) {
      finishOffline();
      return;
    }
    try {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'enregistrement.");
      toast({
        title: "Retrait enregistré",
        description: `${formatFC(payload.amount)} retirés le ${formatISODateLong(payload.date)} — l'épargne disponible a été mise à jour.`,
      });
      setAmount("");
      setNote("");
      setMethod("especes");
      onChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue.";
      setError(message);
      toast({ title: "Erreur", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const deleted = toDelete;
    const finishOffline = () => {
      queueOp({ kind: "withdrawal-delete", payload: { id: deleted.id } });
      applyLocal({ kind: "withdrawal-delete", payload: { id: deleted.id } });
      toast({
        title: "Retrait supprimé hors ligne",
        description: "La suppression sera synchronisée dès le retour de la connexion.",
      });
      setToDelete(null);
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
        description: `${formatFC(deleted.amount)} du ${formatISODateLong(deleted.date.slice(0, 10))} ont été annulés — l'épargne disponible a été recalculée.`,
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

  return (
    <Card className="no-print">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BanknoteArrowDown className="h-5 w-5 text-primary" />
          Retraits d&apos;argent
        </CardTitle>
        <CardDescription>
          Enregistrez l&apos;argent retiré de votre épargne à une date précise (ex : le
          12/02/2004, retrait de 300 000 FC). Chaque retrait diminue l&apos;épargne disponible :
          la colonne « Solde restant après retrait » montre ce qui reste après chaque retrait.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Formulaire d'ajout */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="wd-date" className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-primary" />
                Date du retrait *
              </Label>
              <Input
                id="wd-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full sm:w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wd-amount">Montant retiré (FC) *</Label>
              <Input
                id="wd-amount"
                type="number"
                min="0"
                step="any"
                inputMode="numeric"
                placeholder="300000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="font-money"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wd-note">Motif (facultatif)</Label>
              <Input
                id="wd-note"
                type="text"
                placeholder="Ex : frais de famille, urgence…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Pris en…</Label>
            <div className="grid max-w-md grid-cols-2 gap-2" role="group" aria-label="Mode du retrait">
              <Button
                type="button"
                variant={method === "especes" ? "default" : "outline"}
                className="min-h-11"
                aria-pressed={method === "especes"}
                onClick={() => setMethod("especes")}
              >
                <Banknote className="mr-2 h-4 w-4" />
                Espèces (caisse)
              </Button>
              <Button
                type="button"
                variant={method === "banque" ? "default" : "outline"}
                className="min-h-11"
                aria-pressed={method === "banque"}
                onClick={() => setMethod("banque")}
              >
                <Landmark className="mr-2 h-4 w-4" />
                Banque
              </Button>
            </div>
          </div>
          <Button type="submit" disabled={saving} className="min-h-11">
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Ajouter
          </Button>
        </form>

        {/* Liste des retraits */}
        {withdrawals.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <Wallet className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Aucun retrait enregistré — votre épargne est intacte.
            </p>
          </div>
        ) : (
          <div className="max-h-64 overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="whitespace-nowrap">Date</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Montant retiré</TableHead>
                  <TableHead className="whitespace-nowrap">Pris en</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Solde restant après retrait</TableHead>
                  <TableHead>Motif</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => {
                  const solde = soldeMap.get(w.id) ?? 0;
                  return (
                    <TableRow key={w.id}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {formatISODateLong(w.date.slice(0, 10))}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap font-money font-semibold text-destructive">
                        −{formatFC(w.amount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className="gap-1 px-1.5 py-0 text-[10px]"
                        >
                          {w.paymentMethod === "banque" ? (
                            <Landmark className="h-3 w-3" />
                          ) : (
                            <Banknote className="h-3 w-3" />
                          )}
                          {w.paymentMethod === "banque" ? "Banque" : "Espèces"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right whitespace-nowrap font-money font-semibold ${
                          solde < 0 ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {formatFC(solde)}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
                        {w.note || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setToDelete(w)}
                          aria-label={`Supprimer le retrait du ${formatISODateLong(w.date.slice(0, 10))}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Total retiré</TableCell>
                  <TableCell className="text-right font-money font-bold text-destructive whitespace-nowrap">
                    −{formatFC(total)}
                  </TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}

        {/* Confirmation de suppression */}
        <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce retrait ?</AlertDialogTitle>
              <AlertDialogDescription>
                Le retrait de {toDelete ? formatFC(toDelete.amount) : ""} du{" "}
                {toDelete ? formatISODateLong(toDelete.date.slice(0, 10)) : ""} sera définitivement
                supprimé et l&apos;épargne disponible sera recalculée.
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
      </CardContent>
    </Card>
  );
}
