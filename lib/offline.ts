/**
 * Mode hors-ligne « ISZTRANSPORT » (multi-voitures)
 * ------------------------------------------------------------------
 * L'application fonctionne à 100 % sans connexion :
 *  1. Chaque chargement réussi (voitures / paramètres / semaines / stats)
 *     est mis en cache dans localStorage → affichage instantané au
 *     démarrage, voiture par voiture (application privée : les données
 *     restent sur l'appareil).
 *  2. Si une mutation (saisie, modification, suppression, paramètres,
 *     restauration) échoue parce que l'appareil est hors ligne, elle est
 *     appliquée localement (optimiste) et mise dans une file d'attente.
 *  3. Au retour de la connexion, la file est rejouée automatiquement
 *     dans l'ordre chronologique, puis tout est resynchronisé.
 *
 * Événements DOM émis (sur window) :
 *  - ST_CACHE_EVENT   : le cache local a changé (recharger les états)
 *  - ST_PENDING_EVENT : la taille de la file a changé
 *  - ST_SYNC_EVENT    : une synchronisation vient de réussir (recharger
 *                       les données depuis le serveur)
 */

import { toISODateUTC } from "@/lib/format";
import { weekSavedTotal } from "@/lib/weeks";
import type {
  AppSettings,
  CashMovement,
  DayEntry,
  Loan,
  StatsResponse,
  WeeklyEntry,
  Withdrawal,
} from "@/lib/types";

const CACHE_KEY = "isztransport-cache-v2";
const LEGACY_CACHE_KEY = "isztransport-cache-v1";
const QUEUE_KEY = "isztransport-queue-v1";

// Migration unique : récupère le cache et la file d'attente de l'ancienne
// version (« Suivi Taxi » → ISZTRANSPORT, puis cache v1 → v2 multi-voitures).
if (typeof window !== "undefined") {
  try {
    const legacyPairs: Array<[string, string]> = [
      ["suivi-taxi-cache-v1", LEGACY_CACHE_KEY],
      ["suivi-taxi-queue-v1", QUEUE_KEY],
    ];
    for (const [oldKey, newKey] of legacyPairs) {
      const legacy = localStorage.getItem(oldKey);
      if (legacy && !localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, legacy);
        localStorage.removeItem(oldKey);
      }
    }
  } catch {
    // localStorage indisponible : ignorer silencieusement
  }
}

export const ST_CACHE_EVENT = "st-cache-updated";
export const ST_PENDING_EVENT = "st-pending-changed";
export const ST_SYNC_EVENT = "st-sync-done";

/** Données en cache pour UNE voiture */
export interface CarCacheSlice {
  settings: AppSettings | null;
  weeks: WeeklyEntry[];
  withdrawals: Withdrawal[];
  cashMovements: CashMovement[];
  loans: Loan[];
  stats: StatsResponse | null;
}

/** Snapshot complet multi-voitures, stocké dans localStorage */
export interface LocalCacheV2 {
  savedAt: number;
  activeCarId: string | null;
  cars: Array<{ id: string; name: string; weeksCount?: number; withdrawalsCount?: number }>;
  perCar: Record<string, CarCacheSlice>;
}

/** Vue « voiture active » lue par les composants (forme historique) */
export interface LocalCache extends CarCacheSlice {
  savedAt: number;
}

