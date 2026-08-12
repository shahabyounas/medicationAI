import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  CourseReport,
  DoseView,
  FamilyResponse,
  IntakeOptionsResponse,
  IntakeRequest,
  MedicinesResponse,
  PrescriptionDetail,
  TodayResponse,
  VisitDetail,
  VisitsResponse,
} from '@medication-ai/shared';
import { ApiError, api } from './api/client.js';
import { AgentMark, ErrorState, Loading, StatusBar } from './components/common.js';
import { TodayScreen } from './screens/TodayScreen.js';
import { MedicinesScreen } from './screens/MedicinesScreen.js';
import { VisitsScreen } from './screens/VisitsScreen.js';
import { FamilyScreen } from './screens/FamilyScreen.js';
import { IntakeScreen } from './screens/IntakeScreen.js';
import {
  DoseOverlay,
  ReadBackOverlay,
  ReportOverlay,
  TakenOverlay,
  VisitOverlay,
} from './screens/overlays.js';

type Tab = 'today' | 'medicines' | 'visits' | 'family';

type Overlay =
  | { kind: 'none' }
  | { kind: 'dose'; dose: DoseView }
  | { kind: 'taken'; message: string }
  | { kind: 'visit'; visit: VisitDetail }
  | { kind: 'report'; report: CourseReport }
  | { kind: 'intake'; options: IntakeOptionsResponse }
  | { kind: 'readback'; detail: PrescriptionDetail };

interface Data {
  today: TodayResponse;
  medicines: MedicinesResponse;
  visits: VisitsResponse;
  family: FamilyResponse;
}

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'today', icon: '◉', label: 'Today' },
  { id: 'medicines', icon: '▤', label: 'Medicines' },
  { id: 'visits', icon: '✚', label: 'Record' },
  { id: 'family', icon: '♡', label: 'Family' },
];

const TAB_IDS = TABS.map((tab) => tab.id);

function tabFromHash(): Tab {
  const candidate = window.location.hash.replace('#', '') as Tab;
  return TAB_IDS.includes(candidate) ? candidate : 'today';
}

