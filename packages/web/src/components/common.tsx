import type { ReactNode } from 'react';
import type { MedicationForm } from '@medication-ai/shared';

/** The agent's mark: a ring, echoing the "keeps watch" idea. */
export function AgentMark({ size = 46 }: { size?: number }): ReactNode {
  const inner = Math.round(size * 0.43);
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: size / 2,
        background: 'var(--ink)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          border: `${Math.max(2, Math.round(size * 0.065))}px solid var(--mint)`,
        }}
      />
    </div>
  );
}

/** A tablet or capsule glyph, so a medicine is recognisable at a glance. */
export function PillIcon({ tone = 'capsule', size = 58 }: { tone?: 'capsule' | 'tablet' | 'oblong'; size?: number }): ReactNode {
  const inner =
    tone === 'capsule' ? (
      <div
        style={{
          width: size * 0.59,
          height: size * 0.34,
          borderRadius: size * 0.17,
          background: 'linear-gradient(90deg,#E36B4E 0 50%,#F2F0EA 50% 100%)',
          border: '1.5px solid var(--ink)',
        }}
      />
    ) : tone === 'tablet' ? (
      <div
        style={{
          width: size * 0.41,
          height: size * 0.41,
          borderRadius: '50%',
          background: '#F2F0EA',
          border: '1.5px solid var(--ink)',
        }}
      />
    ) : (
      <div
        style={{
          width: size * 0.52,
          height: size * 0.31,
          // Proportional, so it reads as a caplet at 132px and not a box.
          borderRadius: Math.max(4, size * 0.09),
          background: '#DCE7F0',
          border: '1.5px solid var(--ink)',
        }}
      />
    );

  return (
    <div
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: size * 0.31,
        background: 'var(--sand)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {inner}
    </div>
  );
}

/**
 * The glyph for a dosage form.
 *
 * Driven by the medicine's actual form rather than its name, so the picture
 * never contradicts what is in the packet — patients identify medicines by
 * sight, and a capsule drawn for a round tablet is worse than no picture.
 */
export function glyphFor(form: MedicationForm): 'capsule' | 'tablet' | 'oblong' {
  switch (form) {
    case 'capsule':
      return 'capsule';
    case 'tablet':
      return 'tablet';
    default:
      // Liquids, inhalers, creams and the rest have no faithful pill shape;
      // a neutral caplet is the least misleading stand-in.
      return 'oblong';
  }
}

export function DayCells({
  cells,
}: {
  cells: { day: number; state: 'done' | 'today' | 'upcoming' | 'missed' }[];
}): ReactNode {
  return (
    <div className="daycells">
      {cells.map((cell) => (
        <div key={cell.day} className={`daycell daycell--${cell.state}`}>
          {cell.day}
        </div>
      ))}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }): ReactNode {
  return (
    <div className="centre-state">
      <AgentMark size={54} />
      <div className="sub">{label}</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): ReactNode {
  return (
    <div className="centre-state">
      <div className="banner banner--error">{message}</div>
      {onRetry && (
        <button className="btn btn--ghost" style={{ width: 'auto', padding: '0 28px' }} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
