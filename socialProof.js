// Preuve sociale : enregistre chaque passage à Pro (vente réelle) de façon
// anonyme (uniquement l'horodatage) pour l'afficher aux visiteurs.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "purchases.json");
const MAX = 50; // on ne conserve que les dernières ventes

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]");
}
function read() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}
function write(list) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(list.slice(-MAX), null, 2));
}

// Un client vient de s'abonner → on ajoute un évènement anonyme.
export function recordPurchase() {
  const list = read();
  list.push({ at: new Date().toISOString() });
  write(list);
}

// Ventes récentes (les plus récentes d'abord), sans aucune donnée personnelle.
export function recentPurchases(limit = 10, maxAgeDays = 45) {
  const since = Date.now() - maxAgeDays * 86_400_000;
  return read()
    .filter((e) => new Date(e.at).getTime() >= since)
    .slice(-limit)
    .reverse();
}
