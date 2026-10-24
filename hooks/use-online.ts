"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  flushQueue,
  getPendingCount,
  ST_PENDING_EVENT,
  ST_SYNC_EVENT,
} from "@/lib/offline";

/** Abonnement aux changements de connexion (navigator.onLine) */
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Abonnement aux changements de la file d'attente hors-ligne */
function subscribePending(onChange: () => void) {
  window.addEventListener(ST_PENDING_EVENT, onChange);
  return () => window.removeEventListener(ST_PENDING_EVENT, onChange);
}

/**
 * État de connexion + file d'attente de synchronisation.
 * La file est automatiquement rejouée au retour de la connexion.
 */
export function useOnlineStatus() {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  );

  const pending = useSyncExternalStore(
    subscribePending,
    () => getPendingCount(),
    () => 0
  );

  const [syncing, setSyncing] = useState(false);

  // Rejoue automatiquement la file au retour de la connexion
  useEffect(() => {
    if (!navigator.onLine) return;
    void runSync();
  }, [online]);

  const syncNow = useCallback(async () => {
    await runSync();
  }, []);

  return { online, pending, syncing, syncNow };
}

async function runSync(): Promise<void> {
  if (getPendingCount() === 0) return;
  try {
    await flushQueue();
  } finally {
    window.dispatchEvent(new Event(ST_SYNC_EVENT));
  }
}
