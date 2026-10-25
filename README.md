# 🍬 Papillote

Une liste de souhaits (Noël, anniversaire…) **gratuite, sans compte, sans spoiler**.

> 🎁 **Projet perso, hors de mon domaine habituel (la cybersécurité).** Une petite application web faite pour offrir des cadeaux sans gâcher la surprise. J'en ai profité pour appliquer une approche *security by design* : aucun accès direct à la base (RLS), secrets de 256 bits, fonctions SQL validées, anti-SSRF, anti-spam, tests de concurrence. Voir [Comment fonctionne la sécurité](#comment-fonctionne-la-sécurité).

- Tu crées ta liste d'idées cadeaux.
- Tu envoies un lien à tes proches : ils voient la liste et cliquent **« Je le prends »**.
- Les réservations apparaissent **en direct** chez tous ceux qui ont la page ouverte.
- **Toi, tu ne vois jamais** ce qui est réservé, ni par qui.
- Cagnottes (« cadeau à plusieurs ») avec barre de progression.
- Pas de compte, pas de mot de passe : deux liens secrets par liste.

**Stack 100 % gratuite** : HTML/CSS/JS vanilla (modules ES, aucun build) sur GitHub Pages + Supabase (Postgres, Realtime, 1 Edge Function).

---

## Sommaire

