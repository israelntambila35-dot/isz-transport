/**
 * Authentification « ISZTRANSPORT » (côté serveur) — v2 sécurisée.
 * ------------------------------------------------------------------
 * L'application est privée et individuelle : le propriétaire définit un
 * code d'accès personnel qui protège ses données sur TOUS les appareils.
 *
 * Sécurité (renforcée par rapport à la v1) :
 *  - Le code n'est JAMAIS stocké en clair ni sous forme de hash rapide :
 *    scrypt (sel aléatoire de 16 octets, clé de 64 octets) — coûteux à
 *    brute-forcer même si la base fuit. Les anciens hash SHA-256 restent
 *    acceptés puis automatiquement re-hachés en scrypt à la connexion.
 *  - La connexion crée une SESSION en base (AuthSession) : le navigateur
 *    reçoit uniquement un jeton aléatoire opaque (cookie HttpOnly
 *    « isz_session », 60 jours). Le cookie ne contient NI le code NI son
 *    hash — voler le cookie ne permet pas de deviner le code, et le jeton
 *    est révocable côté serveur (déconnexion, changement de code).
 *  - Chaque route de données appelle guardAccess() : si un code est actif
 *    et que la session est absente/expire → 401 (écran de connexion).
 *  - Anti force brute : 5 codes erronés par IP → verrouillage de 5
 *    minutes (réponse 429 avec le délai restant).
 *  - Changer le code révoque TOUTES les sessions : les autres appareils
 *    doivent se reconnecter avec le nouveau code.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "isz_session";
/** Ancien cookie v1 (contenait le hash) : supprimé à la première connexion */
const LEGACY_COOKIE = "isz_access";

const SESSION_DAYS = 60;
const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/** Ancien sel fixe v1 — sert uniquement à valider les anciens hash */
const LEGACY_SALT = "isztransport::v1::";

/* ------------------------------------------------------------------ */
/* Hachage du code d'accès                                             */
/* ------------------------------------------------------------------ */

/** Hash scrypt d'un code (format « scrypt$<salt>$<key> ») */
export function hashPassword(code: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(code, salt, 64).toString("hex");
  return `scrypt$${salt}$${key}`;
}

/** Ancien hash v1 (SHA-256 + sel fixe) — migration uniquement */
function legacyHash(code: string): string {
  return createHash("sha256").update(LEGACY_SALT + code).digest("hex");
}

/** Comparaison à temps constant de deux buffers */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Vérifie un code contre le hash stocké (scrypt ou ancien SHA-256).
 * Retourne true si le code est correct ; `upgraded` indique qu'un ancien
 * hash a été re-haché en scrypt (à persister).
 */
export function verifyCode(code: string, stored: string): { ok: boolean; upgraded: boolean } {
  try {
    if (stored.startsWith("scrypt$")) {
      const [, salt, key] = stored.split("$");
      if (!salt || !key) return { ok: false, upgraded: false };
      const candidate = scryptSync(code, salt, 64).toString("hex");
      return { ok: safeEqual(candidate, key), upgraded: false };
    }
    // Ancien format v1 : SHA-256 rapide → correct ? → à migrer en scrypt
    const ok = safeEqual(legacyHash(code), stored);
    return { ok, upgraded: ok };
  } catch {
    return { ok: false, upgraded: false };
  }
}

/** Validation d'un nouveau code (4 à 64 caractères) */
export function validateCode(code: unknown): code is string {
  return (
    typeof code === "string" &&
    code.length >= 4 &&
    code.length <= 64 &&
    code.trim().length === code.length
  );
}

/* ------------------------------------------------------------------ */
/* État du verrou (Settings)                                           */
/* ------------------------------------------------------------------ */

