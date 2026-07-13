// Authentification : comptes (via store.js), hachage bcrypt et sessions JWT.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { recordPurchase } from "./socialProof.js";
import { getUser, getUserByEmail, getUserByCustomer, putUser } from "./store.js";

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

// ---------- Quota gratuit & abonnement ----------
export const FREE_LIMIT = 3; // générations gratuites par compte

const isActiveStatus = (s) => s === "active" || s === "trialing";

// État d'usage : combien de générations restent, abonné ou non.
export async function getUsage(id) {
  const u = await getUser(id);
  if (!u) return null;
  const subscribed = u.plan === "pro" && isActiveStatus(u.subscriptionStatus);
  const used = u.generationsUsed || 0;
  return {
    used,
    limit: FREE_LIMIT,
    remaining: subscribed ? null : Math.max(0, FREE_LIMIT - used),
    subscribed,
    plan: subscribed ? "pro" : "free",
  };
}

export async function incrementUsage(id) {
  const u = await getUser(id);
  if (!u) return;
  u.generationsUsed = (u.generationsUsed || 0) + 1;
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

export async function setSubscription(id, status) {
  const u = await getUser(id);
  if (!u) return;
  const wasPro = u.plan === "pro";
  u.subscriptionStatus = status;
  u.plan = isActiveStatus(status) ? "pro" : "free";
  await putUser(u);
  // Nouvelle vente (transition gratuit → Pro) → preuve sociale.
  if (!wasPro && u.plan === "pro") await recordPurchase();
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
