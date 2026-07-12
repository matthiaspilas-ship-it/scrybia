import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import Groq from "groq-sdk";
import { SYSTEM_PROMPT, buildUserMessage } from "./systemPrompt.js";
import {
  COOKIE_NAME,
  cookieOptions,
  registerUser,
  loginUser,
  issueToken,
  attachUser,
  requireAuth,
  getUsage,
  incrementUsage,
  getAccount,
  setStripeCustomer,
  findByStripeCustomer,
  setSubscription,
} from "./auth.js";
import { stripe, PRICE_ID, WEBHOOK_SECRET, stripeReady } from "./billing.js";
import { recentPurchases } from "./socialProof.js";

const app = express();
// Derrière le proxy HTTPS de Render : nécessaire pour que les cookies "secure"
// et req.protocol (https) fonctionnent correctement.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const MODEL = "llama-3.3-70b-versatile"; // gratuit, rapide, bon en français

// Le SDK lit la clé depuis GROQ_API_KEY (.env). Valeur de secours pour permettre
// au serveur de démarrer même sans clé (un message clair est renvoyé à l'usage).
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "cle-absente" });

// ---------- Webhook Stripe ----------
// Doit lire le CORPS BRUT pour vérifier la signature → déclaré AVANT express.json().
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!stripe) return res.status(503).end();
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Signature webhook invalide:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const obj = event.data.object;
    if (event.type === "checkout.session.completed") {
      if (obj.client_reference_id) {
        if (obj.customer) setStripeCustomer(obj.client_reference_id, obj.customer);
        setSubscription(obj.client_reference_id, "active");
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const user = findByStripeCustomer(obj.customer);
      if (user) {
        const status = event.type === "customer.subscription.deleted" ? "canceled" : obj.status;
        setSubscription(user.id, status);
      }
    }
    res.json({ received: true });
  }
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(attachUser); // renseigne req.user si un cookie de session est valide
// no-store : le navigateur récupère toujours la dernière version (évite le cache).
app.use(
  express.static("public", {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  })
);

const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;

