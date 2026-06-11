import { Chart } from 'chart.js';
import type { Plugin, ChartType } from 'chart.js';
import { colors } from '../styles/theme';
import { eventTypeIcons as incomeEventTypeIcons, goalTypeIcons } from '../utils/defaultName';
import type { IncomeEvent } from '../types/IncomeEvent';
import type { SpendingGoal } from '../types/SpendingGoal';

// Extend Chart.js types to include our custom plugin
declare module 'chart.js' {
  // Type param name must match chart.js's own declaration for merging (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    htmlAnnotations?: HtmlAnnotationsOptions;
  }
}

export interface AnnotationConfig {
  id: string;
  type: 'income' | 'spending';
  eventType: string;
  xValue: number;
  yValue: number;
  stackIndex: number;
  data?: IncomeEvent | SpendingGoal;
}

interface HtmlAnnotationsOptions {
  annotations: AnnotationConfig[];
  onIconClick?: (annotation: AnnotationConfig) => void;
  onIconHover?: (annotation: AnnotationConfig | null) => void;
}

// Per-chart plugin state attached in beforeInit, removed in beforeDestroy.
// Private to this file — nothing else reads these fields.
interface HtmlAnnotationsState {
  container: HTMLDivElement;
  dataKey: string | null;
  elements: Map<string, HTMLElement>;
}

type ChartWithAnnotations = Chart & { _htmlAnnotations?: HtmlAnnotationsState };

const getState = (chart: Chart): HtmlAnnotationsState | undefined =>
  (chart as ChartWithAnnotations)._htmlAnnotations;

const eventTypeIcons: Record<string, string> = {
  ...incomeEventTypeIcons,
  ...goalTypeIcons,
};

function updateIconPositions(chart: Chart, annotations: AnnotationConfig[]) {
  const elements = getState(chart)?.elements;
  if (!elements) return;

  annotations.forEach((annotation) => {
    const element = elements.get(annotation.id);
    if (!element) return;

    const xScale = chart.scales.x;
    // Round xValue to ensure it aligns with category (integer index)
    const xValue = Math.round(annotation.xValue);
    const x = xScale.getPixelForValue(xValue);
    // Get bottom of chart area as baseline (just above x-axis)
    const baseline = chart.chartArea.bottom;
    // Position icon so its bottom edge is 2px above the chart bottom
    // Icon is 24px tall, transform centers it, so center = baseline - 14px
    const y = baseline - 14 - 28 * annotation.stackIndex;

    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  });
}

function createIconElement(
  annotation: AnnotationConfig,
  x: number,
  y: number,
  onClick?: (annotation: AnnotationConfig) => void,
  onHover?: (annotation: AnnotationConfig | null) => void
): HTMLElement {
  const icon = document.createElement('i');
  const isIncome = annotation.type === 'income';

  // Add PrimeReact icon class
  icon.className = eventTypeIcons[annotation.eventType] || 'pi pi-circle';

  // Style the icon
  Object.assign(icon.style, {
    position: 'absolute',
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -50%)',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: isIncome ? colors.incomeBg : colors.spendingBg,
    border: `2px solid ${isIncome ? colors.income : colors.spending}`,
    color: isIncome ? colors.income : colors.spending,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    cursor: 'pointer',
    pointerEvents: 'auto',
    transition: 'all 0.2s ease',
    boxShadow: `0 2px 4px ${colors.shadowLight}`,
    zIndex: '10',
  });

  // Add tooltip
  const tooltipText = annotation.data
    ? `${annotation.data.name}\nAmount: $${annotation.data.amount?.toLocaleString()}`
    : '';
  icon.title = tooltipText;

  // Add click handler
  if (onClick) {
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(annotation);
    });
  }

  // Add hover effects
  if (onHover) {
    icon.addEventListener('mouseenter', () => {
      icon.style.transform = 'translate(-50%, -50%) scale(1.2)';
      icon.style.boxShadow = `0 4px 8px ${colors.shadowMedium}`;
      icon.style.zIndex = '100';
      onHover(annotation);
    });

    icon.addEventListener('mouseleave', () => {
      icon.style.transform = 'translate(-50%, -50%) scale(1)';
      icon.style.boxShadow = `0 2px 4px ${colors.shadowLight}`;
      icon.style.zIndex = '10';
      onHover(null);
    });
  }

  return icon;
}

const htmlAnnotationsPlugin: Plugin = {
  id: 'htmlAnnotations',

  beforeInit(chart: Chart) {
    // Create overlay container positioned to match the canvas exactly
    const container = document.createElement('div');
    container.className = 'chart-html-annotations';
    const canvas = chart.canvas;

    // Position container to overlay the canvas precisely
    container.style.position = 'absolute';
    container.style.top = `${canvas.offsetTop}px`;
    container.style.left = `${canvas.offsetLeft}px`;
    container.style.width = `${canvas.offsetWidth}px`;
    container.style.height = `${canvas.offsetHeight}px`;
    container.style.pointerEvents = 'none';
    container.style.zIndex = '10';

    const parent = canvas.parentElement;
    if (parent) {
      parent.style.position = 'relative';
      parent.appendChild(container);
    }

    // Store container and state
    (chart as ChartWithAnnotations)._htmlAnnotations = {
      container,
      dataKey: null,
      elements: new Map(),
    };
  },

  afterDraw(chart: Chart) {
    const state = getState(chart);
    if (!state) return;
    // Chart.js types plugin options as _DeepPartial; our caller always supplies
    // the full shape, so narrow back to the declared options interface.
    const options = chart.options.plugins?.htmlAnnotations as HtmlAnnotationsOptions | undefined;

    if (!options?.annotations) {
      // Clear icons if no data
      state.container.innerHTML = '';
      state.dataKey = null;
      state.elements.clear();
      return;
    }

    const currentData = JSON.stringify(options.annotations);

    // Only update if data has changed
    if (state.dataKey === currentData) {
      // Data hasn't changed, just update positions
      updateIconPositions(chart, options.annotations);
      return;
    }

    // Data changed, recreate icons
    state.dataKey = currentData;
    state.elements.clear();
    state.container.innerHTML = '';

    // Create and position icons
    options.annotations.forEach((annotation) => {
      const xScale = chart.scales.x;
      // Round xValue to ensure it aligns with category (integer index)
      const xValue = Math.round(annotation.xValue);
      const x = xScale.getPixelForValue(xValue);
      // Get bottom of chart area as baseline (just above x-axis)
      const baseline = chart.chartArea.bottom;
      // Position icon so its bottom edge is 2px above the chart bottom
      // Icon is 24px tall, transform centers it, so center = baseline - 14px
      const y = baseline - 14 - 28 * annotation.stackIndex;

      const iconElement = createIconElement(
        annotation,
        x,
        y,
        options.onIconClick,
        options.onIconHover
      );

      // Store reference for position updates
      state.elements.set(annotation.id, iconElement);
      state.container.appendChild(iconElement);
    });
  },

  beforeDestroy(chart: Chart) {
    const container = getState(chart)?.container;
    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
  },
};

export default htmlAnnotationsPlugin;
