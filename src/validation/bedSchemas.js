const { z } = require('zod')

const objectIdRegex = /^[0-9a-fA-F]{24}$/

const assignBedSchema = z.object({
  tenantId:     z.string().regex(objectIdRegex, { message: 'Invalid tenantId' }),
  rentOverride: z.number().min(0).max(100000).optional(),
  deposit:      z.number().min(0).max(1000000).optional(),
  moveInDate:   z.string().refine(v => !isNaN(Date.parse(v)), { message: 'Invalid moveInDate' }).optional(),
})

const reserveBedSchema = z.object({
  reservedTill: z.string()
    .refine(v => !isNaN(Date.parse(v)), { message: 'reservedTill must be a valid date' })
    .refine(v => new Date(v) > new Date(), { message: 'reservedTill must be in the future' }),
  name:  z.string().min(1, 'Name is required').max(100).trim(),
  phone: z.string().min(5, 'Phone is required').max(20).trim(),
  moveInDate: z.string().refine(v => !isNaN(Date.parse(v)), { message: 'Invalid moveInDate' }).optional(),
  notes: z.string().max(500).trim().optional(),
})

const extraBedSchema = z.object({
  isChargeable: z.boolean().default(true),
  extraCharge:  z.number().min(0).max(100000).default(0),
})

const bulkBedSchema = z.object({
  bedIds: z.array(z.string().regex(objectIdRegex, { message: 'Invalid bed ID' }))
    .min(1, { message: 'At least one bed ID is required' })
    .max(20, { message: 'Cannot process more than 20 beds at once' }),
})

module.exports = { assignBedSchema, reserveBedSchema, extraBedSchema, bulkBedSchema }