/** Une mutation en attente de synchronisation */
export interface PendingOp {
  id: string; // identifiant interne de l'opération
  ts: number; // horodatage (ordre chronologique)
  kind:
    | "settings"
    | "week-upsert"
    | "week-update"
    | "week-delete"
    | "day-upsert"
    | "day-delete"
    | "withdrawal-create"
    | "withdrawal-delete"
    | "cash-create"
    | "cash-delete"
    | "loan-create"
    | "loan-update"
    | "loan-delete"
    | "car-update"
    | "restore";
  /** week-upsert : l'entrée complète avec ses jours (id local si créée hors ligne) */
  /** week-update : { id, data } */
  /** week-delete : { id } */
  /** day-upsert : { weekId, day: { date, savedAmount, revenue?, expense?, note? } } */
  /** day-delete : { weekId, date } */
  /** withdrawal-create : le retrait complet (id local si créé hors ligne) */
  /** withdrawal-delete : { id } */
  /** cash-create : le mouvement complet (id local si créé hors ligne) */
  /** cash-delete : { id } */
  /** loan-create : le prêt complet (id local si créé hors ligne) */
  /** loan-update : { id, data } */
  /** loan-delete : { id } */
  /** car-update : { id, data } (soldes de départ, nom…) */
  /** settings : AppSettings */
  /** restore : { settings, weeks, withdrawals, cashMovements?, loans?, cars? } */
  payload: unknown;
}

/* ------------------------------------------------------------------ */
/* Utilitaires localStorage (protégés SSR)                             */
/* ------------------------------------------------------------------ */

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function emit(name: string) {
  if (isBrowser()) window.dispatchEvent(new Event(name));
}

function emptySlice(): CarCacheSlice {
  return { settings: null, weeks: [], withdrawals: [], cashMovements: [], loans: [], stats: null };
}

function emptyV2(): LocalCacheV2 {
  return { savedAt: 0, activeCarId: null, cars: [], perCar: {} };
}

/** Lit la structure complète du cache (multi-voitures) */
export function readCacheFull(): LocalCacheV2 {
  if (!isBrowser()) return emptyV2();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      // Migration v1 → v2 : on réencapsule l'ancien cache (une seule voiture)
      const legacyRaw = localStorage.getItem(LEGACY_CACHE_KEY);
      if (legacyRaw) {
        const old = JSON.parse(legacyRaw) as Partial<
          LocalCache & { settings: AppSettings | null }
        >;
        const slice: CarCacheSlice = {
          settings: old.settings ?? null,
          weeks: Array.isArray(old.weeks) ? old.weeks : [],
          withdrawals: Array.isArray(old.withdrawals) ? old.withdrawals : [],
          stats: old.stats ?? null,
        };
        const carId = old.settings?.carId ?? "_legacy";
        const v2: LocalCacheV2 = {
          savedAt: old.savedAt ?? 0,
          activeCarId: old.settings?.carId ?? null,
          cars: old.settings?.carId
            ? [{ id: old.settings.carId, name: old.settings.carName ?? "Ma voiture" }]
            : [],
          perCar: { [carId]: slice },
        };
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(v2));
        } catch {
          /* quota : ignorer */
        }
        return v2;
      }
      return emptyV2();
    }
    const parsed = JSON.parse(raw) as Partial<LocalCacheV2>;
    const perCar: Record<string, CarCacheSlice> = {};
    for (const [id, slice] of Object.entries(
      parsed.perCar && typeof parsed.perCar === "object" ? parsed.perCar : {}
    )) {
      perCar[id] = {
        settings: slice?.settings ?? null,
        weeks: Array.isArray(slice?.weeks) ? slice!.weeks : [],
        withdrawals: Array.isArray(slice?.withdrawals) ? slice!.withdrawals : [],
        cashMovements: Array.isArray(slice?.cashMovements) ? slice!.cashMovements : [],
        loans: Array.isArray(slice?.loans) ? slice!.loans : [],
        stats: slice?.stats ?? null,
      };
    }
    return {
      savedAt: parsed.savedAt ?? 0,
      activeCarId: parsed.activeCarId ?? null,
      cars: Array.isArray(parsed.cars) ? parsed.cars : [],
      perCar,
    };
  } catch {
    return emptyV2();
  }
}

/** Lit le cache de la voiture ACTIVE (données affichables même sans réseau) */
export function readCache(): LocalCache {
  const v2 = readCacheFull();
  const slice = (v2.activeCarId ? v2.perCar[v2.activeCarId] : null) ?? emptySlice();
  return { ...slice, savedAt: v2.savedAt };
}

