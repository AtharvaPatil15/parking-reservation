import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, ErrorState, LoadingState, Modal, useToast, type BadgeTone } from '../../components';
import { useBooking, useReleaseBooking } from '../../api/hooks';
import type { components } from '../../api/types';

type BookingStatusValue = components['schemas']['BookingStatus'];

function toneFor(status: BookingStatusValue): BadgeTone | undefined {
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
      return undefined; // DRAFT / CANCELLED / RELEASED → neutral
  }
}

function Row({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className={emphasize ? 'text-right font-semibold text-text' : 'text-right text-text'}>{value}</dd>
    </>
  );
}

export function BookingStatus() {
  const { id } = useParams();
  const booking = useBooking(id);
  const release = useReleaseBooking();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (booking.isLoading) return <LoadingState label="Loading booking…" />;
  if (booking.isError || !booking.data) {
    return (
      <ErrorState
        title="Couldn't load booking"
        action={
          <Link to="/app" className="text-primary hover:underline">
            Back to dashboard
          </Link>
        }
      />
    );
  }

  const b = booking.data;
  const sb = b.scoreBreakdown;

  function onRelease() {
    if (!id) return;
    release.mutate(id, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast('Slot released.', { tone: 'success' });
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Booking status</h1>
          <p className="text-text-muted">
            {b.bookingDate} · {b.bookingType}
          </p>
        </div>
        <Badge tone={toneFor(b.status)}>{b.status}</Badge>
      </div>

      <Card title="Allocation">
        {b.status === 'ALLOCATED' && b.allocatedSlotNumber ? (
          <p className="text-text">
            Allocated slot <span className="font-semibold text-accent">{b.allocatedSlotNumber}</span>.
          </p>
        ) : (
          <p className="text-text-muted">No slot assigned ({b.status.toLowerCase()}).</p>
        )}
      </Card>

      <Card title="Score breakdown" description="How this request was scored.">
        {sb ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Distance" value={`${sb.distanceKm ?? '—'} km → ${sb.distanceScore.toFixed(1)}`} />
            <Row label="Carpool" value={`${sb.people} people → ${sb.carpoolScore.toFixed(1)}`} />
            <Row label="Weights" value={`distance ${sb.distanceWeight} · carpool ${sb.carpoolWeight}`} />
            <Row label="Final score" value={sb.finalScore.toFixed(1)} emphasize />
          </dl>
        ) : (
          <p className="text-text-muted">Not scored yet — available after allocation runs.</p>
        )}
      </Card>

      {b.carpoolMembers && b.carpoolMembers.length > 0 && (
        <Card title="Carpool members">
          <ul className="space-y-1.5 text-sm">
            {b.carpoolMembers.map((m, i) => (
              <li key={m.id ?? i} className="flex items-center gap-2">
                <span className="text-text">{m.name}</span>
                {m.employeeEmail && <span className="text-text-muted">{m.employeeEmail}</span>}
                {m.isScored && <Badge tone="success">scored</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {b.status === 'ALLOCATED' && (
        <div>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Release slot
          </Button>
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Release your slot?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={release.isPending} onClick={onRelease}>
              Release
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          Releasing frees your bay for the waitlist. This can't be undone for today.
        </p>
      </Modal>
    </div>
  );
}
