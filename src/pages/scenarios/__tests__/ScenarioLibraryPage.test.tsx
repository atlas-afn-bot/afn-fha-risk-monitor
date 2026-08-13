/**
 * ScenarioLibraryPage — PR-C tests.
 *
 * Covers acceptance criteria from the PR-C spec:
 *   1. Renders S1–S4 seed scenarios on an empty localStorage store.
 *   2. "New scenario" button navigates to /scenarios/new.
 *   3. Include-hidden toggle filters visibility.
 *   4. Row toggle hides / shows a scenario (persists to localStorage).
 *   5. Deep-link into /scenarios/:id is a plain <Link> element the test
 *      can click.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ScenarioLibraryPage from '../ScenarioLibraryPage';
import * as store from '@/lib/scenarios/store';

const TEST_OWNER = 'test-owner-library';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/scenarios']}>
      <Routes>
        <Route path="/scenarios" element={<ScenarioLibraryPage ownerId={TEST_OWNER} />} />
        <Route path="/scenarios/new" element={<div data-testid="new-scenario-route">new</div>} />
        <Route path="/scenarios/:id" element={<div data-testid="detail-route">detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ScenarioLibraryPage', () => {
  beforeEach(() => {
    store._resetForTests(TEST_OWNER);
  });
  afterEach(() => {
    cleanup();
    store._resetForTests(TEST_OWNER);
  });

  it('renders S1–S4 seed scenarios when the localStorage store is empty', async () => {
    renderPage();
    expect(await screen.findByTestId('scenario-row-s1-boost-full-removal')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-row-s2-boost-fico-eg')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-row-s3-boost-guidelines-tighten')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-row-s4-proprietary-dpa-guidelines-tighten')).toBeInTheDocument();
    const s1 = screen.getByTestId('scenario-row-s1-boost-full-removal');
    expect(within(s1).getByText(/v16 seed/i)).toBeInTheDocument();
  });

  it('New scenario button navigates to /scenarios/new', async () => {
    renderPage();
    await screen.findByTestId('scenario-row-s1-boost-full-removal');
    fireEvent.click(screen.getByTestId('new-scenario-button'));
    expect(screen.getByTestId('new-scenario-route')).toBeInTheDocument();
  });

  it('include-hidden toggle changes the visible scenario set', async () => {
    store.setVisible(TEST_OWNER, 's1-boost-full-removal', false);
    renderPage();
    expect(await screen.findByTestId('scenario-row-s2-boost-fico-eg')).toBeInTheDocument();
    expect(screen.queryByTestId('scenario-row-s1-boost-full-removal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('include-hidden-toggle'));
    expect(screen.getByTestId('scenario-row-s1-boost-full-removal')).toBeInTheDocument();
    expect(within(screen.getByTestId('scenario-row-s1-boost-full-removal')).getByText(/hidden/i)).toBeInTheDocument();
  });

  it('toggling visibility on a seed row persists to localStorage', async () => {
    renderPage();
    await screen.findByTestId('scenario-row-s1-boost-full-removal');
    fireEvent.click(screen.getByTestId('toggle-visible-s1-boost-full-removal'));
    expect(screen.queryByTestId('scenario-row-s1-boost-full-removal')).not.toBeInTheDocument();
    const persisted = store.get(TEST_OWNER, 's1-boost-full-removal');
    expect(persisted?.visible).toBe(false);
  });

  it('deep-link into /scenarios/:id via the row title routes to the detail page', async () => {
    renderPage();
    await screen.findByTestId('scenario-row-s1-boost-full-removal');
    const link = within(screen.getByTestId('scenario-row-s1-boost-full-removal')).getByRole('link', {
      name: /Boost fully removed/i,
    });
    fireEvent.click(link);
    expect(screen.getByTestId('detail-route')).toBeInTheDocument();
  });

  it('renders empty state when every scenario is hidden and include-hidden is off', async () => {
    for (const id of ['s1-boost-full-removal', 's2-boost-fico-eg', 's3-boost-guidelines-tighten', 's4-proprietary-dpa-guidelines-tighten']) {
      store.setVisible(TEST_OWNER, id, false);
    }
    renderPage();
    expect(await screen.findByTestId('scenarios-empty')).toBeInTheDocument();
  });
});