/** Fusionne et écrit le cache local (structure v2) */
function writeCacheV2(
  mutate: (cache: LocalCacheV2) => void,
  opts: { emitEvent?: boolean } = {}
): LocalCacheV2 {
  const cache = readCacheFull();
  mutate(cache);
  cache.savedAt = Date.now();
  if (isBrowser()) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* quota dépassé : ignorer */
    }
  }
  if (opts.emitEvent !== false) emit(ST_CACHE_EVENT);
  return cache;
}

/** Mémorise un chargement réseau réussi (voiture + ses données) */
export function saveSnapshot(
  cars: LocalCacheV2["cars"],
  activeCarId: string,
  carId: string,
  settings: AppSettings,
  weeks: WeeklyEntry[],
  stats: StatsResponse,
  withdrawals: Withdrawal[] = [],
  cashMovements: CashMovement[] = [],
  loans: Loan[] = []
): void {
  writeCacheV2((cache) => {
    cache.activeCarId = activeCarId;
    cache.cars = cars;
    cache.perCar[carId] = {
      settings,
      weeks,
      withdrawals,
      cashMovements,
      loans,
      stats,
    };
  });
}

/* ------------------------------------------------------------------ */
/* File d'attente des mutations                                        */
/* ------------------------------------------------------------------ */

function readQueue(): PendingOp[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingOp[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: PendingOp[]): void {
  if (isBrowser()) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch {
      /* quota dépassé : ignorer */
    }
  }
  emit(ST_PENDING_EVENT);
}

export function getPendingOps(): PendingOp[] {
  return readQueue();
}

export function getPendingCount(): number {
  return readQueue().length;
}

/**
 * Efface TOUTES les données locales de l'appareil (cache multi-voitures +
 * file d'attente). Utilisé à la déconnexion : la vie privée d'abord — la
 * prochaine ouverture exigera une connexion, même hors ligne.
 */
export function wipeLocalData(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(QUEUE_KEY);
    localStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    /* stockage indisponible */
  }
  emit(ST_CACHE_EVENT);
  emit(ST_PENDING_EVENT);
}

/**
 * Ajoute une opération à la file. Les opérations de même nature sur la
 * même donnée se remplacent (la plus récente gagne) pour éviter une file
 * qui gonfle inutilement.
 */
export function queueOp(op: Omit<PendingOp, "id" | "ts">): void {
  const q = readQueue();
  const key = opKey(op);
  // Une restauration remplace tout le reste : elle écrase la file.
  if (op.kind === "restore") {
    writeQueue([{ id: newId(), ts: Date.now(), ...op }]);
    return;
  }
  const filtered = q.filter((existing) => opKey(existing) !== key);
  filtered.push({ id: newId(), ts: Date.now(), ...op });
  writeQueue(filtered);
}

function opKey(op: { kind: PendingOp["kind"]; payload: unknown }): string {
  const p = op.payload as Record<string, unknown> | null;
  switch (op.kind) {
    case "settings":
      return "settings";
    case "restore":
      return "restore";
    case "week-upsert":
      return `upsert:${String(p?.carId ?? "?")}:${String(p?.weekStart ?? "?")}`;
    case "week-update":
      return `update:${String(p?.id ?? "?")}`;
    case "week-delete":
      return `delete:${String(p?.id ?? "?")}`;
    case "day-upsert":
      return `dayup:${String(p?.weekId ?? "?")}:${String((p?.day as { date?: string } | undefined)?.date ?? "?").slice(0, 10)}`;
    case "day-delete":
      return `daydel:${String(p?.weekId ?? "?")}:${String(p?.date ?? "?").slice(0, 10)}`;
    case "withdrawal-create":
      return `wcreate:${String(p?.id ?? "?")}`;
    case "withdrawal-delete":
      return `wdel:${String(p?.id ?? "?")}`;
    case "cash-create":
      return `ccreate:${String(p?.id ?? "?")}`;
    case "cash-delete":
      return `cdel:${String(p?.id ?? "?")}`;
    case "loan-create":
      return `lcreate:${String(p?.id ?? "?")}`;
    case "loan-update":
      return `lupdate:${String(p?.id ?? "?")}`;
    case "loan-delete":
      return `ldel:${String(p?.id ?? "?")}`;
    case "car-update":
      return `carup:${String(p?.id ?? "?")}`;
  }
}

