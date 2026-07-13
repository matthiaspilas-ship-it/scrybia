// Authentification : comptes (via store.js), hachage bcrypt et sessions JWT.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { recordPurchase } from "./socialProof.js";
import { getUser, getUserByEmail, getUserByCustomer, putUser } from "./store.js";
import { planLimit } from "./billing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SECRET_FILE = path.join(DATA_DIR, "jwt-secret.txt");

export const COOKIE_NAME = "scriba_token";
const TOKEN_TTL = "7d";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Secret JWT ----------
// Priorité à JWT_SECRET (obligatoire sur Vercel). En local, on persiste un
// secret dans un fichier. En environnement lecture seule sans variable, on
// génère un secret éphémère (⚠️ définir JWT_SECRET en production).
let ephemeralSecret;
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
    const secret = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  } catch {
    if (!ephemeralSecret) ephemeralSecret = crypto.randomBytes(48).toString("hex");
    return ephemeralSecret;
  }
}

// Ne jamais renvoyer le hash du mot de passe au client.
function publicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

// ---------- Quota & abonnement ----------
export const FREE_LIMIT = 3; // générations gratuites (à vie) sans abonnement

const isActiveStatus = (s) => s === "active" || s === "trialing";
const currentPeriod = () => new Date().toISOString().slice(0, 7); // "AAAA-MM"

// État d'usage renvoyé au front, selon l'offre :
//  - pro actif     → illimité
//  - starter actif → quota mensuel (remise à zéro chaque mois)
//  - sinon (free)  → 3 générations à vie
export async function getUsage(id) {
  const u = await getUser(id);
  if (!u) return null;
  const active = isActiveStatus(u.subscriptionStatus);

  if (u.plan === "pro" && active) {
    return { plan: "pro", subscribed: true, unlimited: true, used: 0, limit: null, remaining: null };
  }
  if (u.plan === "starter" && active) {
    const limit = planLimit("starter");
    const used = u.periodKey === currentPeriod() ? u.periodUsed || 0 : 0;
    return {
      plan: "starter",
      subscribed: true,
      unlimited: false,
      used,
      limit,
      remaining: Math.max(0, limit - used),
    };
  }
  const used = u.generationsUsed || 0;
  return {
    plan: "free",
    subscribed: false,
    unlimited: false,
    used,
    limit: FREE_LIMIT,
    remaining: Math.max(0, FREE_LIMIT - used),
  };
}

export async function incrementUsage(id) {
  const u = await getUser(id);
  if (!u) return;
  const active = isActiveStatus(u.subscriptionStatus);
  if (u.plan === "pro" && active) return; // illimité → pas de décompte
  if (u.plan === "starter" && active) {
    const period = currentPeriod();
    if (u.periodKey !== period) {
      u.periodKey = period;
      u.periodUsed = 0;
    }
    u.periodUsed = (u.periodUsed || 0) + 1;
  } else {
    u.generationsUsed = (u.generationsUsed || 0) + 1;
  }
  await putUser(u);
}

// Compte interne (avec l'identifiant client Stripe) pour la facturation.
export async function getAccount(id) {
  const u = await getUser(id);
  if (!u) return null;
  return { id: u.id, email: u.email, stripeCustomerId: u.stripeCustomerId || null };
}

export async function setStripeCustomer(id, customerId) {
  const u = await getUser(id);
  if (!u) return;
  u.stripeCustomerId = customerId;
  await putUser(u);
}

export async function findByStripeCustomer(customerId) {
  const u = await getUserByCustomer(customerId);
  return u ? { id: u.id, email: u.email } : null;
}

// tier = "starter" | "pro" (offre souscrite). Non fourni → on conserve le plan.
export async function setSubscription(id, status, tier) {
  const u = await getUser(id);
  if (!u) return;
  const wasActivePaid =
    (u.plan === "starter" || u.plan === "pro") && isActiveStatus(u.subscriptionStatus);

  u.subscriptionStatus = status;
  if (isActiveStatus(status)) {
    if (tier) u.plan = tier;
  } else {
    u.plan = "free";
  }
  await putUser(u);

  // Nouvelle vente (passage à une offre payante active) → preuve sociale.
  const nowActivePaid =
    isActiveStatus(status) && (u.plan === "starter" || u.plan === "pro");
  if (!wasActivePaid && nowActivePaid) await recordPurchase();
}

// ---------- Inscription / Connexion ----------
export async function registerUser(email, password) {
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");

  if (!EMAIL_RE.test(email)) throw httpError(400, "Adresse e-mail invalide.");
  if (password.length < 8)
    throw httpError(400, "Le mot de passe doit contenir au moins 8 caractères.");

  if (await getUserByEmail(email))
    throw httpError(409, "Un compte existe déjà avec cette adresse e-mail.");

  const user = {
    id: crypto.randomUUID(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString(),
    plan: "free",
    generationsUsed: 0,
  };
  await putUser(user);
  return publicUser(user);
}

export async function loginUser(email, password) {
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");

  const user = await getUserByEmail(email);
  // Message identique que l'e-mail soit inconnu ou le mot de passe faux.
  const fail = () => httpError(401, "E-mail ou mot de passe incorrect.");
  if (!user) throw fail();
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw fail();
  return publicUser(user);
}

// ---------- Jetons ----------
export function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, getSecret(), {
    expiresIn: TOKEN_TTL,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: TOKEN_TTL_MS,
  path: "/",
};

// ---------- Middleware ----------
export function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token ? verifyToken(token) : null;
  req.user = payload ? { id: payload.sub, email: payload.email } : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Connexion requise." });
  next();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
