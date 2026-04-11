import { useState } from 'react'
import RoomCard from './RoomCard'
import AssignTenantModal from './AssignTenantModal'

// ── Dummy data ────────────────────────────────────────────────────────────────
const SAMPLE_ROOMS = [
  {
    id: 'r1',
    roomNumber: '101',
    beds: [
      { id: 'b1', bedNumber: 'A1', status: 'occupied', tenant: { name: 'Aarav Patel' } },
      { id: 'b2', bedNumber: 'A2', status: 'occupied', tenant: { name: 'Rohan Sharma' } },
      { id: 'b3', bedNumber: 'A3', status: 'vacant',   tenant: null },
      { id: 'b4', bedNumber: 'A4', status: 'reserved', tenant: null },
    ],
  },
  {
    id: 'r2',
    roomNumber: '102',
    beds: [
      { id: 'b5', bedNumber: 'B1', status: 'occupied', tenant: { name: 'Priya Mehta' } },
      { id: 'b6', bedNumber: 'B2', status: 'vacant',   tenant: null },
      { id: 'b7', bedNumber: 'B3', status: 'occupied', tenant: { name: 'Kavya Reddy' } },
    ],
  },
  {
    id: 'r3',
    roomNumber: '103',
    beds: [
      { id: 'b8',  bedNumber: 'C1', status: 'vacant',   tenant: null },
      { id: 'b9',  bedNumber: 'C2', status: 'vacant',   tenant: null },
      { id: 'b10', bedNumber: 'C3', status: 'reserved', tenant: null },
      { id: 'b11', bedNumber: 'C4', status: 'vacant',   tenant: null },
    ],
  },
  {
    id: 'r4',
    roomNumber: '201',
    beds: [
      { id: 'b12', bedNumber: '1', status: 'occupied', tenant: { name: 'Ankit Desai' } },
      { id: 'b13', bedNumber: '2', status: 'occupied', tenant: { name: 'Sneha Gupta' } },
    ],
  },
  {
    id: 'r5',
    roomNumber: '202',
    beds: [
      { id: 'b14', bedNumber: '1', status: 'occupied', tenant: { name: 'Vivek Kumar' } },
      { id: 'b15', bedNumber: '2', status: 'occupied', tenant: { name: 'Neha Joshi' } },
      { id: 'b16', bedNumber: '3', status: 'occupied', tenant: { name: 'Rahul Singh' } },
      { id: 'b17', bedNumber: '4', status: 'reserved', tenant: null },
      { id: 'b18', bedNumber: '5', status: 'vacant',   tenant: null },
      { id: 'b19', bedNumber: '6', status: 'vacant',   tenant: null },
    ],
  },
  {
    id: 'r6',
    roomNumber: '203',
    beds: [
      { id: 'b20', bedNumber: '1', status: 'vacant',   tenant: null },
      { id: 'b21', bedNumber: '2', status: 'reserved', tenant: null },
      { id: 'b22', bedNumber: '3', status: 'occupied', tenant: { name: 'Amit Verma' } },
    ],
  },
]

const RoomsGrid = ({ rooms = SAMPLE_ROOMS, onAssignTenant }) => {
  const [modalData, setModalData] = useState(null) // { room, bed }

  const handleBedClick = (bed, room) => {
    if (bed.status === 'vacant') {
      setModalData({ room, bed })
    } else {
      console.log('Bed clicked:', bed)
    }
  }

  const handleAssign = (data) => {
    if (onAssignTenant) {
      onAssignTenant(data)
    } else {
      console.log('Assign Tenant:', data)
    }
    setModalData(null)
  }

  return (
    <>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            onBedClick={(bed) => handleBedClick(bed, room)}
          />
        ))}
      </div>

      {modalData && (
        <AssignTenantModal
          room={modalData.room}
          bed={modalData.bed}
          onClose={() => setModalData(null)}
          onAssignTenant={handleAssign}
        />
      )}
    </>
  )
}

export default RoomsGrid