function newId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** L'erreur vient-elle d'une absence de réseau ? */
export function isOfflineError(err: unknown): boolean {
  return err instanceof TypeError; // fetch lancé hors ligne → TypeError "Failed to fetch"
}

/** La réponse du service worker indique-t-elle un mode hors-ligne ? */
export function isOfflineResponse(res: Response): boolean {
  return res.status === 503 && (res.headers.get("x-offline") === "1" || res.url.includes("offline"));
}

/* ------------------------------------------------------------------ */
/* Application locale optimiste                                        */
/* ------------------------------------------------------------------ */

/** Recalcule toutes les statistiques localement (identique à /api/stats) */
export function computeLocalStats(
  weeks: WeeklyEntry[],
  settings: AppSettings,
  withdrawals: Withdrawal[] = []
): StatsResponse {
  const carPriceFc = settings.carPriceUsd * settings.exchangeRate;
  // Montant versé par semaine : somme des jours saisis, ou total direct sinon
  const totalSaved = weeks.reduce((s, w) => s + weekSavedTotal(w), 0);
  const totalRevenue = weeks.reduce((s, w) => s + w.revenueWeek, 0);
  const totalFuel = weeks.reduce((s, w) => s + w.fuelExpense, 0);
  const totalMaintenance = weeks.reduce((s, w) => s + w.maintenanceExpense, 0);
  const totalDriver = weeks.reduce((s, w) => s + w.driverSaturday, 0);
  const totalOther = weeks.reduce((s, w) => s + w.otherExpenses, 0);
  const totalExpenses = totalFuel + totalMaintenance + totalDriver + totalOther;

  const totalWithdrawn = withdrawals.reduce((s, w) => s + w.amount, 0);
  const netSaved = totalSaved - totalWithdrawn;

  const remaining = Math.max(0, carPriceFc - netSaved);
  const paidPercent =
      carPriceFc > 0 ? Math.max(0, Math.min(100, (netSaved / carPriceFc) * 100)) : 0;

  const entriesCount = weeks.length;
  const avgWeeklySavings =
    entriesCount > 0 ? totalSaved / entriesCount : settings.weeklySavingsTarget;

  const estimatedTotalWeeks = avgWeeklySavings > 0 ? carPriceFc / avgWeeklySavings : 0;
  const estimatedTotalWeeksTarget =
    settings.weeklySavingsTarget > 0
      ? carPriceFc / settings.weeklySavingsTarget
      : 0;

  const remainingWeeks =
    avgWeeklySavings > 0 && remaining > 0 ? remaining / avgWeeklySavings : 0;
  const now = new Date();
  const endDate = new Date(now.getTime());
  endDate.setUTCDate(endDate.getUTCDate() + Math.ceil(remainingWeeks * 7));

  const startMs = new Date(settings.startDate).getTime();
  const weeksElapsed = Number.isFinite(startMs)
    ? Math.max(0, (now.getTime() - startMs) / (1000 * 60 * 60 * 24 * 7))
    : 0;

  return {
    carPriceFc,
    carPriceUsd: settings.carPriceUsd,
    exchangeRate: settings.exchangeRate,
    totalSaved,
    totalRevenue,
    totalFuel,
    totalMaintenance,
    totalDriver,
    totalOther,
    totalExpenses,
    totalWithdrawn,
    netSaved,
    withdrawalsCount: withdrawals.length,
    remaining,
    paidPercent,
    remainingPercent: Math.max(0, 100 - paidPercent),
    weeksElapsed,
    avgWeeklySavings,
    estimatedTotalWeeks,
    estimatedTotalWeeksTarget,
    remainingWeeks,
    estimatedEndDate: toISODateUTC(endDate),
    onTrack: avgWeeklySavings >= settings.weeklySavingsTarget,
    entriesCount,
  };
}

