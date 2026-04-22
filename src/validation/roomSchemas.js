const { z } = require('zod')

const roomTypeEnum = z.enum(['single', 'double', 'triple', 'dormitory'], {
  errorMap: () => ({ message: 'Type must be one of: single, double, triple, dormitory' }),
})

// ── Create ────────────────────────────────────────────────────────────────────
const createRoomSchema = z
  .object({
    roomNumber: z
      .string({ required_error: 'Room number is required' })
      .trim()
      .min(1, { message: 'Room number is required' })
      .max(20, { message: 'Room number must be 20 characters or fewer' })
      .transform((v) => v.toUpperCase()),

    type:     roomTypeEnum.default('single'),

    // capacity: required for dormitory; controller auto-assigns for other types
    capacity: z.number().int()
      .min(1,  { message: 'Capacity must be at least 1' })
      .max(20, { message: 'Capacity cannot exceed 20 beds' })
      .optional(),

    floor:    z.number().int().min(0, { message: 'Floor cannot be negative' }).default(0),

    baseRent: z
      .number({
        required_error:     'Base rent is required',
        invalid_type_error: 'Base rent must be a number',
      })
      .min(0,      { message: 'Base rent cannot be negative' })
      .max(100000, { message: 'Base rent cannot exceed ₹1,00,000' }),

    rentType:            z.enum(['per_bed']).default('per_bed'),
    gender:              z.enum(['male', 'female', 'unisex']).default('unisex'),
    status:              z.enum(['available', 'maintenance', 'blocked']).default('available'),
    hasAC:               z.boolean().default(false),
    hasAttachedBathroom: z.boolean().default(false),
    category:            z.enum(['standard', 'premium', 'luxury']).default('standard'),
    notes:               z.string().trim().max(500).optional(),
    amenities:           z.array(z.string().trim()).optional(),

    // Bed numbering — immutable after creation; stripped from update schema
    bedNumberingType: z.enum(['alphabet', 'numeric']).default('alphabet'),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'dormitory' && !data.capacity) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        message: 'Capacity is required for dormitory rooms',
        path:    ['capacity'],
      })
    }
  })

// ── Update ────────────────────────────────────────────────────────────────────
// bedNumberingType intentionally omitted — Zod strips it on update
const updateRoomSchema = z.object({
  roomNumber: z
    .string()
    .trim()
    .min(1, { message: 'Room number cannot be empty' })
    .max(20, { message: 'Room number must be 20 characters or fewer' })
    .transform((v) => v.toUpperCase())
    .optional(),

  type:     roomTypeEnum.optional(),
  capacity: z.number().int()
    .min(1,  { message: 'Capacity must be at least 1' })
    .max(20, { message: 'Capacity cannot exceed 20 beds' })
    .optional(),
  floor:    z.number().int().min(0, { message: 'Floor cannot be negative' }).optional(),
  baseRent: z.number()
    .min(0,      { message: 'Base rent cannot be negative' })
    .max(100000, { message: 'Base rent cannot exceed ₹1,00,000' })
    .optional(),

  rentType:            z.enum(['per_bed']).optional(),
  gender:              z.enum(['male', 'female', 'unisex']).optional(),
  status:              z.enum(['available', 'maintenance', 'blocked']).optional(),
  hasAC:               z.boolean().optional(),
  hasAttachedBathroom: z.boolean().optional(),
  category:            z.enum(['standard', 'premium', 'luxury']).optional(),
  notes:               z.string().trim().max(500).optional(),
  amenities:           z.array(z.string().trim()).optional(),
  isActive:            z.boolean().optional(),
})

module.exports = { createRoomSchema, updateRoomSchema }
