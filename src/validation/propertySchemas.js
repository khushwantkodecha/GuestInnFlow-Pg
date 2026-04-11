/**
 * propertySchemas.js
 *
 * Zod schemas for property create and update request bodies.
 *
 * Design decisions:
 * - createPropertySchema: name is required; all other fields optional.
 * - updatePropertySchema: all fields optional (PATCH-style partial update),
 *   but name, if supplied, must be non-empty.
 * - Both schemas use .strip() (default) so unknown keys are silently removed
 *   — this mirrors the whitelist in the controller and provides defense-in-depth.
 */
const { z } = require('zod')

const addressSchema = z.object({
  street:  z.string().trim().max(200).optional(),
  city:    z.string().trim().max(100).optional(),
  state:   z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(6,   { message: 'Pincode must be 6 characters or fewer' }).optional(),
}).optional()

const propertyTypeEnum = z.enum(['pg', 'hostel', 'apartment'], {
  errorMap: () => ({ message: "Type must be one of: pg, hostel, apartment" }),
})

// ── Create ────────────────────────────────────────────────────────────────────
const createPropertySchema = z.object({
  name: z
    .string({ required_error: 'Property name is required' })
    .trim()
    .min(1, { message: 'Property name is required' })
    .max(200, { message: 'Property name must be 200 characters or fewer' }),

  type:        propertyTypeEnum.default('pg'),
  address:     addressSchema,
  description: z.string().trim().max(1000).optional(),
  amenities:   z.array(z.string().trim()).optional(),
  isActive:    z.boolean().default(true),
})

// ── Update ────────────────────────────────────────────────────────────────────
// All fields optional — but name, if provided, must still be non-empty.
const updatePropertySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Property name cannot be empty' })
    .max(200, { message: 'Property name must be 200 characters or fewer' })
    .optional(),

  type:        propertyTypeEnum.optional(),
  address:     addressSchema,
  description: z.string().trim().max(1000).optional(),
  amenities:   z.array(z.string().trim()).optional(),
  isActive:    z.boolean().optional(),
})

module.exports = { createPropertySchema, updatePropertySchema }
