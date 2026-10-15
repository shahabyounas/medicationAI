import { useState, type ReactNode } from 'react';
import {
  SPECIALTY_LABELS,
  VISIT_TYPE_LABELS,
  type DoctorWithHistory,
  type VisitDetail,
  type VisitsResponse,
} from '@medication-ai/shared';

/**
 * Doctors and visits — the medical record.
 *
 * Two views over the same history, because there are two questions a patient
 * actually asks: "when did I last see someone about this?" (the timeline) and
 * "who is the doctor who treats my chest?" (the list of doctors). Neither is
 * derivable from the medicines list alone, which is why visits are their own
 * record rather than a field on a prescription.
 *
 * It used to be a fourth tab called "Record", permanently in the bottom bar
 * beside the dose that needs taking. It is reference material — consulted when
 * something prompts the question, not daily — so it has traded its tab for a
 * row at the bottom of Medicines, which is where that question gets asked.
 */
export function RecordScreen({
  data,
  onOpenVisit,
  onClose,
}: {
  data: VisitsResponse;
  onOpenVisit: (visit: VisitDetail) => void;
  onClose: () => void;
}): ReactNode {
  const [tab, setTab] = useState<'timeline' | 'doctors'>('timeline');

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onClose}>
        ← My medicines
      </button>

      <h1 className="h1" style={{ marginTop: 10 }}>
        Your record
      </h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        Every appointment, and who you saw. Each prescription you add is filed against the doctor
        who wrote it.
      </p>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'timeline', label: `Visits (${data.visits.length})` },
          { value: 'doctors', label: `Doctors (${data.doctors.length})` },
        ]}
      />

      {tab === 'timeline' ? (
        <div style={{ marginTop: 18 }} className="stack">
          {data.visits.length === 0 && (
            <p className="sub">
              No visits recorded yet. Every prescription you add is filed against the doctor who
              wrote it.
            </p>
          )}
          {data.visits.map((visit) => (
            <VisitCard key={visit._id} visit={visit} onOpen={onOpenVisit} />
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 18 }} className="stack">
          {data.doctors.length === 0 && (
            <p className="sub">
              No doctors recorded yet. Adding a prescription creates the doctor if they are new,
              or files a new visit against them if you have seen them before.
            </p>
          )}
          {data.doctors.map((doctor) => (
            <DoctorCard key={doctor._id} doctor={doctor} />
          ))}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}): ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        background: 'var(--canvas)',
        borderRadius: 16,
        padding: 5,
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          style={{
            flex: 1,
            height: 46,
            borderRadius: 12,
            font: '800 15px/1 var(--font)',
            background: value === option.value ? 'var(--card)' : 'transparent',
            color: value === option.value ? 'var(--ink)' : 'var(--ink-soft)',
            boxShadow: value === option.value ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function VisitCard({
  visit,
  onOpen,
}: {
  visit: VisitDetail;
  onOpen: (visit: VisitDetail) => void;
}): ReactNode {
  return (
    <button className="card card--tap" style={{ borderRadius: 20 }} onClick={() => onOpen(visit)}>
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="h3">{visit.doctorName}</div>
          <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)', marginTop: 3 }}>
            {formatDate(visit.visitDate)} · {visit.clinicName}
          </div>
        </div>
        <span className="pill pill--grey">{VISIT_TYPE_LABELS[visit.type]}</span>
      </div>

      <div style={{ font: '700 15px/1.45 var(--font)', marginTop: 12 }}>
        {visit.diagnosis ?? visit.reason}
      </div>

      {visit.medicationNames.length > 0 && (
        <div
          style={{
            font: '600 13.5px/1.4 var(--font)',
            color: 'var(--green)',
            marginTop: 8,
          }}
        >
          Prescribed {visit.medicationNames.join(' and ')}
        </div>
      )}

      {visit.followUpDate && (
        <div style={{ font: '700 13.5px/1.4 var(--font)', color: 'var(--amber-ink)', marginTop: 8 }}>
          Follow-up {formatDate(visit.followUpDate)}
        </div>
      )}
    </button>
  );
}

function DoctorCard({ doctor }: { doctor: DoctorWithHistory }): ReactNode {
  return (
    <div className="card" style={{ borderRadius: 20 }}>
      <div className="row" style={{ gap: 14 }}>
        <div
          style={{
            width: 52,
            height: 52,
            flex: 'none',
            borderRadius: 26,
            background: 'var(--green-bg)',
            color: 'var(--green)',
            font: '900 18px/52px var(--font)',
            textAlign: 'center',
          }}
        >
          {initialsOf(doctor.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '900 18px/1.2 var(--font)' }}>{doctor.name}</div>
          <div style={{ font: '600 14px/1.4 var(--font)', color: 'var(--ink-soft)' }}>
            {SPECIALTY_LABELS[doctor.specialty]} · {doctor.clinic.name}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 18,
          marginTop: 14,
          paddingTop: 14,
          borderTop: '1px solid var(--card-border)',
        }}
      >
        <Stat value={doctor.visitCount} label={doctor.visitCount === 1 ? 'visit' : 'visits'} />
        <Stat
          value={doctor.prescriptionCount}
          label={doctor.prescriptionCount === 1 ? 'prescription' : 'prescriptions'}
        />
      </div>

      {doctor.conditionsTreated.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Treated you for
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {doctor.conditionsTreated.map((name) => (
              <span key={name} className="pill pill--grey">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {doctor.clinic.phone && (
        <a
          href={`tel:${doctor.clinic.phone}`}
          className="btn btn--ghost"
          style={{ marginTop: 14, textDecoration: 'none' }}
        >
          Call the surgery
        </a>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }): ReactNode {
  return (
    <div>
      <div style={{ font: '900 22px/1.1 var(--font)' }}>{value}</div>
      <div style={{ font: '600 13px/1.35 var(--font)', color: 'var(--ink-soft)' }}>{label}</div>
    </div>
  );
}

export function initialsOf(name: string): string {
  return name
    .replace(/^Dr\.?\s*/i, '')
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}
