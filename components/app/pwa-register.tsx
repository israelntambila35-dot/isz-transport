"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Enregistre le service worker et rejoue la file d'attente hors-ligne
 * au démarrage. Composant invisible, à monter une seule fois.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js");
      } catch {
        /* l'app fonctionne aussi sans SW (navigation en ligne) */
      }
    };
    void register();

    // Rejoue la file au démarrage si en ligne et des opérations attendent
    if (navigator.onLine) {
      void import("@/lib/offline").then(({ flushQueue, getPendingCount }) => {
        if (getPendingCount() > 0) void flushQueue();
      });
    }
  }, []);

  return null;
}

/**
 * Propose le bouton « Installer l'application » quand le navigateur
 * le permet (beforeinstallprompt). Après installation, l'app s'ouvre
 * comme une vraie application, hors ligne comprise.
 */
export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedByEvent, setInstalledByEvent] = useState(false);

  // L'app tourne-t-elle déjà en mode application installée ?
  const standalone = useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(display-mode: standalone)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(display-mode: standalone)").matches,
    () => false
  );
  const installed = standalone || installedByEvent;

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const installedHandler = () => {
      setInstalledByEvent(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setInstalledByEvent(true);
    setPromptEvent(null);
  }, [promptEvent]);

  return { canInstall: promptEvent !== null, installed, install };
}
