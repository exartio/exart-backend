import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
})

export const PLANS = {
  starter: {
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    verifiedSeatLimit: 1,
    label: 'Starter',
  },
  pro: {
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    verifiedSeatLimit: 5,
    label: 'Pro',
  },
}
