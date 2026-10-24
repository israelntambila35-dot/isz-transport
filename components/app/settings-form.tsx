"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, Save, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { formatFC, formatNumber } from "@/lib/format";
import { applyLocal, isOfflineError, isOfflineResponse, queueOp } from "@/lib/offline";
import { BackupSection } from "@/components/app/backup-section";
import { SecuritySection } from "@/components/app/security-section";
import { MultiDeviceSection } from "@/components/app/multi-device-section";
import { InstallSection } from "@/components/app/install-section";
import type { AppSettings } from "@/lib/types";

interface SettingsFormProps {
  settings: AppSettings | null;
  onSaved: () => void;
}

export function SettingsForm({ settings, onSaved }: SettingsFormProps) {
  const { toast } = useToast();

  const [carPriceUsd, setCarPriceUsd] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [dailyRevenue, setDailyRevenue] = useState("");
  const [activeDaysPerWeek, setActiveDaysPerWeek] = useState("5");
  const [weeklySavingsTarget, setWeeklySavingsTarget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronise le formulaire quand les paramètres changent
  useEffect(() => {
    if (!settings) return;
    setCarPriceUsd(String(settings.carPriceUsd));
    setExchangeRate(String(settings.exchangeRate));
    setDailyRevenue(String(settings.dailyRevenue));
    setActiveDaysPerWeek(String(settings.activeDaysPerWeek));
    setWeeklySavingsTarget(String(settings.weeklySavingsTarget));
    setStartDate(settings.startDate.slice(0, 10));
  }, [settings]);

  // Aperçu en direct : le prix en FC se recalcule automatiquement quand le taux change
  const preview = useMemo(() => {
    const price = Number(carPriceUsd) || 0;
    const rate = Number(exchangeRate) || 0;
    const target = Number(weeklySavingsTarget) || 0;
    const priceFc = price * rate;
    const weeks = target > 0 ? priceFc / target : 0;
    return { priceFc, weeks, revenueWeek: (Number(dailyRevenue) || 0) * (Number(activeDaysPerWeek) || 0) };
  }, [carPriceUsd, exchangeRate, dailyRevenue, activeDaysPerWeek, weeklySavingsTarget]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nums = {
      carPriceUsd: Number(carPriceUsd),
      exchangeRate: Number(exchangeRate),
      dailyRevenue: Number(dailyRevenue),
      activeDaysPerWeek: Number(activeDaysPerWeek),
      weeklySavingsTarget: Number(weeklySavingsTarget),
    };
    if (!Number.isFinite(nums.carPriceUsd) || nums.carPriceUsd <= 0) {
      setError("Le prix de la voiture doit être un nombre positif.");
      return;
    }
    if (!Number.isFinite(nums.exchangeRate) || nums.exchangeRate <= 0) {
      setError("Le taux de change doit être un nombre positif.");
      return;
    }
    if (!Number.isFinite(nums.dailyRevenue) || nums.dailyRevenue <= 0) {
      setError("La recette journalière doit être un nombre positif.");
      return;
    }
    if (!Number.isInteger(nums.activeDaysPerWeek) || nums.activeDaysPerWeek < 1 || nums.activeDaysPerWeek > 7) {
      setError("Les jours actifs doivent être entre 1 et 7.");
      return;
    }
    if (!Number.isFinite(nums.weeklySavingsTarget) || nums.weeklySavingsTarget <= 0) {
      setError("Le versement hebdomadaire cible doit être un nombre positif.");
      return;
    }
    if (!startDate) {
      setError("Veuillez choisir une date de début.");
      return;
    }

    setSaving(true);
    const payload = { ...nums, startDate };
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (isOfflineResponse(res)) {
        saveOffline(payload);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'enregistrement.");
      toast({
        title: "Paramètres enregistrés",
        description: `Prix de la voiture recalculé : ${formatFC(nums.carPriceUsd * nums.exchangeRate)}`,
      });
      onSaved();
    } catch (err) {
      if (isOfflineError(err)) {
        saveOffline(payload);
        return;
      }
      const message = err instanceof Error ? err.message : "Erreur inconnue.";
      setError(message);
      toast({ title: "Erreur", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  /** Applique les paramètres localement + met en file d'attente la synchronisation */
  function saveOffline(payload: AppSettings) {
    queueOp({ kind: "settings", payload });
    applyLocal({ kind: "settings", payload });
    toast({
      title: "Paramètres enregistrés hors ligne",
      description: `Prix recalculé : ${formatFC(payload.carPriceUsd * payload.exchangeRate)} — synchronisation dès le retour de la connexion.`,
    });
    onSaved();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-primary" />
            Paramètres{settings?.carName ? ` — ${settings.carName}` : ""}
          </CardTitle>
          <CardDescription>
            Ces paramètres concernent la voiture sélectionnée dans l&apos;en-tête — chaque
            voiture a ses propres paramètres. Si vous modifiez le taux de change ou le prix,
            le prix de la voiture en FC et la durée estimée sont recalculés automatiquement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="carPriceUsd">Prix de la voiture (USD) *</Label>
              <Input
                id="carPriceUsd"
                type="number"
                min="1"
                step="any"
                inputMode="decimal"
                value={carPriceUsd}
                onChange={(e) => setCarPriceUsd(e.target.value)}
                className="font-money"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exchangeRate">Taux de change (FC pour 1 USD) *</Label>
              <Input
                id="exchangeRate"
                type="number"
                min="1"
                step="any"
                inputMode="decimal"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                className="font-money"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dailyRevenue">Recette journalière (FC) *</Label>
              <Input
                id="dailyRevenue"
                type="number"
                min="1"
                step="any"
                inputMode="numeric"
                value={dailyRevenue}
                onChange={(e) => setDailyRevenue(e.target.value)}
                className="font-money"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="activeDays">Jours actifs d&apos;épargne par semaine *</Label>
              <Select
                value={activeDaysPerWeek}
                onValueChange={(v) => setActiveDaysPerWeek(v)}
              >
                <SelectTrigger id="activeDays" className="w-full">
                  <SelectValue placeholder="Choisir" />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} jour{d > 1 ? "s" : ""} {d === 5 && "(lun–ven)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Ex. : 5 = du lundi au vendredi. Le samedi (chauffeur) et le dimanche (entretien)
                ne comptent pas dans l&apos;épargne.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="weeklySavingsTarget">Versement hebdomadaire cible du chauffeur (FC) *</Label>
              <Input
                id="weeklySavingsTarget"
                type="number"
                min="1"
                step="any"
                inputMode="numeric"
                value={weeklySavingsTarget}
                onChange={(e) => setWeeklySavingsTarget(e.target.value)}
                className="font-money"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate" className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-primary" />
                Date de début du projet *
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
          </div>

          <Separator />

          {/* Aperçu en direct */}
          <div className="rounded-lg border bg-accent/40 p-4">
            <p className="mb-2 text-sm font-medium">Aperçu en direct</p>
            <ul className="space-y-1 text-sm font-money">
              <li>
                Prix de la voiture : {carPriceUsd || 0} USD × {exchangeRate || 0} ={" "}
                <span className="font-semibold text-primary">{formatFC(preview.priceFc)}</span>
              </li>
              <li>
                Recette hebdomadaire attendue :{" "}
                <span className="font-semibold">{formatFC(preview.revenueWeek)}</span>
              </li>
              <li>
                Durée estimée : {formatFC(preview.priceFc)} ÷{" "}
                {formatFC(Number(weeklySavingsTarget) || 0)} ={" "}
                <span className="font-semibold">{formatNumber(preview.weeks)} semaines</span> (soit{" "}
                {Math.ceil(preview.weeks)} semaines complètes)
              </li>
            </ul>
          </div>

          <Button type="submit" disabled={saving} className="min-h-11">
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Enregistrer les paramètres
          </Button>
          </CardContent>
        </Card>
      </form>

      <BackupSection onRestored={onSaved} />
      <SecuritySection />
      <MultiDeviceSection />
      <InstallSection />
    </div>
  );
}
