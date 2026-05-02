import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetirementProvider, RetirementContext } from './RetirementContext';
import { confirmDialog } from 'primereact/confirmdialog';
import type { Scenario } from '../types/Scenario';
import { openDB } from 'idb';

vi.mock('idb', () => ({
  openDB: vi.fn(),
}));

vi.mock('primereact/confirmdialog', () => ({
  confirmDialog: vi.fn(),
}));

vi.stubGlobal('crypto', {
  getRandomValues: vi.fn(() => new Uint8Array(16)),
  randomUUID: vi.fn(() => 'mock-uuid'),
});

// ---- helpers ----

function makeScenarioJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: 'New Scenario',
    currentAge: 40,
    inflationStdDev: 0,
    accounts: [],
    longTermCapGainsRate: 0.15,
    portfolioAssumptions: {
      portfolioBalance: '60_40',
      stockAllocation: 0.6,
      stockReturn: 0.07,
      stockStdDev: 0.15,
      bondReturn: 0.03,
      bondStdDev: 0.05,
    },
    ...overrides,
  });
}

function makeFile(text: string, name = 'scenario.json') {
  const file = new File([text], name, { type: 'application/json' });
  file.text = vi.fn().mockResolvedValue(text);
  return file;
}

// Intercepts document.createElement('input'), prevents click(), returns the element
function spyOnFileInput() {
  let capturedInput: HTMLInputElement | null = null;
  const originalCreate = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...args) => {
    if (tag === 'input') {
      const el = originalCreate('input') as HTMLInputElement;
      el.click = vi.fn();
      capturedInput = el;
      return el;
    }
    return originalCreate(tag, ...(args as []));
  });
  return {
    spy,
    getInput: () => capturedInput,
    restore: () => spy.mockRestore(),
  };
}

async function triggerFileSelection(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', {
    value: { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) },
    configurable: true,
  });
  await act(async () => {
    input.onchange!(new Event('change'));
  });
}

const TestComponent = () => {
  const context = React.useContext(RetirementContext)!;
  React.useEffect(() => {
    if (!context.loading) {
      context.importScenario();
    }
  }, [context.loading]);
  return <div data-testid='test'>Test</div>;
};

// ---- tests ----

describe('RetirementContext Import Tests', () => {
  let mockPut: ReturnType<typeof vi.fn>;
  let mockGetAll: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let inputSpy: ReturnType<typeof spyOnFileInput>;

  beforeEach(() => {
    mockPut = vi.fn().mockResolvedValue(undefined);
    mockGetAll = vi.fn().mockResolvedValue([]);
    mockDelete = vi.fn();
    mockGet = vi.fn();

    vi.mocked(openDB).mockResolvedValue({
      getAll: mockGetAll,
      put: mockPut,
      delete: mockDelete,
      get: mockGet,
    } as any);

    vi.mocked(confirmDialog).mockClear();
    vi.mocked(crypto.randomUUID).mockClear();

    inputSpy = spyOnFileInput();
  });

  afterEach(() => {
    inputSpy.restore();
  });

  it('imports new scenario successfully', async () => {
    const text = makeScenarioJson();
    vi.mocked(crypto.randomUUID).mockReturnValue('123e4567-e89b-12d3-a456-426614174000');

    render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    const input = await waitFor(() => {
      const el = inputSpy.getInput();
      if (!el) throw new Error('no input captured');
      return el;
    });

    await triggerFileSelection(input, makeFile(text));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        'scenarios',
        expect.objectContaining({
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'New Scenario',
        }),
        '123e4567-e89b-12d3-a456-426614174000'
      );
      expect(vi.mocked(confirmDialog)).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Scenario imported successfully!',
          header: 'Success',
        })
      );
    });
  });

  it('imports and overwrites existing scenario when accepted', async () => {
    const existingScenario: Scenario = { id: 'existing-id', name: 'Existing', currentAge: 50 } as Scenario;
    mockGetAll.mockResolvedValue([existingScenario]);

    const text = makeScenarioJson({ id: 'existing-id', name: 'Updated', currentAge: 50 });

    render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    const input = await waitFor(() => {
      const el = inputSpy.getInput();
      if (!el) throw new Error('no input captured');
      return el;
    });

    await triggerFileSelection(input, makeFile(text));

    await waitFor(() => {
      expect(vi.mocked(confirmDialog)).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `"Updated" already exists. Overwrite it or import as a separate copy?`,
          header: 'Scenario Already Exists',
        })
      );
    });

    const overwriteCall = vi.mocked(confirmDialog).mock.calls[0][0];
    await act(async () => {
      await (overwriteCall.accept as () => Promise<void>)();
    });

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        'scenarios',
        expect.objectContaining({ id: 'existing-id', name: 'Updated' }),
        'existing-id'
      );
      expect(vi.mocked(confirmDialog)).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Scenario imported successfully!', header: 'Success' })
      );
    });
  });

  it('imports as copy when duplicate is chosen', async () => {
    const existingScenario: Scenario = { id: 'existing-id', name: 'Existing', currentAge: 50 } as Scenario;
    mockGetAll.mockResolvedValue([existingScenario]);

    const text = makeScenarioJson({ id: 'existing-id', name: 'Updated', currentAge: 50 });
    vi.mocked(crypto.randomUUID).mockReturnValue('00000000-0000-0000-0000-000000000001');

    render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    const input = await waitFor(() => {
      const el = inputSpy.getInput();
      if (!el) throw new Error('no input captured');
      return el;
    });

    await triggerFileSelection(input, makeFile(text));

    await waitFor(() => {
      expect(vi.mocked(confirmDialog)).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Scenario Already Exists' })
      );
    });

    const overwriteCall = vi.mocked(confirmDialog).mock.calls[0][0];
    await act(async () => {
      await (overwriteCall.reject as () => Promise<void>)();
    });

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        'scenarios',
        expect.objectContaining({ id: '00000000-0000-0000-0000-000000000001', name: 'Updated' }),
        '00000000-0000-0000-0000-000000000001'
      );
      expect(vi.mocked(confirmDialog)).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Scenario imported as a new copy.' })
      );
    });
  });

  it('shows error for invalid scenario import', async () => {
    const text = JSON.stringify({ name: 'Invalid' }); // missing currentAge

    render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    const input = await waitFor(() => {
      const el = inputSpy.getInput();
      if (!el) throw new Error('no input captured');
      return el;
    });

    await triggerFileSelection(input, makeFile(text));

    await waitFor(() => {
      expect(vi.mocked(confirmDialog)).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Import failed: Invalid scenario: Missing name or currentAge.',
          header: 'Error',
        })
      );
      expect(mockPut).not.toHaveBeenCalled();
    });
  });
});
