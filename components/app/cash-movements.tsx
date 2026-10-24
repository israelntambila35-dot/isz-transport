"use client";

import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { CashDirection, CashMovement, PaymentMethod } from "@/lib/types";

interface CashMovementsProps {
  movements: CashMovement[];
  onChanged: () => void;
}

/**
 * Saisie manuelle de la caisse : l'utilisateur enregistre lui-même les
 * ajouts (entrées) et les sorties d'argent sur ses espèces ou son compte
 * en banque, en dehors des versements du chauffeur et des retraits.
 */
export function CashMovements({ movements, onChanged }: CashMovementsProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [mode, setMode] = useState<PaymentMethod>("especes");
  const [direction, setDirection] = useState<CashDirection>("entree");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CashMovement | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** Ouvre le dialogue avec les valeurs par défaut (aujourd'hui, entrée espèces) */
  function openDialog() {
    setDate(toISODateUTC(new Date()));
    setMode("especes");
    setDirection("entree");
    setAmount("");
    setNote("");
    setError(null);
    setOpen(true);
  }

  const totals = movements.reduce(
    (acc, m) => {
      if (m.direction === "entree") acc.entrees += m.amount;
      else acc.sorties += m.amount;
      return acc;
    },
    { entrees: 0, sorties: 0 }
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Veuillez choisir la date du mouvement.");
      return;
    }
    const amountNum = amount.trim() === "" ? NaN : Number(amount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Le montant doit être un nombre positif.");
      return;
    }

    const payload = { date, amount: amountNum, mode, direction, note: note.trim() };
    setSaving(true);

    const finishOffline = () => {
      const movement: CashMovement = {
        id: localEntryId(),
        carId: "",
        date: new Date(`${payload.date}T12:00:00.000Z`).toISOString(),
        amount: payload.amount,
        mode: payload.mode,
        direction: payload.direction,
        note: payload.note || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queueOp({ kind: "cash-create", payload: movement });
      applyLocal({ kind: "cash-create", payload: movement });
      toast({
        title: "Mouvement enregistré hors ligne",
        description: `${formatFC(payload.amount)} — sera synchronisé dès le retour de la connexion.`,
      });
      setSaving(false);
      setOpen(false);
      onChanged();
    };

    let res: Response;
    try {
      res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      setSaving(false);
      setError("Impossible d'enregistrer le mouvement. Réessayez.");
      return;
    }
    if (isOfflineResponse(res)) {
      finishOffline();
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setSaving(false);
      setError(data?.error ?? "Impossible d'enregistrer le mouvement. Vérifiez les champs.");
      return;
    }
    setSaving(false);
    setOpen(false);
    toast({
      title: direction === "entree" ? "Entrée enregistrée" : "Sortie enregistrée",
      description: `${formatFC(payload.amount)} en ${mode === "banque" ? "banque" : "espèces"} le ${formatISODateLong(payload.date)}.`,
    });
    onChanged();
  }

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const target = toDelete;

    const finishOffline = () => {
      queueOp({ kind: "cash-delete", payload: { id: target.id } });
      applyLocal({ kind: "cash-delete", payload: { id: target.id } });
      toast({ title: "Mouvement supprimé hors ligne", description: "Sera synchronisé dès le retour de la connexion." });
      setDeleting(false);
      setToDelete(null);
      onChanged();
    };

    let res: Response;
    try {
      res = await fetch(`/api/cash/${target.id}`, { method: "DELETE" });
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      setDeleting(false);
      toast({ title: "Erreur", description: "Impossible de supprimer le mouvement.", variant: "destructive" });
      return;
    }
    if (isOfflineResponse(res)) {
      finishOffline();
      return;
    }
    if (!res.ok && res.status !== 404) {
      setDeleting(false);
      toast({ title: "Erreur", description: "Impossible de supprimer le mouvement.", variant: "destructive" });
      return;
    }
    setDeleting(false);
    setToDelete(null);
    toast({ title: "Mouvement supprimé" });
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          Saisie manuelle — espèces &amp; banque
        </CardTitle>
        <CardDescription>
          Enregistrez vous-même l&apos;argent ajouté à votre épargne bancaire ou à vos
          espèces disponibles (et les sorties), en dehors des versements du chauffeur
          et des retraits déjà suivis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={openDialog} className="min-h-11">
            <Plus className="mr-2 h-4 w-4" />
            Ajouter un mouvement
          </Button>
        </div>

        {movements.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <Wallet className="h-7 w-7 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Aucun mouvement manuel — utilisez le bouton ci-dessus pour saisir votre
              épargne bancaire ou vos espèces.
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="whitespace-nowrap">Date</TableHead>
                  <TableHead className="whitespace-nowrap">Compte</TableHead>
                  <TableHead className="whitespace-nowrap">Sens</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Montant</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatISODateLong(m.date.slice(0, 10))}
                    </TableCell>
                    <TableCell>
                      {m.mode === "banque" ? (
                        <BadgeBanque />
                      ) : (
                        <BadgeEspeces />
                      )}
                    </TableCell>
                    <TableCell>
                      {m.direction === "entree" ? (
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                          <ArrowDownLeft className="h-4 w-4" />
                          Entrée
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-destructive">
                          <ArrowUpRight className="h-4 w-4" />
                          Sortie
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right font-money whitespace-nowrap font-semibold ${
                        m.direction === "entree" ? "text-primary" : "text-destructive"
                      }`}
                    >
                      {m.direction === "entree" ? "+" : "−"}
                      {formatFC(m.amount)}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-sm text-muted-foreground">
                      {m.note || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setToDelete(m)}
                        aria-label={`Supprimer le mouvement du ${formatISODateLong(m.date.slice(0, 10))}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-bold">
                    Totaux
                  </TableCell>
                  <TableCell className="text-right font-money font-bold whitespace-nowrap">
                    +{formatFC(totals.entrees)} / −{formatFC(totals.sorties)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Dialogue d'ajout */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouveau mouvement de caisse</DialogTitle>
            <DialogDescription>
              Ajoutez manuellement de l&apos;argent à votre épargne bancaire ou à vos
              espèces disponibles, ou enregistrez une sortie.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mvt-date">Date</Label>
                <Input
                  id="mvt-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mvt-mode">Compte</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as PaymentMethod)}>
                  <SelectTrigger id="mvt-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="especes">
                      <span className="flex items-center gap-2">
                        <Banknote className="h-4 w-4" /> Espèces (caisse)
                      </span>
                    </SelectItem>
                    <SelectItem value="banque">
                      <span className="flex items-center gap-2">
                        <Landmark className="h-4 w-4" /> Banque
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mvt-direction">Sens</Label>
                <Select value={direction} onValueChange={(v) => setDirection(v as CashDirection)}>
                  <SelectTrigger id="mvt-direction" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entree">Entrée — argent ajouté</SelectItem>
                    <SelectItem value="sortie">Sortie — argent sorti</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mvt-amount">Montant (FC)</Label>
                <Input
                  id="mvt-amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="Ex : 50000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="font-money"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mvt-note">Note (facultatif)</Label>
              <Input
                id="mvt-note"
                placeholder="Ex : dépôt d'épargne personnel"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Annuler
              </Button>
              <Button type="submit" disabled={saving} className="min-h-11">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation de suppression */}
      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce mouvement ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `Le mouvement de ${formatFC(toDelete.amount)} du ${formatISODateLong(
                    toDelete.date.slice(0, 10)
                  )} sera définitivement supprimé et les soldes recalculés.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Badge « Banque » */
function BadgeBanque() {
  return (
    <ModeBadge className="border-primary/40 text-primary">
      <Landmark className="h-3 w-3" />
      Banque
    </ModeBadge>
  );
}

/** Badge « Espèces » */
function BadgeEspeces() {
  return (
    <ModeBadge className="border-amber-600/40 text-amber-700 dark:text-amber-400">
      <Banknote className="h-3 w-3" />
      Espèces
    </ModeBadge>
  );
}

/** Petit badge local (style outline) pour éviter les imports croisés */
function ModeBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