/** Génère un identifiant temporaire pour une entrée créée hors ligne */
export function localEntryId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const nowISO = () => new Date().toISOString();

/**
 * Applique immédiatement une mutation au cache local (mode optimiste),
 * sur la tranche de la voiture concernée. L'interface se met à jour
 * instantanément, même sans réseau.
 */
export function applyLocal(
  op: Omit<PendingOp, "id" | "ts"> & { payload?: unknown }
): void {
  const v2 = readCacheFull();
  const p = op.payload as Record<string, unknown> | null;
  const carId =
    (typeof p?.carId === "string" && p.carId) ||
    (op.kind === "settings" && (p as AppSettings | null)?.carId) ||
    v2.activeCarId;
  if (!carId) return; // aucune voiture active connue

  const slice: CarCacheSlice = v2.perCar[carId] ?? emptySlice();
  if (!slice.settings) return; // rien à faire si aucune donnée de base

  const settings = slice.settings;
  let weeks = [...slice.weeks];
  let withdrawals = [...slice.withdrawals];
  let cashMovements = [...(slice.cashMovements ?? [])];
  let loans = [...(slice.loans ?? [])];
  let mutateSlice = true;

  switch (op.kind) {
    case "settings": {
      const s = op.payload as AppSettings;
      v2.perCar[carId] = {
        settings: s,
        weeks,
        withdrawals,
        cashMovements,
        loans,
        stats: computeLocalStats(weeks, s, withdrawals),
      };
      writeCacheV2((c) => {
        c.perCar[carId] = v2.perCar[carId];
      });
      return;
    }
    case "week-upsert": {
      const entry = op.payload as WeeklyEntry;
      const idx = weeks.findIndex((w) => w.weekStart.slice(0, 10) === entry.weekStart.slice(0, 10));
      if (idx >= 0) weeks[idx] = { ...entry };
      else weeks = [...weeks, entry];
      weeks.sort(
        (a, b) => new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime()
      );
      break;
    }
    case "week-update": {
      const { id, data } = op.payload as { id: string; data: Partial<WeeklyEntry> };
      weeks = weeks.map((w) => (w.id === id ? { ...w, ...data, updatedAt: nowISO() } : w));
      break;
    }
    case "week-delete": {
      const { id } = op.payload as { id: string };
      weeks = weeks.filter((w) => w.id !== id);
      break;
    }
    case "day-upsert": {
      // Ajout/modification du montant versé UN jour donné (mode calendrier)
      const { weekId, day } = op.payload as {
        weekId: string;
        day: { date: string; savedAmount: number; revenue?: number; expense?: number; note?: string | null };
      };
      const dateKey = day.date.slice(0, 10);
      weeks = weeks.map((w) => {
        if (w.id !== weekId) return w;
        const existing = [...(w.days ?? [])];
        const idx = existing.findIndex((d) => d.date.slice(0, 10) === dateKey);
        const entry: DayEntry = {
          id: idx >= 0 ? existing[idx].id : localEntryId(),
          weekId,
          dayIndex:
            idx >= 0
              ? existing[idx].dayIndex
              : Math.round(
                  (new Date(`${dateKey}T12:00:00.000Z`).getTime() -
                    new Date(w.weekStart).getTime()) /
                    86_400_000
                ),
          date: existing[idx]?.date ?? new Date(`${dateKey}T12:00:00.000Z`).toISOString(),
          revenue: day.revenue ?? 0,
          savedAmount: day.savedAmount,
          expense: day.expense ?? 0,
          note: day.note ?? null,
        };
        if (idx >= 0) existing[idx] = entry;
        else existing.push(entry);
        return { ...w, days: existing };
      });
      break;
    }
    case "day-delete": {
      const { weekId, date } = op.payload as { weekId: string; date: string };
      const dateKey = date.slice(0, 10);
      weeks = weeks.map((w) =>
        w.id === weekId
          ? { ...w, days: (w.days ?? []).filter((d) => d.date.slice(0, 10) !== dateKey) }
          : w
      );
      break;
    }
    case "withdrawal-create": {
      const wd = op.payload as Withdrawal;
      const idx = withdrawals.findIndex((x) => x.id === wd.id);
      if (idx >= 0) withdrawals[idx] = { ...wd };
      else withdrawals = [...withdrawals, wd];
      withdrawals.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      break;
    }
    case "withdrawal-delete": {
      const { id } = op.payload as { id: string };
      withdrawals = withdrawals.filter((x) => x.id !== id);
      break;
    }
    case "cash-create": {
      const m = op.payload as CashMovement;
      const idx = cashMovements.findIndex((x) => x.id === m.id);
      if (idx >= 0) cashMovements[idx] = { ...m };
      else cashMovements = [...cashMovements, m];
      cashMovements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      break;
    }
    case "cash-delete": {
      const { id } = op.payload as { id: string };
      cashMovements = cashMovements.filter((x) => x.id !== id);
      break;
    }
    case "loan-create": {
      const l = op.payload as Loan;
      const idx = loans.findIndex((x) => x.id === l.id);
      if (idx >= 0) loans[idx] = { ...l };
      else loans = [...loans, l];
      loans.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      break;
    }
    case "loan-update": {
      const { id, data } = op.payload as { id: string; data: Partial<Loan> };
      loans = loans.map((l) => (l.id === id ? { ...l, ...data, updatedAt: nowISO() } : l));
      break;
    }
    case "loan-delete": {
      const { id } = op.payload as { id: string };
      loans = loans.filter((x) => x.id !== id);
      break;
    }
    case "car-update": {
      // Soldes de départ (et autres champs voiture) modifiés localement
      const { data } = op.payload as { id: string; data: Partial<AppSettings> };
      const next: AppSettings = { ...settings, ...data };
      v2.perCar[carId] = {
        settings: next,
        weeks,
        withdrawals,
        cashMovements,
        loans,
        stats: computeLocalStats(weeks, next, withdrawals),
      };
      writeCacheV2((c) => {
        c.perCar[carId] = v2.perCar[carId];
      });
      return;
    }
    case "restore": {
      // Restauration hors ligne : on remplit la tranche de la voiture active
      const r = op.payload as {
        settings?: AppSettings;
        weeks?: WeeklyEntry[];
        withdrawals?: Withdrawal[];
        cashMovements?: CashMovement[];
        loans?: Loan[];
        cars?: Array<{ id: string; name: string }>;
        activeCarId?: string;
      };
      const newSettings = r.settings ?? settings;
      writeCacheV2((c) => {
        if (r.cars) c.cars = r.cars;
        if (r.activeCarId) c.activeCarId = r.activeCarId;
        c.perCar[r.activeCarId ?? carId] = {
          settings: newSettings,
          weeks: r.weeks ?? [],
          withdrawals: r.withdrawals ?? [],
          cashMovements: r.cashMovements ?? [],
          loans: r.loans ?? [],
          stats: computeLocalStats(r.weeks ?? [], newSettings, r.withdrawals ?? []),
        };
      });
      return;
    }
    default:
      mutateSlice = true;
  }

  if (!mutateSlice) return;
  const updated: CarCacheSlice = {
    settings,
    weeks,
    withdrawals,
    cashMovements,
    loans,
    stats: computeLocalStats(weeks, settings, withdrawals),
  };
  writeCacheV2((c) => {
    c.perCar[carId] = updated;
  });
}

