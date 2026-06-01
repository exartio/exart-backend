import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
})

export const PLANS = {
  solo: {
    priceId: process.env.STRIPE_SOLO_PRICE_ID,
    verifiedSeatLimit: 1,
    label: 'Solo-Lizenz',
    amount: 14900, // €149/month in cents
    interval: 'month',
    type: 'recurring',
  },
  expert: {
    priceId: process.env.STRIPE_EXPERT_PRICE_ID,
    verifiedSeatLimit: 5,
    label: 'Expert-Lizenz',
    amount: 34900, // €349/month in cents
    interval: 'month',
    type: 'recurring',
  },
  einzelgutachten: {
    priceId: process.env.STRIPE_EINZELGUTACHTEN_PRICE_ID,
    verifiedSeatLimit: 1,
    label: 'Einzelgutachten',
    amount: 5900, // €59 one-time in cents
    interval: null,
    type: 'one_time',
  },
}