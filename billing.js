// Client Stripe, offres et tarifs.
import "dotenv/config";
import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;

export const stripe = secret ? new Stripe(secret) : null;
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

// Offres et tarifs (IDs de prix Stripe — non secrets).
// limit = générations par mois (null = illimité).
export const PLANS = {
  starter: {
    label: "Starter",
    limit: 30,
    prices: {
      monthly: "price_1Tsg7qKraV82IpXrIKEHcUNe",
      annual: "price_1Tsg7qKraV82IpXrf4KGM8dV",
    },
  },
  pro: {
    label: "Pro",
    limit: null,
    prices: {
      monthly: "price_1Tsg7rKraV82IpXrWhQv3VIF",
      annual: "price_1Tsg7rKraV82IpXruqYJO1Cm",
    },
  },
};

// Index inverse : priceId -> { tier, cycle } (validation + webhook).
export const PRICE_INDEX = {};
for (const [tier, plan] of Object.entries(PLANS)) {
  for (const [cycle, id] of Object.entries(plan.prices)) PRICE_INDEX[id] = { tier, cycle };
}

// Limite mensuelle d'une offre (null = illimité, undefined si offre inconnue).
export const planLimit = (tier) => PLANS[tier]?.limit;

export const stripeReady = () => Boolean(stripe);
