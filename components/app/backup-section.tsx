"use client";

import { useRef, useState } from "react";
import { DatabaseBackup, Download, Loader2, Upload } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { applyLocal, isOfflineError, isOfflineResponse, queueOp } from "@/lib/offline";

interface BackupSectionProps {
  onRestored: () => void;
}

/**
 * Sauvegarde complète (JSON) et restauration : le fichier remplace
 * les paramètres ET toutes les semaines, après confirmation.
 */
export function BackupSection({ onRestored }: BackupSectionProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<unknown>(null);
  const [fileName, setFileName] = useState<string>("");
  const [restoring, setRestoring] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== "object" || !parsed.settings || !Array.isArray(parsed.weeks)) {
          throw new Error("format");
        }
        setPendingRestore(parsed);
      } catch {
        toast({
          title: "Fichier invalide",
          description:
            "Ce fichier n'est pas une sauvegarde « ISZTRANSPORT » valide (JSON avec settings et weeks).",
          variant: "destructive",
        });
      }
    };
    reader.onerror = () => {
      toast({ title: "Erreur", description: "Impossible de lire le fichier.", variant: "destructive" });
    };
    reader.readAsText(file);
  }

  async function handleRestore() {
    if (!pendingRestore) return;
    setRestoring(true);
    const finishOffline = () => {
      queueOp({ kind: "restore", payload: pendingRestore });
      applyLocal({ kind: "restore", payload: pendingRestore });
      toast({
        title: "Sauvegarde restaurée hors ligne",
        description: "Vos données locales ont été remplacées — la restauration sera synchronisée dès le retour de la connexion.",
      });
      setPendingRestore(null);
      setRestoring(false);
      onRestored();
    };
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingRestore),
      });
      if (isOfflineResponse(res)) {
        finishOffline();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Restauration impossible.");
      toast({
        title: "Sauvegarde restaurée",
        description: `${data.restoredWeeks} semaine(s)${data.restoredWithdrawals ? `, ${data.restoredWithdrawals} retrait(s)` : ""} et les paramètres ont été rechargés.`,
      });
      setPendingRestore(null);
      onRestored();
    } catch (err) {
      if (isOfflineError(err)) {
        finishOffline();
        return;
      }
      toast({
        title: "Erreur de restauration",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-primary" />
          Sauvegarde & restauration
        </CardTitle>
        <CardDescription>
          Téléchargez toutes vos données (paramètres + semaines) dans un fichier JSON, ou restaurez
          une sauvegarde existante — pratique pour changer de téléphone ou garder une copie de
          sécurité.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button asChild className="min-h-11">
          <a href="/api/backup" download>
            <Download className="mr-2 h-4 w-4" />
            Télécharger ma sauvegarde
          </a>
        </Button>
        <Button variant="outline" className="min-h-11" onClick={() => fileRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          Restaurer un fichier…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
          aria-label="Choisir un fichier de sauvegarde"
        />

        {/* Confirmation avant remplacement total */}
        <AlertDialog open={pendingRestore !== null} onOpenChange={(open) => !open && setPendingRestore(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remplacer toutes les données ?</AlertDialogTitle>
              <AlertDialogDescription>
                Le fichier « {fileName} » va remplacer vos paramètres actuels et{" "}
                <span className="font-semibold">toutes</span> vos semaines enregistrées. Cette
                action est irréversible — pensez à télécharger la sauvegarde actuelle avant.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={restoring}>Annuler</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleRestore();
                }}
                disabled={restoring}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Restaurer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
