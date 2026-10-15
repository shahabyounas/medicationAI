import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  ConditionHistory,
  CourseReport,
  DoseView,
  HistoryResponse,
  FamilyResponse,
  Mealtimes,
  IntakeOptionsResponse,
  IntakeRequest,
  MedicinesResponse,
  PrescriptionDetail,
  VisitDetail,
  VisitsResponse,
} from '@medication-ai/shared';
import type {
  AppointmentsResponse,
  CreateAppointmentRequest,
  CreateImmunisationRequest,
  CreateLabResultRequest,
  InsightsResponse,
  ProfileResponse,
  ReadingMetric,
  ReadingsResponse,
  RecordReadingRequest,
  ReportSideEffectRequest,
  ReportSideEffectResponse,
  ResultsResponse,
  SelfCareIntakeRequest,
  ShareSummaryResponse,
  UpdateProfileRequest,
} from '@medication-ai/shared';
import { ApiError, api } from './api/client.js';
import { useAgentClock } from './agentClock.js';
import { AgentMark, ErrorState, Loading } from './components/common.js';
import { OverlayRoot } from './components/OverlayRoot.js';
import { HistoryScreen } from './screens/HistoryScreen.js';
import { ConditionScreen } from './screens/ConditionScreen.js';
import { MedicinesScreen } from './screens/MedicinesScreen.js';
import { RecordScreen } from './screens/RecordScreen.js';
import { RemindersScreen } from './screens/RemindersScreen.js';
import { IntakeScreen } from './screens/IntakeScreen.js';
import {
  DoseOverlay,
  ReadBackOverlay,
  ReportOverlay,
  TakenOverlay,
  VisitOverlay,
} from './screens/overlays.js';
import { HealthScreen } from './screens/HealthScreen.js';
import { ProfileScreen } from './screens/ProfileScreen.js';
import { ShareScreen } from './screens/ShareScreen.js';
import { SideEffectReplyScreen, SideEffectScreen } from './screens/SideEffectScreen.js';
import {
  AppointmentOverlay,
  DocumentOverlay,
  ImmunisationOverlay,
  LabResultOverlay,
  ReadingOverlay,
  RefillOverlay,
  SelfCareOverlay,
} from './screens/LogOverlays.js';

/**
 * Three tabs, with the lifetime record as home.
 *
 * The app's job is to keep a patient's whole healthcare history — every
 * illness, every appointment, every course, every tablet actually swallowed —
 * for as long as they keep using it. That record is the product, so it is the
 * screen the app opens on.
 *
 * Today did not become a fourth tab for it. A dose due in ten minutes and an
 * illness from 2019 belong to one chronology, so the present is the top of the
 * record rather than a screen beside it. "Medicines" still answers the separate
 * question *what am I on right now?*, and "Reminders" holds the settings.
 *
 * "Health" is the fourth, and it earns the slot because it answers a question
 * none of the others can: *how am I actually doing?* Everything on it — the
 * patterns in the doses, the readings the patient takes themselves, what the
 * tests said, when they are next seen — is the outcome side of the record, and
 * the app held almost none of it. The record says what was prescribed and what
 * was swallowed; this says whether any of it worked.
 */
type Tab = 'record' | 'medicines' | 'health' | 'reminders';

type Overlay =
  | { kind: 'none' }
  | { kind: 'dose'; dose: DoseView }
  | { kind: 'taken'; message: string }
  | { kind: 'visit'; visit: VisitDetail }
  | { kind: 'report'; report: CourseReport }
  | { kind: 'intake'; options: IntakeOptionsResponse }
  | { kind: 'readback'; detail: PrescriptionDetail }
  | { kind: 'record'; data: VisitsResponse }
  | { kind: 'condition'; data: ConditionHistory }
  | { kind: 'sideEffect'; courseId: string | null }
  | { kind: 'sideEffectReply'; reply: ReportSideEffectResponse }
  | { kind: 'reading'; metric: ReadingMetric }
  | { kind: 'selfCare'; options: IntakeOptionsResponse }
  | { kind: 'appointment'; options: IntakeOptionsResponse }
  | { kind: 'labResult'; options: IntakeOptionsResponse }
  | { kind: 'immunisation' }
  | { kind: 'document' }
  | {
      kind: 'refill';
      courseId: string;
      medicationName: string;
      dosesRemaining: number;
      unitsRemaining: number | null;
    }
  | { kind: 'share'; summary: ShareSummaryResponse }
  | { kind: 'profile'; profile: ProfileResponse }
  | { kind: 'photo'; title: string; dataUrl: string };

