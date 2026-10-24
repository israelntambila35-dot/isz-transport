"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { Check, Copy, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const emptySubscribe = () => () => {};
const getOriginSnapshot = () => window.location.origin;
const getOriginServer = () => "";

/**
 * Carte « Accès sur un autre appareil » : affiche l'adresse de l'espace
 * personnel, son QR code (à scanner avec l'autre téléphone) et les étapes
 * pour retrouver toutes ses données et ses comptes.
 */
export function MultiDeviceSection() {
  const { toast } = useToast();
  const origin = useSyncExternalStore(emptySubscribe, getOriginSnapshot, getOriginServer);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    QRCode.toDataURL(origin, {
      width: 320,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [origin]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Adresse copiée",
        description: "Collez-la dans le navigateur de votre autre téléphone.",
      });
    } catch {
      toast({
        title: "Copie impossible",
        description: `Sélectionnez et recopiez manuellement : ${origin}`,
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" />
          Accéder à mes données depuis un autre téléphone
        </CardTitle>
        <CardDescription>
          Vos données et vos comptes voitures sont enregistrés sur le serveur : chaque appareil
          qui ouvre cette adresse voit exactement les mêmes informations. Scannez le QR code avec
          l&apos;autre téléphone ou recopiez l&apos;adresse.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
          {/* QR code */}
          <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 dark:bg-white/95">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR code vers votre espace ISZTRANSPORT"
                className="h-40 w-40"
              />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            )}
            <p className="text-[11px] font-medium text-slate-600">
              Scannez avec la caméra du téléphone
            </p>
          </div>

          {/* Adresse + étapes */}
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Adresse de votre espace</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <code className="min-h-11 flex-1 truncate rounded-md border bg-muted/50 px-3 py-2.5 text-sm">
                  {origin || "…"}
                </code>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void handleCopy()}
                  disabled={!origin}
                >
                  {copied ? (
                    <Check className="mr-2 h-4 w-4 text-primary" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  Copier
                </Button>
              </div>
            </div>

            <ol className="space-y-2.5 text-sm">
              <li className="flex gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  1
                </span>
                <span>
                  Ouvrez cette adresse dans le navigateur de l&apos;autre téléphone (ou scannez le
                  QR code), puis installez l&apos;application si vous le souhaitez.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  2
                </span>
                <span>
                  Si un code d&apos;accès est activé (carte ci-dessus), saisissez-le : il ne sera
                  demandé qu&apos;une fois sur cet appareil.
                </span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  3
                </span>
                <span>
                  Retrouvez immédiatement toutes vos voitures, versements, retraits et
                  statistiques — les saisies faites sur un appareil apparaissent sur tous les
                  autres dès la connexion rétablie.
                </span>
              </li>
            </ol>

            <p className="rounded-md border bg-accent/40 px-3 py-2 text-xs text-muted-foreground">
              À savoir : pour être ouverte depuis plusieurs téléphones, l&apos;application doit
              tourner sur une adresse accessible par ces appareils (hébergement ou même réseau).
              En cas de changement d&apos;hébergement, utilisez la sauvegarde JSON pour transférer
              toutes vos données.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
