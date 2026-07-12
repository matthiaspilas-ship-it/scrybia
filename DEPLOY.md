# 🚀 Déployer Scriba en ligne (Render + domaine IONOS .fr)

Objectif : site en ligne, HTTPS, sur ton domaine `.fr`, paiements Stripe réels.

---

## Étape 1 — Mettre le code sur GitHub

Render déploie depuis GitHub. Depuis le dossier du projet :

```bash
cd ~/ai-content-generator
git init
git add .
git commit -m "Scriba - prêt pour le déploiement"
```

> ✅ `.gitignore` exclut déjà `.env` et `data/` : **aucune clé secrète n'est envoyée** sur GitHub.

Crée un dépôt sur https://github.com/new (nom : `scriba`, **Private**), puis :

```bash
git remote add origin https://github.com/TON-COMPTE/scriba.git
git branch -M main
git push -u origin main
```

---

## Étape 2 — Créer le service sur Render

1. Compte sur https://render.com (connexion avec GitHub).
2. **New +** → **Blueprint** → sélectionne ton dépôt `scriba`.
   Render lit `render.yaml` : il crée le service **+ le disque persistant** (comptes clients conservés).
3. Render demande les variables marquées `sync: false`. Renseigne-les (onglet **Environment**) :

| Variable | Valeur |
|---|---|
| `GROQ_API_KEY` | ta clé Groq (`gsk_…`) |
| `STRIPE_SECRET_KEY` | ta clé **live** (`sk_live_…`) |
| `STRIPE_PRICE_ID` | `price_1TsPvvKraV82IpXrlUJoodyl` (le prix Live à 19,99 €) |
| `STRIPE_WEBHOOK_SECRET` | *(vide pour l'instant — étape 5)* |
| `PUBLIC_URL` | *(vide pour l'instant — étape 4)* |

`NODE_ENV`, `DATA_DIR` et `JWT_SECRET` sont gérés automatiquement.

4. **Create** → Render build et déploie. Tu obtiens une URL `https://scriba-xxxx.onrender.com`.
   Teste-la : le site doit s'afficher en HTTPS. 🎉

---

## Étape 3 — Acheter le domaine .fr chez IONOS

1. https://www.ionos.fr → cherche ton nom de domaine `.fr`.
2. Achète-le (~7-15 €/an). **Prends uniquement le domaine** (pas besoin de l'hébergement web).

---

## Étape 4 — Relier le domaine à Render

1. Sur Render : ton service → **Settings** → **Custom Domains** → **Add** → saisis `ton-domaine.fr` **et** `www.ton-domaine.fr`.
2. Render affiche les enregistrements DNS à créer (un `A` ou `ALIAS`, et un `CNAME` pour `www`).
3. Sur IONOS : **Domaines & SSL** → ton domaine → **DNS** → crée les enregistrements donnés par Render :
   - `@`  → type **A** (ou ALIAS) vers la valeur Render
   - `www` → type **CNAME** vers `scriba-xxxx.onrender.com`
4. Attends la propagation (10 min à quelques heures). Render active le **HTTPS automatiquement** (Let's Encrypt).
5. De retour sur Render → variable **`PUBLIC_URL`** = `https://ton-domaine.fr` → **Save** (redéploie).

---

## Étape 5 — Webhook Stripe (mode Live)

Indispensable pour synchroniser renouvellements et résiliations.

1. https://dashboard.stripe.com (en mode **Live**) → **Développeurs** → **Webhooks** → **Ajouter un endpoint**.
2. URL : `https://ton-domaine.fr/api/billing/webhook`
3. Évènements à écouter : `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Copie le **Signing secret** (`whsec_…`).
5. Sur Render → variable **`STRIPE_WEBHOOK_SECRET`** = ce `whsec_…` → **Save** (redéploie).

---

## Étape 6 — Test final (attention : paiements réels !)

1. Va sur `https://ton-domaine.fr`, crée un compte, épuise les 3 générations, clique **S'abonner**.
2. Paie avec une **vraie carte** (elle sera **réellement débitée** de 19,99 €).
3. Vérifie : retour sur le site en Pro, popup de preuve sociale, et le paiement visible dans Stripe.
4. Tu peux **rembourser** depuis Stripe (Paiements → Rembourser) pour ce test.

---

## Notes

- **Coût** : domaine (~10 €/an) + Render Starter avec disque (~7 $/mois + quelques cents de disque). Le plan gratuit Render **ne convient pas** (pas de disque persistant, mise en veille).
- **Sauvegardes** : les données vivent dans `/var/data` sur le disque Render. Pense à exporter `users.json` régulièrement si l'activité grandit (ou migrer vers une vraie base de données — je peux t'aider).
- **Mises à jour** : chaque `git push` sur `main` redéploie automatiquement.