// ---------- Authentification ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await registerUser(email, password);
    res.cookie(COOKIE_NAME, issueToken(user), cookieOptions);
    res.status(201).json({ user, usage: getUsage(user.id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erreur serveur." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await loginUser(email, password);
    res.cookie(COOKIE_NAME, issueToken(user), cookieOptions);
    res.json({ user, usage: getUsage(user.id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erreur serveur." });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

// Preuve sociale : ventes récentes anonymisées (horodatage seulement).
app.get("/api/social-proof", (_req, res) => {
  res.json({ events: recentPurchases(10) });
});

// Renvoie l'utilisateur courant (ou null) + son quota — utilisé par le front.
app.get("/api/auth/me", (req, res) => {
  if (!req.user) return res.json({ user: null, usage: null });
  res.json({ user: req.user, usage: getUsage(req.user.id) });
});

// ---------- Facturation (Stripe) ----------
// Démarre un paiement d'abonnement : crée (ou réutilise) un client Stripe puis
// une session Checkout et renvoie l'URL de redirection.
app.post("/api/billing/checkout", requireAuth, async (req, res) => {
  if (!stripeReady()) {
    return res.status(503).json({
      error:
        "Paiement non configuré. Ajoutez STRIPE_SECRET_KEY et STRIPE_PRICE_ID dans le fichier .env.",
    });
  }
  try {
    const account = getAccount(req.user.id);
    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: account.email,
        metadata: { userId: account.id },
      });
      customerId = customer.id;
      setStripeCustomer(account.id, customerId);
    }

    const base = baseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: account.id,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${base}/?paiement=succes&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?paiement=annule`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Erreur Stripe (checkout):", err.message);
    res.status(500).json({ error: "Impossible de démarrer le paiement." });
  }
});

// Confirme l'abonnement au retour de Stripe (fiable même sans webhook en local).
app.get("/api/billing/confirm", requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe non configuré." });
  const sessionId = req.query.session_id;
  if (!sessionId) return res.status(400).json({ error: "session_id manquant." });
  try {
    const session = await stripe.checkout.sessions.retrieve(String(sessionId));
    if (session.client_reference_id !== req.user.id) {
      return res.status(403).json({ error: "Session non autorisée." });
    }
    if (session.status === "complete" || session.payment_status === "paid") {
      if (session.customer) setStripeCustomer(req.user.id, session.customer);
      setSubscription(req.user.id, "active");
    }
    res.json({ usage: getUsage(req.user.id) });
  } catch (err) {
    console.error("Erreur Stripe (confirm):", err.message);
    res.status(500).json({ error: "Vérification du paiement impossible." });
  }
});

// Types de contenus autorisés
const TYPES_VALIDES = new Set([
  "Publication Facebook",
  "Publication LinkedIn",
  "Offre d'emploi",
]);

// Endpoint de génération : streaming des tokens via Server-Sent Events (SSE).
app.post("/api/generate", requireAuth, async (req, res) => {
  const data = req.body || {};

  if (!TYPES_VALIDES.has(data.type)) {
    return res.status(400).json({ error: "Type de contenu invalide." });
  }
  if (!data.details && !data.sujet && !data.poste) {
    return res
      .status(400)
      .json({ error: "Merci de fournir au moins un sujet, un poste ou des détails." });
  }
  if (!process.env.GROQ_API_KEY) {
    return res
      .status(500)
      .json({ error: "Clé API manquante. Ajoutez GROQ_API_KEY dans le fichier .env." });
  }

  // Quota gratuit : au-delà de la limite, il faut un abonnement actif.
  const usage = getUsage(req.user.id);
  if (usage && !usage.subscribed && usage.used >= usage.limit) {
    return res.status(402).json({
      error: "quota_atteint",
      message: `Vous avez utilisé vos ${usage.limit} générations gratuites. Passez à Pro pour continuer.`,
    });
  }

  // En-têtes SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, payload) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

  // Le client a réellement fermé la connexion (déconnexion) → on arrête d'envoyer.
  // On écoute "res" (pas "req") : sur Node récent, req émet "close" dès que le
  // corps est lu, ce qui n'est PAS une déconnexion. On ne considère l'abandon
  // que si la réponse n'a pas encore été terminée normalement.
  let aborted = false;
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  try {
    const stream = await groq.chat.completions.create({
      model: MODEL,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(data) },
      ],
    });

    let recu = "";
    for await (const chunk of stream) {
      if (aborted) break;
      const text = chunk.choices?.[0]?.delta?.content || "";
      if (text) {
        recu += text;
        send("delta", { text });
      }
    }

    if (!aborted) {
      if (!recu) {
        send("error", { message: "Réponse vide. Réessayez ou reformulez la demande." });
      } else {
        // Génération réussie → on décompte un crédit gratuit (pas pour les abonnés).
        if (!usage.subscribed) incrementUsage(req.user.id);
        send("done", {});
      }
      res.end();
    }
  } catch (err) {
    console.error("Erreur API Groq:", err);
    const status = err?.status;
    if (!res.headersSent) {
      return res.status(500).json({ error: "Erreur du serveur." });
    }
    const message =
      status === 401
        ? "Clé API invalide ou manquante. Vérifiez votre fichier .env."
        : status === 429
        ? "Limite de requêtes atteinte. Réessayez dans un instant."
        : "Une erreur est survenue pendant la génération.";
    send("error", { message });
    res.end();
  }
});

const server = app.listen(PORT, () => {
  if (!process.env.GROQ_API_KEY) {
    console.warn(
      "\n⚠️  GROQ_API_KEY n'est pas définie. Copiez .env.example vers .env et ajoutez votre clé (gratuite).\n"
    );
  }
  console.log(`\n✅ Serveur prêt : http://localhost:${PORT}\n`);
});

// Message clair si le port est déjà occupé par une autre application.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n❌ Le port ${PORT} est déjà utilisé par une autre application.\n   Changez la valeur de PORT dans le fichier .env (ex : PORT=4000), puis relancez.\n`
    );
    process.exit(1);
  }
  throw err;
});
