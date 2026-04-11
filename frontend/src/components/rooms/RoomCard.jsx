import BedItem from './BedItem'

const RoomCard = ({ room, onBedClick }) => {
  const beds = room.beds ?? []
  const occupied = beds.filter((b) => b.status === 'occupied').length

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 transition-shadow duration-200 hover:shadow-md">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-800">Room {room.roomNumber}</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          {beds.length} Beds • {occupied} Occupied
        </p>
      </div>

      {/* Bed grid */}
      {beds.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {beds.map((bed) => (
            <BedItem key={bed.id} bed={bed} onBedClick={onBedClick} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-300 text-center py-3">No beds</p>
      )}
    </div>
  )
}

export default RoomCard
