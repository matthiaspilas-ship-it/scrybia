# ✨ AI Business Content Generator

Un générateur de contenus professionnels propulsé par **l'IA Groq**.
Il crée des **offres d'emploi optimisées**, des **posts LinkedIn** et des **posts Facebook**
prêts à publier, à partir de quelques informations que vous saisissez.

- 🧠 Vraie IA (API Groq, modèle `llama-3.3-70b-versatile`)
- 🆓 **Clé API gratuite** — sans carte bancaire ni facturation
- ⚡ Génération en direct (streaming, effet « IA qui écrit »)
- 🎯 Analyse + contenu + explications à chaque génération
- 🔒 Aucune information inventée : l'IA n'utilise que vos détails

---

## 🚀 Démarrage rapide

### 1. Installer Node.js
Téléchargez et installez **Node.js 18 ou plus récent** : https://nodejs.org

### 2. Installer les dépendances
Dans un terminal, placez-vous dans le dossier du projet puis lancez :

```bash
cd ai-content-generator
npm install
```

### 3. Obtenir votre clé API Groq (gratuite)
1. Allez sur **https://console.groq.com/keys**
2. Connectez-vous (compte Google ou e-mail) — **gratuit, sans carte bancaire**.
3. Cliquez sur **« Create API Key »**, donnez-lui un nom, puis copiez la clé (`gsk_...`).
4. Copiez le fichier d'exemple :

```bash
cp .env.example .env
```

5. Dans `.env`, remplacez la valeur par votre vraie clé :

```
GROQ_API_KEY=gsk_votre-vraie-cle-ici
```

### 4. Lancer le site

```bash
npm start
```

Puis ouvrez **http://localhost:3000** dans votre navigateur. 🎉

---

## 📖 Utilisation

1. Choisissez le **type de contenu** (Offre d'emploi, LinkedIn ou Facebook).
2. Remplissez l'entreprise, le poste/sujet, le ton et surtout les **détails**.
3. Cliquez sur **✨ Générer** — le texte s'écrit en direct.
4. Cliquez sur **📋 Copier** pour récupérer le résultat.

> 💡 Plus vous donnez de détails (missions, avantages, lieu, contrat…),
> plus le contenu est précis et pertinent.

---

## 🛠️ Structure du projet

```
ai-content-generator/
├── server.js          # Serveur Express + appel streaming à l'API Groq
├── systemPrompt.js    # Prompt système (rôle + règles de l'IA)
├── package.json
├── .env.example       # Modèle de configuration (à copier en .env)
└── public/            # Interface web
    ├── index.html
    ├── style.css
    └── app.js
```

## 💸 Coût

L'offre **gratuite** de Groq suffit largement pour un usage normal
(plusieurs milliers de requêtes par jour, sans facturation).
Détails des limites gratuites : https://console.groq.com/docs/rate-limits

## ⚠️ Sécurité

- Ne partagez **jamais** votre fichier `.env` ni votre clé API.
- Le fichier `.gitignore` empêche déjà `.env` d'être versionné.
