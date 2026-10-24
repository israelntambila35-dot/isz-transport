"use client";

import { useState } from "react";
import { Car, Check, Loader2, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { CarWithCounts } from "@/lib/types";

interface CarSwitcherProps {
  cars: CarWithCounts[];
  activeCarId: string | null;
  onSwitch: (carId: string) => void;
  /** Recharge toutes les données après une gestion (ajout, renommage…) */
  onChanged: () => void;
}

/**
 * Sélecteur de voiture (compte) dans l'en-tête + dialogue de gestion :
 * ajouter, renommer ou supprimer une voiture. Application privée :
 * toutes les voitures appartiennent au même propriétaire.
 */
export function CarSwitcher({ cars, activeCarId, onSwitch, onChanged }: CarSwitcherProps) {
  const { toast } = useToast();
  const [manageOpen, setManageOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [toDelete, setToDelete] = useState<CarWithCounts | null>(null);
  const [deleting, setDeleting] = useState(false);

  const active = cars.find((c) => c.id === activeCarId) ?? null;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const res = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la création.");
      toast({
        title: "Voiture ajoutée",
        description: `« ${name} » est prête. Vous pouvez la configurer dans l'onglet Paramètres.`,
      });
      setNewName("");
      setManageOpen(false);
      onChanged();
      onSwitch(data.id as string);
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    try {
      const res = await fetch(`/api/cars/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors du renommage.");
      toast({ title: "Voiture renommée", description: `Nouveau nom : ${name}` });
      setRenamingId(null);
      onChanged();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/cars/${toDelete.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la suppression.");
      toast({ title: "Voiture supprimée", description: `« ${toDelete.name} » a été supprimée.` });
      setToDelete(null);
      setManageOpen(false);
      onChanged();
    } catch (err) {
      toast({
        title: "Suppression impossible",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-10 max-w-36 gap-1.5 px-2 sm:max-w-52 sm:px-3"
            aria-label="Choisir la voiture active"
          >
            <Car className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-medium">
              {active ? active.name : "Voiture…"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Mes voitures</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {cars.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onClick={() => onSwitch(c.id)}
              className="gap-2"
              aria-current={c.id === activeCarId}
            >
              <Check
                className={`h-4 w-4 shrink-0 ${c.id === activeCarId ? "text-primary" : "opacity-0"}`}
              />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">
                {c.weeksCount} sem.
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setManageOpen(true)} className="gap-2">
            <Settings2 className="h-4 w-4" />
            Gérer les voitures…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogue de gestion des voitures */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Car className="h-5 w-5 text-primary" />
              Gérer mes voitures
            </DialogTitle>
            <DialogDescription>
              Ajoutez autant de voitures que nécessaire — application privée, toutes
              vos données restent sur votre appareil. Chaque voiture a ses propres
              semaines, retraits et paramètres.
            </DialogDescription>
          </DialogHeader>

          {/* Liste des voitures */}
          <div className="space-y-2">
            {cars.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg border px-3 py-2"
              >
                {renamingId === c.id ? (
                  <>
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleRename(c.id);
                        }
                      }}
                      className="h-9"
                      autoFocus
                      aria-label={`Nouveau nom pour ${c.name}`}
                    />
                    <Button
                      size="sm"
                      className="h-9 min-h-9"
                      onClick={() => void handleRename(c.id)}
                    >
                      Enregistrer
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 min-h-9"
                      onClick={() => setRenamingId(null)}
                    >
                      Annuler
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {c.id === activeCarId && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                        )}
                        {c.name}
                        {c.id === activeCarId && (
                          <span className="text-xs font-normal text-muted-foreground">
                            (active)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.weeksCount} semaine{c.weeksCount > 1 ? "s" : ""} ·{" "}
                        {c.withdrawalsCount} retrait{c.withdrawalsCount > 1 ? "s" : ""}
                      </p>
                    </div>
                    {c.id !== activeCarId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 min-h-8"
                        onClick={() => {
                          onSwitch(c.id);
                          setManageOpen(false);
                        }}
                      >
                        Activer
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => {
                        setRenamingId(c.id);
                        setRenameValue(c.name);
                      }}
                      aria-label={`Renommer ${c.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => setToDelete(c)}
                      aria-label={`Supprimer ${c.name}`}
                      disabled={cars.length <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Ajouter une voiture */}
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom de la nouvelle voiture (ex : Toyota Hiace)"
              maxLength={40}
              aria-label="Nom de la nouvelle voiture"
            />
            <Button type="submit" disabled={adding || !newName.trim()} className="min-h-11 shrink-0">
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Ajouter
            </Button>
          </form>

          <DialogFooter className="sm:justify-start">
            <p className="text-xs text-muted-foreground">
              Astuce : la suppression n&apos;est possible que pour une voiture sans
              aucune semaine ni retrait.
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation de suppression */}
      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette voiture ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {toDelete?.name} » n&apos;a aucune donnée enregistrée et sera
              définitivement supprimée de votre application privée.
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
    </>
  );
}
