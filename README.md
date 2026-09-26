# Tournoi poule

**Collège Yves du Manoir de Vaucresson** · © 2026 Eude Florian

Application web pour organiser des tournois par poules en cours d'EPS : import des classes, niveaux en étoiles, poules homogènes ou équilibrées, mixtes ou non, rencontres « tout le monde se rencontre », rôles (arbitre, coach, observateur…), classement en direct avec bonus/malus fair-play, saisie sur tablettes, historique et montées/descentes d'une séance à l'autre.

Hébergement gratuit : **GitHub Pages** pour le site, **Firebase** (offre Spark, sans carte bancaire) pour la base de données et la connexion.

---

## 1. Créer le projet Firebase (10 minutes)

1. Va sur <https://console.firebase.google.com> et connecte-toi avec ton compte Google.
2. **Ajouter un projet** → donne un nom (ex. `tournoi-poule`) → tu peux désactiver Google Analytics → Créer.
3. **Authentification** (menu Créer > Authentication) → Commencer → onglet *Sign-in method* :
   - active **Google** (choisis ton adresse comme e-mail d'assistance) ;
   - active **Anonyme** (c'est ce qu'utilisent les tablettes des élèves).
4. **Base de données** (menu Créer > Firestore Database) → Créer une base de données → choisis un emplacement en Europe (ex. `eur3` ou `europe-west9 (Paris)`) → démarrer en **mode production**.
5. Dans Firestore, onglet **Règles** : remplace tout le contenu par celui du fichier `firestore.rules` fourni, puis **Publier**.
6. Roue dentée ⚙️ > **Paramètres du projet** > en bas, *Vos applications* → icône **Web `</>`** → donne un nom → **Enregistrer** (pas besoin de Firebase Hosting).
7. Firebase affiche un bloc `const firebaseConfig = { … }`. Copie les valeurs dans le fichier **`js/firebase-config.js`** à la place des `A_REMPLACER`.

## 2. Mettre le site en ligne avec GitHub Pages

1. Crée un compte sur <https://github.com> si besoin, puis **New repository** (ex. `tournoi-poule`), en **Public**.
2. **Add file > Upload files** : dépose tout le contenu du dossier (`index.html`, dossiers `css` et `js`, etc.) → *Commit changes*.
3. Dans le dépôt : **Settings > Pages** → *Source* : `Deploy from a branch` → branche `main`, dossier `/ (root)` → Save.
4. Après une minute, l'adresse s'affiche : `https://TON-PSEUDO.github.io/tournoi-poule/`.
5. **Important** : retourne dans Firebase > Authentication > **Paramètres** > *Domaines autorisés* → **Ajouter un domaine** → `TON-PSEUDO.github.io`.

C'est prêt. Chaque collègue ouvre la même adresse et se connecte avec **son propre compte Google** : il ne voit que ses classes et son historique.

> La clé `apiKey` visible dans `firebase-config.js` n'est pas un secret : c'est normal pour une appli web Firebase. La protection est assurée par les règles de sécurité.

## 3. Utilisation

### Préparer
- **Classes** : importe un fichier Excel avec les colonnes *Nom, Prénom, Sexe* (F ou G ; « fille », « garçon », « M » sont aussi compris). Un fichier `exemple_classe.xlsx` est fourni. Règle les niveaux en touchant les étoiles. Tout est modifiable (nom, prénom, sexe) et supprimable.
- **Réglages** : barème de points, bonus/malus, nombre de montées et descentes, rôles par défaut, option RGPD (initiale du nom seulement).

### Lancer une séance
1. **Séances > Nouvelle séance** : classe, activité (gardée en mémoire), format (simple, double ou équipes de N).
2. **Présences** : touche le statut pour passer Présent → Absent → Dispensé. Les dispensés deviennent arbitres, coachs ou observateurs.
3. **Organisation** : nombre de poules (ou nombre de joueurs par poule), terrains par poule, poules homogènes ou équilibrées, mixité, et répartition selon les étoiles ou selon les montées/descentes de la séance précédente.
4. **Générer les poules** → renomme les poules, déplace un joueur, change l'ordre (la première est la plus forte) → **Lancer la séance**.

### Pendant la séance
- Un **code à 4 chiffres** s'affiche. Sur chaque tablette : *Mode tablette élève* → code → choix de la poule. La tablette mémorise la poule, même après une mise en veille.
- Les élèves voient les rotations, leurs rôles, qui est au repos, et saisissent le score puis le fair-play de chaque joueur. Un résultat se modifie ou s'efface à tout moment.
- Sur l'ordinateur : vue d'ensemble de toutes les poules (idéal au vidéoprojecteur), modification des rôles (👥), renommage des poules (✎), **chronomètre de rotation** partagé avec les tablettes, avec signal sonore.

### Après la séance
- **Terminer et archiver** : la séance passe dans l'**Historique** avec les classements et la **proposition de montées/descentes**. On peut la rouvrir pour corriger, l'exporter en Excel ou la supprimer.
- **Suivi des élèves** : bilan par élève sur toutes les séances (matchs, victoires, bonus/malus, rôles tenus, montées/descentes) exportable en Excel pour l'évaluation.

## 4. Barème proposé

| Résultat | Points |
|---|---|
| Victoire | 3 |
| Nul | 2 |
| Défaite | 1 |
| Forfait | 0 |
| 🌟 Comportement exemplaire | +1 |
| 😠 Contestation de l'arbitre | −1 |

La défaite rapporte 1 point pour valoriser l'engagement. Le bonus vaut exactement l'écart entre une défaite et un nul : il compte sans pouvoir renverser seul un résultat. Tout est modifiable dans les Réglages.

**Départage** en cas d'égalité : confrontation directe, puis différence de points marqués/encaissés, puis fair-play, puis points marqués.

## 5. Gratuité et limites

L'offre gratuite Firebase Spark permet 50 000 lectures et 20 000 écritures par jour : une journée de cours complète en consomme une petite fraction. GitHub Pages est gratuit pour un dépôt public.

## 6. Protection des données

Les prénoms et noms des élèves sont stockés dans **ton** projet Firebase (serveurs Google, en Europe si tu as choisi cet emplacement). Pour limiter les données personnelles, active l'option « initiale du nom seulement » dans les Réglages avant d'importer, et parles-en à ton chef d'établissement (référent RGPD / DPO de l'académie).

## Fichiers

```
index.html              page principale
css/style.css           mise en forme
js/app.js               application (écrans, Firebase)
js/logic.js             poules, rencontres, rôles, classement, montées/descentes
js/firebase-config.js   ta configuration Firebase (à compléter)
firestore.rules         règles de sécurité à coller dans Firebase
exemple_classe.xlsx     modèle d'import
```