1. [Ce qu'il te faut](#1-ce-quil-te-faut)
2. [Créer le projet Supabase](#2-créer-le-projet-supabase)
3. [Exécuter le schéma SQL](#3-exécuter-le-schéma-sql)
4. [Déployer l'Edge Function (Linux)](#4-déployer-ledge-function-linux)
5. [Remplir config.js](#5-remplir-configjs)
6. [Tester en local](#6-tester-en-local)
7. [Pousser sur GitHub et activer Pages](#7-pousser-sur-github-et-activer-pages)
8. [Secrets du keepalive](#8-secrets-du-keepalive)
9. [Tester que tout est sûr](#9-tester-que-tout-est-sûr)
10. [Comment fonctionne la sécurité](#comment-fonctionne-la-sécurité)
11. [Choix faits pour toi](#choix-faits-pour-toi)
12. [Dépannage](#dépannage)

---

## 1. Ce qu'il te faut

- Un compte [Supabase](https://supabase.com) (gratuit) et un compte [GitHub](https://github.com) (gratuit).
- Sur ton PC Linux : `git` et `curl` (`sudo apt install git curl`). Python 3 sert à tester en local (déjà installé sur la plupart des distributions).

## 2. Créer le projet Supabase

1. Sur supabase.com : **New project**. Choisis un nom (`papillote`), un mot de passe de base de données (garde-le dans ton gestionnaire de mots de passe, tu n'en auras pas besoin pour l'appli) et la région la plus proche (ex. *West EU (Paris)* ou *Frankfurt*).
2. Attends 1-2 minutes que le projet démarre.
3. Note deux choses, dans **Project Settings → API** (ou *Connect*) :
   - **Project URL** : `https://xxxxxxxx.supabase.co`
   - **Clé publique** : la clé `anon` (longue, commence par `eyJ…`) **ou** la clé `publishable` (`sb_publishable_…`). Les deux fonctionnent.
   - ⚠️ Ne copie **jamais** la clé `service_role` / `secret` dans l'appli.
4. Vérifie que le temps réel public est autorisé : **Project Settings → Realtime** (ou *Realtime → Settings*) → l'option *Allow public access* doit être activée (c'est le cas par défaut). Papillote n'envoie que des signaux vides sur des canaux au nom secret.

## 3. Exécuter le schéma SQL

1. Dans Supabase : **SQL Editor → New query**.
2. Ouvre [supabase/schema.sql](supabase/schema.sql), copie **tout** le contenu, colle-le, clique **Run**.
3. Résultat attendu : « Success. No rows returned ». Tu peux relancer le script sans risque (il est idempotent).
4. Contrôle : **Table Editor** doit montrer 3 tables (`lists`, `items`, `reservations`) avec le badge **RLS enabled**, et chacune sans aucune policy.

## 4. Déployer l'Edge Function (Linux)

Cette fonction lit le titre/l'image/le prix d'une page produit quand tu colles un lien. Elle est **facultative** : sans elle, tu remplis les champs à la main.

```bash
# 1) Installer la CLI Supabase (binaire officiel, sans Node.js)
#    (sur un PC ARM, remplace amd64 par arm64)
cd /tmp
curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz -o supabase.tar.gz
tar -xzf supabase.tar.gz supabase
sudo mv supabase /usr/local/bin/
supabase --version

# 2) Te connecter (ouvre le navigateur) puis lier le dossier au projet
cd ~/Documents/Papillote
supabase login
supabase link --project-ref xxxxxxxx      # xxxxxxxx = la partie avant .supabase.co de ton URL

# 3) Déployer la fonction
supabase functions deploy fetch-product-info --no-verify-jwt
```

Pourquoi `--no-verify-jwt` ? Les nouvelles clés `sb_publishable_…` ne sont pas des JWT et seraient refusées. Ça ne change rien à la sécurité : la clé anon est publique de toute façon, et la fonction se protège elle-même (anti-SSRF, limite de débit, timeout, taille limitée).

*(Facultatif)* Pour n'autoriser que ton site : `supabase secrets set ALLOWED_ORIGIN=https://TON-PSEUDO.github.io`.

## 5. Remplir config.js

```bash
cd ~/Documents/Papillote
cp config.example.js config.js
nano config.js        # remplace l'URL et la clé, Ctrl+O, Entrée, Ctrl+X
```

`config.js` est **commité volontairement** (GitHub Pages en a besoin). Il ne contient que des valeurs publiques par conception.

## 6. Tester en local

```bash
cd ~/Documents/Papillote
python3 -m http.server 8080
```

Ouvre <http://localhost:8080>, crée une liste, ajoute une idée. Ouvre le **lien de partage** dans une fenêtre de navigation privée (sinon Papillote te prévient « c'est ta liste ») et réserve : tu dois voir le point vert « En direct ».

> Pour tester en vrai la partie « invité » depuis le même PC, utilise une fenêtre privée *dans laquelle tu n'as jamais ouvert le lien propriétaire*.

## 7. Pousser sur GitHub et activer Pages

1. Sur github.com : **New repository** → nom `papillote` → *Public* (Pages gratuit) → **ne coche rien** (ni README, ni licence) → *Create*.
2. Dans le terminal :

```bash
cd ~/Documents/Papillote
git init -b main
git add .
git commit -m "Papillote : première version"
git remote add origin https://github.com/TON-PSEUDO/papillote.git
git push -u origin main
```

*(GitHub demande un identifiant : utilise un [Personal Access Token](https://github.com/settings/tokens) comme mot de passe, ou configure `gh auth login` si tu as la CLI GitHub.)*

3. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
4. Onglet **Actions** : le workflow *Déploiement GitHub Pages* tourne. Une minute plus tard, ton site est sur `https://TON-PSEUDO.github.io/papillote/`.

À chaque `git push` sur `main`, le site se met à jour.

## 8. Secrets du keepalive

Le plan gratuit de Supabase **met en pause** un projet après 7 jours sans activité. Le workflow [keepalive.yml](.github/workflows/keepalive.yml) l'appelle chaque jour.

Sur GitHub : **Settings → Secrets and variables → Actions → New repository secret** :

| Nom | Valeur |
|---|---|
| `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | ta clé publique (anon / publishable) |

Puis onglet **Actions → Keepalive Supabase → Run workflow** pour vérifier : il doit finir en vert.

> GitHub désactive les workflows planifiés d'un dépôt public sans aucune activité pendant 60 jours. Si tu reçois un mail à ce sujet, clique « Enable ».

## 9. Tester que tout est sûr

**Test SQL** (le plus simple) : colle [tests/security.sql](tests/security.sql) dans le SQL Editor et clique Run. Il tourne avec le rôle `anon`, dans une transaction annulée à la fin, et affiche `TOUS LES TESTS SONT PASSÉS`. Il prouve notamment :

- aucun accès direct aux tables ;
- `owner_get_list` ne contient aucun nom, aucun champ de réservation ;
- une seconde réservation d'un article `single` est refusée ;
- les mauvais secrets / jetons sont refusés, les entrées invalides rejetées.

**Test de concurrence** contre ton vrai projet (nécessite Node 18+ : `sudo apt install nodejs`) :

```bash
SUPABASE_URL=https://xxxxxxxx.supabase.co \
SUPABASE_ANON_KEY=ta_cle_publique \
node tests/security.test.mjs
```

Il lance **25 réservations simultanées** du même article et vérifie qu'**une seule** réussit, que la cagnotte accepte plusieurs participations parallèles, et que le propriétaire ne voit rien. Il crée une liste temporaire et la supprime ensuite.

*(Sans Node ni Supabase, tu peux tout rejouer dans Docker avec Postgres : voir l'en-tête de [tests/local-postgres-shim.sql](tests/local-postgres-shim.sql).)*

---

## Comment fonctionne la sécurité

**Pas de comptes : deux secrets par liste.** À la création, la base génère (avec `gen_random_bytes`, 32 octets = 256 bits, encodés url-safe) :

| Secret | Qui l'a | Ce qu'il permet |
|---|---|---|
| `owner_secret` (🔑 lien propriétaire) | toi seul | modifier la liste |
| `share_secret` (🎁 lien de partage) | tes proches | voir la liste, réserver, annuler *sa* réservation |

Les liens utilisent la partie `#…` de l'URL : elle n'est **jamais envoyée au serveur** ni dans le `Referer`. En plus : `<meta name="referrer" content="no-referrer">`, `robots noindex`, et une Content-Security-Policy.

**Aucun accès direct à la base.** La RLS est activée sur `lists`, `items`, `reservations` **sans aucune policy**, et les droits `SELECT/INSERT/…` sont révoqués à `anon` et `authenticated`. La clé `anon` publique ne permet donc de rien lire ni écrire directement.

**Tout passe par des fonctions SQL `SECURITY DEFINER`** (`owner_*`, `shared_*`, `create_list`) :
- elles reçoivent le secret en paramètre et le vérifient ;
- `search_path` est fixé à vide (tout est qualifié `public.`), ce qui bloque les détournements de schéma ;
- les entrées sont validées (longueurs max, prix, URL `http(s)` uniquement) ;
- `EXECUTE` est révoqué à tout le monde puis accordé uniquement aux fonctions publiques. Les fonctions internes (`_txt`, `_url`, `_list_id_by_*`…) ne sont pas appelables depuis l'API.

**Le propriétaire ne voit rien.** `owner_get_list` ne renvoie que la liste et les articles : pas de nom, pas de montant, pas même un booléen « réservé ». Les erreurs ne divulguent rien non plus (changer le type d'un article ne produit aucune erreur, que des réservations existent ou non). Et si tu ouvres par erreur ton propre lien de partage, Papillote le détecte (ton navigateur connaît tes listes), affiche **« Attention, c'est ta liste : la surprise serait gâchée »** et ne télécharge même pas les réservations.

**Réservations concurrentes.** `shared_reserve` verrouille la ligne de l'article (`SELECT … FOR UPDATE`) : deux personnes qui cliquent en même temps sont départagées, la seconde reçoit « quelqu'un vient de le prendre ». Un **index unique partiel** (`reservations_one_exclusive_per_item`) garantit en plus, au niveau base, qu'un article `single` n'a qu'une réservation. Annuler exige le **jeton d'annulation** (secret, gardé dans le navigateur de l'invité, jamais renvoyé par `shared_get_list`).

**Temps réel sans fuite.** Pas de `postgres_changes` (il exposerait des données). Papillote utilise **Realtime Broadcast** sur un canal dont le nom est `SHA-256(share_secret)` : le message est **vide**, c'est juste un signal « refresh », et chaque client re-télécharge via les RPC. Secours : rafraîchissement toutes les 30 s et au retour sur l'onglet. Le propriétaire n'écoute jamais ce canal (il l'alimente seulement, pour que les invités voient ses modifications).

**Edge Function `fetch-product-info`** : refuse tout sauf `http(s)` sur les ports 80/443, sans identifiants dans l'URL ; refuse `localhost`, les noms internes et les IP privées/loopback/link-local/CGNAT/multicast (IPv4 et IPv6, y compris `::ffff:127.0.0.1`, NAT64, 6to4) ; résout le DNS et vérifie **chaque IP à chaque redirection** (redirections suivies à la main, 3 max) ; timeout de 6 s ; 600 Ko max ; HTML uniquement ; 20 requêtes/minute/IP.

**XSS.** Aucun `innerHTML` dans le code : tout contenu utilisateur est inséré comme nœud texte. Les `href`/`src` sont filtrés (`http`/`https` seulement) et les liens externes portent `rel="noopener noreferrer nofollow"`.

### Limites honnêtes (à connaître)

- **Le « pas de spoil » est structurel pour l'interface, pas cryptographique.** Pour pouvoir envoyer le lien de partage, le propriétaire le connaît forcément : un propriétaire techniquement très motivé pourrait l'ouvrir dans un autre navigateur (ou appeler l'API à la main) et voir les réservations. Papillote protège contre l'accident et la curiosité, pas contre un propriétaire qui veut absolument tricher. Si quelqu'un d'autre que toi obtient ton lien de partage, il voit aussi les réservations : envoie-le seulement aux bonnes personnes.
- **Qui a le lien de partage peut réserver sous n'importe quel prénom** (pas de compte = pas de vérification d'identité). Chacun ne peut annuler que ses propres réservations.
- **Anti-spam** : comme l'URL et la clé publique sont visibles, n'importe qui peut appeler la création de listes. La base limite donc : 40 créations/heure au total, 5/heure par visiteur (selon son IP hachée, si Supabase la fournit) et 1000 listes au maximum. Par liste : 100 articles, 100 réservations par article, 300 au total. Conséquence : un attaquant motivé peut t'empêcher de créer une liste pendant une heure, mais ne peut ni toucher aux listes existantes ni saturer le quota gratuit. Les valeurs (`c_per_client_hour`, `c_global_hour`, `c_global_total`) se changent dans `create_list` de [supabase/schema.sql](supabase/schema.sql) ; relance le script après modification.
- **Perdre le lien propriétaire = perdre l'édition.** Pas de « mot de passe oublié » possible. Utilise « Copier » ou « Enregistrer en fichier » dans la page de ta liste.
- La limite de débit de l'Edge Function est en mémoire (par instance) : c'est un garde-fou simple, pas un pare-feu.
- `supabase-js` est chargé depuis jsDelivr en version figée (`2.45.4`) ; ce chargement dynamique ne permet pas d'ajouter un hash SRI.

## Choix faits pour toi

- **Routes** : `#/` accueil · `#/o/<secret>` propriétaire · `#/s/<secret>` invité.
- **Occasions** : Noël (rouge/vert/or + flocons), Anniversaire (couleurs vives + confettis), Autre (palette neutre). Les décors respectent « réduire les animations ».
- **Cagnotte** : le prix de l'article est l'objectif ; le montant d'une participation est obligatoire ; on peut dépasser l'objectif.
- **Réordonner** : glisser-déposer à la souris, plus des boutons ↑ ↓ (clavier, lecteur d'écran et tactile).
- **Monnaie** : euro.
- **Aperçu de lien** : il ne remplace jamais ce que tu as déjà tapé ; en cas d'échec, simple message discret.
- **`config.js` commité** : valeurs publiques, nécessaires à GitHub Pages. Seuls `index.html`, `config.js`, `css/`, `js/` et `assets/` sont publiés (pas `supabase/` ni `tests/`).
- **Un invité ne peut annuler que depuis le navigateur où il a réservé** (le jeton y est stocké).

## Dépannage

| Symptôme | Piste |
|---|---|
| Écran « Papillote n'est pas encore configuré » | `config.js` absent ou non rempli : voir [étape 5](#5-remplir-configjs). |
| `Could not find the function public.create_list` / erreur 404 sur `/rpc/` | `schema.sql` n'a pas été exécuté (ou a échoué). Relance-le entièrement. Si besoin : SQL Editor → `notify pgrst, 'reload schema';`. |
| « Lien introuvable » sur un lien valide | Lien tronqué à la copie (il doit faire plus de 40 caractères après `#/o/` ou `#/s/`), ou liste supprimée. |
| Pas de point vert « En direct » | Vérifie *Allow public access* dans les réglages Realtime (étape 2). L'appli reste utilisable : elle se rafraîchit toutes les 30 s et au retour sur l'onglet. Un bloqueur de pubs agressif peut aussi couper les WebSockets. |
| Les autres ne voient mes modifications qu'après 30 s | Même cause : le signal temps réel n'arrive pas (surtout si tu utilises une clé `sb_publishable_…` : essaie la clé `anon` classique `eyJ…`). |
| Le préremplissage d'un lien ne marche pas | Fonction non déployée (étape 4) ou site qui bloque les robots/utilise du JavaScript pour afficher le produit. Remplis à la main, c'est prévu. Logs : Supabase → Edge Functions → fetch-product-info → Logs. |
| Le site GitHub Pages affiche une page blanche | Ouvre la console du navigateur (F12). Vérifie que `config.js` est bien commité (`git ls-files config.js`) et que Pages est en mode *GitHub Actions*. |
| Le workflow Pages échoue sur « config.js est absent » | `cp config.example.js config.js`, remplis, `git add config.js && git commit && git push`. |
| Le keepalive échoue (HTTP 401/404) | Secrets mal copiés, ou `schema.sql` non exécuté (la fonction `ping` n'existe pas encore). |
| Projet Supabase « Paused » | Clique *Restore project* dans le tableau de bord, puis vérifie le keepalive. |
| Écran bloqué après avoir copié `config.js` | Le navigateur a mis l'ancien en cache : recharge avec Ctrl+Maj+R. |
| Content-Security-Policy dans la console | Si tu utilises un domaine Supabase personnalisé, ajoute-le dans `connect-src` de la balise CSP de `index.html`. |

---

Licence MIT — voir [LICENSE](LICENSE).
