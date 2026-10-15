import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * The charts.
 *
 * Every number drawn here was already in the database and never on a screen.
 * Three rules shape all of it:
 *
 *   - **Thin marks, recessive chrome.** Hairline grid one shade off the
 *     surface, 2px lines, small markers. These sit inside cards a patient
 *     reads, not on a trading desk.
 *   - **Colour is never the only channel.** Dose outcomes carry a glyph and a
 *     word as well as a hue, because green-against-red is the pair red-green
 *     colourblind readers cannot separate — and it is the most important
 *     distinction in the app. Two-series charts get a legend and a direct label
 *     on the last point.
 *   - **Every chart has a table.** The toggle is not a nicety: it is the
 *     WCAG-clean twin, and the only way the numbers are reachable without
 *     hovering anything.
 *
 * One axis, always. Severity and doses-per-day share a day axis but are drawn
 * as two stacked plots rather than two y-scales on one, because a second scale
 * invents a correlation that is not in the data.
 */

/* -------------------------------------------------------------------------- */
/* Measuring                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The container's real pixel width.
 *
 * A fixed `viewBox` scaled to 100% would scale the text with it, so an 11px
 * axis label becomes 6px on a phone and 15px on a desktop. Charts are drawn at
 * actual size instead, and re-drawn when the column changes.
 */
