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

  it('reports no results rather than a zero range', () => {
    render(<Pager page={1} pageSize={10} total={0} onPage={vi.fn()} />);
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('clamps a page left past the end after the total shrinks', () => {
    // A filter or refetch can drop `total` while the caller is still on page 3.
    render(<Pager page={3} pageSize={10} total={5} onPage={vi.fn()} />);

    // Without clamping this would read "21–10 of 5" on a single-page result.
    expect(screen.getByText('1–5 of 5')).toBeInTheDocument();
    expect(screen.getByText('Page 1 / 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('steps from the clamped page, not the out-of-range one', async () => {
    const onPage = vi.fn();
    render(<Pager page={9} pageSize={10} total={25} onPage={onPage} />);
    expect(screen.getByText('Page 3 / 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /prev/i }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
