import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  checkRateLimit,
  clearAuthCookies,
  clearFailures,
  clientIp,
  createSession,
  destroyAllSessions,
  destroySession,
  failuresLeft,
  getAccessState,
  hashPassword,
  purgeExpiredSessions,
  recordFailure,
  requestHasAccess,
  sessionCookieOptions,
  validateCode,
  verifyCode,
} from "@/lib/auth-server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth — état de l'authentification pour cet appareil.
 *  { locked, unlocked, needsSetup, codeUpdatedAt } — le hash n'est jamais exposé.
 *  - needsSetup : aucun code défini → l'interface affiche l'écran de création.
 *  - unlocked   : une session valide est active sur cet appareil.
 */
export async function GET(request: Request) {
  try {
    const { hash, locked, codeUpdatedAt } = await getAccessState();
    if (locked) await purgeExpiredSessions();
    const unlocked = await requestHasAccess(request, hash);
    return NextResponse.json({
      locked,
      unlocked: unlocked || !locked,
      needsSetup: !locked,
      codeUpdatedAt,
    });
  } catch (error) {
    console.error("GET /api/auth:", error);
    return NextResponse.json(
      { error: "Impossible de vérifier l'état du verrou." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth — actions :
 *  - { action: "verify", code } → connexion (crée une session de 60 jours)
 *  - { action: "set", code }                → crée le code (première fois)
 *  - { action: "set", code, currentCode }   → change le code (session requise)
 *  - { action: "logout" }                   → déconnecte cet appareil
 *
 * Sécurité : 5 codes erronés par IP → verrouillage 5 minutes (429).
 * Changer le code révoque toutes les sessions (autres appareils inclus).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body?.action;
    const { hash } = await getAccessState();
    const ip = clientIp(request);

    // --- Connexion (vérification du code) ---
    if (action === "verify") {
      if (!hash) {
        // Aucun verrou actif : rien à vérifier (l'interface passe à l'activation)
        return NextResponse.json({ ok: true, needsSetup: true, codeUpdatedAt: null });
      }

      const limit = checkRateLimit(ip);
      if (limit.locked) {
        return NextResponse.json(
          {
            error: `Trop de tentatives. Réessayez dans ${formatDelay(limit.retryAfter)}.`,
            retryAfter: limit.retryAfter,
          },
          { status: 429 }
        );
      }

      if (typeof body.code !== "string") {
        return NextResponse.json({ ok: false, error: "Code incorrect." }, { status: 400 });
      }

      const { ok, upgraded } = verifyCode(body.code, hash);
      if (!ok) {
        recordFailure(ip);
        const left = failuresLeft(ip);
        // Verrou déclenché par cette tentative → 429 avec le délai complet
        if (left === 0) {
          const retryAfter = checkRateLimit(ip).retryAfter || 300;
          return NextResponse.json(
            {
              ok: false,
              error: `Trop de tentatives. Réessayez dans ${formatDelay(retryAfter)}.`,
              retryAfter,
            },
            { status: 429 }
          );
        }
        return NextResponse.json(
          {
            ok: false,
            error:
              left <= 2
                ? `Code incorrect. ${left} tentative${left > 1 ? "s" : ""} avant verrouillage de 5 minutes.`
                : "Code incorrect.",
          },
          { status: 400 }
        );
      }

      clearFailures(ip);

      // Migration automatique : ancien hash SHA-256 → scrypt
      if (upgraded) {
        await db.settings
          .update({ where: { id: "settings" }, data: { accessCodeHash: hashPassword(body.code) } })
          .catch(() => undefined);
      }

      // Nouvelle session (60 jours) posée en cookie HttpOnly opaque
      const { token, expiresAt } = await createSession();
      const res = NextResponse.json({
        ok: true,
        codeUpdatedAt: (await getAccessState()).codeUpdatedAt,
      });
      res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
      return res;
    }

    // --- Création / changement du code ---
    if (action === "set") {
      if (!validateCode(body.code)) {
        return NextResponse.json(
          { error: "Le code doit contenir entre 4 et 64 caractères (sans espaces aux extrémités)." },
          { status: 400 }
        );
      }

      if (hash) {
        // Changement : appareil déjà connecté + ancien code obligatoire
        const authed = await requestHasAccess(request, hash);
        if (!authed) {
          return NextResponse.json(
            { error: "Session expirée : reconnectez-vous pour changer le code." },
            { status: 401 }
          );
        }
        const limit = checkRateLimit(ip);
        if (limit.locked) {
          return NextResponse.json(
            {
              error: `Trop de tentatives. Réessayez dans ${formatDelay(limit.retryAfter)}.`,
              retryAfter: limit.retryAfter,
            },
            { status: 429 }
          );
        }
        const { ok } = verifyCode(String(body.currentCode ?? ""), hash);
        if (!ok) {
          recordFailure(ip);
          return NextResponse.json({ error: "Code actuel incorrect." }, { status: 400 });
        }
        clearFailures(ip);
      }

      const now = new Date();
      const newHash = hashPassword(body.code);

      // Le changement de code révoque toutes les sessions existantes
      await destroyAllSessions();
      await db.settings.update({
        where: { id: "settings" },
        data: { accessCodeHash: newHash, accessCodeUpdatedAt: now },
      });

      // Nouvelle session immédiate pour CET appareil
      const { token, expiresAt } = await createSession();
      const res = NextResponse.json({
        ok: true,
        codeUpdatedAt: now.toISOString(),
        message: hash ? "Code d'accès modifié." : "Code d'accès créé.",
      });
      res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
      return res;
    }

    // --- Déconnexion de cet appareil ---
    if (action === "logout") {
      await destroySession(request);
      const res = NextResponse.json({ ok: true });
      clearAuthCookies(res);
      return res;
    }

    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    console.error("POST /api/auth:", error);
    return NextResponse.json(
      { error: "Impossible de traiter la demande." },
      { status: 500 }
    );
  }
}

/** Format lisible d'un délai en secondes */
function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} min ${s.toString().padStart(2, "0")} s` : `${m} min`;
}
