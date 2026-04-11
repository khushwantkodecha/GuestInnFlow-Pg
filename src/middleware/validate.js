/**
 * validate.js
 *
 * Generic Zod validation middleware factory.
 * Usage:  router.post('/', validate(schema), controller)
 *
 * Validates req.body against the supplied Zod schema.
 * Returns 400 with structured error messages on failure.
 * Passes cleaned (parsed) data back on req.body so controllers
 * always receive safe, coerced values.
 */
const { ZodError } = require('zod')

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body)

  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      field:   e.path.join('.') || 'body',
      message: e.message,
    }))

    return res.status(400).json({
      success: false,
      message: errors[0].message,   // human-readable first error for toasts
      errors,                        // full list for programmatic consumers
    })
  }

  // Replace req.body with the clean parsed output (strips unknown keys,
  // applies defaults, coerces types as declared in the schema)
  req.body = result.data
  next()
}

module.exports = validate
