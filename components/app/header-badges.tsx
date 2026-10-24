"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online";
import { useInstallPrompt } from "@/components/app/pwa-register";
import { CheckCircle2, CloudOff, Download, Loader2, RefreshCw, Wifi } from "lucide-react";

/**
 * Badges d'état de l'en-tête :
 *  - connexion (en ligne / hors ligne)
 *  - file d'attente de synchronisation (avec bouton « Synchroniser »)
 *  - bouton « Installer l'application » (PWA)
 */
export function HeaderBadges() {
  const { online, pending, syncing, syncNow } = useOnlineStatus();
  const { canInstall, installed, install } = useInstallPrompt();
  const { toast } = useToast();

  function handleSync() {
    void syncNow().then(({ flushed, remaining }) => {
      if (flushed > 0 && remaining === 0) {
        toast({
          title: "Synchronisation terminée",
          description: `${flushed} opération${flushed > 1 ? "s" : ""} enregistrée${flushed > 1 ? "s" : ""} sur le serveur.`,
        });
      } else if (remaining > 0) {
        toast({
          title: "Synchronisation incomplète",
          description: "Connexion indisponible. Nous réessaierons automatiquement.",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex shrink-0 items-center gap-2">
        {/* Statut de connexion */}
        {online ? (
          <Badge
            variant="outline"
            className="hidden gap-1 border-primary/30 bg-primary/5 text-primary sm:flex"
          >
            <Wifi className="h-3 w-3" />
            En ligne
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          >
            <CloudOff className="h-3 w-3" />
            Hors ligne
          </Badge>
        )}

        {/* File d'attente de synchronisation */}
        {pending > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing || !online}
            className="min-h-9 gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300"
            aria-label={`Synchroniser ${pending} opération${pending > 1 ? "s" : ""} en attente`}
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="font-money">{pending}</span>
            <span className="hidden sm:inline">à synchroniser</span>
          </Button>
        )}
        {online && pending === 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="hidden gap-1 text-muted-foreground md:flex">
                <CheckCircle2 className="h-3 w-3 text-primary" />
                À jour
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Toutes vos données sont synchronisées.</TooltipContent>
          </Tooltip>
        )}

        {/* Installation PWA */}
        {canInstall && !installed && (
          <Button
            size="sm"
            onClick={() => void install()}
            className="min-h-9 bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label="Installer l'application sur cet appareil"
          >
            <Download className="h-4 w-4" />
            <span className="ml-1.5 hidden md:inline">Installer l&apos;application</span>
            <span className="ml-1.5 hidden sm:inline md:hidden">Installer</span>
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}