/**
 * What a step is called, for a screen reader announcing the dialog, and what to
 * ask before closing it.
 *
 * Every step can now be closed. Making the read-back and the intake form
 * undismissable kept a stray Escape from throwing away an answer or a half-typed
 * form, but it also left a dialog with no visible exit and a dead Escape key —
 * which reads as a jammed app, not as a considered choice. So the two steps that
 * stand to lose something ask first, and the rest close silently.
 */
function describeOverlay(overlay: Overlay): { label: string; confirmClose: string | null } {
  switch (overlay.kind) {
    case 'dose':
      return { label: `Take your ${overlay.dose.medicationName}`, confirmClose: null };
    case 'taken':
      return { label: 'Dose confirmed', confirmClose: null };
    case 'visit':
      return { label: `Your visit with ${overlay.visit.doctorName}`, confirmClose: null };
    case 'report':
      return { label: `Course report — ${overlay.report.conditionName}`, confirmClose: null };
    case 'record':
      return { label: 'Your record', confirmClose: null };
    case 'condition':
      return { label: overlay.data.name, confirmClose: null };
    case 'intake':
      return {
        label: 'Add a prescription',
        confirmClose: 'Leave this form? Everything you have typed will be lost.',
      };
    case 'readback':
      // No question: the prescription is already saved, and closing means the
      // same as "not yet", which now leaves it waiting on the Today screen.
      return { label: 'Check the prescription', confirmClose: null };
    case 'sideEffect':
      return {
        label: 'Tell me what is wrong',
        confirmClose: 'Stop telling me about this? Nothing will be written down.',
      };
    case 'sideEffectReply':
      return { label: 'What I have done about it', confirmClose: null };
    case 'reading':
      return { label: 'Write down a reading', confirmClose: null };
    case 'selfCare':
      return {
        label: 'Add something you take yourself',
        confirmClose: 'Leave this? Nothing will be added.',
      };
    case 'appointment':
      return { label: 'Add an appointment', confirmClose: null };
    case 'labResult':
      return { label: 'Add a test result', confirmClose: 'Leave this? Nothing will be saved.' };
    case 'immunisation':
      return { label: 'Add a jab', confirmClose: null };
    case 'document':
      return { label: 'Add a photograph', confirmClose: null };
    case 'refill':
      return { label: 'How many have you got?', confirmClose: null };
    case 'share':
      return { label: 'Your record, on one page', confirmClose: null };
    case 'profile':
      return { label: 'You', confirmClose: null };
    case 'photo':
      return { label: overlay.title, confirmClose: null };
    case 'none':
      return { label: '', confirmClose: null };
  }
}

/** "5 visits · 2 doctors" — enough to show the record is worth opening. */
function summariseRecord(visits: VisitsResponse): string {
  if (visits.visits.length === 0 && visits.doctors.length === 0) {
    return 'Nothing filed yet';
  }
  const parts = [
    `${visits.visits.length} ${visits.visits.length === 1 ? 'visit' : 'visits'}`,
    `${visits.doctors.length} ${visits.doctors.length === 1 ? 'doctor' : 'doctors'}`,
  ];
  return parts.join(' · ');
}

interface Data {
  history: HistoryResponse;
  medicines: MedicinesResponse;
  visits: VisitsResponse;
  family: FamilyResponse;
  insights: InsightsResponse;
  readings: ReadingsResponse;
  appointments: AppointmentsResponse;
  results: ResultsResponse;
}

/**
 * Line icons rather than the `◉ ▤ ✚ ♡` glyphs that were here before.
 *
 * Those were ornaments: a filled circle for "Today" and a heart for "Family"
 * carry no meaning to a patient in her seventies, and at 21px the typeface drew
 * them at four different weights. A clock, a capsule and a bell say what the
 * three tabs are without the label having to do all the work.
 */
