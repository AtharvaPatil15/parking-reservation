import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pager } from './Pager';

describe('Pager', () => {
  it('shows the range/page summary and navigates', async () => {
    const onPage = vi.fn();
    render(<Pager page={2} pageSize={10} total={25} onPage={onPage} />);

    expect(screen.getByText('11–20 of 25')).toBeInTheDocument();
    expect(screen.getByText('Page 2 / 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /prev/i }));
    expect(onPage).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPage).toHaveBeenCalledWith(3);
  });

  it('disables Prev on the first page and Next on the last', () => {
    const { rerender } = render(<Pager page={1} pageSize={10} total={25} onPage={vi.fn()} />);
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();

    rerender(<Pager page={3} pageSize={10} total={25} onPage={vi.fn()} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});