/* ------------------------------------------------------------------ */
/* Synchronisation (rejeu de la file)                                  */
/* ------------------------------------------------------------------ */

export interface FlushResult {
  flushed: number;
  remaining: number;
}

/**
 * Rejoue toutes les opérations en attente, dans l'ordre chronologique.
 * - succès (2xx) ou 404 (déjà supprimée) → opération retirée ;
 * - 400/422 (donnée invalide) → opération retirée (elle ne passera jamais) ;
 * - échec réseau → on s'arrête et on retentera plus tard.
 */
export async function flushQueue(): Promise<FlushResult> {
  const q = readQueue();
  if (q.length === 0) return { flushed: 0, remaining: 0 };

  const remaining: PendingOp[] = [...q];
  const idMap = new Map<string, string>(); // id local → id serveur
  let flushed = 0;

  for (const op of q) {
    try {
      const ok = await replayOp(op, idMap);
      if (ok) {
        flushed += 1;
        const idx = remaining.findIndex((r) => r.id === op.id);
        if (idx >= 0) remaining.splice(idx, 1);
        writeQueue(remaining);
      } else {
        break; // échec réseau : arrêter, garder le reste dans l'ordre
      }
    } catch {
      break; // échec réseau
    }
  }

  const left = getPendingCount();
  if (flushed > 0) emit(ST_SYNC_EVENT);
  return { flushed, remaining: left };
}

