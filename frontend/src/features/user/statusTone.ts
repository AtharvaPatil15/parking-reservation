import type { BadgeTone } from '../../components';
import type { components } from '../../api/types';

type BookingStatusValue = components['schemas']['BookingStatus'];

/** Badge tone for a booking status (undefined → neutral). */
export function statusTone(status: BookingStatusValue): BadgeTone | undefined {
  switch (status) {
    case 'ALLOCATED':
      return 'success';
    case 'WAITLISTED':
      return 'warning';
    case 'REJECTED':
    case 'EXPIRED':
      return 'danger';
    case 'SUBMITTED':
      return 'primary';
    default:
      return undefined;
  }
}
