"use client";

import { useEffect, useState } from "react";
import {
  Car,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LockScreenProps {
  /** « setup » : aucun code défini → création ; « locked » : connexion */
  mode: "setup" | "locked";
  onUnlock: () => void;
}

/**
 * Page de connexion / d'activation du code d'accès.
 *  - mode « setup » : premier lancement (ou code jamais créé) → le
 *    propriétaire choisit son code personnel (avec confirmation).
 *  - mode « locked » : connexion classique — le code ouvre une session
 *    de 60 jours sur cet appareil (cookie sécurisé côté serveur).
 * Anti force brute : après 5 codes erronés, le serveur refuse toute
 * nouvelle tentative pendant 5 minutes (compte à rebours affiché).
 */
export function LockScreen({ mode, onUnlock }: LockScreenProps) {
  const isSetup = mode === "setup";
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  /** Décompte anti force brute (secondes restantes), 0 = aucun */
  const [lockRemaining, setLockRemaining] = useState(0);

  // Compte à rebours du verrouillage
  useEffect(() => {
    if (lockRemaining <= 0) return;
    const t = setInterval(() => {
      setLockRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [lockRemaining]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (checking || lockRemaining > 0) return;
    setError(null);

    if (isSetup) {
      if (code.length < 4) {
        setError("Le code doit contenir au moins 4 caractères.");
        return;
      }
      if (code !== confirm) {
        setError("Les deux codes ne correspondent pas.");
        return;
      }
    }
    if (!code.trim()) return;

    setChecking(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSetup ? { action: "set", code } : { action: "verify", code }
        ),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; retryAfter?: number; needsSetup?: boolean }
        | null;
      if (res.ok && data?.ok) {
        onUnlock();
        return;
      }
      if (res.status === 429 && data?.retryAfter) {
        setLockRemaining(data.retryAfter);
        setError(data.error ?? "Trop de tentatives. Réessayez dans quelques minutes.");
      } else {
        setError(data?.error ?? "Code incorrect.");
      }
    } catch {
      setError(
        "Impossible de vérifier le code : connectez cet appareil à Internet puis réessayez."
      );
    } finally {
      setChecking(false);
    }
  }

  const lockActive = lockRemaining > 0;

  return (
    <div className="flex min-h-[70vh] flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Car className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">ISZTRANSPORT</h1>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <LockKeyhole className="h-3.5 w-3.5" />
              {isSetup
                ? "Espace privé — sécurisez-le avec votre code"
                : "Espace privé — connexion requise"}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {isSetup ? (
                <ShieldCheck className="h-4 w-4 text-primary" />
              ) : (
                <KeyRound className="h-4 w-4 text-primary" />
              )}
              {isSetup ? "Créer votre code d'accès" : "Connexion"}
            </CardTitle>
            <CardDescription>
              {isSetup
                ? "Bienvenue ! Choisissez un code secret pour protéger vos données. Il vous sera demandé pour accéder à votre espace depuis n'importe quel appareil."
                : "Entrez votre code d'accès personnel pour retrouver vos voitures, vos versements, votre caisse et vos comptes."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertDescription className="text-sm">{error}</AlertDescription>
                </Alert>
              )}

              {lockActive && (
                <div
                  className="flex items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  role="alert"
                >
                  <Timer className="h-4 w-4" />
                  Trop de tentatives — réessayez dans{" "}
                  <span className="font-mono tabular-nums">
                    {Math.floor(lockRemaining / 60)}:
                    {(lockRemaining % 60).toString().padStart(2, "0")}
                  </span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="access-code">
                  {isSetup ? "Nouveau code d'accès" : "Code d'accès"}
                </Label>
                <div className="relative">
                  <Input
                    id="access-code"
                    type={showCode ? "text" : "password"}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={isSetup ? "Choisissez votre code secret" : "Votre code personnel"}
                    autoComplete={isSetup ? "new-password" : "current-password"}
                    autoFocus
                    className="min-h-11 pr-11 text-center text-lg tracking-[0.3em]"
                    required
                    minLength={isSetup ? 4 : undefined}
                    maxLength={64}
                    disabled={lockActive}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCode((v) => !v)}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={showCode ? "Masquer le code" : "Afficher le code"}
                  >
                    {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {isSetup && (
                  <p className="text-xs text-muted-foreground">
                    4 caractères minimum. Mémorisez-le bien : sans lui, impossible d&apos;accéder à
                    vos données.
                  </p>
                )}
              </div>

              {isSetup && (
                <div className="space-y-2">
                  <Label htmlFor="access-confirm">Confirmez le code</Label>
                  <Input
                    id="access-confirm"
                    type={showCode ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Répétez le même code"
                    autoComplete="new-password"
                    className="min-h-11 text-center text-lg tracking-[0.3em]"
                    required
                    maxLength={64}
                  />
                </div>
              )}

              <Button
                type="submit"
                className="min-h-11 w-full"
                disabled={checking || lockActive || !code.trim() || (isSetup && !confirm.trim())}
              >
                {checking ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : isSetup ? (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                {checking
                  ? "Vérification…"
                  : isSetup
                    ? "Sécuriser mon espace"
                    : "Se connecter"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {isSetup
            ? "Ce code restera confidentiel : il n'est jamais stocké en clair et la connexion est protégée contre les tentatives répétées."
            : "Vos données restent enregistrées sur le serveur : ouvrez la même adresse sur n'importe quel appareil et connectez-vous avec votre code."}
        </p>
      </div>
    </div>
  );
}
