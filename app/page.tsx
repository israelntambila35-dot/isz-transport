"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BanknoteArrowDown,
  Car,
  FileBarChart2,
  FlaskConical,
  HandCoins,
  History as HistoryIcon,
  LayoutDashboard,
  CalendarDays,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dashboard } from "@/components/app/dashboard";
import { Simulator } from "@/components/app/simulator";
import { HeaderBadges } from "@/components/app/header-badges";
import { PwaRegister } from "@/components/app/pwa-register";
import { ThemeToggle } from "@/components/theme-toggle";
import { CarSwitcher } from "@/components/app/car-switcher";
import { CalendarView } from "@/components/app/calendar-view";
import { History } from "@/components/app/history";
import { WithdrawalsSection } from "@/components/app/withdrawals-section";
import { Caisse } from "@/components/app/caisse";
import { LoansSection } from "@/components/app/loans-section";
import { Reports } from "@/components/app/reports";
import { SettingsForm } from "@/components/app/settings-form";
import { LockScreen } from "@/components/app/lock-screen";
import { checkAccess, forgetDevice, markHadAccess } from "@/lib/access";
import {
  applyLocal,
  queueOp,
  readCacheFull,
  saveSnapshot,
  wipeLocalData,
  ST_CACHE_EVENT,
  ST_SYNC_EVENT,
} from "@/lib/offline";
import type {
  AppSettings,
  CarWithCounts,
  CashMovement,
  Loan,
  StatsResponse,
  WeeklyEntry,
  Withdrawal,
} from "@/lib/types";

const VALID_TABS = [
  "dashboard",
  "calendrier",
  "historique",
  "retraits",
  "caisse",
  "prets",
  "rapports",
  "simulateur",
  "parametres",
];