const TABS: { id: Tab; icon: ReactNode; label: string }[] = [
  {
    id: 'record',
    label: 'Record',
    icon: (
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    ),
  },
  {
    id: 'medicines',
    label: 'Medicines',
    icon: (
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2.5" y="9" width="19" height="7.5" rx="3.75" />
        <path d="M12 9v7.5" />
      </svg>
    ),
  },
  {
    id: 'health',
    label: 'Health',
    icon: (
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 17.5l4.5-5 3.5 3L17 8l4 4.5" />
        <path d="M3 21h18" />
      </svg>
    ),
  },
  {
    id: 'reminders',
    label: 'Reminders',
    icon: (
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
        <path d="M10.2 19a2 2 0 0 0 3.6 0" />
      </svg>
    ),
  },
];

const TAB_IDS = TABS.map((tab) => tab.id);

/**
 * Two tabs went away; their URLs did not.
 *
 * The tab lives in the hash, so a bookmark or an installed PWA shortcut can
 * still point at `#visits` or `#family`. Those land on the screen that absorbed
 * them rather than silently falling back to Today.
 */
const RETIRED_TABS: Record<string, Tab> = {
  today: 'record',
  visits: 'medicines',
  family: 'reminders',
};

function tabFromHash(): Tab {
  const candidate = window.location.hash.replace('#', '');
  if (TAB_IDS.includes(candidate as Tab)) return candidate as Tab;
  return RETIRED_TABS[candidate] ?? 'record';
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
    const [history, medicines, visits, family, insights, readings, appointments, results] =
      await Promise.all([
        api.history(id),
        api.medicines(id),
        api.visits(id),
        api.family(id),
        api.insights(id),
        api.readings(id),
        api.appointments(id),
        api.results(id),
      ]);
    setData({
      history,
      medicines,
      visits,
      family,
      insights,
      readings,
      appointments,
      results,
    });
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
    return data.history.todayDoses.some((d) => d.status === 'due' || d.status === 'missed');
  }, [data]);

  /** The dose waiting right now, if there is one. */
  const due = data?.history.due ?? null;

  /**
   * Let the agent catch up while the app is open.
   *
   * Nothing else advances it in production — a serverless function has no
   * timer — so the open app is the clock. It also means a dose that comes due
   * while the screen is sitting there turns red on its own, rather than waiting
   * for someone to pull to refresh an app that answers "have I taken it yet?".
   *
   * Paused mid-action and behind a step: the data under an open dialog should
   * not change while it is being read, and the action itself resyncs anyway.
   */
  useAgentClock({
    enabled: patientId !== null && !busy && overlay.kind === 'none',
    onAdvance: () => {
      if (!patientId) return;
      // A failed resync earns no banner; the next tick is a minute away.
      void refresh(patientId).catch(() => undefined);
    },
  });

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
      const id =
        conditionId ??
        data?.medicines.active[0]?._id ??
        data?.medicines.finished[0]?._id;
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
        goToTab('record');
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

  /** One illness in full — the visits, the medicines and every dose taken. */
  const openCondition = useCallback(async (conditionId: string) => {
    try {
      setOverlay({ kind: 'condition', data: await api.conditionHistory(conditionId) });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not open that.');
    }
  }, []);

  /** A visit note, reached from the record by id rather than by object. */
  const openVisit = useCallback(
    (visitId: string) => {
      const visit = data?.visits.visits.find((v) => v._id === visitId);
      if (visit) setOverlay({ kind: 'visit', visit });
    },
    [data],
  );

  /** The record, opened from Medicines rather than owning a tab. */
  const openRecord = useCallback(() => {
    if (!data) return;
    setOverlay({ kind: 'record', data: data.visits });
  }, [data]);

  /**
   * Correct the mealtimes, and move the doses still to come with them.
   *
   * The notice says how many moved. A setting that quietly rewrites a running
   * course should not report "Saved".
   */
  const saveMealtimes = useCallback(
    async (mealtimes: Mealtimes) => {
      if (!patientId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await api.updateMealtimes(patientId, mealtimes);
        await refresh(patientId);
        setNotice(
          result.movedDoses === 0
            ? 'Mealtimes saved. Nothing left to take was affected.'
            : `Mealtimes saved. I moved the ${result.movedDoses} ${
                result.movedDoses === 1 ? 'dose' : 'doses'
              } still to come to match.`,
        );
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not save those times.');
      } finally {
        setBusy(false);
      }
    },
    [busy, patientId, refresh],
  );

  /* ======================================================================== */
  /* The outcome side of the record                                           */
  /* ======================================================================== */

  /**
   * Report a side effect.
   *
   * The reply is its own screen rather than a banner, because it is the only
   * place in the app where the next move belongs to a person and the patient
   * needs a phone number in front of them rather than a line of text to
   * remember.
   */
  const reportSideEffect = useCallback(
    async (request: ReportSideEffectRequest) => {
      if (!patientId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const reply = await api.reportSideEffect(request);
        await refresh(patientId);
        setOverlay({ kind: 'sideEffectReply', reply });
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not save that.');
      } finally {
        setBusy(false);
      }
    },
    [busy, patientId, refresh],
  );

  /** Run something that changes the record, then resync every screen. */
  const run = useCallback(
    async (action: () => Promise<string | void>, closeOverlayAfter = true) => {
      if (!patientId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const message = await action();
        await refresh(patientId);
        if (closeOverlayAfter) setOverlay({ kind: 'none' });
        if (typeof message === 'string') setNotice(message);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not save that.');
      } finally {
        setBusy(false);
      }
    },
    [busy, patientId, refresh],
  );

  /** Open a form that needs the existing doctors, conditions and medicines. */
  const openWithOptions = useCallback(
    async (kind: 'selfCare' | 'appointment' | 'labResult') => {
      if (!patientId) return;
      setBusy(true);
      setError(null);
      try {
        setOverlay({ kind, options: await api.intakeOptions(patientId) });
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not open the form.');
      } finally {
        setBusy(false);
      }
    },
    [patientId],
  );

  const openShare = useCallback(async () => {
    if (!patientId) return;
    setBusy(true);
    setError(null);
    try {
      setOverlay({ kind: 'share', summary: await api.shareSummary(patientId) });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not build the page.');
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  const openProfile = useCallback(async () => {
    if (!patientId) return;
    setBusy(true);
    setError(null);
    try {
      setOverlay({ kind: 'profile', profile: await api.profile(patientId) });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not open your details.');
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  const openDocument = useCallback(async (documentId: string) => {
    try {
      const result = await api.document(documentId);
      setOverlay({
        kind: 'photo',
        title: result.document.title,
        dataUrl: result.dataUrl,
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not open that.');
    }
  }, []);

  const closeOverlay = useCallback(() => setOverlay({ kind: 'none' }), []);
  const step = describeOverlay(overlay);

  /**
   * "Not yet" — and what closing the read-back means.
   *
   * The prescription stays saved and now shows on Today as something waiting on
   * the medicine, so this is a pause rather than a discard.
   */
  const waitForMedicine = useCallback(() => {
    setOverlay({ kind: 'none' });
    setNotice(
      "Saved. It's waiting on your Today screen — tell me when you have the medicine and I'll start the reminders.",
    );
  }, []);

  /** Closing a step: confirm when something would be lost, then do the right thing. */
  const requestClose = useCallback(() => {
    if (step.confirmClose && !window.confirm(step.confirmClose)) return;
    if (overlay.kind === 'readback') {
      waitForMedicine();
      return;
    }
    closeOverlay();
  }, [closeOverlay, overlay.kind, step.confirmClose, waitForMedicine]);

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
                {data.history.patientName}
              </div>
            )}
          </div>
        </div>

        {TABS.map((item) => {
          const attention = item.id === 'record' && needsAttention && tab !== 'record';
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

              {tab === 'record' && (
                <HistoryScreen
                  history={data.history}
                  busy={busy}
                  onOpenDose={(dose) => setOverlay({ kind: 'dose', dose })}
                  onOpenCondition={(id) => void openCondition(id)}
                  onOpenVisit={(id) => void openVisit(id)}
                  onAddPrescription={() => void openIntake()}
                  onStartCourse={(id) => void startCourse(id)}
                />
              )}
              {tab === 'medicines' && (
                <MedicinesScreen
                  medicines={data.medicines}
                  busy={busy}
                  onOpenCondition={(id) => void openCondition(id)}
                  onAddPrescription={() => void openIntake()}
                  onOpenRecord={openRecord}
                  recordSummary={summariseRecord(data.visits)}
                  onAddSelfCare={() => void openWithOptions('selfCare')}
                  onReportSideEffect={(courseId) => setOverlay({ kind: 'sideEffect', courseId })}
                  onRefill={(course) => setOverlay({ kind: 'refill', ...course })}
                  onResume={(courseId) =>
                    void run(async () => (await api.resumeChasing(courseId)).message, false)
                  }
                  onStopSelfCare={(courseId) =>
                    void run(async () => (await api.stopSelfCare(courseId)).message, false)
                  }
                />
              )}
              {tab === 'health' && patientId && (
                <HealthScreen
                  insights={data.insights}
                  readings={data.readings}
                  appointments={data.appointments}
                  results={data.results}
                  busy={busy}
                  onLogReading={(metric) => setOverlay({ kind: 'reading', metric })}
                  onRecordSymptom={(conditionId, severity) =>
                    void run(
                      async () =>
                        (
                          await api.recordSymptom({
                            patientId,
                            conditionId,
                            recordedAt: new Date(),
                            severity,
                          })
                        ).message,
                      false,
                    )
                  }
                  onAddAppointment={() => void openWithOptions('appointment')}
                  onBookFromVisit={(visitId) =>
                    void run(async () => {
                      await api.appointmentFromVisit(visitId);
                      return "Booked. I'll remind you a week before, the day before, and on the morning.";
                    }, false)
                  }
                  onSetAppointmentStatus={(appointmentId, status) =>
                    void run(async () => {
                      await api.setAppointmentStatus(appointmentId, status);
                    }, false)
                  }
                  onAddResult={() => void openWithOptions('labResult')}
                  onAddImmunisation={() => setOverlay({ kind: 'immunisation' })}
                  onOpenDocument={(documentId) => void openDocument(documentId)}
                  onAddDocument={() => setOverlay({ kind: 'document' })}
                  onOpenCondition={(id) => void openCondition(id)}
                  onShare={() => void openShare()}
                />
              )}
              {tab === 'reminders' && patientId && (
                <RemindersScreen
                  family={data.family}
                  patientId={patientId}
                  busy={busy}
                  onSaveMealtimes={(mealtimes) => void saveMealtimes(mealtimes)}
                  onOpenReport={() => void openReport()}
                  reportAvailable={data.medicines.active.length + data.medicines.finished.length > 0}
                  onOpenProfile={() => void openProfile()}
                  onShare={() => void openShare()}
                  allergyCount={data.insights.openSideEffects.length}
                />
              )}
            </div>

            {/* Mobile navigation. */}
            <nav className="tabbar">
              {TABS.map((item) => {
                const attention = item.id === 'record' && needsAttention && tab !== 'record';
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
          <OverlayRoot label={step.label} onClose={requestClose}>
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
            {overlay.kind === 'condition' && (
              <ConditionScreen
                condition={overlay.data}
                onClose={closeOverlay}
                onOpenVisit={(id) => openVisit(id)}
                // Only when the dose waiting is for *this* illness: a button
                // that records someone else's tablet is worse than no button.
                onRecordDose={
                  due && due.conditionId === overlay.data._id
                    ? () => setOverlay({ kind: 'dose', dose: due })
                    : undefined
                }
              />
            )}
            {overlay.kind === 'record' && (
              <RecordScreen
                data={overlay.data}
                onOpenVisit={(visit) => setOverlay({ kind: 'visit', visit })}
                onClose={closeOverlay}
              />
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
                onNotYet={waitForMedicine}
              />
            )}

            {/* --- The outcome side of the record ----------------------- */}

            {overlay.kind === 'sideEffect' && patientId && data && (
              <SideEffectScreen
                medicines={data.medicines}
                preselectedCourseId={overlay.courseId}
                patientId={patientId}
                busy={busy}
                onSubmit={(request) => void reportSideEffect(request)}
                onCancel={closeOverlay}
              />
            )}
            {overlay.kind === 'sideEffectReply' && (
              <SideEffectReplyScreen reply={overlay.reply} onClose={closeOverlay} />
            )}
            {overlay.kind === 'reading' && patientId && (
              <ReadingOverlay
                metric={overlay.metric}
                patientId={patientId}
                busy={busy}
                onSubmit={(request: RecordReadingRequest) =>
                  void run(async () => (await api.recordReading(request)).message)
                }
                onCancel={closeOverlay}
              />
            )}
            {overlay.kind === 'selfCare' && patientId && (
              <SelfCareOverlay
                options={overlay.options}
                patientId={patientId}
                busy={busy}
                onSubmit={(request: SelfCareIntakeRequest) =>
                  void run(async () => {
                    const result = await api.addSelfCare(request);
                    // The allergy flags come first: they are the reason the
                    // check exists, and a success message that buried them
                    // would be worse than no check at all.
                    return result.allergyFlags.length > 0
                      ? result.allergyFlags.join(' ')
                      : result.message;
                  })
                }
                onCancel={closeOverlay}
              />
            )}
            {overlay.kind === 'appointment' && patientId && (
              <AppointmentOverlay
                options={overlay.options}
                patientId={patientId}
                busy={busy}
                onSubmit={(request: CreateAppointmentRequest) =>
                  void run(async () => {
                    await api.createAppointment(request);
                    return "Saved. I'll remind you a week before, the day before, and on the morning.";
                  })
                }
                onCancel={closeOverlay}
              />
            )}
            {overlay.kind === 'labResult' && patientId && (
              <LabResultOverlay
                options={overlay.options}
                patientId={patientId}
                busy={busy}
                onSubmit={(request: CreateLabResultRequest) =>
                  void run(async () => {
                    await api.recordLabResult(request);
                    return 'Result kept. If the same test comes round again I will draw the line.';
                  })
                }
                onCancel={closeOverlay}
              />
            )}
            {overlay.kind === 'immunisation' && patientId && (
              <ImmunisationOverlay
                patientId={patientId}
                busy={busy}
                onSubmit={(request: CreateImmunisationRequest) =>
                  void run(async () => {
                    await api.recordImmunisation(request);
                    return 'Written down.';
                  })
                }
                onCancel={closeOverlay}
              />
            )}
            {overlay.kind === 'document' && patientId && (
              <DocumentOverlay
                patientId={patientId}
                busy={busy}
                onSubmit={(request) =>
                  void run(async () => {
                    await api.uploadDocument(request);
                    return 'Kept with your record.';
                  })
                }
                onCancel={closeOverlay}
              />
            )}
            {overlay.kind === 'refill' && (
              <RefillOverlay
                medicationName={overlay.medicationName}
                dosesRemaining={overlay.dosesRemaining}
                unitsRemaining={overlay.unitsRemaining}
                busy={busy}
                onSubmit={(unitsNow) =>
                  void run(async () => (await api.recordRefill(overlay.courseId, unitsNow)).message)
                }
                onCancel={closeOverlay}
              />
            )}
            {overlay.kind === 'share' && (
              <ShareScreen summary={overlay.summary} onClose={closeOverlay} />
            )}
            {overlay.kind === 'profile' && patientId && (
              <ProfileScreen
                profile={overlay.profile}
                busy={busy}
                onSave={(request: UpdateProfileRequest) =>
                  void run(async () => {
                    const result = await api.updateProfile(patientId, request);
                    return result.movedDoses === 0
                      ? 'Saved.'
                      : `Saved. I moved the ${result.movedDoses} ${
                          result.movedDoses === 1 ? 'dose' : 'doses'
                        } still to come to match.`;
                  })
                }
                onClose={closeOverlay}
              />
            )}
            {overlay.kind === 'photo' && (
              <div className="overlay overlay--light">
                <button className="back" onClick={closeOverlay}>
                  ← Back
                </button>
                <div className="scroll" style={{ flex: 1 }}>
                  <h1 className="h1">{overlay.title}</h1>
                  {overlay.dataUrl.startsWith('data:application/pdf') ? (
                    <a className="btn btn--primary" href={overlay.dataUrl} download={overlay.title}>
                      Open the PDF
                    </a>
                  ) : (
                    <img
                      src={overlay.dataUrl}
                      alt={overlay.title}
                      style={{
                        width: '100%',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--card-border)',
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </OverlayRoot>
        )}
      </main>
    </div>
  );
}