/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * The measurement has to run before paint or the chart draws once at the
 * fallback width and visibly jumps. But `useLayoutEffect` has no meaning in
 * `react-dom/server`, where it warns on every chart — and the rendering tests
 * render exactly these components on the server.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useChartWidth(fallback = 320): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const observed = useRef<HTMLDivElement | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    observed.current = node;
    if (node) setWidth(node.clientWidth || fallback);
  }, [fallback]);

  useIsomorphicLayoutEffect(() => {
    const node = observed.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/* -------------------------------------------------------------------------- */
/* The tooltip layer                                                          */
/* -------------------------------------------------------------------------- */

interface TipState {
  x: number;
  y: number;
  lines: string[];
}

/**
 * A hover layer every plotted chart gets.
 *
 * An HTML chart is interactive whether or not it was designed to be, so the
 * choice is between a tooltip and a reader who cannot find out what a mark
 * means. It enhances rather than gates: the same values are in the table view,
 * and focusing a mark with the keyboard shows the same panel as hovering it.
 */
function useTooltip(): {
  tip: TipState | null;
  show: (event: { clientX: number; clientY: number }, lines: string[], host: HTMLElement | null) => void;
  hide: () => void;
} {
  const [tip, setTip] = useState<TipState | null>(null);

  const show = useCallback(
    (event: { clientX: number; clientY: number }, lines: string[], host: HTMLElement | null) => {
      if (!host) return;
      const box = host.getBoundingClientRect();
      setTip({ x: event.clientX - box.left, y: event.clientY - box.top, lines });
    },
    [],
  );

  return { tip, show, hide: useCallback(() => setTip(null), []) };
}

function Tooltip({ tip, width }: { tip: TipState | null; width: number }): ReactNode {
  if (!tip) return null;
  // Flipped near the right edge so it never runs off a phone screen.
  const flip = tip.x > width - 150;
  return (
    <div
      className="viz-tip"
      style={{
        left: flip ? undefined : Math.max(0, tip.x + 12),
        right: flip ? Math.max(0, width - tip.x + 12) : undefined,
        top: Math.max(0, tip.y - 8),
      }}
      role="status"
    >
      {tip.lines.map((line, index) => (
        <div key={line + index} className={index === 0 ? 'viz-tip__head' : undefined}>
          {line}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The frame every chart sits in                                              */
/* -------------------------------------------------------------------------- */

/**
 * Title, legend, the plot, and the table toggle.
 *
 * The toggle lives here rather than in each chart so that every chart has one
 * by construction — the accessibility twin cannot be the thing that gets
 * forgotten on the eleventh chart.
 */
export function Figure({
  title,
  caption,
  legend,
  table,
  children,
  note,
}: {
  title: string;
  caption?: string | null;
  legend?: { label: string; swatch: ReactNode }[];
  table?: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  note?: string | null;
}): ReactNode {
  const [showTable, setShowTable] = useState(false);

  return (
    <figure className="viz">
      <div className="viz__head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <figcaption className="viz__title">{title}</figcaption>
          {caption && <div className="viz__caption">{caption}</div>}
        </div>
        {table && (
          <button
            className="viz__toggle"
            onClick={() => setShowTable((open) => !open)}
            aria-pressed={showTable}
          >
            {showTable ? 'Chart' : 'Numbers'}
          </button>
        )}
      </div>

      {legend && legend.length > 0 && (
        <ul className="viz__legend">
          {legend.map((item) => (
            <li key={item.label}>
              {item.swatch}
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}

      {showTable && table ? (
        <div className="viz__tablewrap">
          <table className="viz__table">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}

      {note && <div className="viz__note">{note}</div>}
    </figure>
  );
}

/** A legend swatch: a line, a filled block, or a dashed reference rule. */
export function Swatch({
  tone = 'series-1',
  shape = 'block',
}: {
  tone?: 'series-1' | 'series-2' | 'good' | 'bad' | 'warn' | 'neutral';
  shape?: 'block' | 'line' | 'dashed';
}): ReactNode {
  const color = `var(--viz-${tone})`;
  if (shape === 'block') {
    return <span className="viz-swatch" style={{ background: color }} aria-hidden="true" />;
  }
  return (
    <span
      className={`viz-swatch viz-swatch--${shape}`}
      style={shape === 'dashed' ? { borderTopColor: color } : { background: color }}
      aria-hidden="true"
    />
  );
}

/** A hairline grid line and its tick label. One shade off the surface, solid. */
function GridLines({
  ticks,
  width,
  left,
  scale,
}: {
  ticks: number[];
  width: number;
  left: number;
  scale: (value: number) => number;
}): ReactNode {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <line
          key={tick}
          x1={left}
          x2={width}
          y1={scale(tick)}
          y2={scale(tick)}
          stroke="var(--viz-grid)"
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Adherence by mealtime                                                   */
/* -------------------------------------------------------------------------- */

export interface AnchorRow {
  label: string;
  clockTime: string;
  percent: number;
  taken: number;
  late: number;
  missed: number;
  skipped: number;
  settled: number;
}

/**
 * The most directly actionable chart in the app.
 *
 * One series, so one colour and no legend — the title names it. The worst row
 * is the one worth looking at, so only that bar is direct-labelled beyond its
 * own value, and the caption says what to do about it. It sits beside the
 * mealtimes editor because that is the control that fixes what it shows.
 */
export function AnchorBars({ rows }: { rows: readonly AnchorRow[] }): ReactNode {
  const [ref, width] = useChartWidth();
  const host = useRef<HTMLDivElement | null>(null);
  const { tip, show, hide } = useTooltip();

  const usable = rows.filter((row) => row.settled > 0);
  if (usable.length === 0) return null;

  const labelWidth = 86;
  const valueWidth = 44;
  const rowHeight = 34;
  const barHeight = 14;
  const plotWidth = Math.max(40, width - labelWidth - valueWidth);
  const height = usable.length * rowHeight;

  const worst = usable.reduce((low, row) => (row.percent < low.percent ? row : low), usable[0]!);

  return (
    <Figure
      title="How you do at each time of day"
      caption="Out of the doses whose time has come. Nothing counted before it was due."
      note={
        worst.percent < 80
          ? `Your ${worst.label.toLowerCase()} dose is the one that goes — it is set to ${
              worst.clockTime
            }. If that is the wrong time, change it in Reminders and I will move the rest of the course.`
          : null
      }
      table={{
        columns: ['Time of day', 'Set for', 'Taken', 'Missed', 'Skipped', 'Of', '%'],
        rows: usable.map((row) => [
          row.label,
          row.clockTime,
          row.taken + row.late,
          row.missed,
          row.skipped,
          row.settled,
          `${row.percent}%`,
        ]),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label="Adherence by time of day">
            {usable.map((row, index) => {
              const y = index * rowHeight;
              const filled = Math.max(0, (row.percent / 100) * plotWidth);
              const isWorst = row.label === worst.label && worst.percent < 80;

              return (
                <g key={row.label}>
                  <text
                    x={0}
                    y={y + rowHeight / 2 + 4}
                    className="viz-axis"
                    style={{ fontWeight: isWorst ? 800 : 700 }}
                  >
                    {row.label}
                  </text>

                  {/* The track, so a short bar still reads as a share. */}
                  <rect
                    x={labelWidth}
                    y={y + (rowHeight - barHeight) / 2}
                    width={plotWidth}
                    height={barHeight}
                    rx={4}
                    fill="var(--viz-track)"
                  />
                  <rect
                    x={labelWidth}
                    y={y + (rowHeight - barHeight) / 2}
                    width={filled}
                    height={barHeight}
                    rx={4}
                    fill="var(--viz-series-1)"
                    tabIndex={0}
                    role="button"
                    aria-label={`${row.label}, ${row.percent}% — ${row.taken + row.late} of ${
                      row.settled
                    } taken`}
                    onMouseMove={(event) =>
                      show(
                        event,
                        [
                          `${row.label} · ${row.clockTime}`,
                          `${row.taken + row.late} of ${row.settled} taken`,
                          row.missed > 0 ? `${row.missed} missed` : '',
                          row.skipped > 0 ? `${row.skipped} skipped` : '',
                        ].filter(Boolean),
                        host.current,
                      )
                    }
                    onMouseLeave={hide}
                    onFocus={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      show(
                        { clientX: box.left + box.width / 2, clientY: box.top },
                        [`${row.label} · ${row.clockTime}`, `${row.taken + row.late} of ${row.settled} taken`],
                        host.current,
                      );
                    }}
                    onBlur={hide}
                  />
                  <text
                    x={labelWidth + plotWidth + 8}
                    y={y + rowHeight / 2 + 4}
                    className="viz-value"
                  >
                    {row.percent}%
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. The dose grid                                                           */
/* -------------------------------------------------------------------------- */

export interface GridCell {
  doseId: string;
  status: string;
  statusLabel: string;
  clockTime: string;
  takenTimeLabel: string | null;
  minutesLate: number | null;
}

export interface GridRow {
  day: number;
  dateLabel: string;
  isToday: boolean;
  cells: (GridCell | null)[];
}

/**
 * A course as days down and doses across.
 *
 * The home screen's day cells collapse a whole day into one square, so a day
 * with two of three doses missed looks exactly like a day with one. At the dose
 * level the real pattern shows, and it is nearly always a column rather than a
 * scatter: it is the evening dose that goes, every day.
 *
 * `taken` and `taken late` share one colour on purpose. They are both the
 * tablet going in, which is what this grid is about; and a separate amber for
 * lateness sat 9.5 ΔE from the red of a miss, which is below the floor at which
 * full-colour readers can tell two marks apart, let alone colourblind ones.
 * Lateness is a small notch on the corner of the cell, and it has a chart of
 * its own.
 */
export function DoseGridChart({
  grid,
}: {
  grid: {
    medicationName: string;
    conditionName: string | null;
    statusLabel: string;
    columns: { label: string }[];
    rows: GridRow[];
    projectionNote: string | null;
    rowsTruncated?: boolean;
  };
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [ref, width] = useChartWidth();
  const { tip, show, hide } = useTooltip();

  const dayWidth = 58;
  const columns = grid.columns.length;
  const cellSize = Math.max(
    22,
    Math.min(40, Math.floor((width - dayWidth - 8) / Math.max(1, columns)) - 6),
  );
  const gap = 6;
  const headerHeight = 22;
  const rowHeight = cellSize + gap;
  const height = headerHeight + grid.rows.length * rowHeight;

  return (
    <Figure
      title={grid.medicationName}
      caption={
        grid.conditionName
          ? `${grid.conditionName} · ${grid.statusLabel}`
          : grid.statusLabel
      }
      legend={[
        { label: 'Taken', swatch: <Swatch tone="good" /> },
        { label: 'Missed', swatch: <Swatch tone="bad" /> },
        { label: 'Skipped', swatch: <Swatch tone="neutral" /> },
        {
          label: 'Still to come',
          swatch: <span className="viz-swatch viz-swatch--pending" aria-hidden="true" />,
        },
      ]}
      note={
        [
          grid.rowsTruncated ? 'Showing the last three weeks.' : null,
          grid.projectionNote,
        ]
          .filter(Boolean)
          .join(' ') || null
      }
      table={{
        columns: ['Day', 'Date', ...grid.columns.map((column) => column.label)],
        rows: grid.rows.map((row) => [
          row.day,
          row.dateLabel,
          ...row.cells.map((cell) =>
            cell === null
              ? '—'
              : cell.takenTimeLabel
                ? `${cell.statusLabel} ${cell.takenTimeLabel}`
                : cell.statusLabel,
          ),
        ]),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label={`${grid.medicationName}, every dose`}>
            {grid.columns.map((column, index) => (
              <text
                key={`${column.label}-${index}`}
                x={dayWidth + index * (cellSize + gap) + cellSize / 2}
                y={13}
                className="viz-axis"
                textAnchor="middle"
              >
                {column.label.replace(/:00/, '').replace(' ', '')}
              </text>
            ))}

            {grid.rows.map((row, rowIndex) => {
              const y = headerHeight + rowIndex * rowHeight;
              return (
                <g key={row.day}>
                  <text
                    x={0}
                    y={y + cellSize / 2 + 4}
                    className="viz-axis"
                    style={{ fontWeight: row.isToday ? 800 : 600 }}
                  >
                    {row.isToday ? 'Today' : row.dateLabel.replace(/ (\w{3})\w+$/, ' $1')}
                  </text>

                  {row.cells.map((cell, cellIndex) => {
                    const x = dayWidth + cellIndex * (cellSize + gap);
                    if (cell === null) return null;
                    const tone = toneFor(cell.status);
                    const glyph = glyphForStatus(cell.status);
                    const late = (cell.minutesLate ?? 0) > 60;

                    return (
                      <g
                        key={cell.doseId}
                        tabIndex={0}
                        role="button"
                        aria-label={`Day ${row.day}, ${cell.clockTime}: ${cell.statusLabel}`}
                        onMouseMove={(event) =>
                          show(
                            event,
                            [
                              `${row.dateLabel} · ${cell.clockTime}`,
                              cell.statusLabel,
                              cell.takenTimeLabel ? `Taken at ${cell.takenTimeLabel}` : '',
                              cell.minutesLate !== null && cell.minutesLate > 5
                                ? `${cell.minutesLate} minutes after I asked`
                                : '',
                            ].filter(Boolean),
                            host.current,
                          )
                        }
                        onMouseLeave={hide}
                        onFocus={(event) => {
                          const box = event.currentTarget.getBoundingClientRect();
                          show(
                            { clientX: box.left + box.width / 2, clientY: box.top },
                            [`${row.dateLabel} · ${cell.clockTime}`, cell.statusLabel],
                            host.current,
                          );
                        }}
                        onBlur={hide}
                      >
                        <rect
                          x={x}
                          y={y}
                          width={cellSize}
                          height={cellSize}
                          rx={7}
                          fill={tone.fill}
                          stroke={tone.stroke}
                          strokeWidth={tone.dashed ? 1.5 : 0}
                          strokeDasharray={tone.dashed ? '3 3' : undefined}
                        />
                        {glyph && (
                          <text
                            x={x + cellSize / 2}
                            y={y + cellSize / 2 + 5}
                            textAnchor="middle"
                            className="viz-glyph"
                            fill={tone.ink}
                          >
                            {glyph}
                          </text>
                        )}
                        {/* Lateness, as a notch rather than a second hue. */}
                        {late && (
                          <circle
                            cx={x + cellSize - 5}
                            cy={y + 5}
                            r={3}
                            fill="var(--card)"
                            stroke={tone.ink}
                            strokeWidth={1.5}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/**
 * The status palette.
 *
 * Green against red is precisely the pair a red-green colourblind reader cannot
 * separate, and it is also the single most important distinction in a medication
 * app — so it is never carried by colour. Every cell has a glyph, the legend
 * names every state in words, and the table view holds the same information with
 * no colour at all.
 */
function toneFor(status: string): {
  fill: string;
  ink: string;
  stroke: string;
  dashed: boolean;
} {
  switch (status) {
    case 'taken':
    case 'taken_late':
      return { fill: 'var(--viz-good-bg)', ink: 'var(--viz-good)', stroke: 'none', dashed: false };
    case 'missed':
      return { fill: 'var(--viz-bad-bg)', ink: 'var(--viz-bad)', stroke: 'none', dashed: false };
    case 'skipped':
      return {
        fill: 'var(--viz-neutral-bg)',
        ink: 'var(--viz-neutral)',
        stroke: 'none',
        dashed: false,
      };
    case 'due':
      return { fill: 'var(--viz-warn-bg)', ink: 'var(--viz-warn)', stroke: 'none', dashed: false };
    default:
      return {
        fill: 'transparent',
        ink: 'var(--ink-faint)',
        stroke: 'var(--viz-pending)',
        dashed: true,
      };
  }
}

function glyphForStatus(status: string): string | null {
  switch (status) {
    case 'taken':
    case 'taken_late':
      return '✓';
    case 'missed':
      return '✕';
    case 'skipped':
      return '–';
    case 'due':
      return '!';
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* 3. A measured series over time                                             */
/* -------------------------------------------------------------------------- */

export interface SeriesPoint {
  dateLabel: string;
  value: number;
  secondValue?: number | null;
  label?: string;
  muted?: boolean;
  note?: string | null;
}

/**
 * The line chart behind readings, lab trends and anything else measured
 * repeatedly.
 *
 * Blood pressure is the reason it takes two values rather than one: systolic
 * and diastolic are two numbers in the same unit on the same scale, which is
 * the one case where two series legitimately share an axis. Two measures of
 * *different* scale would be two charts — a second y-axis invents a correlation
 * that is not in the data.
 *
 * `band` is the range printed on the monitor's own leaflet, drawn behind the
 * line so a reading has something to sit against. It is never a verdict: the
 * app does not say whether a number is good, and there is no colour change when
 * a point leaves the band.
 */
export function LineChart({
  title,
  caption,
  points,
  unit,
  decimals = 0,
  band,
  seriesLabels,
  height = 150,
  note,
}: {
  title: string;
  caption?: string | null;
  points: readonly SeriesPoint[];
  unit: string;
  decimals?: number;
  band?: { from: number; to: number } | null;
  seriesLabels?: [string, string];
  height?: number;
  note?: string | null;
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [ref, width] = useChartWidth();
  const { tip, show, hide } = useTooltip();

  const hasPair = points.some((point) => point.secondValue !== null && point.secondValue !== undefined);

  const geometry = useMemo(() => {
    const left = 38;
    const right = 10;
    const top = 10;
    // Room for the x labels, so the card never grows a nested scrollbar.
    const bottom = 22;
    const plotWidth = Math.max(10, width - left - right);
    const plotHeight = Math.max(10, height - top - bottom);

    const values = points.flatMap((point) =>
      [point.value, point.secondValue ?? null].filter((v): v is number => v !== null),
    );
    const bandValues = band ? [band.from, band.to] : [];
    const all = [...values, ...bandValues];
    const rawMin = all.length === 0 ? 0 : Math.min(...all);
    const rawMax = all.length === 0 ? 1 : Math.max(...all);
    const pad = Math.max((rawMax - rawMin) * 0.15, Math.pow(10, -decimals));
    const min = rawMin - pad;
    const max = rawMax + pad;

    const x = (index: number): number =>
      points.length <= 1 ? left + plotWidth / 2 : left + (index / (points.length - 1)) * plotWidth;
    const y = (value: number): number =>
      top + plotHeight - ((value - min) / (max - min || 1)) * plotHeight;

    const ticks = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.1];

    return { left, top, plotWidth, plotHeight, min, max, x, y, ticks, bottom };
  }, [band, decimals, height, points, width]);

  if (points.length === 0) return null;

  const path = (pick: (point: SeriesPoint) => number | null | undefined): string =>
    points
      .map((point, index) => {
        const value = pick(point);
        if (value === null || value === undefined) return null;
        return `${index === 0 ? 'M' : 'L'}${geometry.x(index)} ${geometry.y(value)}`;
      })
      .filter(Boolean)
      .join(' ');

  const last = points.at(-1)!;
  const format = (value: number): string => value.toFixed(decimals);

  // Only a handful of x labels, however many points there are.
  const labelEvery = Math.max(1, Math.ceil(points.length / 4));

  return (
    <Figure
      title={title}
      caption={caption}
      legend={
        hasPair && seriesLabels
          ? [
              { label: seriesLabels[0], swatch: <Swatch tone="series-1" shape="line" /> },
              { label: seriesLabels[1], swatch: <Swatch tone="series-2" shape="line" /> },
            ]
          : band
            ? [
                {
                  label: `Usual range on the leaflet (${format(band.from)}–${format(band.to)})`,
                  swatch: <span className="viz-swatch viz-swatch--band" aria-hidden="true" />,
                },
              ]
            : undefined
      }
      note={note}
      table={{
        columns: hasPair
          ? ['Date', seriesLabels?.[0] ?? 'Value', seriesLabels?.[1] ?? 'Second', 'Note']
          : ['Date', `Value (${unit})`, 'Note'],
        rows: points.map((point) =>
          hasPair
            ? [
                point.dateLabel,
                format(point.value),
                point.secondValue === null || point.secondValue === undefined
                  ? '—'
                  : format(point.secondValue),
                point.note ?? (point.muted ? 'At your appointment' : ''),
              ]
            : [point.dateLabel, format(point.value), point.note ?? ''],
        ),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label={title}>
            {/* The leaflet's range, behind everything. */}
            {band && (
              <rect
                x={geometry.left}
                y={geometry.y(band.to)}
                width={geometry.plotWidth}
                height={Math.max(1, geometry.y(band.from) - geometry.y(band.to))}
                fill="var(--viz-band)"
                aria-hidden="true"
              />
            )}

            <GridLines
              ticks={geometry.ticks}
              width={width - 10}
              left={geometry.left}
              scale={geometry.y}
            />
            {geometry.ticks.map((tick) => (
              <text
                key={tick}
                x={geometry.left - 6}
                y={geometry.y(tick) + 4}
                className="viz-axis viz-axis--num"
                textAnchor="end"
              >
                {format(tick)}
              </text>
            ))}

            <path
              d={path((point) => point.value)}
              fill="none"
              stroke="var(--viz-series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {hasPair && (
              <path
                d={path((point) => point.secondValue)}
                fill="none"
                stroke="var(--viz-series-2)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                // The second line is also dashed: the pair sits in the 6–8 ΔE
                // band under tritanopia, where colour alone is not enough.
                strokeDasharray="5 4"
              />
            )}

            {points.map((point, index) => (
              <g key={`${point.dateLabel}-${index}`}>
                {/* A 24px invisible target over an 8px mark. */}
                <rect
                  x={geometry.x(index) - 12}
                  y={geometry.top}
                  width={24}
                  height={geometry.plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${point.dateLabel}: ${point.label ?? format(point.value)}`}
                  onMouseMove={(event) =>
                    show(
                      event,
                      [
                        point.dateLabel,
                        point.label ?? `${format(point.value)} ${unit}`,
                        point.muted ? 'Taken at your appointment' : '',
                        point.note ?? '',
                      ].filter(Boolean),
                      host.current,
                    )
                  }
                  onMouseLeave={hide}
                  onFocus={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    show(
                      { clientX: box.left + box.width / 2, clientY: box.top },
                      [point.dateLabel, point.label ?? `${format(point.value)} ${unit}`],
                      host.current,
                    );
                  }}
                  onBlur={hide}
                />
                <circle
                  cx={geometry.x(index)}
                  cy={geometry.y(point.value)}
                  r={point.muted ? 3.5 : 4}
                  fill={point.muted ? 'var(--card)' : 'var(--viz-series-1)'}
                  stroke={point.muted ? 'var(--viz-series-1)' : 'var(--card)'}
                  strokeWidth={2}
                />
                {hasPair && point.secondValue !== null && point.secondValue !== undefined && (
                  <circle
                    cx={geometry.x(index)}
                    cy={geometry.y(point.secondValue)}
                    r={4}
                    fill="var(--viz-series-2)"
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                )}
              </g>
            ))}

            {/* Selectively labelled: the last point, which is the one asked about. */}
            <text
              x={geometry.x(points.length - 1)}
              y={geometry.y(last.value) - 10}
              className="viz-value"
              textAnchor="end"
            >
              {format(last.value)}
            </text>

            {points.map((point, index) =>
              index % labelEvery === 0 || index === points.length - 1 ? (
                <text
                  key={`label-${index}`}
                  x={geometry.x(index)}
                  y={height - 6}
                  className="viz-axis"
                  textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                >
                  {point.dateLabel.replace(/ (\w{3})\w+/, ' $1')}
                </text>
              ) : null,
            )}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Punctuality                                                             */
/* -------------------------------------------------------------------------- */

/**
 * When a dose was due against how late it was taken.
 *
 * `learnedDriftMinutes` has been computed from exactly this since the first
 * version and folded into future reminder times with nobody ever told. Drawing
 * it turns invisible machinery into something the patient can agree with — and
 * "you take your morning tablet about forty minutes after I ask" is far more
 * useful to know about yourself than a percentage.
 *
 * The grace line is the app's own rule made visible: an hour, after which a
 * dose is recorded as taken late.
 */
export function PunctualityPlot({
  points,
  graceMinutes = 60,
  driftNote,
}: {
  points: readonly {
    doseId: string;
    scheduledMinuteOfDay: number;
    minutesLate: number;
    dateLabel: string;
    clockTime: string;
    medicationName: string;
  }[];
  graceMinutes?: number;
  driftNote?: string | null;
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [ref, width] = useChartWidth();
  const { tip, show, hide } = useTooltip();
  const height = 170;

  if (points.length < 3) return null;

  const left = 34;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const plotWidth = Math.max(10, width - left - right);
  const plotHeight = Math.max(10, height - top - bottom);

  const lateValues = points.map((point) => point.minutesLate);
  const maxLate = Math.max(graceMinutes + 15, ...lateValues);
  const minLate = Math.min(-10, ...lateValues);

  const x = (minuteOfDay: number): number => left + (minuteOfDay / 1440) * plotWidth;
  const y = (minutes: number): number =>
    top + plotHeight - ((minutes - minLate) / (maxLate - minLate || 1)) * plotHeight;

  const hours = [0, 6, 12, 18, 24];

  return (
    <Figure
      title="How close to the time you take them"
      caption="Each dot is one dose: when it was due, and how long after that you took it."
      legend={[
        { label: 'A dose you took', swatch: <Swatch tone="series-1" /> },
        {
          label: `Past ${graceMinutes} minutes counts as late`,
          swatch: <Swatch tone="neutral" shape="dashed" />,
        },
      ]}
      note={driftNote}
      table={{
        columns: ['Date', 'Due', 'Medicine', 'Minutes after'],
        rows: points
          .slice()
          .reverse()
          .slice(0, 40)
          .map((point) => [
            point.dateLabel,
            point.clockTime,
            point.medicationName,
            point.minutesLate,
          ]),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label="Punctuality by time of day">
            <GridLines ticks={[0]} width={width - right} left={left} scale={y} />
            <text x={left - 6} y={y(0) + 4} className="viz-axis viz-axis--num" textAnchor="end">
              0
            </text>
            <text
              x={left - 6}
              y={y(graceMinutes) + 4}
              className="viz-axis viz-axis--num"
              textAnchor="end"
            >
              {graceMinutes}
            </text>

            {/* The grace boundary — a threshold, so dashed is right here. */}
            <line
              x1={left}
              x2={width - right}
              y1={y(graceMinutes)}
              y2={y(graceMinutes)}
              stroke="var(--viz-neutral)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />

            {hours.map((hour) => (
              <text
                key={hour}
                x={x(hour * 60)}
                y={height - 6}
                className="viz-axis"
                textAnchor={hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}
              >
                {hour === 24 ? '12am' : hour === 0 ? '12am' : hour === 12 ? '12pm' : `${hour > 12 ? hour - 12 : hour}${hour < 12 ? 'am' : 'pm'}`}
              </text>
            ))}

            {points.map((point) => (
              <circle
                key={point.doseId}
                cx={x(point.scheduledMinuteOfDay)}
                cy={y(point.minutesLate)}
                r={4.5}
                fill="var(--viz-series-1)"
                fillOpacity={0.75}
                stroke="var(--card)"
                strokeWidth={2}
                tabIndex={0}
                role="button"
                aria-label={`${point.dateLabel}, due ${point.clockTime}, taken ${point.minutesLate} minutes after`}
                onMouseMove={(event) =>
                  show(
                    event,
                    [
                      `${point.dateLabel} · due ${point.clockTime}`,
                      point.minutesLate <= 0
                        ? `${Math.abs(point.minutesLate)} minutes early`
                        : `${point.minutesLate} minutes after I asked`,
                      point.medicationName,
                    ],
                    host.current,
                  )
                }
                onMouseLeave={hide}
                onFocus={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  show(
                    { clientX: box.left + box.width / 2, clientY: box.top },
                    [`${point.dateLabel} · due ${point.clockTime}`, `${point.minutesLate} minutes after`],
                    host.current,
                  );
                }}
                onBlur={hide}
              />
            ))}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Month by month                                                          */
/* -------------------------------------------------------------------------- */

/** Adherence, month by month. One series, so one colour and no legend. */
export function MonthlyBars({
  months,
}: {
  months: readonly { month: string; label: string; taken: number; due: number; percent: number }[];
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [ref, width] = useChartWidth();
  const { tip, show, hide } = useTooltip();
  const height = 140;

  if (months.length < 2) return null;

  const top = 10;
  const bottom = 22;
  const plotHeight = height - top - bottom;
  const slot = width / months.length;
  const barWidth = Math.max(6, Math.min(34, slot - 8));

  return (
    <Figure
      title="Month by month"
      caption="Of the doses due in each month, how many were taken."
      table={{
        columns: ['Month', 'Taken', 'Due', '%'],
        rows: months.map((month) => [month.label, month.taken, month.due, `${month.percent}%`]),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label="Adherence month by month">
            {months.map((month, index) => {
              const barHeight = Math.max(2, (month.percent / 100) * plotHeight);
              const x = index * slot + (slot - barWidth) / 2;
              return (
                <g key={month.month}>
                  <rect
                    x={x}
                    y={top + plotHeight - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill="var(--viz-series-1)"
                    tabIndex={0}
                    role="button"
                    aria-label={`${month.label}: ${month.percent}%, ${month.taken} of ${month.due}`}
                    onMouseMove={(event) =>
                      show(
                        event,
                        [month.label, `${month.taken} of ${month.due} taken`, `${month.percent}%`],
                        host.current,
                      )
                    }
                    onMouseLeave={hide}
                    onFocus={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      show(
                        { clientX: box.left + box.width / 2, clientY: box.top },
                        [month.label, `${month.taken} of ${month.due} taken`],
                        host.current,
                      );
                    }}
                    onBlur={hide}
                  />
                  {months.length <= 8 && (
                    <text
                      x={index * slot + slot / 2}
                      y={height - 6}
                      className="viz-axis"
                      textAnchor="middle"
                    >
                      {month.label.split(' ')[0]}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 6. The burn-down                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the plan said against what happened.
 *
 * The plan is a dashed reference rule in muted ink rather than a second series
 * colour, because it is not a measurement — it is the line the measurement is
 * being judged against. The gap at the right-hand edge is the number of tablets
 * still owed, which is the quantity this product actually cares about: the goal
 * is all twenty-one, not a good percentage.
 */
export function BurnDown({
  rows,
  medicationName,
  note,
}: {
  rows: readonly {
    day: number;
    dateLabel: string;
    expectedTaken: number;
    actualTaken: number;
    isProjection: boolean;
  }[];
  medicationName: string;
  note?: string | null;
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [ref, width] = useChartWidth();
  const { tip, show, hide } = useTooltip();
  const height = 150;

  if (rows.length < 2) return null;

  const left = 28;
  const right = 12;
  const top = 12;
  const bottom = 22;
  const plotWidth = Math.max(10, width - left - right);
  const plotHeight = Math.max(10, height - top - bottom);

  const max = Math.max(...rows.map((row) => row.expectedTaken), 1);
  const x = (index: number): number => left + (index / (rows.length - 1)) * plotWidth;
  const y = (value: number): number => top + plotHeight - (value / max) * plotHeight;

  // The actual line stops at the present: past that it is not a measurement.
  const measured = rows.filter((row) => !row.isProjection);
  const line = (
    source: readonly typeof rows[number][],
    pick: (row: typeof rows[number]) => number,
  ): string =>
    source
      .map((row, index) => `${index === 0 ? 'M' : 'L'}${x(rows.indexOf(row))} ${y(pick(row))}`)
      .join(' ');

  const lastMeasured = measured.at(-1);
  const owed = lastMeasured ? lastMeasured.expectedTaken - lastMeasured.actualTaken : 0;

  return (
    <Figure
      title={`${medicationName} — the plan against what happened`}
      caption="Doses added up day by day."
      legend={[
        { label: 'Taken', swatch: <Swatch tone="series-1" shape="line" /> },
        { label: 'The plan', swatch: <Swatch tone="neutral" shape="dashed" /> },
      ]}
      note={
        note ??
        (owed > 0
          ? `${owed} ${owed === 1 ? 'dose' : 'doses'} behind the plan so far. Nothing was dropped — they moved to the end.`
          : null)
      }
      table={{
        columns: ['Day', 'Date', 'Planned by then', 'Taken'],
        rows: rows.map((row) => [
          row.day,
          row.dateLabel,
          row.expectedTaken,
          row.isProjection ? '—' : row.actualTaken,
        ]),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label={`${medicationName} burn-down`}>
            <GridLines ticks={[0, max / 2, max]} width={width - right} left={left} scale={y} />
            <text x={left - 6} y={y(max) + 4} className="viz-axis viz-axis--num" textAnchor="end">
              {max}
            </text>
            <text x={left - 6} y={y(0) + 4} className="viz-axis viz-axis--num" textAnchor="end">
              0
            </text>

            <path
              d={line(rows, (row) => row.expectedTaken)}
              fill="none"
              stroke="var(--viz-neutral)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            {measured.length > 1 && (
              <path
                d={line(measured, (row) => row.actualTaken)}
                fill="none"
                stroke="var(--viz-series-1)"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            )}

            {rows.map((row, index) => (
              <rect
                key={row.day}
                x={x(index) - Math.max(12, plotWidth / rows.length / 2)}
                y={top}
                width={Math.max(24, plotWidth / rows.length)}
                height={plotHeight}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`Day ${row.day}: ${row.actualTaken} taken of ${row.expectedTaken} planned`}
                onMouseMove={(event) =>
                  show(
                    event,
                    [
                      `Day ${row.day} · ${row.dateLabel}`,
                      `Planned by then: ${row.expectedTaken}`,
                      row.isProjection ? 'Still to come' : `Taken: ${row.actualTaken}`,
                    ],
                    host.current,
                  )
                }
                onMouseLeave={hide}
                onFocus={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  show(
                    { clientX: box.left + box.width / 2, clientY: box.top },
                    [`Day ${row.day}`, `Taken ${row.actualTaken} of ${row.expectedTaken} planned`],
                    host.current,
                  );
                }}
                onBlur={hide}
              />
            ))}

            {lastMeasured && (
              <circle
                cx={x(rows.indexOf(lastMeasured))}
                cy={y(lastMeasured.actualTaken)}
                r={4.5}
                fill="var(--viz-series-1)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            )}

            <text x={left} y={height - 6} className="viz-axis">
              Day 1
            </text>
            <text x={width - right} y={height - 6} className="viz-axis" textAnchor="end">
              Day {rows.at(-1)!.day}
            </text>
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 7. How you felt, against what you took                                     */
/* -------------------------------------------------------------------------- */

/**
 * The product's whole thesis, about this patient.
 *
 * Severity runs 0–10 and doses run 0–3; putting both on one plot would need two
 * y-scales, which invents a correlation out of whatever alignment was chosen.
 * So they are two plots stacked on a shared day axis — the reader's eye does the
 * joining, and the only claim made is that these two things happened on the same
 * days.
 */
export function SymptomAgainstDoses({
  conditionName,
  points,
  doseDays,
  note,
}: {
  conditionName: string;
  points: readonly { dayNumber: number | null; dateLabel: string; severity: number; severityLabel: string; note: string | null }[];
  doseDays: readonly { day: number; taken: number; total: number }[];
  note?: string | null;
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [ref, width] = useChartWidth();
  const { tip, show, hide } = useTooltip();

  const usable = points.filter((point) => point.dayNumber !== null);
  if (usable.length < 2) return null;

  const severityHeight = 120;
  const stripHeight = 34;
  const gapBetween = 10;
  const height = severityHeight + gapBetween + stripHeight + 20;

  const left = 26;
  const right = 10;
  const plotWidth = Math.max(10, width - left - right);

  const days = [
    ...new Set([...usable.map((p) => p.dayNumber!), ...doseDays.map((d) => d.day)]),
  ].sort((a, b) => a - b);
  const lastDay = days.at(-1) ?? 1;
  const firstDay = days[0] ?? 1;

  const x = (day: number): number =>
    lastDay === firstDay
      ? left + plotWidth / 2
      : left + ((day - firstDay) / (lastDay - firstDay)) * plotWidth;
  const y = (severity: number): number => 10 + (1 - severity / 10) * (severityHeight - 20);

  const path = usable
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.dayNumber!)} ${y(point.severity)}`)
    .join(' ');

  const slotWidth = Math.max(
    8,
    Math.min(32, plotWidth / Math.max(1, days.length) - 4),
  );

  return (
    <Figure
      title={`How you felt — ${conditionName}`}
      caption="0 is completely well, 10 is as bad as it has been. The row underneath is the doses you took that day."
      legend={[
        { label: 'How you felt', swatch: <Swatch tone="series-1" shape="line" /> },
        { label: 'Doses taken', swatch: <Swatch tone="good" /> },
        { label: 'Doses not taken', swatch: <Swatch tone="bad" /> },
      ]}
      note={note}
      table={{
        columns: ['Day', 'Date', 'How you felt', 'Doses taken'],
        rows: usable.map((point) => {
          const day = doseDays.find((d) => d.day === point.dayNumber);
          return [
            point.dayNumber ?? '—',
            point.dateLabel,
            `${point.severity}/10 — ${point.severityLabel}`,
            day ? `${day.taken} of ${day.total}` : '—',
          ];
        }),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label={`How you felt against doses taken, ${conditionName}`}>
            {/* Plot one: how it felt. */}
            <GridLines ticks={[0, 5, 10]} width={width - right} left={left} scale={y} />
            {[0, 5, 10].map((tick) => (
              <text
                key={tick}
                x={left - 5}
                y={y(tick) + 4}
                className="viz-axis viz-axis--num"
                textAnchor="end"
              >
                {tick}
              </text>
            ))}

            <path d={path} fill="none" stroke="var(--viz-series-1)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

            {usable.map((point) => (
              <g key={point.dayNumber}>
                <circle
                  cx={x(point.dayNumber!)}
                  cy={y(point.severity)}
                  r={5}
                  fill="var(--viz-series-1)"
                  stroke="var(--card)"
                  strokeWidth={2}
                  tabIndex={0}
                  role="button"
                  aria-label={`Day ${point.dayNumber}: ${point.severity} out of 10, ${point.severityLabel}`}
                  onMouseMove={(event) =>
                    show(
                      event,
                      [
                        `Day ${point.dayNumber} · ${point.dateLabel}`,
                        `${point.severity}/10 — ${point.severityLabel}`,
                        point.note ?? '',
                      ].filter(Boolean),
                      host.current,
                    )
                  }
                  onMouseLeave={hide}
                  onFocus={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    show(
                      { clientX: box.left + box.width / 2, clientY: box.top },
                      [`Day ${point.dayNumber}`, `${point.severity}/10 — ${point.severityLabel}`],
                      host.current,
                    );
                  }}
                  onBlur={hide}
                />
              </g>
            ))}

            {/* Plot two: the doses, on the same day axis. */}
            {doseDays.map((day) => {
              const notTaken = Math.max(0, day.total - day.taken);
              const top = severityHeight + gapBetween;
              const unit = day.total === 0 ? 0 : (stripHeight - 4) / day.total;
              return (
                <g
                  key={`strip-${day.day}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`Day ${day.day}: ${day.taken} of ${day.total} doses taken`}
                  onMouseMove={(event) =>
                    show(
                      event,
                      [`Day ${day.day}`, `${day.taken} of ${day.total} doses taken`],
                      host.current,
                    )
                  }
                  onMouseLeave={hide}
                  onFocus={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    show(
                      { clientX: box.left + box.width / 2, clientY: box.top },
                      [`Day ${day.day}`, `${day.taken} of ${day.total} doses taken`],
                      host.current,
                    );
                  }}
                  onBlur={hide}
                >
                  {Array.from({ length: day.taken }, (_, index) => (
                    <rect
                      key={`t${index}`}
                      x={x(day.day) - slotWidth / 2}
                      // A 2px surface gap between segments, not a border.
                      y={top + stripHeight - (index + 1) * unit}
                      width={slotWidth}
                      height={Math.max(2, unit - 2)}
                      rx={2}
                      fill="var(--viz-good)"
                    />
                  ))}
                  {Array.from({ length: notTaken }, (_, index) => (
                    <rect
                      key={`m${index}`}
                      x={x(day.day) - slotWidth / 2}
                      y={top + stripHeight - (day.taken + index + 1) * unit}
                      width={slotWidth}
                      height={Math.max(2, unit - 2)}
                      rx={2}
                      fill="var(--viz-bad)"
                      fillOpacity={0.85}
                    />
                  ))}
                </g>
              );
            })}

            <text x={left} y={height - 4} className="viz-axis">
              Day {firstDay}
            </text>
            <text x={width - right} y={height - 4} className="viz-axis" textAnchor="end">
              Day {lastDay}
            </text>
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 8. The lifetime timeline                                                   */
/* -------------------------------------------------------------------------- */

export interface TimelineRow {
  conditionId: string;
  name: string;
  startedAt: Date;
  endedAt: Date | null;
  startLabel: string;
  endLabel: string | null;
  durationDays: number;
  state: 'in_progress' | 'cleared' | 'stopped' | 'ongoing';
  percentComplete: number;
  recurrenceOfConditionId: string | null;
}

const STATE_WORDS: Record<TimelineRow['state'], string> = {
  in_progress: 'Being treated',
  cleared: 'Cleared',
  stopped: 'Stopped early',
  ongoing: 'Long-term',
};

/**
 * Illnesses as bars across the years, with the recurrence arrows drawn.
 *
 * `recurrenceOfConditionId` is the strongest fact in this record — a course
 * abandoned in February and the same illness back in October — and until now it
 * has been one line of grey text on a card. Drawn, it is the argument the whole
 * product is making.
 *
 * Four states, and only three carry a hue: a long-term condition is a hatched
 * bar with no end cap, which is both what it is and what keeps the palette
 * inside the number of classes a reader can separate. Every bar is labelled, so
 * the state never depends on its colour.
 */
export function EpisodeTimeline({
  rows,
  onOpen,
}: {
  rows: readonly TimelineRow[];
  onOpen?: (conditionId: string) => void;
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [ref, width] = useChartWidth();
  const { tip, show, hide } = useTooltip();

  if (rows.length === 0) return null;

  const ordered = [...rows].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const now = Date.now();
  const first = ordered[0]!.startedAt.getTime();
  const last = Math.max(
    now,
    ...ordered.map((row) => (row.endedAt ?? new Date(now)).getTime()),
  );
  const span = Math.max(1, last - first);

  const labelWidth = 0;
  const rowHeight = 46;
  const barHeight = 13;
  const height = ordered.length * rowHeight + 18;
  const plotWidth = Math.max(10, width - labelWidth - 8);

  const x = (time: number): number => labelWidth + ((time - first) / span) * plotWidth;
  const indexById = new Map(ordered.map((row, index) => [row.conditionId, index]));

  const years = [...new Set(ordered.map((row) => row.startedAt.getFullYear()))];

  return (
    <Figure
      title="Your illnesses, end to end"
      caption="Each bar is one illness. An arrow means it came back."
      legend={[
        { label: 'Cleared', swatch: <Swatch tone="good" /> },
        { label: 'Stopped early', swatch: <Swatch tone="bad" /> },
        { label: 'Being treated', swatch: <Swatch tone="series-2" /> },
        {
          label: 'Long-term',
          swatch: <span className="viz-swatch viz-swatch--hatch" aria-hidden="true" />,
        },
      ]}
      table={{
        columns: ['Illness', 'From', 'To', 'Days', 'How it went', 'Doses taken'],
        rows: ordered.map((row) => [
          row.name,
          row.startLabel,
          row.endLabel ?? 'still open',
          row.durationDays,
          STATE_WORDS[row.state],
          row.state === 'ongoing' ? '—' : `${row.percentComplete}%`,
        ]),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label="Every illness on the record">
            <defs>
              <pattern id="viz-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="var(--viz-neutral-bg)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--viz-neutral)" strokeWidth="2" />
              </pattern>
              <marker id="viz-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                <path d="M0,0 L6,3.5 L0,7 Z" fill="var(--viz-bad)" />
              </marker>
            </defs>

            {years.map((year) => {
              const at = x(new Date(year, 0, 1).getTime());
              if (at < labelWidth || at > width) return null;
              return (
                <g key={year} aria-hidden="true">
                  <line x1={at} x2={at} y1={0} y2={height - 16} stroke="var(--viz-grid)" strokeWidth={1} />
                  <text x={at + 3} y={height - 4} className="viz-axis">
                    {year}
                  </text>
                </g>
              );
            })}

            {ordered.map((row, index) => {
              const y = index * rowHeight + 16;
              const startX = x(row.startedAt.getTime());
              const endX = x((row.endedAt ?? new Date(now)).getTime());
              const barWidth = Math.max(6, endX - startX);
              const fill =
                row.state === 'ongoing'
                  ? 'url(#viz-hatch)'
                  : row.state === 'cleared'
                    ? 'var(--viz-good)'
                    : row.state === 'stopped'
                      ? 'var(--viz-bad)'
                      : 'var(--viz-series-2)';

              // The arrow from the course that was abandoned to the illness
              // that followed it.
              const fromIndex = row.recurrenceOfConditionId
                ? indexById.get(row.recurrenceOfConditionId)
                : undefined;

              return (
                <g key={row.conditionId}>
                  {fromIndex !== undefined && (
                    <path
                      d={`M${x(ordered[fromIndex]!.endedAt?.getTime() ?? ordered[fromIndex]!.startedAt.getTime())} ${
                        fromIndex * rowHeight + 16 + barHeight / 2
                      } C ${startX - 20} ${fromIndex * rowHeight + 20}, ${startX - 20} ${y}, ${startX - 3} ${
                        y + barHeight / 2
                      }`}
                      fill="none"
                      stroke="var(--viz-bad)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      markerEnd="url(#viz-arrow)"
                      aria-hidden="true"
                    />
                  )}

                  <text x={startX} y={y - 4} className="viz-axis" style={{ fontWeight: 800 }}>
                    {row.name}
                  </text>

                  <rect
                    x={startX}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill={fill}
                    tabIndex={0}
                    role={onOpen ? 'button' : 'img'}
                    aria-label={`${row.name}, ${row.startLabel} to ${row.endLabel ?? 'now'}, ${
                      STATE_WORDS[row.state]
                    }`}
                    style={onOpen ? { cursor: 'pointer' } : undefined}
                    onClick={() => onOpen?.(row.conditionId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onOpen?.(row.conditionId);
                    }}
                    onMouseMove={(event) =>
                      show(
                        event,
                        [
                          row.name,
                          `${row.startLabel} → ${row.endLabel ?? 'now'}`,
                          STATE_WORDS[row.state],
                          row.state === 'ongoing' ? '' : `${row.percentComplete}% of the doses taken`,
                          fromIndex !== undefined ? 'Came back after an earlier course' : '',
                        ].filter(Boolean),
                        host.current,
                      )
                    }
                    onMouseLeave={hide}
                    onFocus={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      show(
                        { clientX: box.left + box.width / 2, clientY: box.top },
                        [row.name, STATE_WORDS[row.state]],
                        host.current,
                      );
                    }}
                    onBlur={hide}
                  />
                </g>
              );
            })}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 9. Which rung did the work                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The agent's own case for existing, made honestly.
 *
 * If nearly everything settles at the first reminder, this is a reminder app
 * with a great deal of machinery behind it. If the later rungs carry real
 * weight, that is worth knowing. And if the family rung is carrying it, the
 * patient should be the first to find that out — which is why that bar is
 * marked and named rather than just coloured.
 */
export function EscalationFunnel({
  rows,
}: {
  rows: readonly { nodeId: string; label: string; count: number; percent: number; isFamily: boolean }[];
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const [ref, width] = useChartWidth();
  const { tip, show, hide } = useTooltip();

  if (rows.length === 0) return null;

  const labelWidth = 118;
  const rowHeight = 30;
  const barHeight = 12;
  const plotWidth = Math.max(20, width - labelWidth - 44);
  const max = Math.max(...rows.map((row) => row.count), 1);
  const height = rows.length * rowHeight;

  return (
    <Figure
      title="Which nudge actually worked"
      caption="How often each step of the ladder was the one that went out."
      legend={
        rows.some((row) => row.isFamily)
          ? [
              { label: 'My own reminders', swatch: <Swatch tone="series-1" /> },
              { label: 'Your family — the last resort', swatch: <Swatch tone="warn" /> },
            ]
          : undefined
      }
      table={{
        columns: ['Step', 'Times', 'Share'],
        rows: rows.map((row) => [row.label, row.count, `${row.percent}%`]),
      }}
    >
      <div className="viz__plot" ref={host}>
        <div ref={ref}>
          <svg width={width} height={height} role="img" aria-label="Escalation steps used">
            {rows.map((row, index) => {
              const y = index * rowHeight;
              const barWidth = Math.max(3, (row.count / max) * plotWidth);
              return (
                <g key={row.nodeId}>
                  <text x={0} y={y + rowHeight / 2 + 4} className="viz-axis">
                    {row.label}
                  </text>
                  <rect
                    x={labelWidth}
                    y={y + (rowHeight - barHeight) / 2}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill={row.isFamily ? 'var(--viz-warn)' : 'var(--viz-series-1)'}
                    tabIndex={0}
                    role="button"
                    aria-label={`${row.label}: ${row.count} times, ${row.percent}%`}
                    onMouseMove={(event) =>
                      show(
                        event,
                        [
                          row.label,
                          `${row.count} ${row.count === 1 ? 'time' : 'times'}`,
                          row.isFamily ? 'Your family was told — the last rung' : '',
                        ].filter(Boolean),
                        host.current,
                      )
                    }
                    onMouseLeave={hide}
                    onFocus={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      show(
                        { clientX: box.left + box.width / 2, clientY: box.top },
                        [row.label, `${row.count} times`],
                        host.current,
                      );
                    }}
                    onBlur={hide}
                  />
                  <text x={labelWidth + barWidth + 8} y={y + rowHeight / 2 + 4} className="viz-value">
                    {row.count}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <Tooltip tip={tip} width={width} />
      </div>
    </Figure>
  );
}

/* -------------------------------------------------------------------------- */
/* 10. Stat tiles — where the number is the chart                             */
/* -------------------------------------------------------------------------- */

/**
 * Four numbers, and no plot.
 *
 * The most common way a chart screen misses its point is drawing eight hues
 * when the story is one number. A streak, a count and a percentage are stat
 * tiles: proportional figures, no equal-width digits at this size, and the unit
 * in the label rather than appended to the value.
 */
export function StatTiles({
  tiles,
}: {
  tiles: readonly { label: string; value: string; hint?: string | null; tone?: 'good' | 'bad' | 'plain' }[];
}): ReactNode {
  return (
    <div className="stat-tiles">
      {tiles.map((tile) => (
        <div key={tile.label} className="stat-tile">
          <div
            className="stat-tile__value"
            style={{
              color:
                tile.tone === 'good'
                  ? 'var(--viz-good)'
                  : tile.tone === 'bad'
                    ? 'var(--viz-bad)'
                    : 'var(--ink)',
            }}
          >
            {tile.value}
          </div>
          <div className="stat-tile__label">{tile.label}</div>
          {tile.hint && <div className="stat-tile__hint">{tile.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** A horizontal 0–10 severity picker, used by the daily "how are you?" prompt. */
export function SeverityPicker({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <div className="severity" role="radiogroup" aria-label="How are you feeling, 0 to 10">
      {Array.from({ length: 11 }, (_, index) => index).map((score) => (
        <button
          key={score}
          type="button"
          role="radio"
          aria-checked={value === score}
          disabled={disabled}
          className={`severity__dot${value === score ? ' severity__dot--on' : ''}`}
          onClick={() => onChange(score)}
        >
          {score}
        </button>
      ))}
    </div>
  );
}
