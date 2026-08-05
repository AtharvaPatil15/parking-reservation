import { Badge, Button, LoadingState, Modal } from '../../components';
import { useUserDetail } from '../../api/hooks';

export interface UserDetailsModalProps {
  /** The user to show. `null` closes the dialog and skips the fetch entirely. */
  userId: string | null;
  onClose: () => void;
  /** Rendered in the footer — the approve/reject buttons, so a decision can be made from here. */
  actions?: React.ReactNode;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text">{value}</dd>
    </>
  );
}

/**
 * Everything about one applicant, for the approval screens.
 *
 * The queues list name, email and status, which is not enough to approve on. The number that matters
 * most here is the **home → office distance**: it is 60% of the person's allocation score, so approving
 * someone with 2 km against someone with 38 km has real consequences for who gets a slot all year. The
 * address is shown next to it because it is the only way an admin can sanity-check that distance.
 *
 * Fetched on open rather than joined into the list: the list is paged and most rows are never inspected.
 */
export function UserDetailsModal({ userId, onClose, actions }: UserDetailsModalProps) {
  const detail = useUserDetail(userId);
  const u = detail.data;

  return (
    <Modal
      open={userId !== null}
      onClose={onClose}
      size="lg"
      title={u ? u.fullName : 'Applicant details'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {actions}
        </>
      }
    >
      {detail.isLoading ? (
        <LoadingState label="Loading details…" />
      ) : detail.isError || !u ? (
        <p role="alert" className="text-sm text-danger">
          Could not load this person's details.
        </p>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
            <Row label="Name" value={<span className="font-medium">{u.fullName}</span>} />
            <Row label="Email" value={u.email} />
            <Row label="Contact" value={u.contactNumber || '—'} />
            <Row label="Company" value={<Badge tone="neutral">{u.companyName}</Badge>} />
            <Row label="Requested as" value={u.role === 'SECURITY' ? 'Security' : u.role === 'COMPANY_ADMIN' ? 'Company admin' : 'Employee'} />
            <Row
              label="Status"
              value={
                <Badge tone={u.status === 'ACTIVE' ? 'success' : u.status === 'PENDING' ? 'warning' : 'danger'}>
                  {u.status}
                </Badge>
              }
            />
          </dl>

          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-text">Home</h3>
            <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="Address" value={u.address || '—'} />
              <Row label="Pin code" value={u.pinCode || '—'} />
              <Row
                label="Distance to office"
                value={
                  u.distanceKm != null ? (
                    <span className="font-medium tabular-nums">{u.distanceKm} km</span>
                  ) : (
                    // Not cosmetic: with no distance the person cannot book at all, so an admin
                    // approving them should know they have an unfinished profile.
                    <span className="text-warning">Not set — they cannot book until they add it</span>
                  )
                }
              />
            </dl>
            {u.distanceKm != null && (
              <p className="text-xs text-text-muted">
                Distance is 60% of the allocation score, so it decides who wins a contested day.
              </p>
            )}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-text">Cars</h3>
            {u.vehicles.length === 0 ? (
              <p className="text-sm text-text-muted">No cars in the registry yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {u.vehicles.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium text-text">{v.displayNumber}</span>
                    <span className="text-text-muted">
                      {[v.vehicleType.replace('_', ' ').toLowerCase(), v.makeModel, v.colour]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
