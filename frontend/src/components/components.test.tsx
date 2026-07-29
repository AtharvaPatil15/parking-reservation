import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';
import { Input } from './Input';
import { Select } from './Select';
import { Table, type Column } from './Table';
import { EmptyState } from './States';

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge tone="success">Allocated</Badge>);
    expect(screen.getByText('Allocated')).toBeInTheDocument();
  });
});

describe('Input', () => {
  it('associates the label and exposes the error with aria-invalid', () => {
    render(<Input label="Email" error="Required" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});

describe('Select', () => {
  it('keeps the placeholder selected when only placeholder + options are given', () => {
    render(
      <Select
        label="Lot"
        placeholder="Choose a lot"
        options={[
          { value: 'a', label: 'Lot A' },
          { value: 'b', label: 'Lot B' },
        ]}
      />,
    );
    const select = screen.getByLabelText('Lot') as HTMLSelectElement;
    expect(select.value).toBe('');
  });
});

interface Row {
  id: string;
  name: string;
}
const columns: Column<Row>[] = [{ key: 'name', header: 'Name', render: (r) => r.name }];

describe('Table', () => {
  it('renders rows', () => {
    render(<Table columns={columns} rows={[{ id: '1', name: 'Priya' }]} rowKey={(r) => r.id} />);
    expect(screen.getByText('Priya')).toBeInTheDocument();
  });

  it('shows the empty slot when there are no rows', () => {
    render(
      <Table
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<span>Nothing here</span>}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No bookings" description="Create one to get started." />);
    expect(screen.getByText('No bookings')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
  });
});
