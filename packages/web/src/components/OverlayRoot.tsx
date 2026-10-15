import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The container every full-screen step renders into.
 *
 * On a phone these fill the screen; on a desktop they are modal dialogs over
 * the app. They were already modal in behaviour — nothing behind them can be
 * reached — without saying so, which left three things broken for anyone not
 * using a mouse: Escape did nothing, focus stayed on the button behind the
 * dialog, and a screen reader announced nothing when one opened.
 *
 * Every step closes, and closing is offered three ways: a visible button in the
 * corner, the Escape key, and a click on the scrim beside the dialog.
 *
 * An earlier version made the read-back and the intake form genuinely modal —
 * no button, no Escape — reasoning that dismissing a question is not one of its
 * answers. That reasoning is wrong in the hand. A dialog with no visible way
 * out and a dead Escape key reads as a broken app, and the read-back had no
 * back button either, so the only exits were its two answers. Closing is now
 * always possible; a step that would lose something by closing asks first, and
 * the read-back treats it as the "not yet" answer rather than dropping the
 * prescription on the floor.
 */
export function OverlayRoot({
  label,
  onClose,
  children,
}: {
  /** What this step is, for a screen reader announcing it. */
  label: string;
  /** Always provided: the caller decides what closing *means* for this step. */
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  const root = useRef<HTMLDivElement | null>(null);

  // Focus moves into the dialog and, on the way out, back to whatever opened
  // it — otherwise a keyboard user lands at the top of the page each time.
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Keep Tab inside the dialog. Without this it walks into the navigation
      // behind, where every click goes to a screen the dialog is covering.
      const focusable = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={root}
      className="overlay-root"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onClick={(event) => {
        // The scrim is only the part of this element not covered by the step
        // itself, which is why the target check matters.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="overlay-frame">
        {children}
        <button className="overlay-close" onClick={onClose} aria-label={`Close ${label}`}>
          ✕
        </button>
      </div>
    </div>
  );
}
