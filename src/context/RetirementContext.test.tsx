import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetirementProvider, RetirementContext } from './RetirementContext';
import { migrateLegacyTaxStrategy } from '../utils/scenarioMigration';
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
    // Test harness: fire importScenario exactly once when loading flips false.
    // Including `context` (new object each provider render) would re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.loading]);
  return <div data-testid='test'>Test</div>;
};

// Renders the provider and exposes the LATEST context value through a ref —
// for tests that drive the context API directly (clone/update/export/etc.)
// instead of auto-firing importScenario like TestComponent does.
function renderProvider() {
  const ref: { current: React.ContextType<typeof RetirementContext> } = { current: null };
  const Grabber = () => {
    ref.current = React.useContext(RetirementContext);
    return null;
  };
  render(
    <RetirementProvider>
      <Grabber />
    </RetirementProvider>
  );
  return ref;
}

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
    } as unknown as Awaited<ReturnType<typeof openDB>>);

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

  it('normalizes an under-specified legacy record silently on load (no toast)', async () => {
    // Old record missing portfolioAssumptions defaults. The load path now runs
    // the same normalization the import path always did — and persists it
    // WITHOUT firing the "Scenarios updated" migration toast.
    const legacy = {
      id: 'norm-id',
      name: 'Needs normalize',
      currentAge: 50,
      portfolioAssumptions: { stockReturn: 0.07, stockStdDev: 0.15, bondReturn: 0.03, bondStdDev: 0.05 },
    } as unknown as Scenario;
    mockGetAll.mockResolvedValue([legacy]);

    render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        'scenarios',
        expect.objectContaining({
          id: 'norm-id',
          schemaVersion: CURRENT_SCHEMA_VERSION,
          longTermCapGainsRate: 0.15,
          portfolioAssumptions: expect.objectContaining({ returnDistribution: 'lognormal', returnModel: 'parametric' }),
        }),
        'norm-id'
      );
    });
    // No content migration happened → no "Scenarios updated" toast.
    expect(vi.mocked(confirmDialog)).not.toHaveBeenCalledWith(
      expect.objectContaining({ header: 'Scenarios updated' })
    );
  });

  it('leaves a newer-schema record untouched on load (forward-compat guard)', async () => {
    const future = {
      id: 'future-id',
      name: 'From the future',
      currentAge: 50,
      schemaVersion: CURRENT_SCHEMA_VERSION + 5,
    } as Scenario;
    mockGetAll.mockResolvedValue([future]);

    render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    // Give the load loop a tick to settle, then assert it never re-persisted.
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled());
    expect(mockPut).not.toHaveBeenCalledWith('scenarios', expect.anything(), 'future-id');
  });

  it('rejects importing a file from a newer app version', async () => {
    const text = makeScenarioJson({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 });

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
          header: 'Error',
          message: expect.stringContaining('newer version of YARP'),
        })
      );
    });
    expect(mockPut).not.toHaveBeenCalled();
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

  describe('state management and persistence guards', () => {
    it('keeps a freshly-cloned scenario when updateScenario follows cloneScenario in one closure', async () => {
      // Repro for the stale-closure setter bug: both calls come from ONE
      // captured context snapshot. The old setters derived next state from the
      // render-time `scenarios` array, so the second call (updateScenario)
      // mapped over a snapshot that predated the clone — losing it from React
      // state (it survived only in IndexedDB).
      const base = { id: 'base-id', name: 'Base', currentAge: 50 } as Scenario;
      mockGetAll.mockResolvedValue([base]);
      vi.mocked(crypto.randomUUID).mockReturnValue('00000000-0000-4000-8000-000000000123');

      const ctx = renderProvider();
      await waitFor(() => expect(ctx.current?.loading).toBe(false));

      const captured = ctx.current!; // single closure, as in the repro
      await act(async () => {
        await captured.cloneScenario('base-id', 'Base (copy)');
        await captured.updateScenario({ ...base, name: 'Base renamed' } as Scenario);
      });

      await waitFor(() => {
        const names = ctx.current!.scenarios.map((s) => s.name).sort();
        expect(names).toEqual(['Base (copy)', 'Base renamed']);
      });
    });

    it('refuses to stamp/persist a newer-schema scenario on write (forward-compat guard)', async () => {
      const future = {
        id: 'future-id',
        name: 'From the future',
        currentAge: 50,
        schemaVersion: 999,
      } as Scenario;
      mockGetAll.mockResolvedValue([future]);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const ctx = renderProvider();
      await waitFor(() => expect(ctx.current?.loading).toBe(false));
      expect(mockPut).not.toHaveBeenCalled(); // load-path guard skipped re-persist

      // The MC probability write-back does exactly this after merely
      // activating the record — it must be a no-op, not a v999 → v1 downgrade.
      await act(async () => {
        await ctx.current!.updateScenario({ ...future, lastSuccessProbability: 55 } as Scenario);
      });
      expect(mockPut).not.toHaveBeenCalled();
      expect(ctx.current!.scenarios).toEqual([future]); // untouched, still v999

      await act(async () => {
        await ctx.current!.addScenario({ ...future, id: 'future-2' } as Scenario);
      });
      expect(mockPut).not.toHaveBeenCalled();
      expect(ctx.current!.scenarios).toEqual([future]);

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('still loads good records when one malformed record throws during migration', async () => {
      const good = { id: 'good-id', name: 'Good', currentAge: 50 } as Scenario;
      const malformed = {
        id: 'bad-id',
        name: 'Bad',
        currentAge: 50,
        // Legacy taxStrategy present + incomeEvents not an array → the
        // migration pipeline throws (TypeError on .filter). One bad record
        // must not brick the whole load.
        taxStrategy: { name: 'optimize' },
        incomeEvents: null,
      } as unknown as Scenario;
      mockGetAll.mockResolvedValue([malformed, good]);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const ctx = renderProvider();
      await waitFor(() => expect(ctx.current?.loading).toBe(false));

      const ids = ctx.current!.scenarios.map((s) => s.id);
      expect(ids).toContain('good-id'); // survived its neighbor's failure
      expect(ids).toContain('bad-id'); // loaded raw, unmigrated
      // The malformed record is never re-persisted...
      expect(mockPut).not.toHaveBeenCalledWith('scenarios', expect.anything(), 'bad-id');
      // ...while the good record went through the pipeline normally.
      expect(mockPut).toHaveBeenCalledWith(
        'scenarios',
        expect.objectContaining({ id: 'good-id', schemaVersion: CURRENT_SCHEMA_VERSION }),
        'good-id'
      );
      // No global persistence failure was reported.
      expect(ctx.current!.persistenceError).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('never auto-activates an unmigrated record, even when it sorts first', async () => {
      // The raw record skipped normalizeScenario, so it can be missing fields
      // the engine dereferences. Activating it runs the SYNCHRONOUS fast
      // preview, whose throw would escape to the app-wide ErrorBoundary — a
      // full-screen crash on every load, with no way to reach the sidebar and
      // delete it. The healthy neighbour must win instead.
      const malformed = {
        id: 'bad-id', name: 'Bad', currentAge: 50,
        taxStrategy: { name: 'optimize' }, incomeEvents: null,
      } as unknown as Scenario;
      const good = { id: 'good-id', name: 'Good', currentAge: 50 } as Scenario;
      mockGetAll.mockResolvedValue([malformed, good]); // malformed is FIRST
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const ctx = renderProvider();
      await waitFor(() => expect(ctx.current?.loading).toBe(false));

      expect(ctx.current!.activeScenario?.id).toBe('good-id');
      errorSpy.mockRestore();
    });

    it('leaves activeScenario null when EVERY record fails migration', async () => {
      const malformed = {
        id: 'bad-id', name: 'Bad', currentAge: 50,
        taxStrategy: { name: 'optimize' }, incomeEvents: null,
      } as unknown as Scenario;
      mockGetAll.mockResolvedValue([malformed]);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const ctx = renderProvider();
      await waitFor(() => expect(ctx.current?.loading).toBe(false));

      // Listed (so the user can delete it) but not active — empty state beats
      // a crash loop.
      expect(ctx.current!.scenarios.map((s) => s.id)).toEqual(['bad-id']);
      expect(ctx.current!.activeScenario).toBeNull();
      errorSpy.mockRestore();
    });

    it('strips lastSuccessProbability from exported scenario JSON', async () => {
      const scenario = {
        id: 'exp-id',
        name: 'Export Me',
        currentAge: 50,
        lastSuccessProbability: 87,
      } as Scenario;
      mockGetAll.mockResolvedValue([scenario]);

      // Exercise the File System Access API branch and capture what's written.
      let written = '';
      const writable = {
        write: vi.fn(async (data: string) => {
          written = data;
        }),
        close: vi.fn(async () => {}),
      };
      window.showSaveFilePicker = vi.fn(async () => ({
        createWritable: async () => writable,
      })) as unknown as typeof window.showSaveFilePicker;

      try {
        const ctx = renderProvider();
        await waitFor(() => expect(ctx.current?.loading).toBe(false));

        await act(async () => {
          await ctx.current!.exportScenario('exp-id');
        });

        expect(written).not.toBe('');
        const parsed = JSON.parse(written) as Record<string, unknown>;
        expect(parsed).not.toHaveProperty('lastSuccessProbability');
        expect(parsed.name).toBe('Export Me');
        expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      } finally {
        delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
      }
    });
  });
});
