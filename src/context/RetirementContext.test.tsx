import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetirementProvider, RetirementContext, migrateLegacyTaxStrategy } from './RetirementContext';
import { confirmDialog } from 'primereact/confirmdialog';
import type { Scenario } from '../types/Scenario';
import { CURRENT_SCHEMA_VERSION } from '../types/Scenario';
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
    lifeExpectancy: 90,
    referenceYear: 2026,
    inflationRate: 0.03,
    inflationStdDev: 0,
    filingStatus: 'single',
    spouseAge: null,
    accounts: [],
    incomeEvents: [],
    spendingGoals: [],
    stateTimeline: [{ state: 'Florida' }],
    simulationSettings: { numSimulations: 100 },
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

  it('stamps schemaVersion on an imported scenario that lacks it', async () => {
    // makeScenarioJson() emits no schemaVersion (a legacy / hand-written file).
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
        expect.objectContaining({ schemaVersion: CURRENT_SCHEMA_VERSION }),
        '123e4567-e89b-12d3-a456-426614174000'
      );
    });
  });

  it('stamps schemaVersion on a legacy record during initDB load', async () => {
    // A record already in IndexedDB with no schemaVersion must be re-persisted
    // with the current stamp on load (silent — no migration toast for this).
    const legacy = { id: 'legacy-id', name: 'Legacy', currentAge: 50 } as Scenario;
    mockGetAll.mockResolvedValue([legacy]);

    render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        'scenarios',
        expect.objectContaining({ id: 'legacy-id', schemaVersion: CURRENT_SCHEMA_VERSION }),
        'legacy-id'
      );
    });
  });

  describe('migrateLegacyTaxStrategy', () => {
    // Direct unit tests for the migration function (R13). Past-year filter,
    // idempotency, empty-cache, and generator-name mapping each have
    // user-data-affecting branches that should be locked in.

    // Counter so each call to randomUUID returns a unique value (the migration
    // builds event ids from a slice of generatorRunId — duplicate runIds
    // would collide with our M2 idempotency strip).
    let uuidCounter = 0;
    beforeEach(() => {
      uuidCounter = 0;
      vi.mocked(crypto.randomUUID).mockImplementation(
        () => `runid-${++uuidCounter}-0000-0000-0000-000000000000` as `${string}-${string}-${string}-${string}-${string}`
      );
    });

    const baseScenario = (overrides: Partial<Scenario> = {}): Scenario =>
      ({
        id: 's1',
        name: 'Legacy',
        currentAge: 62,
        lifeExpectancy: 92,
        referenceYear: 2026,
        accounts: [],
        spendingGoals: [],
        incomeEvents: [],
        portfolioAssumptions: {
          stockReturn: 0.07, stockStdDev: 0.15, bondReturn: 0.03, bondStdDev: 0.05,
          stockBondCorrelationEnabled: false, stockBondCorrelation: 0,
          returnDistribution: 'lognormal', degreesOfFreedom: 4,
        },
        inflationRate: 0.03,
        inflationStdDev: 0,
        simulationSettings: { numSimulations: 100 },
        filingStatus: 'single',
        spouseAge: null,
        stateTimeline: [{ state: 'Florida' }],
        longTermCapGainsRate: 0.15,
        ...overrides,
      } as Scenario);

    it('drops past-year decisions (year < referenceYear)', () => {
      const scenarioWithLegacy = {
        ...baseScenario(),
        // legacy field — cast-through-unknown is how the production migration reads it
        taxStrategy: {
          name: 'optimize',
          cachedVector: {
            fingerprint: 'x',
            perYearDecisions: [
              { year: 2024, conversionAmount: 50_000 },  // past — must drop
              { year: 2025, conversionAmount: 50_000 },  // past — must drop
              { year: 2026, conversionAmount: 30_000 },  // current — keep
              { year: 2027, conversionAmount: 30_000 },  // future — keep
            ],
          },
        },
      } as unknown as Scenario;
      const { scenario: migrated, addedConversions } = migrateLegacyTaxStrategy(scenarioWithLegacy);
      expect(addedConversions).toBe(2);
      const conversions = migrated.incomeEvents.filter((e) => e.type === 'roth_conversion');
      expect(conversions).toHaveLength(2);
      // Verify the surviving years.
      const years = conversions.map((e) => 2026 + (e.startAge - 62));
      expect(years.sort()).toEqual([2026, 2027]);
      // No event has startAge below currentAge (which would render it inert).
      for (const c of conversions) expect(c.startAge).toBeGreaterThanOrEqual(62);
      // taxStrategy field is stripped from the migrated scenario.
      expect((migrated as unknown as { taxStrategy?: unknown }).taxStrategy).toBeUndefined();
    });

    it('returns the scenario unchanged when there is no cachedVector', () => {
      const scenarioWithLegacy = {
        ...baseScenario(),
        taxStrategy: { name: 'fill_to_bracket' },  // strategy named but never Compute-d
      } as unknown as Scenario;
      const { scenario: migrated, addedConversions } = migrateLegacyTaxStrategy(scenarioWithLegacy);
      expect(addedConversions).toBe(0);
      expect(migrated.incomeEvents).toEqual([]);
      // Field is still stripped even when nothing was materialized.
      expect((migrated as unknown as { taxStrategy?: unknown }).taxStrategy).toBeUndefined();
    });

    it('idempotently strips prior migrated-conv-* events on re-migration', () => {
      // Simulate: the scenario was already migrated once (so it has
      // migrated-conv-* events on it), and the user re-imports the original
      // legacy JSON (so taxStrategy.cachedVector is back). The function must
      // strip the old migrated batch before appending the new one.
      const priorMigrated = {
        id: 'migrated-conv-2027-deadbeef',
        type: 'roth_conversion' as const,
        name: 'Roth conversion 2027',
        amount: 99_999,  // stale value the user "edited" in JSON — should be replaced
        startAge: 63,
        endAge: 63,
        isOneTime: true,
        taxStatus: 'before_tax' as const,
        colaType: 'fixed' as const,
        meta: { generatedBy: 'optimize' as const, generatedAt: '2026-01-01', generatorRunId: 'old-run' },
      };
      const scenarioWithLegacy = {
        ...baseScenario({ incomeEvents: [priorMigrated] }),
        taxStrategy: {
          name: 'optimize',
          cachedVector: {
            fingerprint: 'x',
            perYearDecisions: [
              { year: 2027, conversionAmount: 30_000 },  // fresh value
            ],
          },
        },
      } as unknown as Scenario;
      const { scenario: migrated, addedConversions } = migrateLegacyTaxStrategy(scenarioWithLegacy);
      expect(addedConversions).toBe(1);
      const conversions = migrated.incomeEvents.filter((e) => e.type === 'roth_conversion');
      // Exactly one — the prior migrated-conv-2027 was stripped, the fresh one added.
      expect(conversions).toHaveLength(1);
      expect(conversions[0].amount).toBe(30_000);
      // The new event id is also migrated-conv-* (just with a new run-id slice).
      expect(conversions[0].id.startsWith('migrated-conv-')).toBe(true);
      expect(conversions[0].id).not.toBe(priorMigrated.id);
    });

    it("maps the legacy strategy name into meta.generatedBy", () => {
      const cases = [
        { name: 'optimize', expected: 'optimize' },
        { name: 'auto_bracket', expected: 'auto_bracket' },
        { name: 'fill_to_bracket', expected: 'fill_to_bracket' },
        { name: 'fixed', expected: 'user' }, // anything else collapses to user
        { name: 'unknown-future-name', expected: 'user' },
      ];
      for (const c of cases) {
        const scenarioWithLegacy = {
          ...baseScenario(),
          taxStrategy: {
            name: c.name,
            cachedVector: {
              fingerprint: 'x',
              perYearDecisions: [{ year: 2026, conversionAmount: 25_000 }],
            },
          },
        } as unknown as Scenario;
        const { scenario: migrated } = migrateLegacyTaxStrategy(scenarioWithLegacy);
        const conversion = migrated.incomeEvents.find((e) => e.type === 'roth_conversion');
        expect(conversion?.meta?.generatedBy).toBe(c.expected);
      }
    });
  });

  it('rejects scenarios with numSimulations < 1 on import (E1)', async () => {
    // numSimulations: 0 would crash runSimulation (division by zero in
    // probability calc, undefined deref in pickRepresentatives). The import
    // validator must reject it loudly.
    const text = makeScenarioJson({ simulationSettings: { numSimulations: 0 } });

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
          message: expect.stringContaining('numSimulations must be at least 1'),
          header: 'Error',
        })
      );
      expect(mockPut).not.toHaveBeenCalled();
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