/** État du verrou lu depuis Settings (jamais le hash lui-même) */
export async function getAccessState() {
  const settings = await db.settings.findUnique({ where: { id: "settings" } });
  const hash = settings?.accessCodeHash ?? null;
  return {
    hash,
    locked: Boolean(hash),
    codeUpdatedAt: settings?.accessCodeUpdatedAt
      ? settings.accessCodeUpdatedAt.toISOString()
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Sessions en base (jetons opaques)                                   */
/* ------------------------------------------------------------------ */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Nettoie les sessions expirées (appelé opportunistement) */
export async function purgeExpiredSessions(): Promise<void> {
  try {
    await db.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch {
    /* non bloquant */
  }
}

/** Crée une session (60 jours) et retourne le jeton opaque à mettre en cookie */
export async function createSession(): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.authSession.create({
    data: { id: hashToken(token), expiresAt },
  });
  // Housekeeping : profite de la connexion pour purger les expirées
  await purgeExpiredSessions();
  return { token, expiresAt };
}

/** Lit le jeton de session d'une requête */
function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * La requête a-t-elle une session valide ?
 * (toujours true si aucun code d'accès n'est actif)
 */
export async function requestHasAccess(request: Request, hash: string | null): Promise<boolean> {
  if (!hash) return true;
  const token = readSessionToken(request);
  if (!token) return false;
  try {
    const session = await db.authSession.findUnique({ where: { id: hashToken(token) } });
    if (!session) return false;
    if (session.expiresAt.getTime() < Date.now()) {
      await db.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Supprime la session de cette requête (déconnexion) */
export async function destroySession(request: Request): Promise<void> {
  const token = readSessionToken(request);
  if (!token) return;
  try {
    await db.authSession.delete({ where: { id: hashToken(token) } });
  } catch {
    /* session déjà inconnue */
  }
}

/** Révoque toutes les sessions (changement de code → tous les appareils) */
export async function destroyAllSessions(): Promise<void> {
  try {
    await db.authSession.deleteMany({});
  } catch {
    /* non bloquant */
  }
}

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */

/** Cookie de session posé après une connexion réussie */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/** Options pour supprimer les cookies d'accès (session + ancien v1) */
export function clearAuthCookies(res: NextResponse): void {
  const past = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 0 };
  res.cookies.set(SESSION_COOKIE, "", past);
  res.cookies.set(LEGACY_COOKIE, "", past);
}

/* ------------------------------------------------------------------ */
/* Anti force brute (par IP, en mémoire)                               */
/* ------------------------------------------------------------------ */

const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;
const attempts = new Map<string, { count: number; lockUntil: number }>();

/** IP client (derrière le proxy) */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

/** Verrouillé ? → { locked, retryAfter (secondes) } */
export function checkRateLimit(ip: string): { locked: boolean; retryAfter: number } {
  const entry = attempts.get(ip);
  if (entry && entry.lockUntil > Date.now()) {
    return { locked: true, retryAfter: Math.ceil((entry.lockUntil - Date.now()) / 1000) };
  }
  return { locked: false, retryAfter: 0 };
}

/** Tentatives restantes avant verrouillage (0 = verrouillé) */
export function failuresLeft(ip: string): number {
  const entry = attempts.get(ip);
  if (!entry) return MAX_ATTEMPTS;
  if (entry.lockUntil > Date.now()) return 0;
  return Math.max(0, MAX_ATTEMPTS - entry.count);
}

/** Enregistre un code erroné ; déclenche le verrou au-delà de MAX_ATTEMPTS */
export function recordFailure(ip: string): void {
  const now = Date.now();
  // purge légère des vieilles entrées
  if (attempts.size > 500) {
    for (const [k, v] of attempts) {
      if (v.lockUntil < now && v.count === 0) attempts.delete(k);
    }
  }
  const entry = attempts.get(ip) ?? { count: 0, lockUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockUntil = now + LOCK_MS;
    entry.count = 0;
  }
  attempts.set(ip, entry);
}

/** Réinitialise le compteur après une connexion réussie */
export function clearFailures(ip: string): void {
  attempts.delete(ip);
}

/* ------------------------------------------------------------------ */
/* Garde des routes de données                                         */
/* ------------------------------------------------------------------ */

/** Réponse 401 standard quand le code est requis */
function unauthorized() {
  return NextResponse.json(
    {
      error: "Espace privé : connectez-vous avec votre code d'accès.",
      locked: true,
    },
    { status: 401 }
  );
}

/**
 * Garde-fou à appeler au début de chaque route API de données.
 * Retourne null si l'accès est autorisé, sinon une réponse 401 prête à
 * être renvoyée.
 */
export async function guardAccess(request: Request): Promise<NextResponse | null> {
  const { hash } = await getAccessState();
  if (!(await requestHasAccess(request, hash))) return unauthorized();
  return null;
}
