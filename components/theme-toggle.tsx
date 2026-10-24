"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/** Détecte la fin de l'hydratation sans setState dans un effet */
const emptySubscribe = () => () => {};
const useIsHydrated = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useIsHydrated();

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  // Évite tout décalage d'hydratation : l'icône définitive ne s'affiche qu'après le montage
  if (!hydrated) {
    return (
      <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" aria-label="Changer de thème" disabled>
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-10 w-10 shrink-0"
      onClick={toggle}
      aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
      title={isDark ? "Mode clair" : "Mode sombre"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
