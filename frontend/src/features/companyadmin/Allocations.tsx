import { AllocationRoster } from '../shared/AllocationRoster';

/**
 * Company Admin → Allocations: which of your company's users hold which seat, for what date, and
 * whether it came from primary allocation or the common pool.
 */
export function Allocations() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Allocations</h2>
        <p className="text-text-muted">Which seat is allotted to whom, by date — primary and common-pool.</p>
      </div>
      <AllocationRoster scope="company" />
    </div>
  );
}
