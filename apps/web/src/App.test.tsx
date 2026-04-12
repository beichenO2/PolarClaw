import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders shell, main landmark, navigation, and overview content', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    expect(container.querySelector('.shell')).toBeInTheDocument();
    expect(screen.getByText('MyClaw')).toBeInTheDocument();
    expect(screen.getByText('dashboard')).toBeInTheDocument();

    expect(screen.getByRole('main')).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('button', { name: '概览' })).toHaveAttribute('aria-current', 'true');

    expect(screen.getByRole('heading', { name: '本周结果' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本周交付' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About', level: 2 })).toBeInTheDocument();

    await user.click(within(nav).getByRole('button', { name: '任务' }));
    expect(screen.getByRole('heading', { name: '任务看板' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '本周结果' })).not.toBeInTheDocument();
  });
});
