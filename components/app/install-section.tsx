"use client";

import { Download, Info, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useInstallPrompt } from "@/components/app/pwa-register";

/**
 * Aide à l'installation de l'application (PWA) sur l'appareil :
 * bouton d'installation natif quand disponible, sinon instructions
 * détaillées selon la plateforme.
 */
export function InstallSection() {
  const { canInstall, installed, install } = useInstallPrompt();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="h-5 w-5 text-primary" />
          Installer l&apos;application sur votre appareil
        </CardTitle>
        <CardDescription>
          Installez ISZTRANSPORT comme une vraie application : icône sur le bureau ou l&apos;écran
          d&apos;accueil, ouverture dans sa propre fenêtre, et fonctionnement complet sans
          connexion Internet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {installed ? (
          <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm font-medium text-primary">
            <Download className="h-4 w-4" />
            L&apos;application est déjà installée sur cet appareil.
          </p>
        ) : canInstall ? (
          <Button onClick={() => void install()} className="min-h-11">
            <Download className="mr-2 h-4 w-4" />
            Installer maintenant
          </Button>
        ) : (
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="mb-1 font-semibold">Windows / Mac / Linux</p>
              <p className="text-muted-foreground">
                Cliquez sur l&apos;icône <Info className="inline h-3.5 w-3.5" /> ou{" "}
                <Download className="inline h-3.5 w-3.5" /> dans la barre d&apos;adresse du
                navigateur (Chrome, Edge), puis « Installer ».
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-1 font-semibold">Android</p>
              <p className="text-muted-foreground">
                Menu <Info className="inline h-3.5 w-3.5" /> du navigateur → « Ajouter à
                l&apos;écran d&apos;accueil ».
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-1 font-semibold">iPhone / iPad</p>
              <p className="text-muted-foreground">
                Dans Safari, bouton Partager → « Sur l&apos;écran d&apos;accueil ».
              </p>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Après installation, l&apos;application démarre hors ligne : vos saisies sont conservées
          localement puis synchronisées automatiquement dès que la connexion revient.
        </p>
      </CardContent>
    </Card>
  );
}
