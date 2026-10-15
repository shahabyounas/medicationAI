import type { ReactNode } from 'react';
import type { ShareSummaryResponse } from '@medication-ai/shared';

/**
 * One page to hand the person across the desk.
 *
 * The record has always been good and completely trapped. A clinician has
 * ninety seconds and is not going to tap through three screens of somebody
 * else's phone, so in practice every appointment began with the patient
 * reciting from memory the exact facts the app was holding.
 *
 * Three things make this usable rather than just complete:
 *
 *   - **The order is the order it is asked in.** Allergies, then what they are
 *     taking right now, then what they are being treated for, then the numbers.
 *   - **Self-managed medicines are in the same list, marked.** "What are you
 *     taking?" has one answer, and a supplements section at the bottom of a
 *     page is a section that gets missed.
 *   - **It prints.** A print stylesheet drops the app's chrome so the browser's
 *     own "Print → Save as PDF" produces something you could put in a file,
 *     which is the sharing mechanism everybody already has. No upload, no link,
 *     nothing leaving the phone unless the patient sends it.
 *
 * The provenance note at the bottom is not boilerplate. Somebody reading an
 * adherence figure at a desk needs to know it is what an app observed, not what
 * was swallowed, and that no clinician has reviewed a word of it.
 */
export function ShareScreen({
  summary,
  onClose,
}: {
  summary: ShareSummaryResponse;
  onClose: () => void;
}): ReactNode {
  return (
    <div className="overlay overlay--light sheet">
      <div className="sheet__chrome">
        <button className="back" onClick={onClose}>
          ← Back
        </button>
        <button className="btn btn--primary" style={{ width: 'auto', padding: '0 20px' }} onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>

      <div className="scroll sheet__page" style={{ flex: 1 }}>
        <header className="sheet__head">
          <div>
            <h1 className="sheet__title">{summary.patient.name}</h1>
            <div className="sheet__sub">
              {[summary.patient.dateOfBirthLabel, summary.patient.ageLabel, summary.patient.phone]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="sheet__stamp">
            Medication record
            <br />
            {summary.generatedAtLabel}
          </div>
        </header>

        {/* First, and loudly even when empty: "none recorded" and "nobody
            asked" look identical otherwise. */}
        <Section title="Allergies">
          {summary.allergies.length === 0 ? (
            <p className="sheet__none">None recorded.</p>
          ) : (
            <ul className="sheet__list">
              {summary.allergies.map((allergy) => (
                <li key={allergy.substance}>
                  <strong
                    style={{
                      color:
                        allergy.severity === 'mild' ? 'var(--ink)' : 'var(--viz-bad)',
                    }}
                  >
                    {allergy.substance}
                  </strong>{' '}
                  — {allergy.severityLabel.toLowerCase()}
                  {allergy.reaction ? `: ${allergy.reaction}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Taking now">
          {summary.currentMedicines.length === 0 ? (
            <p className="sheet__none">Nothing.</p>
          ) : (
            <table className="sheet__table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>How</th>
                  <th>For</th>
                  <th>Taken</th>
                </tr>
              </thead>
              <tbody>
                {summary.currentMedicines.map((medicine) => (
                  <tr key={`${medicine.medicationName}-${medicine.startedLabel ?? ''}`}>
                    <td>
                      <strong>{medicine.medicationName}</strong>
                      {medicine.strength ? ` ${medicine.strength}` : ''}
                      {medicine.selfManaged && (
                        <span className="sheet__tag">{medicine.kindLabel.toLowerCase()}</span>
                      )}
                      {medicine.paused && <span className="sheet__tag">reminders paused</span>}
                    </td>
                    <td>{medicine.instructionLine}</td>
                    <td>
                      {medicine.forCondition ?? '—'}
                      {medicine.prescribedBy && (
                        <div className="sheet__fine">{medicine.prescribedBy}</div>
                      )}
                      {medicine.selfManaged && <div className="sheet__fine">self-managed</div>}
                    </td>
                    <td>{medicine.adherenceLabel ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {summary.sideEffects.length > 0 && (
          <Section title="Reported reactions">
            <ul className="sheet__list">
              {summary.sideEffects.map((report, index) => (
                <li key={index}>
                  <strong>{report.medicationName}</strong> — {report.symptom} (
                  {report.severityLabel.toLowerCase()}), from {report.startedLabel}
                  {report.ongoing ? ', ongoing' : ', settled'}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Conditions">
          {summary.conditions.length === 0 ? (
            <p className="sheet__none">None recorded.</p>
          ) : (
            <table className="sheet__table">
              <thead>
                <tr>
                  <th>Condition</th>
                  <th>From</th>
                  <th>Status</th>
                  <th>Seen by</th>
                </tr>
              </thead>
              <tbody>
                {summary.conditions.map((condition) => (
                  <tr key={condition.name + condition.startedLabel}>
                    <td>
                      <strong>{condition.name}</strong>
                      {condition.isChronic && <span className="sheet__tag">long-term</span>}
                    </td>
                    <td>{condition.startedLabel}</td>
                    <td>
                      {condition.statusLabel}
                      {condition.resolvedLabel && (
                        <div className="sheet__fine">{condition.resolvedLabel}</div>
                      )}
                    </td>
                    <td>{condition.doctorNames.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {summary.recentReadings.length > 0 && (
          <Section title="Recent readings">
            <table className="sheet__table">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Latest</th>
                  <th>When</th>
                  <th>Average</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentReadings.map((reading) => (
                  <tr key={reading.label}>
                    <td>
                      <strong>{reading.label}</strong>
                      <div className="sheet__fine">{reading.countLabel}</div>
                    </td>
                    <td>{reading.latest}</td>
                    <td>{reading.takenAtLabel}</td>
                    <td>{reading.averageLabel ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {summary.recentResults.length > 0 && (
          <Section title="Test results">
            {summary.recentResults.map((result, index) => (
              <div key={index} style={{ marginBottom: 10 }}>
                <strong>{result.panelName}</strong> — {result.dateLabel}
                <ul className="sheet__list">
                  {result.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        )}

        {summary.immunisations.length > 0 && (
          <Section title="Immunisations">
            <ul className="sheet__list">
              {summary.immunisations.map((jab, index) => (
                <li key={index}>
                  <strong>{jab.name}</strong> — {jab.dateLabel}
                  {jab.nextDueLabel ? ` (next due ${jab.nextDueLabel})` : ''}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {summary.recentVisits.length > 0 && (
          <Section title="Recent appointments">
            <table className="sheet__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Who</th>
                  <th>Why, and what was said</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentVisits.map((visit, index) => (
                  <tr key={index}>
                    <td>{visit.dateLabel}</td>
                    <td>{visit.doctorName}</td>
                    <td>
                      {visit.reason}
                      {visit.diagnosis && (
                        <div className="sheet__fine">Diagnosis: {visit.diagnosis}</div>
                      )}
                      {visit.vitalsLine && <div className="sheet__fine">{visit.vitalsLine}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {summary.upcomingAppointments.length > 0 && (
          <Section title="Booked">
            <ul className="sheet__list">
              {summary.upcomingAppointments.map((appointment, index) => (
                <li key={index}>
                  {appointment.dateLabel} — {appointment.withWhom} ({appointment.typeLabel})
                </li>
              ))}
            </ul>
          </Section>
        )}

        <footer className="sheet__foot">{summary.provenanceNote}</footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="sheet__section">
      <h2 className="sheet__h2">{title}</h2>
      {children}
    </section>
  );
}
