import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
})

export const PLANS = {
  solo: {
    priceId: process.env.STRIPE_SOLO_PRICE_ID,
    verifiedSeatLimit: 1,
    label: 'Solo-Lizenz',
    amount: 14900,
    interval: 'month',
    type: 'recurring',
  },
  solo_yearly: {
    priceId: process.env.STRIPE_SOLO_YEARLY_PRICE_ID,
    verifiedSeatLimit: 1,
    label: 'Solo-Lizenz (jährlich)',
    amount: 149000,
    interval: 'year',
    type: 'recurring',
  },
  expert: {
    priceId: process.env.STRIPE_EXPERT_PRICE_ID,
    verifiedSeatLimit: 5,
    label: 'Expert-Lizenz',
    amount: 34900,
    interval: 'month',
    type: 'recurring',
  },
  expert_yearly: {
    priceId: process.env.STRIPE_EXPERT_YEARLY_PRICE_ID,
    verifiedSeatLimit: 5,
    label: 'Expert-Lizenz (jährlich)',
    amount: 349000,
    interval: 'year',
    type: 'recurring',
  },
  einzelgutachten: {
    priceId: process.env.STRIPE_UNIT_PRICE_ID,
    verifiedSeatLimit: 1,
    label: 'Einzelgutachten',
    amount: 5900,
    interval: null,
    type: 'one_time',
  },
  einzelgutachten_solo: {
    priceId: process.env.STRIPE_UNIT_SOLO_PRICE_ID,
    verifiedSeatLimit: 1,
    label: 'Einzelgutachten (Solo-Rabatt)',
    amount: 3900,
    interval: null,
    type: 'one_time',
  },
}