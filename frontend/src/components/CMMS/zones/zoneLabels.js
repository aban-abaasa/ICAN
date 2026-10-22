// Shared wording for the restricted-zone screens.

export const VEHICLE_TYPES = [
  { id: 'motorcycle', label: 'Boda / motorcycle' },
  { id: 'bicycle', label: 'Bicycle' },
  { id: 'tuktuk', label: 'Tuk-tuk' },
  { id: 'car', label: 'Car' },
  { id: 'van', label: 'Van' },
  { id: 'truck', label: 'Truck' },
];

export const vehicleLabel = (id) => VEHICLE_TYPES.find((v) => v.id === id)?.label || (id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Vehicle');

export const ZONE_KINDS = [
  { id: 'estate', label: 'Estate / residence' },
  { id: 'campus', label: 'Campus / school' },
  { id: 'hospital', label: 'Hospital' },
  { id: 'market', label: 'Market' },
  { id: 'industrial', label: 'Industrial park / factory' },
  { id: 'port', label: 'Port / depot' },
  { id: 'event', label: 'Event ground' },
  { id: 'other', label: 'Other restricted area' },
];

export const MEMBER_KINDS = [
  { id: 'staff', label: 'Staff' },
  { id: 'contractor', label: 'Contractor' },
  { id: 'resident', label: 'Resident' },
  { id: 'supplier', label: 'Supplier' },
  { id: 'vip', label: 'VIP' },
];

export const memberKindLabel = (id) => MEMBER_KINDS.find((k) => k.id === id)?.label || id;

export const ugx = (value) => `UGX ${Math.round(Number(value) || 0).toLocaleString('en-UG')}`;

export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
export const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export const duration = (minutes) => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

// Why an approved-list row is not good right now (the database's words).
export const MEMBER_STATE_TEXT = {
  ok: 'Active',
  member_revoked: 'Removed',
  member_suspended: 'Suspended',
  member_not_started: 'Not started',
  member_expired: 'Ended',
  outside_hours: 'Outside hours',
};

export const CARD_STATE_TEXT = {
  valid: 'Card valid',
  unpaid: 'Card not activated',
  expired: 'Card expired',
  suspended: 'Rider suspended',
  cancelled: 'Card cancelled',
  no_card: 'No card',
};
