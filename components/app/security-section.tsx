"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { formatISODateLong } from "@/lib/format";

/**
 * Carte « Sécurité & code d'accès » des Paramètres :
 * activer, changer ou désactiver le code d'accès personnel qui protège
 * les données sur tous les appareils.
 */
export function SecuritySection() {
  const { toast } = useToast();

  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [codeUpdatedAt, setCodeUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Formulaire « activer » (aucun code) ou « changer » (code actif)
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setHasCode(Boolean(data.locked));
      setCodeUpdatedAt(data.codeUpdatedAt ?? null);
    } catch {
      setHasCode(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = data?.error || "Opération impossible.";
        setError(message);
        toast({ title: "Erreur", description: message, variant: "destructive" });
        return false;
      }
      // La session de cet appareil est renouvelée par le serveur (cookie mis à jour)
      setCodeUpdatedAt(data?.codeUpdatedAt ?? null);
      return true;
    } catch {
      const message = "Connexion au serveur impossible.";
      setError(message);
      toast({ title: "Erreur", description: message, variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    if (newCode !== confirmCode) {
      setError("Les deux codes ne correspondent pas.");
      return;
    }
    const body: Record<string, unknown> = { action: "set", code: newCode };
    if (hasCode) body.currentCode = currentCode;
    const ok = await post(body);
    if (ok) {
      const changed = hasCode;
      setHasCode(true);
      setCurrentCode("");
      setNewCode("");
      setConfirmCode("");
      toast({
        title: changed ? "Code d'accès modifié" : "Code d'accès créé",
        description: changed
          ? "Tous les autres appareils ont été déconnectés : ils devront saisir le nouveau code."
          : "Vos données sont désormais protégées sur tous les appareils.",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Sécurité &amp; code d&apos;accès
        </CardTitle>
        <CardDescription>
          Votre code d&apos;accès personnel protège vos données sur tous les appareils : toute
          nouvelle connexion (autre téléphone, navigateur…) exige le code. La connexion ouvre
          une session de 60 jours sur l&apos;appareil ; vous pouvez vous déconnecter à tout
          moment depuis le bouton en haut de page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Vérification de l&apos;état du verrou…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge className="gap-1 bg-primary/10 text-primary border border-primary/30">
                <LockKeyhole className="h-3 w-3" />
                Protection active
                {codeUpdatedAt
                  ? ` — code du ${formatISODateLong(codeUpdatedAt.slice(0, 10))}`
                  : ""}
              </Badge>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <form onSubmit={handleActivate} className="space-y-4">
              {hasCode && (
                <div className="space-y-2">
                  <Label htmlFor="sec-current">Code actuel *</Label>
                  <Input
                    id="sec-current"
                    type="password"
                    autoComplete="current-password"
                    value={currentCode}
                    onChange={(e) => setCurrentCode(e.target.value)}
                    className="min-h-11"
                    required
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sec-new">
                    {hasCode ? "Nouveau code *" : "Code d'accès souhaité *"}
                  </Label>
                  <Input
                    id="sec-new"
                    type="password"
                    autoComplete="new-password"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="4 caractères minimum"
                    className="min-h-11"
                    minLength={4}
                    maxLength={64}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sec-confirm">Confirmez le code *</Label>
                  <Input
                    id="sec-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    className="min-h-11"
                    minLength={4}
                    maxLength={64}
                    required
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy} className="min-h-11">
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LockKeyhole className="mr-2 h-4 w-4" />
                  )}
                  {hasCode ? "Modifier le code" : "Créer le code d'accès"}
                </Button>
              </div>
            </form>

            <Separator />

            <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
              <li>
                Changer le code déconnecte immédiatement tous les autres appareils : chacun
                devra saisir le nouveau code une fois.
              </li>
              <li>
                Après 5 codes erronés, l&apos;écran de connexion se bloque automatiquement
                pendant 5 minutes (protection contre les tentatives répétées).
              </li>
              <li>
                Le code n&apos;est jamais stocké en clair (hachage scrypt salé) et le cookie de
                session ne contient ni le code ni son empreinte.
              </li>
              <li>
                Sans le code, l&apos;accès à vos données est impossible : choisissez-en un
                facile à retenir et notez-le en lieu sûr.
              </li>
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
