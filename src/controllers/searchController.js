const Property    = require('../models/Property')
const Tenant      = require('../models/Tenant')
const Room        = require('../models/Room')
const asyncHandler = require('../utils/asyncHandler')

// GET /api/search?q=
// Returns grouped results: { properties, tenants, rooms }
// Scoped to the authenticated user's properties only.
const globalSearch = asyncHandler(async (req, res) => {
  const q = (req.query.q ?? '').trim()

  if (!q || q.length < 2) {
    return res.json({ success: true, data: { properties: [], tenants: [], rooms: [] } })
  }

  const regex  = new RegExp(q, 'i')
  const userId = req.user._id

  // Fetch all property IDs owned by this user (used to scope room/tenant queries)
  const userProps   = await Property.find({ owner: userId }, '_id').lean()
  const propertyIds = userProps.map((p) => p._id)

  const [properties, tenants, rooms] = await Promise.all([
    // Properties: search by name
    Property.find(
      { owner: userId, isActive: true, name: regex },
      'name type address isActive'
    ).limit(5).lean(),

    // Tenants: search by name or phone
    Tenant.find(
      {
        property: { $in: propertyIds },
        status: { $in: ['active', 'notice'] },
        $or: [{ name: regex }, { phone: regex }],
      },
      'name phone status property'
    )
      .populate('property', 'name')
      .limit(5)
      .lean(),

    // Rooms: search by room number
    Room.find(
      { property: { $in: propertyIds }, isActive: true, roomNumber: regex },
      'roomNumber type floor rent property'
    )
      .populate('property', 'name')
      .limit(5)
      .lean(),
  ])

  res.json({ success: true, data: { properties, tenants, rooms } })
})

module.exports = { globalSearch }
