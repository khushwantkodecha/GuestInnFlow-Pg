const PLANS = {
  standard:   { name: 'Standard',   maxProperties: 1,        price: 1999 },
  pro:        { name: 'Pro',        maxProperties: 2,        price: 2999 },
  elite:      { name: 'Elite',      maxProperties: 3,        price: 3999 },
  enterprise: { name: 'Enterprise', maxProperties: Infinity, price: 5999 },
}

module.exports = PLANS
