/**
 * Accès multi-appareils (côté navigateur) — v2.
 * ------------------------------------------------------------------
 * L'authentification est décidée par le SERVEUR via une session en base
 * (cookie HttpOnly « isz_session » posé à la connexion). Le navigateur ne
 * stocke ni code ni preuve falsifiable : seul un marqueur « cet appareil
 * a déjà eu un accès légitime » est conservé localement, uniquement pour
 * autoriser le mode hors-ligne (données du cache) quand le serveur est
 * injoignable.
 */

const ACCESS_KEY = "isztransport-access-v2";

function readHadAccess(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ACCESS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHadAccess(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(ACCESS_KEY, "1");
    else window.localStorage.removeItem(ACCESS_KEY);
    // Ancienne clé v1 (stamp falsifiable) : nettoyage
    window.localStorage.removeItem("isztransport-access-v1");
  } catch {
    // Stockage indisponible (navigation privée) : mode hors-ligne limité
  }
}

/** Cet appareil a-t-il déjà eu un accès légitime (usage hors ligne) ? */
export function deviceHadAccess(): boolean {
  return readHadAccess();
}

/** Marque cet appareil comme ayant eu un accès légitime */
export function markHadAccess() {
  writeHadAccess(true);
}

/** Oublie la preuve d'accès locale (déconnexion, session expirée…) */
export function forgetDevice() {
  writeHadAccess(false);
}

export type AccessState = "open" | "locked" | "setup";

/**
 * Vérifie l'état de l'authentification auprès du serveur :
 *  - « setup » : aucun code d'accès défini → l'écran de création s'affiche ;
 *  - « locked » : un code est défini mais cet appareil n'a pas de session
 *    valide → l'écran de connexion s'affiche ;
 *  - « open » : session valide (ou serveur injoignable mais cet appareil
 *    avait déjà eu un accès → mode hors-ligne avec les données du cache).
 */
export async function checkAccess(): Promise<AccessState> {
  try {
    const res = await fetch("/api/auth", { cache: "no-store" });
    if (!res.ok) throw new Error("auth");
    const data = (await res.json()) as {
      locked: boolean;
      unlocked: boolean;
      needsSetup: boolean;
    };
    if (data.needsSetup) return "setup";
    if (!data.unlocked) return "locked";
    markHadAccess();
    return "open";
  } catch {
    // Serveur injoignable (hors ligne) : on ne rouvre que si cet appareil
    // avait déjà eu un accès légitime — sinon écran de connexion.
    return readHadAccess() ? "open" : "locked";
  }
}
