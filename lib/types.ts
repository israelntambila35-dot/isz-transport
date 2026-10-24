/**
 * Types partagés entre le frontend et les routes API.
 */

/** Mode d'encaissement / de retrait de l'argent */
export type PaymentMethod = "especes" | "banque";

/** Un compte voiture géré par le propriétaire (application privée individuelle) */
export interface Car {
  id: string;
  name: string;
  carPriceUsd: number;
  exchangeRate: number;
  dailyRevenue: number;
  activeDaysPerWeek: number;
  weeklySavingsTarget: number;
  startDate: string; // ISO
  openingEspeces: number; // Solde de départ en espèces (caisse) — FC
  openingBanque: number; // Solde de départ en banque — FC
  createdAt: string;
  updatedAt: string;
}

/** Voiture avec compteurs (liste du sélecteur) */
export interface CarWithCounts extends Car {
  weeksCount: number;
  withdrawalsCount: number;
}

/** Paramètres de la voiture active (valeurs par défaut = exemple du cahier des charges) */
export interface AppSettings {
  carId: string; // Voiture concernée
  carName: string; // Nom de la voiture active
  carPriceUsd: number; // Prix d'achat de la voiture en USD
  exchangeRate: number; // Taux de change : 1 USD = X FC
  dailyRevenue: number; // Recette versée par jour ouvré (FC)
  activeDaysPerWeek: number; // Jours actifs d'épargne par semaine (lundi-vendredi = 5)
  weeklySavingsTarget: number; // Épargne hebdomadaire cible (FC)
  startDate: string; // Date de début du projet (ISO)
  openingEspeces: number; // Solde de départ en espèces (caisse) — FC
  openingBanque: number; // Solde de départ en banque — FC
}

/** Détail d'un jour individuel à l'intérieur d'une semaine (ex : mardi 17) */
export interface DayEntry {
  id: string;
  weekId: string;
  dayIndex: number; // 0 = lundi … 6 = dimanche
  date: string; // Date réelle du jour (ISO)
  revenue: number; // Recette du jour (FC)
  savedAmount: number; // Épargne du jour (FC)
  expense: number; // Dépense du jour (FC)
  note?: string | null;
}

/** Une semaine de saisie (début et fin choisis par l'utilisateur sur le calendrier) */
export interface WeeklyEntry {
  id: string;
  carId: string; // Voiture concernée
  weekStart: string; // Jour de début (ISO)
  weekEnd?: string | null; // Jour de fin choisi (ISO) — sinon début + 6 jours
  revenueWeek: number; // Recette encaissée dans la semaine (FC)
  savedAmount: number; // Montant versé par le chauffeur (total direct, sans détail par jour)
  fuelExpense: number; // Dépenses carburant (FC)
  maintenanceExpense: number; // Dépenses entretien (FC)
  driverSaturday: number; // Montant donné au chauffeur samedi (FC)
  otherExpenses: number; // Autres dépenses (FC)
  paymentMethod: PaymentMethod; // Encaissé en espèces ou en banque
  note?: string | null;
  days?: DayEntry[]; // Montants versés jour par jour (le 16, le 17, le 18…)
  createdAt: string;
  updatedAt: string;
}

/** Retrait d'argent à une date précise (déduit de l'épargne) */
export interface Withdrawal {
  id: string;
  carId: string; // Voiture concernée
  date: string; // ISO
  amount: number; // Montant retiré (FC)
  paymentMethod: PaymentMethod; // Pris en espèces (caisse) ou en banque
  note?: string | null;
  createdAt: string;
}

/** Mouvement manuel de caisse : ajout (entrée) ou sortie d'argent hors suivi des versements/retraits */
export type CashDirection = "entree" | "sortie";

export interface CashMovement {
  id: string;
  carId: string; // Voiture concernée
  date: string; // ISO
  mode: PaymentMethod; // Compte concerné : espèces (caisse) ou banque
  direction: CashDirection; // Entrée (ajout) ou sortie (argent sorti)
  amount: number; // Montant (FC), toujours positif
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Prêt (argent donné) ou emprunt (argent reçu), avec suivi des remboursements */
export type LoanKind = "pret" | "emprunt";

export interface Loan {
  id: string;
  carId: string; // Voiture concernée
  kind: LoanKind; // Prêt à quelqu'un ou emprunt de quelqu'un
  person: string; // Nom de la personne
  amount: number; // Montant (FC), toujours positif
  date: string; // ISO
  dueDate?: string | null; // Échéance (facultative, ISO)
  repaidAmount: number; // Total remboursé à ce jour (FC)
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Réponse de la route /api/stats : tous les calculs du tableau de bord */
export interface StatsResponse {
  // Prix de la voiture
  carPriceFc: number;
  carPriceUsd: number;
  exchangeRate: number;

  // Totaux cumulés
  totalSaved: number;
  totalRevenue: number;
  totalFuel: number;
  totalMaintenance: number;
  totalDriver: number;
  totalOther: number;
  totalExpenses: number;

  // Retraits (argent sorti de l'épargne)
  totalWithdrawn: number; // Somme de tous les retraits (FC)
  netSaved: number; // Épargne disponible = totalSaved − totalWithdrawn
  withdrawalsCount: number; // Nombre de retraits

  // Remboursement (basé sur l'épargne NETTE)
  remaining: number; // Reste à rembourser (FC) = prix − épargne nette
  paidPercent: number; // Pourcentage remboursé (0-100)
  remainingPercent: number;

  // Temps estimé
  weeksElapsed: number; // Semaines écoulées depuis le début
  avgWeeklySavings: number; // Épargne hebdomadaire moyenne réelle
  estimatedTotalWeeks: number; // Semaines totales estimées (moyenne réelle)
  estimatedTotalWeeksTarget: number; // Semaines totales si objectif respecté (70.5)
  remainingWeeks: number; // Semaines restantes estimées
  estimatedEndDate: string; // Date de fin estimée (ISO)
  onTrack: boolean; // Épargne moyenne >= objectif ?

  // Nombre de semaines enregistrées
  entriesCount: number;
}
