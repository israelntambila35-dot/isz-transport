# ISZTRANSPORT

Application privée de gestion pour voiture de transport (taxi) : versements
journaliers du chauffeur, calendrier des semaines, caisse espèces & banque,
retraits, prêts & emprunts, rapports et sauvegarde — avec code d'accès personnel,
mode hors-ligne et installation PWA sur téléphone.

## Fonctionnalités

- **Tableau de bord** : prix de la voiture, épargne disponible, reste à rembourser, caisse
- **Calendrier** : semaines créées au clic, versement saisi jour par jour
- **Historique** : registre fusionné (semaines, retraits, prêts) groupé par mois
- **Retraits** : date, montant, motif, source (espèces ou banque), solde restant
- **Caisse** : soldes manuels espèces/banque, mouvements libres, détail hebdomadaire
- **Prêts & emprunts** : suivi des remboursements et échéances
- **Rapports** : graphique mensuel (versements vs dépenses & retraits fusionnés), CSV, PDF
- **Sécurité** : code d'accès haché, sessions 60 jours, anti force brute
- **PWA hors-ligne** : file d'attente des saisies sans réseau, synchronisation au retour

## Démarrage (développement)

```bash
bun install
bun run db:push     # crée la base SQLite
bun run dev         # http://localhost:3000
```

## Déploiement longue durée

Voir **[DEPLOIEMENT.md](./DEPLOIEMENT.md)** : guide complet en français pour mettre le
site en ligne durablement (Railway, Render, Fly.io ou VPS avec Docker), avec disque
persistant pour la base, HTTPS automatique et mises à jour sans perte de données.

```bash
docker compose up -d --build   # déploiement Docker en une commande
```

## Sauvegarde

- **Automatique intégrée** : *Paramètres → Sauvegarde & restauration* (JSON export/import)
- **Fichier brut** : la base est `db/custom.db` en local, `/data/custom.db` en production

## Stack

Next.js 16 (App Router, sortie standalone) · TypeScript · Tailwind CSS 4 · shadcn/ui ·
Prisma + SQLite · PWA (service worker) · Recharts
