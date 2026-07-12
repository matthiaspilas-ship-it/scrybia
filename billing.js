// Client Stripe et configuration de facturation.
// Les clés viennent du fichier .env. Si elles sont absentes, `stripe` vaut null
// et les routes de paiement renvoient un message clair invitant à les configurer.
import "dotenv/config";
import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;

export const stripe = secret ? new Stripe(secret) : null;
export const PRICE_ID = process.env.STRIPE_PRICE_ID || "";
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

// Vrai seulement si la clé secrète ET l'identifiant de tarif sont présents.
export const stripeReady = () => Boolean(stripe && PRICE_ID);
