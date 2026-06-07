import React, { useMemo, useState } from 'react';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { spacing, colors, fontSize, border } from '../../styles/theme';
import type { DisplayCurrency } from '../../utils/displayCurrency';
import type { AnnualCashFlowBreakdown } from '../../services/SimulationService';
import { buildSankeyModel, type SankeyNode, type SankeyNodeKind, type SankeyLink } from './sankeyLayout';
import { formatCurrencyShort } from '../../utils/formatCurrencyShort';

interface Props {
  breakdown: AnnualCashFlowBreakdown;
  pathFactor: number;
  displayCurrency: DisplayCurrency;
  /** Optional override for the SVG width (defaults to 720). Tests pass small values. */
  width?: number;
  /** Optional override for the SVG height (defaults to 480). */
  height?: number;
}

const NODE_COLORS: Record<SankeyNodeKind, string> = {
  detail:          colors.bucketDetail,
  income:          colors.income,
  employer:        colors.successMuted,
  withdrawal:      colors.textSecondary,
  bucket_ord:      colors.bucketOrdinary,
  bucket_capgains: colors.bucketCapGains,
  bucket_exempt:   colors.bucketExempt,
  cashpool:        colors.textSecondary,
  spending:        colors.spending,
  tax:             colors.danger,
  deposit:         colors.textMuted,
  transfer:        colors.borderMedium,
};