export default function HomePage() {
  const [cars, setCars] = useState<CarWithCounts[]>([]);
  const [activeCarId, setActiveCarId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [weeks, setWeeks] = useState<WeeklyEntry[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offlineData, setOfflineData] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [editingWeek, setEditingWeek] = useState<WeeklyEntry | null>(null);
  // Authentification : « checking » → « setup » (créer le code) ou
  // « locked » (connexion requise) ou « open » (session valide)
  const [authState, setAuthState] = useState<"checking" | "locked" | "setup" | "open">(
    "checking"
  );

  /** Applique un instantané du cache local (voiture active) à l'interface */
  const applyCache = useCallback(() => {
    const cache = readCacheFull();
    if (cache.activeCarId) {
      const slice = cache.perCar[cache.activeCarId];
      if (slice?.settings) {
        setCars(
          cache.cars.map((c) => ({
            weeksCount: 0,
            withdrawalsCount: 0,
            ...c,
          }))
        );
        setActiveCarId(cache.activeCarId);
        setSettings(slice.settings);
        setWeeks(slice.weeks);
        setWithdrawals(slice.withdrawals);
        setCashMovements(slice.cashMovements ?? []);
        setLoans(slice.loans ?? []);
        setStats(slice.stats);
      }
    }
  }, []);

  /** Chargement : cache local d'abord (instantané), puis réseau */
  const loadAll = useCallback(
    async (carIdArg?: string) => {
      setLoading(true);
      setLoadError(null);
      applyCache(); // affichage immédiat depuis le cache

      try {
        // 1. Voitures (fournit la voiture active si inconnue)
        let targetCarId = carIdArg ?? activeCarId;
        const carsRes = await fetch("/api/cars");
        if (!carsRes.ok) throw new Error("cars");
        const carsData = (await carsRes.json()) as {
          activeCarId: string;
          cars: CarWithCounts[];
        };
        setCars(carsData.cars);
        if (!targetCarId) targetCarId = carsData.activeCarId;
        if (!targetCarId) throw new Error("nocar");
        setActiveCarId(carsData.activeCarId);

        // 2. Données de la voiture active
        const q = `?carId=${encodeURIComponent(targetCarId)}`;
        const [settingsRes, weeksRes, statsRes, withdrawalsRes, cashRes, loansRes] = await Promise.all([
          fetch(`/api/settings${q}`),
          fetch(`/api/weeks${q}`),
          fetch(`/api/stats${q}`),
          fetch(`/api/withdrawals${q}`),
          fetch(`/api/cash${q}`),
          fetch(`/api/loans${q}`),
        ]);
        if (
          !settingsRes.ok ||
          !weeksRes.ok ||
          !statsRes.ok ||
          !withdrawalsRes.ok ||
          !cashRes.ok ||
          !loansRes.ok
        ) {
          throw new Error("Le serveur n'a pas répondu correctement.");
        }
        const [settingsData, weeksData, statsData, withdrawalsData, cashData, loansData] =
          await Promise.all([
            settingsRes.json(),
            weeksRes.json(),
            statsRes.json(),
            withdrawalsRes.json(),
            cashRes.json(),
            loansRes.json(),
          ]);
        // Verrou personnel : le serveur exige le code d'accès → afficher l'écran de déverrouillage
        if (settingsRes.status === 401) {
          forgetDevice();
          setAuthState("locked");
          setLoading(false);
          return;
        }
        setSettings(settingsData);
        setWeeks(weeksData);
        setStats(statsData);
        setWithdrawals(withdrawalsData);
        setCashMovements(Array.isArray(cashData) ? cashData : []);
        setLoans(Array.isArray(loansData) ? loansData : []);
        setOfflineData(false);
        saveSnapshot(
          carsData.cars,
          carsData.activeCarId,
          targetCarId,
          settingsData,
          weeksData,
          statsData,
          withdrawalsData,
          Array.isArray(cashData) ? cashData : [],
          Array.isArray(loansData) ? loansData : []
        );
      } catch {
        // Hors ligne : si le cache contient des données, on reste utilisable
        const cache = readCacheFull();
        const slice = cache.activeCarId ? cache.perCar[cache.activeCarId] : null;
        if (slice?.settings) {
          setOfflineData(true);
          setLoadError(null);
        } else {
          setLoadError(
            "Impossible de charger les données. Vérifiez votre connexion puis réessayez — au premier lancement, une connexion est nécessaire."
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [applyCache, activeCarId]
  );

  // Chargement initial : verrou personnel d'abord, puis données.
  // Support des raccourcis PWA (?tab=…) — « saisie » = ancien onglet,
  // redirigé vers le calendrier.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t && VALID_TABS.includes(t)) setTab(t);
    else if (t === "saisie") setTab("calendrier");

    void (async () => {
      const state = await checkAccess();
      if (state === "locked") {
        setAuthState("locked");
        return;
      }
      if (state === "setup") {
        setAuthState("setup");
        return;
      }
      setAuthState("open");
      await loadAll();
    })();
  }, []);

  // Le cache local a changé (mutation optimiste hors-ligne) → rafraîchir l'UI
  // (uniquement si l'espace est ouvert : jamais de données avant déverrouillage)
  useEffect(() => {
    const onCache = () => {
      if (authState === "open") applyCache();
    };
    window.addEventListener(ST_CACHE_EVENT, onCache);
    return () => window.removeEventListener(ST_CACHE_EVENT, onCache);
  }, [applyCache, authState]);

  // Une synchronisation vient de réussir → recharger depuis le serveur
  useEffect(() => {
    const onSync = () => {
      if (authState === "open") void loadAll();
    };
    window.addEventListener(ST_SYNC_EVENT, onSync);
    return () => window.removeEventListener(ST_SYNC_EVENT, onSync);
  }, [loadAll, authState]);

  /** Change de voiture active (fonctionne aussi hors ligne si déjà en cache) */
  async function switchCar(carId: string) {
    if (carId === activeCarId) return;
    setActiveCarId(carId);
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeCarId: carId }),
      });
      if (!res.ok) throw new Error("switch");
    } catch {
      // Hors ligne : la voiture a-t-elle déjà des données en cache ?
      const cache = readCacheFull();
      const slice = cache.perCar[carId];
      if (slice?.settings) {
        queueOp({ kind: "settings", payload: { ...slice.settings, activeCarId: carId } });
        applyLocal({ kind: "settings", payload: { ...slice.settings, activeCarId: carId } });
      } else if (cache.activeCarId) {
        // Revenir à l'ancienne voiture : impossible de charger la nouvelle
        setActiveCarId(cache.activeCarId);
        setLoading(false);
        setLoadError(
          "Impossible de charger cette voiture hors ligne (aucune donnée enregistrée sur l'appareil). Reconnectez-vous puis réessayez."
        );
        return;
      }
    }
    await loadAll(carId);
  }

  function handleEditWeek(entry: WeeklyEntry) {
    setEditingWeek(entry);
    setTab("calendrier");
  }

  function goToCalendrier() {
    setEditingWeek(null);
    setTab("calendrier");
  }

  /** Le code d'accès a été accepté (connexion) ou créé (activation) → ouvrir */
  function handleUnlock() {
    // Marque cet appareil comme ayant eu un accès légitime : il pourra
    // rouvrir en mode hors-ligne (données du cache) sans serveur.
    markHadAccess();
    setAuthState("open");
    void loadAll();
  }

  /** Déconnexion : session révoquée + données locales de l'appareil effacées */
  async function handleLogout() {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {
      // même hors ligne, on purge localement
    }
    wipeLocalData();
    forgetDevice();
    setCars([]);
    setActiveCarId(null);
    setSettings(null);
    setWeeks([]);
    setWithdrawals([]);
    setCashMovements([]);
    setLoans([]);
    setStats(null);
    setOfflineData(false);
    setLoadError(null);
    setTab("dashboard");
    setAuthState("locked");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PwaRegister />

      {/* En-tête */}
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 no-print">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Car className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight">
                ISZTRANSPORT
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                Gestion privée de vos voitures de transport — versements, caisse &amp; remboursement
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {authState === "open" ? (
              <>
                <CarSwitcher
                  cars={cars}
                  activeCarId={activeCarId}
                  onSwitch={(id) => void switchCar(id)}
                  onChanged={() => void loadAll()}
                />
                <HeaderBadges />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      title="Se déconnecter"
                      aria-label="Se déconnecter"
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Se déconnecter ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Votre session sera fermée et toutes les données enregistrées sur cet
                        appareil (y compris hors ligne) seront effacées. Vos données restent
                        intactes sur le serveur : reconnectez-vous avec votre code d&apos;accès
                        pour les retrouver.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleLogout()}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Se déconnecter
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Contenu */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {authState === "checking" ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader />
            <p className="text-sm">Vérification de l&apos;accès…</p>
          </div>
        ) : authState === "locked" || authState === "setup" ? (
          <LockScreen mode={authState === "setup" ? "setup" : "locked"} onUnlock={handleUnlock} />
        ) : (
          <>
            {offlineData && !loadError && (
              <Alert className="mb-4 border-amber-500/40 bg-amber-50 no-print dark:bg-amber-950">
                <AlertTitle>Mode hors ligne</AlertTitle>
                <AlertDescription>
                  Vous consultez vos données enregistrées sur cet appareil. Vous pouvez continuer à
                  créer vos semaines et saisir vos montants : tout sera synchronisé automatiquement au
                  retour de la connexion.
                </AlertDescription>
              </Alert>
            )}

            {loadError ? (
              <Alert variant="destructive">
                <AlertTitle>Erreur de chargement</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3">
                  {loadError}
                  <Button variant="outline" size="sm" onClick={() => void loadAll()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Réessayer
                  </Button>
                </AlertDescription>
              </Alert>
            ) : loading && !settings ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader />
                <p className="text-sm">Chargement des données…</p>
              </div>
            ) : (
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="mb-6 flex h-auto w-full justify-start gap-1 overflow-x-auto p-1 sm:h-10">
              <TabsTrigger value="dashboard" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <LayoutDashboard className="h-4 w-4" />
                Tableau de bord
              </TabsTrigger>
              <TabsTrigger value="calendrier" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <CalendarDays className="h-4 w-4" />
                Calendrier
              </TabsTrigger>
              <TabsTrigger value="historique" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <HistoryIcon className="h-4 w-4" />
                Historique
              </TabsTrigger>
              <TabsTrigger value="retraits" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <BanknoteArrowDown className="h-4 w-4" />
                Retraits
              </TabsTrigger>
              <TabsTrigger value="caisse" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <Wallet className="h-4 w-4" />
                Caisse
              </TabsTrigger>
              <TabsTrigger value="prets" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <HandCoins className="h-4 w-4" />
                Prêts &amp; emprunts
              </TabsTrigger>
              <TabsTrigger value="rapports" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <FileBarChart2 className="h-4 w-4" />
                Rapports
              </TabsTrigger>
              <TabsTrigger value="simulateur" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <FlaskConical className="h-4 w-4" />
                Simulateur
              </TabsTrigger>
              <TabsTrigger value="parametres" className="gap-1.5 whitespace-nowrap px-3 py-1.5">
                <SettingsIcon className="h-4 w-4" />
                Paramètres
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard">
              <Dashboard
                stats={stats}
                weeks={weeks}
                settings={settings}
                withdrawals={withdrawals}
                cashMovements={cashMovements}
                loans={loans}
                onGoToCalendrier={goToCalendrier}
              />
            </TabsContent>

            <TabsContent value="calendrier">
              <CalendarView
                weeks={weeks}
                withdrawals={withdrawals}
                settings={settings}
                onChanged={() => void loadAll()}
                editingWeek={editingWeek}
                onEditingWeekHandled={() => setEditingWeek(null)}
              />
            </TabsContent>

            <TabsContent value="historique">
              <History
                weeks={weeks}
                withdrawals={withdrawals}
                loans={loans}
                carPriceFc={stats?.carPriceFc ?? 0}
                onEdit={handleEditWeek}
                onChanged={() => void loadAll()}
              />
            </TabsContent>

            <TabsContent value="retraits">
              <WithdrawalsSection
                withdrawals={withdrawals}
                weeks={weeks}
                onChanged={() => void loadAll()}
              />
            </TabsContent>

            <TabsContent value="caisse">
              <Caisse
                weeks={weeks}
                withdrawals={withdrawals}
                cashMovements={cashMovements}
                settings={settings}
                onChanged={() => void loadAll()}
              />
            </TabsContent>

            <TabsContent value="prets">
              <LoansSection loans={loans} onChanged={() => void loadAll()} />
            </TabsContent>

            <TabsContent value="rapports">
              <Reports weeks={weeks} withdrawals={withdrawals} stats={stats} settings={settings} />
            </TabsContent>

            <TabsContent value="simulateur">
              <Simulator stats={stats} settings={settings} />
            </TabsContent>

            <TabsContent value="parametres">
              <SettingsForm settings={settings} onSaved={() => void loadAll()} />
            </TabsContent>
          </Tabs>
            )}
          </>
        )}
      </main>

      {/* Pied de page collant */}
      <footer className="mt-auto border-t bg-card no-print">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <p>
            <span className="font-semibold text-foreground">ISZTRANSPORT</span> — espace privé
            protégé par votre code d&apos;accès : vos données et vos comptes restent accessibles
            depuis tous vos appareils après connexion.
          </p>
          <p>Plusieurs voitures · caisse espèces / banque · prêts &amp; emprunts · historique mensuel</p>
        </div>
      </footer>
    </div>
  );
}

/** Petit loader local pour éviter un import inutile */
function Loader() {
  return (
    <div
      className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      role="status"
      aria-label="Chargement en cours"
    />
  );
}
