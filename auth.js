// Authentification : stockage des comptes (fichier JSON), hachage des mots de
// passe (bcrypt) et sessions via cookie httpOnly signé (JWT).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { recordPurchase } from "./socialProof.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR permet de pointer vers un disque persistant (ex. /var/data sur Render).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SECRET_FILE = path.join(DATA_DIR, "jwt-secret.txt");

export const COOKIE_NAME = "scriba_token";
const TOKEN_TTL = "7d";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Secret JWT ----------
// On privilégie la variable d'environnement ; sinon on génère un secret fort et
// on le persiste, pour que les sessions survivent aux redémarrages.
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  ensureStore();
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

// ---------- Stockage fichier ----------
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
}

function readUsers() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Ne jamais renvoyer le hash du mot de passe au client.
function publicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

// ---------- Quota gratuit & abonnement ----------
export const FREE_LIMIT = 3; // générations gratuites par compte

const isActiveStatus = (s) => s === "active" || s === "trialing";

// État d'usage renvoyé au front : combien de générations restent, abonné ou non.
export function getUsage(id) {
  const u = readUsers().find((x) => x.id === id);
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

export function incrementUsage(id) {
  const users = readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return;
  u.generationsUsed = (u.generationsUsed || 0) + 1;
  writeUsers(users);
}

// Compte interne (avec l'identifiant client Stripe) pour la facturation.
export function getAccount(id) {
  const u = readUsers().find((x) => x.id === id);
  if (!u) return null;
  return { id: u.id, email: u.email, stripeCustomerId: u.stripeCustomerId || null };
}

export function setStripeCustomer(id, customerId) {
  const users = readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return;
  u.stripeCustomerId = customerId;
  writeUsers(users);
}

export function findByStripeCustomer(customerId) {
  const u = readUsers().find((x) => x.stripeCustomerId === customerId);
  return u ? { id: u.id, email: u.email } : null;
}

export function setSubscription(id, status) {
  const users = readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return;
  const wasPro = u.plan === "pro";
  u.subscriptionStatus = status;
  u.plan = isActiveStatus(status) ? "pro" : "free";
  writeUsers(users);
  // Nouvelle vente (transition gratuit → Pro) → preuve sociale.
  if (!wasPro && u.plan === "pro") recordPurchase();
}

// ---------- Inscription / Connexion ----------
export async function registerUser(email, password) {
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");

  if (!EMAIL_RE.test(email)) throw httpError(400, "Adresse e-mail invalide.");
  if (password.length < 8)
    throw httpError(400, "Le mot de passe doit contenir au moins 8 caractères.");

  const users = readUsers();
  if (users.some((u) => u.email === email))
    throw httpError(409, "Un compte existe déjà avec cette adresse e-mail.");

  const user = {
    id: crypto.randomUUID(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  return publicUser(user);
}

export async function loginUser(email, password) {
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");

  const user = readUsers().find((u) => u.email === email);
  // Message identique que l'e-mail soit inconnu ou le mot de passe faux
  // (on n'indique pas lequel est en cause).
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
// Attache req.user si un cookie de session valide est présent.
export function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token ? verifyToken(token) : null;
  req.user = payload ? { id: payload.sub, email: payload.email } : null;
  next();
}

// Bloque l'accès si l'utilisateur n'est pas connecté.
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Connexion requise." });
  next();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
