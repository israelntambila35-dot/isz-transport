"use client";

import { useMemo, useState } from "react";
import {
  AlarmClock,
  ArrowDownLeft,
  ArrowUpRight,
  HandCoins,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  User,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatFC, formatISODateLong, toISODateUTC } from "@/lib/format";
import {
  applyLocal,
  isOfflineError,
  isOfflineResponse,
  localEntryId,
  queueOp,
} from "@/lib/offline";
import type { Loan, LoanKind } from "@/lib/types";

interface LoansSectionProps {
  loans: Loan[];
  onChanged: () => void;
}

/** Formulaire partagé (création + modification) */
interface LoanFormState {
  kind: LoanKind;
  person: string;
  amount: string;
  date: string;
  dueDate: string;
  note: string;
}

const EMPTY_FORM: LoanFormState = {
  kind: "pret",
  person: "",
  amount: "",
  date: "",
  dueDate: "",
  note: "",
};

/**
 * Onglet « Prêts & emprunts » : gestion manuelle de l'argent prêté à
 * d'autres personnes et de l'argent emprunté, avec suivi des
 * remboursements.
 */
export function LoansSection({ loans, onChanged }: LoansSectionProps) {
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [form, setForm] = useState<LoanFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [repayTarget, setRepayTarget] = useState<Loan | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repaying, setRepaying] = useState(false);
  const [repayError, setRepayError] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState(false);

  const stats = useMemo(() => {
    let pretTotal = 0;
    let pretReste = 0;
    let empruntTotal = 0;
    let empruntReste = 0;
    for (const l of loans) {
      const reste = Math.max(0, l.amount - l.repaidAmount);
      if (l.kind === "emprunt") {
        empruntTotal += l.amount;
        empruntReste += reste;
      } else {
        pretTotal += l.amount;
        pretReste += reste;
      }
    }
    return { pretTotal, pretReste, empruntTotal, empruntReste };
  }, [loans]);

  // Date du jour : ce composant n'est monté que lorsque l'onglet est actif
  // (jamais rendu côté serveur), le calcul direct est donc sans risque.
  const todayISO = toISODateUTC(new Date());

  /** Échéance dépassée (et pas encore remboursée) */
  function isOverdue(l: Loan): boolean {
    if (!l.dueDate) return false;
    const reste = Math.max(0, l.amount - l.repaidAmount);
    return reste > 0 && l.dueDate.slice(0, 10) < todayISO;
  }

  /** Échéance proche (dans les 7 jours, pas encore remboursée) */
  function isSoon(l: Loan): boolean {
    if (!l.dueDate) return false;
    const reste = Math.max(0, l.amount - l.repaidAmount);
    if (reste === 0) return false;
    const due = l.dueDate.slice(0, 10);
    const soonMs = new Date(`${todayISO}T12:00:00.000Z`).getTime() + 7 * 86_400_000;
    const dueMs = new Date(`${due}T12:00:00.000Z`).getTime();
    return due >= todayISO && dueMs <= soonMs;
  }

  const overdue = loans.filter((l) => isOverdue(l));

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, date: toISODateUTC(new Date()) });
    setError(null);
    setFormOpen(true);
  }

  function openEdit(l: Loan) {
    setEditing(l);
    setForm({
      kind: l.kind === "emprunt" ? "emprunt" : "pret",
      person: l.person,
      amount: String(l.amount),
      date: l.date.slice(0, 10),
      dueDate: l.dueDate ? l.dueDate.slice(0, 10) : "",
      note: l.note ?? "",
    });
    setError(null);
    setFormOpen(true);
  }

  function openRepay(l: Loan) {
    setRepayTarget(l);
    setRepayAmount("");
    setRepayError(null);
  }

  /** Création ou modification */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const person = form.person.trim();
    if (!person) {
      setError("Veuillez indiquer le nom de la personne.");
      return;
    }
    const amountNum = form.amount.trim() === "" ? NaN : Number(form.amount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Le montant doit être un nombre positif.");
      return;
    }
    if (!form.date || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      setError("Veuillez choisir la date.");
      return;
    }
    if (form.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate)) {
      setError("La date d'échéance est invalide.");
      return;
    }

    const payload = {
      kind: form.kind,
      person,
      amount: amountNum,
      date: form.date,
      dueDate: form.dueDate || "",
      note: form.note.trim(),
    };
    setSaving(true);

    const finishOfflineCreate = () => {
      const loan: Loan = {
        id: localEntryId(),
        carId: "",
        kind: payload.kind,
        person: payload.person,
        amount: payload.amount,
        date: new Date(`${payload.date}T12:00:00.000Z`).toISOString(),
        dueDate: payload.dueDate ? new Date(`${payload.dueDate}T12:00:00.000Z`).toISOString() : null,
        repaidAmount: 0,
        note: payload.note || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queueOp({ kind: "loan-create", payload: loan });
      applyLocal({ kind: "loan-create", payload: loan });
      toast({
        title: "Enregistré hors ligne",
        description: "Sera synchronisé dès le retour de la connexion.",
      });
      setSaving(false);
      setFormOpen(false);
      onChanged();
    };

    const finishOfflineUpdate = (target: Loan) => {
      const data = {
        kind: payload.kind,
        person: payload.person,
        amount: payload.amount,
        date: payload.date,
        dueDate: payload.dueDate,
        note: payload.note,
      };
      queueOp({ kind: "loan-update", payload: { id: target.id, data } });
      applyLocal({ kind: "loan-update", payload: { id: target.id, data } });
      toast({
        title: "Modification enregistrée hors ligne",
        description: "Sera synchronisée dès le retour de la connexion.",
      });
      setSaving(false);
      setFormOpen(false);
      onChanged();
    };

    let res: Response;
    try {
      res = editing
        ? await fetch(`/api/loans/${editing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/loans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
    } catch (err) {
      if (isOfflineError(err)) {
        if (editing) finishOfflineUpdate(editing);
        else finishOfflineCreate();
        return;
      }
      setSaving(false);
      setError("Impossible d'enregistrer. Réessayez.");
      return;
    }
    if (isOfflineResponse(res)) {
      if (editing) finishOfflineUpdate(editing);
      else finishOfflineCreate();
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setSaving(false);
      setError(data?.error ?? "Impossible d'enregistrer. Vérifiez les champs.");
      return;
    }
    setSaving(false);
    setFormOpen(false);
    toast({
      title: editing ? "Prêt / emprunt modifié" : "Prêt / emprunt enregistré",
      description: `${payload.kind === "emprunt" ? "Emprunt" : "Prêt"} de ${formatFC(payload.amount)} — ${person}.`,
    });
    onChanged();
  }

  /** Enregistre un remboursement (partiel ou total) */
  async function handleRepay(e: React.FormEvent) {
    e.preventDefault();
    setRepayError(null);
    if (!repayTarget) return;

    const amountNum = repayAmount.trim() === "" ? NaN : Number(repayAmount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setRepayError("Le montant du remboursement doit être un nombre positif.");
      return;
    }
    const reste = repayTarget.amount - repayTarget.repaidAmount;
    if (amountNum > reste) {
      setRepayError(`Le montant dépasse le reste à rembourser (${formatFC(reste)}).`);
      return;
    }

    const newRepaid = repayTarget.repaidAmount + amountNum;
    setRepaying(true);

    const finishOffline = () => {
      const data = { repaidAmount: newRepaid };
      queueOp({ kind: "loan-update", payload: { id: repayTarget.id, data } });
      applyLocal({ kind: "loan-update", payload: { id: repayTarget.id, data } });
      toast({
        title: "Remboursement enregistré hors ligne",
        description: "Sera synchronisé dès le retour de la connexion.",
      });
      setRepaying(false);
      setRepayTarget(null);
      onChanged();
    };

    let res: Response;
    try {
      res = await fetch(`/api/loans/${repayTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repaidAmount: newRepaid }),
      });
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      setRepaying(false);
      setRepayError("Impossible d'enregistrer le remboursement. Réessayez.");
      return;
    }
    if (isOfflineResponse(res)) {
      finishOffline();
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setRepaying(false);
      setRepayError(data?.error ?? "Impossible d'enregistrer le remboursement.");
      return;
    }
    setRepaying(false);
    setRepayTarget(null);
    toast({
      title: newRepaid >= repayTarget.amount ? "Remboursement complet !" : "Remboursement enregistré",
      description: `${formatFC(amountNum)} — reste ${formatFC(Math.max(0, repayTarget.amount - newRepaid))}.`,
    });
    onChanged();
  }

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const target = toDelete;

    const finishOffline = () => {
      queueOp({ kind: "loan-delete", payload: { id: target.id } });
      applyLocal({ kind: "loan-delete", payload: { id: target.id } });
      toast({
        title: "Supprimé hors ligne",
        description: "Sera synchronisé dès le retour de la connexion.",
      });
      setDeleting(false);
      setToDelete(null);
      onChanged();
    };

    let res: Response;
    try {
      res = await fetch(`/api/loans/${target.id}`, { method: "DELETE" });
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      setDeleting(false);
      toast({ title: "Erreur", description: "Impossible de supprimer.", variant: "destructive" });
      return;
    }
    if (isOfflineResponse(res)) {
      finishOffline();
      return;
    }
    if (!res.ok && res.status !== 404) {
      setDeleting(false);
      toast({ title: "Erreur", description: "Impossible de supprimer.", variant: "destructive" });
      return;
    }
    setDeleting(false);
    setToDelete(null);
    toast({ title: "Prêt / emprunt supprimé" });
    onChanged();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-primary" />
            Prêts &amp; emprunts
          </CardTitle>
          <CardDescription>
            Gérez manuellement l&apos;argent que vous prêtez aux autres (prêts) et
            l&apos;argent que vous empruntez (emprunts), avec suivi des
            remboursements.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Alerte des échéances dépassées */}
          {overdue.length > 0 && (
            <Alert className="border-destructive/40 bg-destructive/5">
              <AlarmClock className="h-4 w-4 !text-destructive" />
              <AlertTitle>
                {overdue.length} opération{overdue.length > 1 ? "s" : ""} en retard de
                remboursement
              </AlertTitle>
              <AlertDescription>
                {overdue
                  .map((l) => `${l.person} (${formatFC(Math.max(0, l.amount - l.repaidAmount))}, échéance le ${formatISODateLong(l.dueDate!.slice(0, 10))})`)
                  .join(" · ")}
              </AlertDescription>
            </Alert>
          )}

          {/* Statistiques */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Total prêté (argent donné)</p>
              <p className="font-money text-lg font-bold text-amber-600 dark:text-amber-400">
                {formatFC(stats.pretTotal)}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Reste à recevoir (prêts)</p>
              <p className="font-money text-lg font-bold">{formatFC(stats.pretReste)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Total emprunté (argent reçu)</p>
              <p className="font-money text-lg font-bold text-destructive">
                {formatFC(stats.empruntTotal)}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Reste à rembourser (emprunts)</p>
              <p className="font-money text-lg font-bold">{formatFC(stats.empruntReste)}</p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={openCreate} className="min-h-11">
              <Plus className="mr-2 h-4 w-4" />
              Nouveau prêt / emprunt
            </Button>
          </div>

          {loans.length === 0 ? (
            <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
              <HandCoins className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Aucun prêt ni emprunt enregistré — ajoutez-en un avec le bouton
                ci-dessus.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Type</TableHead>
                    <TableHead className="whitespace-nowrap">Personne</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Montant</TableHead>
                    <TableHead className="whitespace-nowrap">Date</TableHead>
                    <TableHead className="whitespace-nowrap">Échéance</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Remboursé</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Reste</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loans.map((l) => {
                    const reste = Math.max(0, l.amount - l.repaidAmount);
                    const settled = reste === 0;
                    const ratio = l.amount > 0 ? Math.min(1, l.repaidAmount / l.amount) : 0;
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          {l.kind === "emprunt" ? (
                            <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
                              <ArrowUpRight className="h-3 w-3" />
                              Emprunt
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 border-amber-600/40 text-amber-700 dark:text-amber-400">
                              <ArrowDownLeft className="h-3 w-3" />
                              Prêt
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {l.person}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-money whitespace-nowrap font-semibold">
                          {formatFC(l.amount)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatISODateLong(l.date.slice(0, 10))}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {l.dueDate ? (
                            <span className="inline-flex items-center gap-1.5">
                              {formatISODateLong(l.dueDate.slice(0, 10))}
                              {isOverdue(l) && (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-destructive/50 px-1.5 py-0 text-[10px] text-destructive"
                                  title="Échéance dépassée"
                                >
                                  <AlarmClock className="h-3 w-3" />
                                  En retard
                                </Badge>
                              )}
                              {!isOverdue(l) && isSoon(l) && (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-amber-600/50 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                                  title="Échéance dans les 7 jours"
                                >
                                  Bientôt
                                </Badge>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-money whitespace-nowrap text-primary">
                          <div className="flex flex-col items-end gap-1">
                            <span>{formatFC(l.repaidAmount)}</span>
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <span
                                className="block h-full rounded-full bg-primary transition-all"
                                style={{ width: `${Math.round(ratio * 100)}%` }}
                              />
                            </span>
                          </div>
                        </TableCell>
                        <TableCell
                          className={`text-right font-money whitespace-nowrap font-semibold ${
                            settled ? "text-primary" : "text-foreground"
                          }`}
                        >
                          {settled ? (
                            <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
                              Remboursé
                            </Badge>
                          ) : (
                            formatFC(reste)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {!settled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-primary hover:text-primary"
                                onClick={() => openRepay(l)}
                                aria-label={`Enregistrer un remboursement pour ${l.person}`}
                                title="Enregistrer un remboursement"
                              >
                                <HandCoins className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(l)}
                              aria-label={`Modifier le prêt/emprunt de ${l.person}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setToDelete(l)}
                              aria-label={`Supprimer le prêt/emprunt de ${l.person}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="font-bold">
                      Totaux
                    </TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap">
                      {formatFC(stats.pretTotal + stats.empruntTotal)}
                    </TableCell>
                    <TableCell colSpan={2} />
                    <TableCell className="text-right font-money font-bold whitespace-nowrap text-primary">
                      {formatFC(
                        loans.reduce((s, l) => s + l.repaidAmount, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-money font-bold whitespace-nowrap">
                      {formatFC(stats.pretReste + stats.empruntReste)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}

          {loans.some((l) => l.note) && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {loans
                .filter((l) => l.note)
                .map((l) => (
                  <li key={`note-${l.id}`} className="truncate">
                    <span className="font-medium">{l.person}</span> : {l.note}
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Dialogue création / modification */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le prêt / emprunt" : "Nouveau prêt / emprunt"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Corrigez les informations de cette opération."
                : "Un prêt = argent donné à quelqu'un. Un emprunt = argent reçu de quelqu'un."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="loan-kind">Type</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) => setForm((f) => ({ ...f, kind: v as LoanKind }))}
                >
                  <SelectTrigger id="loan-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pret">Prêt — argent donné</SelectItem>
                    <SelectItem value="emprunt">Emprunt — argent reçu</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="loan-person">Personne</Label>
                <Input
                  id="loan-person"
                  placeholder="Ex : Jean"
                  value={form.person}
                  onChange={(e) => setForm((f) => ({ ...f, person: e.target.value }))}
                  required
                  maxLength={60}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loan-amount">Montant (FC)</Label>
                <Input
                  id="loan-amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="Ex : 100000"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  required
                  className="font-money"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loan-date">Date</Label>
                <Input
                  id="loan-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="loan-due">Échéance (facultatif)</Label>
                <Input
                  id="loan-due"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-note">Note (facultatif)</Label>
              <Textarea
                id="loan-note"
                rows={2}
                placeholder="Ex : prêt pour les pièces de la moto"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                maxLength={200}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
                Annuler
              </Button>
              <Button type="submit" disabled={saving} className="min-h-11">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editing ? "Enregistrer les modifications" : "Enregistrer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialogue remboursement */}
      <Dialog
        open={repayTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRepayTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enregistrer un remboursement</DialogTitle>
            <DialogDescription>
              {repayTarget
                ? `${repayTarget.kind === "emprunt" ? "Emprunt" : "Prêt"} — ${repayTarget.person} · reste à rembourser : ${formatFC(
                    repayTarget.amount - repayTarget.repaidAmount
                  )}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRepay} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repay-amount">Montant remboursé (FC)</Label>
              <Input
                id="repay-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="Ex : 50000"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                required
                className="font-money"
                autoFocus
              />
            </div>
            {repayError && <p className="text-sm text-destructive">{repayError}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRepayTarget(null)}
                disabled={repaying}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={repaying} className="min-h-11">
                {repaying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
            <AlertDialogTitle>Supprimer ce prêt / emprunt ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `L'opération de ${formatFC(toDelete.amount)} avec ${toDelete.person} sera définitivement supprimée.`
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
    </div>
  );
}
