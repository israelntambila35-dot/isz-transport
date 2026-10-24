# Déployer ISZTRANSPORT pour une utilisation longue durée

Votre application est prête à tourner **24 h/24, tous les jours**, sur Internet avec
votre propre adresse (HTTPS + installation PWA sur vos téléphones). Ce guide vous
donne les étapes exactes — comptez **15 à 30 minutes**.

---

## ⚠️ Important : à savoir avant de commencer

1. **L'aperçu actuel (panneau de prévisualisation) est temporaire** : c'est un bac à
   sable de développement. Pour une utilisation réelle sur plusieurs téléphones, il
   faut héberger le site sur un service en ligne avec votre propre compte.

2. **Pourquoi pas Firebase tel quel ?** Firebase Hosting héberge des pages statiques,
   et Firebase App Hosting exécute Next.js sur des serveurs *sans disque permanent* :
   la base **SQLite** (fichier `db/custom.db`) serait **effacée à chaque
   redémarrage** — vos versements, retraits et prêts seraient perdus. Utiliser
   Firebase obligerait à migrer la base vers Firestore/PostgreSQL (gros chantier).
   Les options ci-dessous gardent l'application **exactement identique**, avec
   disque persistant, pour quelques euros par mois (et souvent gratuitement au
   début). Si vous tenez absolument à Firebase, il faudra d'abord migrer la base
   vers PostgreSQL (Neon) — contactez-moi et je le ferai.

3. **Vos données restent les vôtres** : la base est un simple fichier SQLite. Le
   dossier `data/` (ou le volume de la plateforme) contient tout. Sauvegardez-le,
   et utilisez aussi la sauvegarde JSON intégrée (*Paramètres → Sauvegarde &
   restauration*).

---

## Option A — Railway (recommandé : le plus simple)

Railway détecte le `Dockerfile` tout seul et fournit HTTPS + nom de domaine.

1. Créez un compte gratuit sur **[railway.com](https://railway.com)**.
2. Installez **Git** si besoin, puis publiez le projet sur **GitHub** :
   ```bash
   git init
   git add .
   git commit -m "ISZTRANSPORT prêt pour le déploiement"
   # créez un dépôt « isztransport » sur github.com puis :
   git remote add origin https://github.com/VOTRE-COMPTE/isztransport.git
   git push -u origin main
   ```
3. Sur Railway : **New Project → Deploy from GitHub repo** → choisissez `isztransport`.
4. Une fois le service créé : onglet **Variables** → ajoutez
   `DATABASE_URL = file:/data/custom.db`.
5. Onglet **Settings → Volumes** → **New Volume** → monter `/data` (taille 1 Go suffit
   largement).
6. Onglet **Settings → Networking → Generate Domain** → vous obtenez
   `https://isztransport-….up.railway.app` : **c'est votre adresse définitive**.

Coût : essai gratuit, puis ~5 $/mois (Hobby). Mises à jour : chaque `git push`
redéploie automatiquement.

## Option B — Render

1. Compte gratuit sur **[render.com](https://render.com)** → **New → Web Service**.
2. Connectez votre dépôt GitHub (étapes 2 de l'option A).
3. Rendu détecte le `Dockerfile`. Réglez :
   - **Instance type** : Starter (les gratuits s'endorment et perdent l'accès disque) ;
   - **Environment variable** : `DATABASE_URL=file:/var/data/custom.db` ;
   - **Persistent Disk** : monté sur `/var/data`, 1 Go.
4. **Create Web Service** → adresse HTTPS fournie.

## Option C — Fly.io

1. Installez le CLI : `curl -L https://fly.io/install.sh | sh` puis `fly auth signup`.
2. Dans le dossier du projet :
   ```bash
   fly launch --no-deploy          # détecte le Dockerfile ; n'ajoutez pas de base Postgres
   fly volumes create iszdata --size 1   # disque persistant
   fly deploy
   ```
3. Ajoutez le secret si nécessaire : `fly secrets set DATABASE_URL=file:/data/custom.db`.
4. Adresse fournie : `https://VOTRE-APP.fly.dev`.

## Option D — VPS ou ordinateur personnel (Docker)

N'importe quelle machine Linux (OVH, Contabo, Raspberry Pi, votre PC…).

```bash
# sur la machine, dans le dossier du projet :
docker compose up -d --build
```

Le site tourne sur le port 3000. Pour un accès extérieur : ouvrez/redirigez le port
de votre box, ou placez un reverse proxy (Caddy, Nginx) avec un domaine + HTTPS.

> 💡 Astuce maison : le `docker-compose.yml` range la base dans **./data** —
> sauvegarder le site = copier ce dossier.

---

## Après le déploiement — 3 minutes

1. Ouvrez l'adresse HTTPS fournie : l'écran **« Créer votre code d'accès »** s'affiche
   (c'est l'espace privé) — choisissez un code solide et mémorisable.
2. Restaurez vos données si besoin : *Paramètres → Sauvegarde & restauration →
   Restaurer un fichier…* (fichier JSON téléchargé depuis l'aperçu actuel).
3. Sur chaque téléphone : ouvrez l'adresse → menu du navigateur → **« Installer
   l'application »** (PWA). Le mode hors-ligne fonctionne ensuite comme d'habitude.

## Mots de passe / sécurité

- Le code d'accès est stocké **haché** (jamais en clair) côté serveur ; les sessions
  durent 60 jours par appareil ; 5 codes erronés = verrouillage 5 minutes.
- Pour changer de code : *Paramètres → Sécurité & code d'accès* (déconnecte tous
  les appareils).
- Toutes les plateformes ci-dessus fournissent **HTTPS automatiquement** —
  indispensable pour la PWA.

## Mettre à jour le site plus tard

```bash
git add . && git commit -m "Mise à jour" && git push   # Railway/Render redéploient seuls
# Fly.io :   fly deploy        # VPS :  docker compose up -d --build
```

Les données ne sont **pas** touchées par les mises à jour : elles vivent dans le
volume persistant, séparé de l'application.
