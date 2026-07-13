// Preuve sociale : enregistre chaque passage à Pro (vente réelle) de façon
// anonyme (uniquement l'horodatage) et renvoie les ventes récentes.
import { pushPurchase, getPurchases } from "./store.js";

// Un client vient de s'abonner → on ajoute un évènement anonyme.
export async function recordPurchase() {
  await pushPurchase(new Date().toISOString());
}

// Ventes récentes (les plus récentes d'abord), sans aucune donnée personnelle.
export async function recentPurchases(limit = 10, maxAgeDays = 45) {
  const since = Date.now() - maxAgeDays * 86_400_000;
  const list = await getPurchases();
  return list
    .filter((ts) => new Date(ts).getTime() >= since)
    .slice(0, limit)
    .map((ts) => ({ at: ts }));
}
