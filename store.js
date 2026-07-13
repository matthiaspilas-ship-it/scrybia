// Couche de stockage à deux backends, choisie automatiquement :
//  - Upstash Redis si UPSTASH_REDIS_REST_URL + _TOKEN sont définis (→ Vercel/prod)
//  - Fichiers JSON sinon (→ développement local)
// API uniforme et asynchrone pour les comptes et l'historique des ventes.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const useRedis = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

const PURCHASES_MAX = 50;

// ---------------------------------------------------------------------------
// Backend Redis (Upstash) — pour Vercel (pas de système de fichiers persistant)
// ---------------------------------------------------------------------------
function makeRedisBackend(Redis) {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  const parse = (v) => (v == null ? null : typeof v === "string" ? JSON.parse(v) : v);

  return {
    async getUser(id) {
      return parse(await redis.get(`user:${id}`));
    },
    async getUserByEmail(email) {
      const id = await redis.get(`emailidx:${email}`);
      return id ? this.getUser(id) : null;
    },
    async getUserByCustomer(customerId) {
      const id = await redis.get(`custidx:${customerId}`);
      return id ? this.getUser(id) : null;
    },
    async putUser(user) {
      await redis.set(`user:${user.id}`, JSON.stringify(user));
      await redis.set(`emailidx:${user.email}`, user.id);
      if (user.stripeCustomerId) await redis.set(`custidx:${user.stripeCustomerId}`, user.id);
    },
    async pushPurchase(ts) {
      await redis.lpush("purchases", ts);
      await redis.ltrim("purchases", 0, PURCHASES_MAX - 1);
    },
    async getPurchases() {
      return (await redis.lrange("purchases", 0, PURCHASES_MAX - 1)) || [];
    },
  };
}

// ---------------------------------------------------------------------------
// Backend fichiers — pour le développement local
// ---------------------------------------------------------------------------
function makeFileBackend() {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
  const USERS_FILE = path.join(DATA_DIR, "users.json");
  const PURCHASES_FILE = path.join(DATA_DIR, "purchases.json");

  const ensure = () => {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
    if (!fs.existsSync(PURCHASES_FILE)) fs.writeFileSync(PURCHASES_FILE, "[]");
  };
  const readJson = (f) => {
    ensure();
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      return [];
    }
  };
  const writeJson = (f, v) => {
    ensure();
    fs.writeFileSync(f, JSON.stringify(v, null, 2));
  };

  return {
    async getUser(id) {
      return readJson(USERS_FILE).find((u) => u.id === id) || null;
    },
    async getUserByEmail(email) {
      return readJson(USERS_FILE).find((u) => u.email === email) || null;
    },
    async getUserByCustomer(customerId) {
      return readJson(USERS_FILE).find((u) => u.stripeCustomerId === customerId) || null;
    },
    async putUser(user) {
      const users = readJson(USERS_FILE);
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx === -1) users.push(user);
      else users[idx] = user;
      writeJson(USERS_FILE, users);
    },
    async pushPurchase(ts) {
      const list = readJson(PURCHASES_FILE);
      list.unshift(ts);
      writeJson(PURCHASES_FILE, list.slice(0, PURCHASES_MAX));
    },
    async getPurchases() {
      return readJson(PURCHASES_FILE);
    },
  };
}

// ---------------------------------------------------------------------------
// Initialisation PARESSEUSE (au premier appel), sans "top-level await" : évite
// tout crash au démarrage de la fonction serverless (FUNCTION_INVOCATION_FAILED).
let backendPromise;
async function getBackend() {
  if (!backendPromise) {
    backendPromise = (async () => {
      if (useRedis) {
        const { Redis } = await import("@upstash/redis");
        console.log("🗄️  Stockage : Upstash Redis");
        return makeRedisBackend(Redis);
      }
      console.log("🗄️  Stockage : fichiers locaux (data/)");
      return makeFileBackend();
    })();
  }
  return backendPromise;
}

export const getUser = async (id) => (await getBackend()).getUser(id);
export const getUserByEmail = async (email) => (await getBackend()).getUserByEmail(email);
export const getUserByCustomer = async (cid) => (await getBackend()).getUserByCustomer(cid);
export const putUser = async (user) => (await getBackend()).putUser(user);
export const pushPurchase = async (ts) => (await getBackend()).pushPurchase(ts);
export const getPurchases = async () => (await getBackend()).getPurchases();