const fmtPrecise = (n: number) =>
  Math.round(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// d3-sankey mutates the node/link objects we pass in. Clone to layout objects so React state stays clean.
interface LayoutNode extends SankeyNode {
  x0?: number; x1?: number; y0?: number; y1?: number; value?: number;
  sourceLinks?: LayoutLink[]; targetLinks?: LayoutLink[];
  index?: number; depth?: number; height?: number;
}
interface LayoutLink {
  source: LayoutNode | string;
  target: LayoutNode | string;
  value: number;
  kind: SankeyLink['kind'];
  width?: number; y0?: number; y1?: number; index?: number;
}

type HoverState =
  | { kind: 'node'; node: LayoutNode; x: number; y: number }
  | { kind: 'link'; link: LayoutLink; x: number; y: number }
  | null;

const YearCashFlowSankey: React.FC<Props> = ({
  breakdown,
  pathFactor,
  displayCurrency,
  width = 1300,
  height = 560,
}) => {
  const model = useMemo(
    () => buildSankeyModel(breakdown, pathFactor, displayCurrency),
    [breakdown, pathFactor, displayCurrency],
  );

  // Split main Sankey from off-axis transfer rows.
  const mainNodes = useMemo(() => model.nodes.filter(n => n.kind !== 'transfer'), [model]);
  const mainLinks = useMemo(() => model.links.filter(l => l.kind === 'main'), [model]);
  const transfers = useMemo(() => model.links.filter(l => l.kind === 'transfer'), [model]);

  const totalFlow = Math.max(model.inflowTotal, model.outflowTotal, 1);

  const layout = useMemo(() => {
    if (mainNodes.length === 0 || mainLinks.length === 0) return null;
    const gen = sankey<LayoutNode, LayoutLink>()
      .nodeId((d: LayoutNode) => d.id)
      .nodeWidth(14)
      .nodePadding(4)
      .extent([[4, 4], [width - 4, height - 4]]);
    return gen({
      nodes: mainNodes.map(n => ({ ...n })),
      links: mainLinks.map(l => ({ ...l })),
    });
  }, [mainNodes, mainLinks, width, height]);

  const [hover, setHover] = useState<HoverState>(null);

  const isDev = typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  const worstBucketDrift = model.bucketAudits.reduce((m, a) => Math.max(m, Math.abs(a.diff)), 0);
  const worstAggregatorDrift = model.aggregatorAudits.reduce((m, a) => Math.max(m, Math.abs(a.diff)), 0);
  const showConservationWarning =
    isDev && (Math.abs(model.conservationDiff) > 1 || worstBucketDrift > 1 || worstAggregatorDrift > 1);

  if (mainLinks.length === 0 && transfers.length === 0) {
    return (
      <div
        data-testid="year-cash-flow-sankey"
        style={{ padding: spacing.md, color: colors.textMuted, fontSize: fontSize.xs }}
      >
        No cash flow recorded for this year.
      </div>
    );
  }

  return (
    <div
      data-testid="year-cash-flow-sankey"
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: spacing.sm }}
    >
      {model.shortfall > 0 && (
        <div
          data-testid="depletion-banner"
          style={{
            background: colors.dangerStrongBg,
            color: colors.dangerStrong,
            border: `1px solid ${colors.dangerStrong}`,
            borderRadius: border.radius,
            padding: `${spacing.xs} ${spacing.sm}`,
            fontSize: fontSize.xs,
            fontWeight: 'bold',
          }}
        >
          Portfolio depleted — {fmtPrecise(model.shortfall)} of requested spending unmet. Spending flows below
          show the funded portion only.
        </div>
      )}

      {showConservationWarning && (
        <div
          style={{
            background: colors.warningBg,
            color: colors.warning,
            border: `1px solid ${colors.warning}`,
            borderRadius: border.radius,
            padding: `${spacing.xs} ${spacing.sm}`,
            fontSize: fontSize.xs,
          }}
        >
          ⚠ Flow conservation off — global Δ {fmtPrecise(model.conservationDiff)}, worst bucket Δ {fmtPrecise(worstBucketDrift)}, worst aggregator Δ {fmtPrecise(worstAggregatorDrift)}. Possible engine drift.
        </div>
      )}

      <svg
        width={width}
        height={height}
        style={{ display: 'block', maxWidth: '100%', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        {layout && (
          <>
            <g>
              {layout.links.map((link, i) => {
                const sourceNode = link.source as LayoutNode;
                const stroke = NODE_COLORS[sourceNode.kind] ?? colors.textMuted;
                const isHovered =
                  hover?.kind === 'link' && hover.link === link;
                return (
                  <path
                    key={`link-${i}`}
                    d={sankeyLinkHorizontal()(link) ?? ''}
                    fill="none"
                    stroke={stroke}
                    strokeOpacity={isHovered ? 0.65 : 0.32}
                    strokeWidth={Math.max(1, link.width ?? 1)}
                    style={{ cursor: 'pointer', transition: 'stroke-opacity 80ms ease' }}
                    onMouseEnter={e => setHover({ kind: 'link', link, x: e.clientX, y: e.clientY })}
                    onMouseMove={e => setHover({ kind: 'link', link, x: e.clientX, y: e.clientY })}
                  />
                );
              })}
            </g>
            <g>
              {layout.nodes.map((node, i) => {
                const fill = NODE_COLORS[node.kind] ?? colors.textMuted;
                const w = (node.x1 ?? 0) - (node.x0 ?? 0);
                const h = (node.y1 ?? 0) - (node.y0 ?? 0);
                const labelOnLeft = (node.x0 ?? 0) > width / 2;
                return (
                  <g key={`node-${i}`}>
                    <rect
                      x={node.x0}
                      y={node.y0}
                      width={w}
                      height={Math.max(2, h)}
                      fill={fill}
                      stroke={fill}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => setHover({ kind: 'node', node, x: e.clientX, y: e.clientY })}
                      onMouseMove={e => setHover({ kind: 'node', node, x: e.clientX, y: e.clientY })}
                    />
                    <text
                      x={labelOnLeft ? (node.x0 ?? 0) - 6 : (node.x1 ?? 0) + 6}
                      y={((node.y0 ?? 0) + (node.y1 ?? 0)) / 2}
                      dy="0.32em"
                      textAnchor={labelOnLeft ? 'end' : 'start'}
                      style={{
                        fontSize: fontSize.xs,
                        fill: colors.textPrimary,
                        pointerEvents: 'none',
                        userSelect: 'none',
                      }}
                    >
                      {node.label}
                      <tspan style={{ fill: colors.textMuted }}> {formatCurrencyShort(node.total, 'compact')}</tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          </>
        )}
      </svg>

      {transfers.length > 0 && (
        <div
          data-testid="sankey-transfers"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: spacing.sm,
            padding: `${spacing.xs} ${spacing.sm}`,
            background: colors.bgLight,
            border: border.light,
            borderRadius: border.radius,
            fontSize: fontSize.xs,
            color: colors.textSecondary,
          }}
        >
          <span style={{ fontWeight: 'bold' }}>Inter-account transfers (no flow through year):</span>
          {transfers.map((t, i) => {
            const isRefill = t.source === 'xfer_brokerage_src';
            const label = isRefill ? 'Cash refill: Brokerage → Cash' : 'Cash sweep: Cash → Brokerage';
            return (
              <span key={`xfer-${i}`}>
                {label} {formatCurrencyShort(t.value, 'compact')}
              </span>
            );
          })}
        </div>
      )}

      {hover && (
        <div
          style={{
            position: 'fixed',
            left: hover.x + 12,
            top: hover.y + 12,
            background: colors.textPrimary,
            color: colors.bgLight,
            padding: `${spacing.xs} ${spacing.sm}`,
            borderRadius: border.radius,
            fontSize: fontSize.xs,
            lineHeight: 1.4,
            maxWidth: '20rem',
            pointerEvents: 'none',
            zIndex: 1000,
            boxShadow: `0 2px 6px ${colors.shadowMedium}`,
          }}
        >
          {hover.kind === 'node' ? (
            (() => {
              const k = hover.node.kind;
              const isBucket = k === 'bucket_ord' || k === 'bucket_capgains' || k === 'bucket_exempt';
              const bAudit = isBucket ? model.bucketAudits.find(b => b.id === hover.node.id) : undefined;
              return (
                <>
                  <div style={{ fontWeight: 'bold' }}>{hover.node.label}</div>
                  <div>{fmtPrecise(hover.node.total)}</div>
                  {bAudit && (
                    <div style={{ color: colors.borderMedium, marginTop: 2 }}>
                      inflow {fmtPrecise(bAudit.inflow)} / outflow {fmtPrecise(bAudit.outflow)}
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <>
              <div style={{ fontWeight: 'bold' }}>
                {(hover.link.source as LayoutNode).label} → {(hover.link.target as LayoutNode).label}
              </div>
              <div>
                {fmtPrecise(hover.link.value)} ({((hover.link.value / totalFlow) * 100).toFixed(1)}% of year)
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default YearCashFlowSankey;
