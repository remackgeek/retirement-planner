import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetirementProvider, RetirementContext } from './RetirementContext';
import { confirmDialog } from 'primereact/confirmdialog';
import type { Scenario } from '../types/Scenario';
import { openDB } from 'idb';

// Mock idb
vi.mock('idb', () => ({
  openDB: vi.fn(),
}));

// Mock confirmDialog
vi.mock('primereact/confirmdialog', () => ({
  confirmDialog: vi.fn(),
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  getRandomValues: vi.fn(() => new Uint8Array(16)),
  randomUUID: vi.fn(() => 'mock-uuid'),
});

// Mock window.showOpenFilePicker
const mockFileHandle = {
  kind: 'file' as const,
  getFile: vi.fn(),
  createWritable: vi.fn(),
  name: 'test.json',
  isSameEntry: vi.fn(),
} as Partial<FileSystemFileHandle> & { getFile: typeof vi.fn };
const mockFile = new File(['{"name": "Test", "currentAge": 30}'], 'test.json', {
  type: 'application/json',
});
mockFileHandle.getFile.mockResolvedValue(mockFile);
vi.stubGlobal(
  'showOpenFilePicker',
  vi.fn().mockResolvedValue([mockFileHandle as any])
);

// Mock window.showSaveFilePicker for completeness
vi.stubGlobal('showSaveFilePicker', vi.fn());

const TestComponent = () => {
  const context = React.useContext(RetirementContext)!;
  React.useEffect(() => {
    context.importScenario();
  }, []);
  return <div data-testid='test'>Test</div>;
};

describe('RetirementContext Import Tests', () => {
  let mockPut: ReturnType<typeof vi.fn>;
  let mockGetAll: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockOpenDB: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPut = vi.fn().mockResolvedValue(undefined);
    mockGetAll = vi.fn().mockResolvedValue([]);
    mockDelete = vi.fn();
    mockGet = vi.fn();

    mockOpenDB = vi.fn().mockResolvedValue({
      getAll: mockGetAll,
      put: mockPut,
      delete: mockDelete,
      get: mockGet,
    } as any);

    // Set the mock on the module
    const idbModule = vi.mocked(openDB);
    idbModule.mockImplementation(mockOpenDB);

    // Reset mocks
    vi.mocked(confirmDialog).mockClear();
    vi.mocked(window.showOpenFilePicker).mockClear();
    vi.mocked(crypto.randomUUID).mockClear();
    (mockFileHandle.getFile as vi.Mock).mockClear();
  });

  it('imports new scenario successfully', async () => {
    const mockText = '{"name": "New Scenario", "currentAge": 40}';
    const newFile = new File([mockText], 'new.json', {
      type: 'application/json',
    });
    newFile.text = vi.fn().mockResolvedValue(mockText);
    (mockFileHandle.getFile as vi.Mock).mockResolvedValue(newFile);
    vi.mocked(crypto.randomUUID).mockReturnValue(
      '123e4567-e89b-12d3-a456-426614174000'
    );
    vi.mocked(window.showOpenFilePicker).mockResolvedValue([
      mockFileHandle as any,
    ]);

    const { getByLabelText } = render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    // Wait for dialog to open
    await waitFor(() => {
      expect(getByLabelText('Choose JSON File')).toBeInTheDocument();
    });

    // Click the button to trigger confirmImport
    await act(async () => {
      fireEvent.click(getByLabelText('Choose JSON File'));
    });

    await waitFor(() => {
      expect(vi.mocked(window.showOpenFilePicker)).toHaveBeenCalled();
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
    const existingScenario: Scenario = {
      id: 'existing-id',
      name: 'Existing',
      currentAge: 50,
    } as Scenario;
    mockGetAll.mockResolvedValue([existingScenario]);

    const mockText =
      '{"id": "existing-id", "name": "Updated", "currentAge": 50}';
    const updateFile = new File([mockText], 'update.json', {
      type: 'application/json',
    });
    updateFile.text = vi.fn().mockResolvedValue(mockText);
    (mockFileHandle.getFile as vi.Mock).mockResolvedValue(updateFile);
    vi.mocked(window.showOpenFilePicker).mockResolvedValue([
      mockFileHandle as any,
    ]);

    const { getByLabelText } = render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    await waitFor(() => {
      expect(getByLabelText('Choose JSON File')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(getByLabelText('Choose JSON File'));
    });

    // Now confirmDialog for overwrite is called
    await waitFor(() => {
      expect(vi.mocked(confirmDialog)).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `A scenario with ID 'existing-id' already exists. Importing will overwrite it. Are you sure?`,
          header: 'Overwrite Scenario?',
        })
      );
    });

    // Call accept callback
    const confirmMock = vi.mocked(confirmDialog);
    const overwriteOptions = confirmMock.mock.calls[0][0];
    const acceptCallback = overwriteOptions.accept as () => Promise<void>;
    await act(async () => {
      await acceptCallback();
    });

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        'scenarios',
        expect.objectContaining({ id: 'existing-id', name: 'Updated' }),
        'existing-id'
      );
      expect(vi.mocked(confirmDialog)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: 'Scenario imported successfully!',
          header: 'Success',
        })
      );
    });
  });

  it('cancels import when overwrite is rejected', async () => {
    const existingScenario: Scenario = {
      id: 'existing-id',
      name: 'Existing',
      currentAge: 50,
    } as Scenario;
    mockGetAll.mockResolvedValue([existingScenario]);

    const mockText =
      '{"id": "existing-id", "name": "Updated", "currentAge": 50}';
    const updateFile = new File([mockText], 'update.json', {
      type: 'application/json',
    });
    updateFile.text = vi.fn().mockResolvedValue(mockText);
    (mockFileHandle.getFile as vi.Mock).mockResolvedValue(updateFile);
    vi.mocked(window.showOpenFilePicker).mockResolvedValue([
      mockFileHandle as any,
    ]);

    const { getByLabelText } = render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    await waitFor(() => {
      expect(getByLabelText('Choose JSON File')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(getByLabelText('Choose JSON File'));
    });

    await waitFor(() => {
      expect(vi.mocked(confirmDialog)).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `A scenario with ID 'existing-id' already exists. Importing will overwrite it. Are you sure?`,
          header: 'Overwrite Scenario?',
        })
      );
    });

    // Call reject callback
    const confirmMock = vi.mocked(confirmDialog);
    const overwriteOptions = confirmMock.mock.calls[0][0];
    const rejectCallback = overwriteOptions.reject as () => void;
    await act(async () => {
      rejectCallback();
    });

    await waitFor(() => {
      expect(mockPut).not.toHaveBeenCalledWith(
        'scenarios',
        expect.objectContaining({ id: 'existing-id', name: 'Updated' }),
        'existing-id'
      );
      expect(vi.mocked(confirmDialog)).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Scenario imported successfully!' })
      );
    });
  });

  it('shows error for invalid scenario import', async () => {
    const mockText = '{"name": "Invalid"}'; // Missing currentAge
    const invalidFile = new File([mockText], 'invalid.json', {
      type: 'application/json',
    });
    invalidFile.text = vi.fn().mockResolvedValue(mockText);
    (mockFileHandle.getFile as vi.Mock).mockResolvedValue(invalidFile);
    vi.mocked(window.showOpenFilePicker).mockResolvedValue([
      mockFileHandle as any,
    ]);

    const { getByLabelText } = render(
      <RetirementProvider>
        <TestComponent />
      </RetirementProvider>
    );

    await waitFor(() => {
      expect(getByLabelText('Choose JSON File')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(getByLabelText('Choose JSON File'));
    });

    await waitFor(() => {
      expect(vi.mocked(confirmDialog)).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Import failed: Invalid scenario: Missing name or currentAge.',
          header: 'Error',
        })
      );
      expect(mockPut).not.toHaveBeenCalled();
    });
  });
});