export function App(): ReactNode {
  const [patientId, setPatientId] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Reload every screen at once.
   *
   * Taking one dose changes the Today feed, the progress on Medicines and the
   * family log, so there is no useful notion of refreshing "just this screen".
   * The whole payload is small and this keeps the screens from disagreeing.
   */
  const refresh = useCallback(async (id: string) => {
    const [today, medicines, visits, family] = await Promise.all([
      api.today(id),
      api.medicines(id),
      api.visits(id),
      api.family(id),
    ]);
    setData({ today, medicines, visits, family });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const patients = await api.listPatients();
      const first = patients[0];
      if (!first) {
        setError('No patient found. Run `npm run seed` to load the demo data.');
        return;
      }
      setPatientId(first._id);
      await refresh(first._id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong.');
    }
  }, [refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  // The tab lives in the URL, so a refresh keeps your place and the phone's
  // back button steps between tabs rather than leaving the app.
  useEffect(() => {
    const onHashChange = (): void => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const goToTab = useCallback((next: Tab) => {
    window.location.hash = next;
    setTab(next);
  }, []);

  /**
   * Whether a dose is waiting right now.
   *
   * This drives the red blink on the Today tab. The whole product fails if she
   * does not look at that tab, so the cue is loud — but it is tied to a real
   * outstanding dose, never permanently on, because a badge that is always lit
   * stops being information within a day.
   */
  const needsAttention = useMemo(() => {
    if (!data) return false;
    return data.today.doses.some((dose) => dose.status === 'due' || dose.status === 'missed');
  }, [data]);

  /** Run a dose action, then resync every screen. */
  const act = useCallback(
    async (action: () => Promise<{ message: string }>, celebrate: boolean) => {
      if (!patientId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        await refresh(patientId);
        setOverlay(celebrate ? { kind: 'taken', message: result.message } : { kind: 'none' });
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Something went wrong.');
        setOverlay({ kind: 'none' });
      } finally {
        setBusy(false);
      }
    },
    [busy, patientId, refresh],
  );

  const openReport = useCallback(
    async (conditionId?: string) => {
      const id = conditionId ?? data?.today.primaryCondition?.conditionId;
      if (!id) return;
      try {
        setOverlay({ kind: 'report', report: await api.report(id) });
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not load the report.');
      }
    },
    [data],
  );

  /** Open the "add a prescription" wizard, loading its choices first. */
  const openIntake = useCallback(async () => {
    if (!patientId) return;
    setBusy(true);
    setError(null);
    try {
      setOverlay({ kind: 'intake', options: await api.intakeOptions(patientId) });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not open the form.');
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  /**
   * Save an intake, then go straight to the read-back.
   *
   * The prescription is confirmed on the patient's behalf here because she has
   * just typed it in herself — asking her to re-approve her own typing is
   * ceremony. The question that genuinely matters, "do you have it yet?", is
   * the one the next screen asks.
   */
  const submitIntake = useCallback(
    async (request: IntakeRequest) => {
      if (!patientId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await api.intake(request);
        await api.confirmPrescription(result.prescriptionId);
        const detail = await api.prescription(result.prescriptionId);
        await refresh(patientId);
        setOverlay({ kind: 'readback', detail });
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not save that.');
      } finally {
        setBusy(false);
      }
    },
    [busy, patientId, refresh],
  );

  /** "Yes, I have it" — the moment the clock starts. */
  const startCourse = useCallback(
    async (prescriptionId: string) => {
      if (!patientId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await api.startPrescription(prescriptionId);
        await refresh(patientId);
        setOverlay({ kind: 'none' });
        goToTab('today');
        setNotice(
          `${result.dosesScheduled} doses planned around your mealtimes. I'll take it from here.`,
        );
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not start the course.');
      } finally {
        setBusy(false);
      }
    },
    [busy, patientId, refresh, goToTab],
  );

  const closeOverlay = useCallback(() => setOverlay({ kind: 'none' }), []);

  return (
    <div className="app">
      {/* Desktop navigation. */}
      <aside className="sidebar">
        <div className="brand">
          <AgentMark size={40} />
          <div>
            <div style={{ font: '900 17px/1.2 var(--font)' }}>Medication Agent</div>
            {data && (
              <div style={{ font: '600 13px/1.3 var(--font)', color: 'var(--green)' }}>
                {data.today.patientName}
              </div>
            )}
          </div>
        </div>

        {TABS.map((item) => {
          const attention = item.id === 'today' && needsAttention && tab !== 'today';
          return (
            <button
              key={item.id}
              className={`nav-item${tab === item.id ? ' nav-item--active' : ''}${
                attention ? ' nav-item--attention' : ''
              }`}
              onClick={() => goToTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
            >
              <span className="tab-icon">
                {item.icon}
                {attention && <span className="attention-dot" />}
              </span>
              {item.label}
              {attention && <span className="sr-only">— a dose is waiting</span>}
            </button>
          );
        })}

        <button
          className="btn btn--primary"
          style={{ marginTop: 'auto', fontSize: 17 }}
          onClick={() => void openIntake()}
          disabled={busy || !patientId}
        >
          + Add a prescription
        </button>
      </aside>

      <main className="main">
        <StatusBar />

        {!data && !error && <Loading label="Waking your agent…" />}
        {!data && error && <ErrorState message={error} onRetry={() => void load()} />}

        {data && (
          <>
            <div className="scroll">
              {(error || notice) && (
                <div className="pad" style={{ paddingBottom: 0 }}>
                  {error && <div className="banner banner--error">{error}</div>}
                  {notice && !error && (
                    <button
                      className="banner banner--info"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => setNotice(null)}
                    >
                      {notice}
                    </button>
                  )}
                </div>
              )}

              {tab === 'today' && (
                <TodayScreen
                  today={data.today}
                  busy={busy}
                  onOpenDose={(dose) => setOverlay({ kind: 'dose', dose })}
                  onOpenCondition={(id) => void openReport(id)}
                  onAddPrescription={() => void openIntake()}
                />
              )}
              {tab === 'medicines' && (
                <MedicinesScreen
                  medicines={data.medicines}
                  onOpenCondition={(id) => void openReport(id)}
                  onAddPrescription={() => void openIntake()}
                />
              )}
              {tab === 'visits' && (
                <VisitsScreen
                  data={data.visits}
                  onOpenVisit={(visit) => setOverlay({ kind: 'visit', visit })}
                  onAddPrescription={() => void openIntake()}
                />
              )}
              {tab === 'family' && patientId && (
                <FamilyScreen
                  family={data.family}
                  patientId={patientId}
                  onOpenReport={() => void openReport()}
                  reportAvailable={data.today.primaryCondition !== null}
                />
              )}
            </div>

            {/* Mobile navigation. */}
            <nav className="tabbar">
              {TABS.map((item) => {
                const attention = item.id === 'today' && needsAttention && tab !== 'today';
                return (
                  <button
                    key={item.id}
                    className={`tab${tab === item.id ? ' tab--active' : ''}${
                      attention ? ' tab--attention' : ''
                    }`}
                    onClick={() => goToTab(item.id)}
                    aria-current={tab === item.id ? 'page' : undefined}
                  >
                    <span className="tab-icon">
                      {item.icon}
                      {attention && <span className="attention-dot" />}
                    </span>
                    <span className="tab-label">{item.label}</span>
                    {attention && <span className="sr-only">— a dose is waiting</span>}
                  </button>
                );
              })}
            </nav>
          </>
        )}

        {overlay.kind !== 'none' && (
          <div className="overlay-root">
            {overlay.kind === 'dose' && (
              <DoseOverlay
                dose={overlay.dose}
                busy={busy}
                onClose={closeOverlay}
                onTake={() => void act(() => api.takeDose(overlay.dose._id), true)}
                onSnooze={() => void act(() => api.snoozeDose(overlay.dose._id, 30), false)}
                onSkip={() => void act(() => api.skipDose(overlay.dose._id), false)}
              />
            )}
            {overlay.kind === 'taken' && (
              <TakenOverlay message={overlay.message} onClose={closeOverlay} />
            )}
            {overlay.kind === 'visit' && (
              <VisitOverlay visit={overlay.visit} onClose={closeOverlay} />
            )}
            {overlay.kind === 'report' && (
              <ReportOverlay report={overlay.report} onClose={closeOverlay} />
            )}
            {overlay.kind === 'intake' && patientId && (
              <IntakeScreen
                options={overlay.options}
                patientId={patientId}
                busy={busy}
                onCancel={closeOverlay}
                onSubmit={(request) => void submitIntake(request)}
              />
            )}
            {overlay.kind === 'readback' && (
              <ReadBackOverlay
                detail={overlay.detail}
                busy={busy}
                onStart={() => void startCourse(overlay.detail._id)}
                onNotYet={() => {
                  closeOverlay();
                  setNotice(
                    "Saved. I'll wait — tell me when you have the medicine and I'll start the reminders.",
                  );
                }}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