async function replayOp(op: PendingOp, idMap: Map<string, string>): Promise<boolean> {
  switch (op.kind) {
    case "settings": {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op.payload),
      });
      return res.ok;
    }
    case "week-upsert": {
      const entry = op.payload as WeeklyEntry;
      const body = {
        carId: entry.carId || undefined,
        weekStart: entry.weekStart.slice(0, 10),
        weekEnd: entry.weekEnd ? entry.weekEnd.slice(0, 10) : "",
        revenueWeek: entry.revenueWeek,
        savedAmount: entry.savedAmount,
        fuelExpense: entry.fuelExpense,
        maintenanceExpense: entry.maintenanceExpense,
        driverSaturday: entry.driverSaturday,
        otherExpenses: entry.otherExpenses,
        paymentMethod: entry.paymentMethod === "banque" ? "banque" : "especes",
        note: entry.note ?? "",
        days: (entry.days ?? []).map((d) => ({
          date: d.date.slice(0, 10),
          dayIndex: d.dayIndex,
          revenue: d.revenue,
          savedAmount: d.savedAmount,
          expense: d.expense,
          note: d.note ?? "",
        })),
      };
      const res = await fetch("/api/weeks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return res.status < 500; // 4xx : ne bloquera jamais
      const created = (await res.json()) as WeeklyEntry;
      if (entry.id.startsWith("local-") && created?.id) {
        idMap.set(entry.id, created.id);
      }
      return true;
    }
    case "week-update": {
      const { id, data } = op.payload as { id: string; data: Partial<WeeklyEntry> };
      const realId = idMap.get(id) ?? id;
      const res = await fetch(`/api/weeks/${realId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: data.weekStart ? data.weekStart.slice(0, 10) : undefined,
          weekEnd: data.weekEnd !== undefined ? (data.weekEnd ? data.weekEnd.slice(0, 10) : "") : undefined,
          revenueWeek: data.revenueWeek,
          savedAmount: data.savedAmount,
          fuelExpense: data.fuelExpense,
          maintenanceExpense: data.maintenanceExpense,
          driverSaturday: data.driverSaturday,
          otherExpenses: data.otherExpenses,
          paymentMethod: data.paymentMethod,
          note: data.note ?? "",
          days: (data.days ?? []).map((d) => ({
            date: d.date.slice(0, 10),
            dayIndex: d.dayIndex,
            revenue: d.revenue,
            savedAmount: d.savedAmount,
            expense: d.expense,
            note: d.note ?? "",
          })),
        }),
      });
      return res.ok || res.status === 404;
    }
    case "day-upsert": {
      const { weekId, day } = op.payload as {
        weekId: string;
        day: { date: string; savedAmount: number; revenue?: number; expense?: number; note?: string | null };
      };
      const realId = idMap.get(weekId) ?? weekId;
      const res = await fetch(`/api/weeks/${realId}/days`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: day.date.slice(0, 10),
          savedAmount: day.savedAmount,
          revenue: day.revenue ?? 0,
          expense: day.expense ?? 0,
          note: day.note ?? "",
        }),
      });
      return res.ok || res.status === 404;
    }
    case "day-delete": {
      const { weekId, date } = op.payload as { weekId: string; date: string };
      const realId = idMap.get(weekId) ?? weekId;
      const res = await fetch(
        `/api/weeks/${realId}/days?date=${encodeURIComponent(date.slice(0, 10))}`,
        { method: "DELETE" }
      );
      return res.ok || res.status === 404;
    }
    case "week-delete": {
      const { id } = op.payload as { id: string };
      const realId = idMap.get(id) ?? id;
      const res = await fetch(`/api/weeks/${realId}`, { method: "DELETE" });
      return res.ok || res.status === 404;
    }
    case "withdrawal-create": {
      const wd = op.payload as Withdrawal;
      const res = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId: wd.carId || undefined,
          date: wd.date.slice(0, 10),
          amount: wd.amount,
          paymentMethod: wd.paymentMethod === "banque" ? "banque" : "especes",
          note: wd.note ?? "",
        }),
      });
      if (!res.ok) return res.status < 500;
      const created = (await res.json()) as Withdrawal;
      if (wd.id.startsWith("local-") && created?.id) {
        idMap.set(wd.id, created.id);
      }
      return true;
    }
    case "withdrawal-delete": {
      const { id } = op.payload as { id: string };
      const realId = idMap.get(id) ?? id;
      const res = await fetch(`/api/withdrawals/${realId}`, { method: "DELETE" });
      return res.ok || res.status === 404;
    }
    case "cash-create": {
      const m = op.payload as CashMovement;
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId: m.carId || undefined,
          date: m.date.slice(0, 10),
          amount: m.amount,
          mode: m.mode === "banque" ? "banque" : "especes",
          direction: m.direction === "sortie" ? "sortie" : "entree",
          note: m.note ?? "",
        }),
      });
      if (!res.ok) return res.status < 500;
      const created = (await res.json()) as CashMovement;
      if (m.id.startsWith("local-") && created?.id) {
        idMap.set(m.id, created.id);
      }
      return true;
    }
    case "cash-delete": {
      const { id } = op.payload as { id: string };
      const realId = idMap.get(id) ?? id;
      const res = await fetch(`/api/cash/${realId}`, { method: "DELETE" });
      return res.ok || res.status === 404;
    }
    case "loan-create": {
      const l = op.payload as Loan;
      const res = await fetch("/api/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId: l.carId || undefined,
          kind: l.kind === "emprunt" ? "emprunt" : "pret",
          person: l.person,
          amount: l.amount,
          date: l.date.slice(0, 10),
          dueDate: l.dueDate ? l.dueDate.slice(0, 10) : "",
          repaidAmount: l.repaidAmount,
          note: l.note ?? "",
        }),
      });
      if (!res.ok) return res.status < 500;
      const created = (await res.json()) as Loan;
      if (l.id.startsWith("local-") && created?.id) {
        idMap.set(l.id, created.id);
      }
      return true;
    }
    case "loan-update": {
      const { id, data } = op.payload as { id: string; data: Partial<Loan> };
      const realId = idMap.get(id) ?? id;
      const res = await fetch(`/api/loans/${realId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: data.kind,
          person: data.person,
          amount: data.amount,
          date: data.date ? data.date.slice(0, 10) : undefined,
          dueDate:
            data.dueDate !== undefined ? (data.dueDate ? data.dueDate.slice(0, 10) : "") : undefined,
          repaidAmount: data.repaidAmount,
          note: data.note ?? "",
        }),
      });
      return res.ok || res.status === 404;
    }
    case "loan-delete": {
      const { id } = op.payload as { id: string };
      const realId = idMap.get(id) ?? id;
      const res = await fetch(`/api/loans/${realId}`, { method: "DELETE" });
      return res.ok || res.status === 404;
    }
    case "car-update": {
      const { id, data } = op.payload as { id: string; data: Record<string, unknown> };
      const realId = idMap.get(id) ?? id;
      const res = await fetch(`/api/cars/${realId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.ok || res.status === 404;
    }
    case "restore": {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(op.payload),
      });
      return res.ok;
    }
  }
}
