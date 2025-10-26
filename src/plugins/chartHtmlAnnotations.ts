import { Chart } from 'chart.js';
import type { Plugin, ChartType } from 'chart.js';

// Extend Chart.js types to include our custom plugin
declare module 'chart.js' {
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
  data?: any;
}

interface HtmlAnnotationsOptions {
  annotations: AnnotationConfig[];
  onIconClick?: (annotation: AnnotationConfig) => void;
  onIconHover?: (annotation: AnnotationConfig | null) => void;
}

const eventTypeIcons: Record<string, string> = {
  // Income events
  social_security: 'pi pi-shield',
  annuity_income: 'pi pi-money-bill',
  inheritance: 'pi pi-gift',
  pension_income: 'pi pi-briefcase',
  rental_income: 'pi pi-home',
  sale_of_property: 'pi pi-arrow-right-arrow-left',
  work_during_retirement: 'pi pi-cog',
  other_income: 'pi pi-ellipsis-h',

  // Spending goals
  monthly_retirement: 'pi pi-dollar',
  charity: 'pi pi-heart',
  dependent_support: 'pi pi-users',
  healthcare: 'pi pi-heart-fill',
  home_purchase: 'pi pi-home',
  education: 'pi pi-book',
  renovation: 'pi pi-wrench',
  vacation: 'pi pi-plane',
  vehicle: 'pi pi-car',
  wedding: 'pi pi-heart',
  other: 'pi pi-circle',
};

function updateIconPositions(chart: Chart, annotations: AnnotationConfig[]) {
  const elements = (chart as any)._htmlAnnotationsElements as Map<
    string,
    HTMLElement
  >;

  annotations.forEach((annotation) => {
    const element = elements.get(annotation.id);
    if (!element) return;

    const xScale = chart.scales.x;
    const x = xScale.getPixelForValue(annotation.xValue);
    const chartBottom = chart.chartArea.bottom;
    const y = chartBottom - (2 + 28 * annotation.stackIndex);

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
    backgroundColor: isIncome
      ? 'rgba(0, 128, 0, 0.1)'
      : 'rgba(210, 105, 30, 0.1)',
    border: `2px solid ${isIncome ? 'green' : '#d2691e'}`,
    color: isIncome ? 'green' : '#d2691e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    cursor: 'pointer',
    pointerEvents: 'auto',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    zIndex: '10',
  });

  // Add tooltip
  const tooltipText = annotation.data
    ? `${
        annotation.data.name || (isIncome ? 'Income Event' : 'Spending Goal')
      }\nAmount: $${(
        annotation.data.annualAmount || annotation.data.amount
      )?.toLocaleString()}`
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
      icon.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
      icon.style.zIndex = '100';
      onHover(annotation);
    });

    icon.addEventListener('mouseleave', () => {
      icon.style.transform = 'translate(-50%, -50%) scale(1)';
      icon.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      icon.style.zIndex = '10';
      onHover(null);
    });
  }

  return icon;
}

const htmlAnnotationsPlugin: Plugin = {
  id: 'htmlAnnotations',

  beforeInit(chart: Chart) {
    // Create overlay container
    const container = document.createElement('div');
    container.className = 'chart-html-annotations';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '10';

    const canvas = chart.canvas;
    const parent = canvas.parentElement;
    if (parent) {
      parent.style.position = 'relative';
      parent.appendChild(container);
    }

    // Store container and state
    (chart as any)._htmlAnnotationsContainer = container;
    (chart as any)._htmlAnnotationsData = null;
    (chart as any)._htmlAnnotationsElements = new Map();
  },

  afterDraw(chart: Chart) {
    const container = (chart as any)._htmlAnnotationsContainer as HTMLElement;
    const options = chart.options.plugins
      ?.htmlAnnotations as HtmlAnnotationsOptions;

    if (!container || !options?.annotations) {
      // Clear icons if no data
      container.innerHTML = '';
      (chart as any)._htmlAnnotationsData = null;
      (chart as any)._htmlAnnotationsElements.clear();
      return;
    }

    const currentData = JSON.stringify(options.annotations);

    // Only update if data has changed
    if ((chart as any)._htmlAnnotationsData === currentData) {
      // Data hasn't changed, just update positions
      updateIconPositions(chart, options.annotations);
      return;
    }

    // Data changed, recreate icons
    (chart as any)._htmlAnnotationsData = currentData;
    (chart as any)._htmlAnnotationsElements.clear();
    container.innerHTML = '';

    // Create and position icons
    options.annotations.forEach((annotation) => {
      const xScale = chart.scales.x;

      const x = xScale.getPixelForValue(annotation.xValue);
      // Position icons just above the chart baseline (x-axis)
      const chartBottom = chart.chartArea.bottom;
      const y = chartBottom - (2 + 28 * annotation.stackIndex); // Stack vertically upward from baseline

      const iconElement = createIconElement(
        annotation,
        x,
        y,
        options.onIconClick,
        options.onIconHover
      );

      // Store reference for position updates
      (chart as any)._htmlAnnotationsElements.set(annotation.id, iconElement);
      container.appendChild(iconElement);
    });
  },

  beforeDestroy(chart: Chart) {
    const container = (chart as any)._htmlAnnotationsContainer as HTMLElement;
    if (container && container.parentElement) {
      container.parentElement.removeChild(container);
    }
  },
};

export default htmlAnnotationsPlugin;
