import { useState, type ReactNode } from 'react';
import {
  ALLERGY_SEVERITY_LABELS,
  type Allergy,
  type AllergySeverity,
  type FamilyContact,
  type FamilyContactRelation,
  type ProfileResponse,
  type UpdateProfileRequest,
} from '@medication-ai/shared';

/**
 * Who you are, what must not be given to you, and who gets rung.
 *
 * There was no profile screen at all, which left two things stranded. The
 * allergy list is new and has to be editable by definition — it is the one
 * record that must be in front of somebody *before* a medicine is accepted.
 *
 * The family contact was not new. It has been the last rung of the escalation
 * ladder since the first version, and no screen in the app could add, change or
 * remove the person who gets the phone call: it was seed data or nothing. The
 * ladder's most consequential step was unconfigurable.
 */
const RELATIONS: FamilyContactRelation[] = [
  'son',
  'daughter',
  'spouse',
  'sibling',
  'parent',
  'carer',
  'friend',
  'other',
];

export function ProfileScreen({
  profile,
  busy,
  onSave,
  onClose,
}: {
  profile: ProfileResponse;
  busy: boolean;
  onSave: (request: UpdateProfileRequest) => void;
  onClose: () => void;
}): ReactNode {
  const { patient } = profile;

  const [name, setName] = useState(patient.name);
  const [phone, setPhone] = useState(patient.phone);
  const [dateOfBirth, setDateOfBirth] = useState(
    patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().slice(0, 10) : '',
  );
  const [heightCm, setHeightCm] = useState(patient.heightCm ? String(patient.heightCm) : '');
  const [allergies, setAllergies] = useState<Allergy[]>(patient.allergies);
  const [contacts, setContacts] = useState<FamilyContact[]>(patient.familyContacts);

  const save = (): void =>
    onSave({
      name: name.trim(),
      phone: phone.trim(),
      dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00Z`) : null,
      heightCm: heightCm.trim() === '' ? null : Number(heightCm),
      allergies: allergies
        .filter((allergy) => allergy.substance.trim().length > 0)
        .map((allergy) => ({
          id: allergy.id,
          substance: allergy.substance.trim(),
          ...(allergy.reaction?.trim() ? { reaction: allergy.reaction.trim() } : {}),
          severity: allergy.severity,
          recordedAt: allergy.recordedAt,
        })),
      familyContacts: contacts
        .filter((contact) => contact.name.trim().length > 0 && contact.phone.trim().length >= 6)
        .map((contact) => ({ ...contact, name: contact.name.trim(), phone: contact.phone.trim() })),
    });

  return (
    <div className="overlay overlay--light">
      <button className="back" onClick={onClose} disabled={busy}>
        ← Back
      </button>

      <div className="scroll" style={{ flex: 1 }}>
        <h1 className="h1">You</h1>
        <p className="sub" style={{ marginBottom: 6 }}>
          {profile.totals.spanLabel} · {profile.totals.visits} appointments ·{' '}
          {profile.totals.dosesTaken} doses taken · {profile.totals.readings} readings
        </p>

        {/* --- Allergies: first, because they are checked before a medicine. */}
        <div className="section-gap" />
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Things you react to
        </div>
        <p className="sub" style={{ marginBottom: 14 }}>
          I check every new medicine's name against this list and say something before you start. I
          match a name against a name — I cannot tell that one medicine contains another, so this
          is a prompt to ask a person, never a guarantee.
        </p>

        {allergies.map((allergy, index) => (
          <div key={allergy.id} className="card" style={{ marginBottom: 10 }}>
            <label className="field" style={{ marginBottom: 10 }}>
              <span className="field-label">What is it?</span>
              <input
                className="input"
                value={allergy.substance}
                onChange={(event) =>
                  setAllergies((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, substance: event.target.value } : row,
                    ),
                  )
                }
                placeholder="Penicillin, peanuts, latex…"
                maxLength={160}
              />
            </label>
            <label className="field" style={{ marginBottom: 10 }}>
              <span className="field-label">What happened?</span>
              <input
                className="input"
                value={allergy.reaction ?? ''}
                onChange={(event) =>
                  setAllergies((rows) =>
                    rows.map((row, i) =>
                      i === index ? { ...row, reaction: event.target.value } : row,
                    ),
                  )
                }
                placeholder="A rash, swelling, being sick…"
                maxLength={300}
              />
            </label>
            <label className="field" style={{ marginBottom: 10 }}>
              <span className="field-label">How bad was it?</span>
              <select
                className="select"
                value={allergy.severity}
                onChange={(event) =>
                  setAllergies((rows) =>
                    rows.map((row, i) =>
                      i === index
                        ? { ...row, severity: event.target.value as AllergySeverity }
                        : row,
                    ),
                  )
                }
              >
                {Object.entries(ALLERGY_SEVERITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn--danger"
              onClick={() => setAllergies((rows) => rows.filter((_, i) => i !== index))}
            >
              Take this off my record
            </button>
          </div>
        ))}

        <button
          className="btn btn--ghost"
          onClick={() =>
            setAllergies((rows) => [
              ...rows,
              {
                id: crypto.randomUUID(),
                substance: '',
                reaction: '',
                severity: 'mild',
                recordedAt: new Date(),
              },
            ])
          }
        >
          + Add something I react to
        </button>

        {/* --- The last rung of the ladder, finally editable. ------------- */}
        <div className="section-gap" />
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Your last resort
        </div>
        <p className="sub" style={{ marginBottom: 14 }}>
          {profile.escalationSummary}
        </p>

        {contacts.map((contact, index) => (
          <div key={contact.id} className="card" style={{ marginBottom: 10 }}>
            <div className="field-row">
              <label className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Their name</span>
                <input
                  className="input"
                  value={contact.name}
                  onChange={(event) =>
                    setContacts((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)),
                    )
                  }
                  maxLength={120}
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Who are they?</span>
                <select
                  className="select"
                  value={contact.relation}
                  onChange={(event) =>
                    setContacts((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, relation: event.target.value as FamilyContactRelation }
                          : row,
                      ),
                    )
                  }
                >
                  {RELATIONS.map((relation) => (
                    <option key={relation} value={relation}>
                      {relation.charAt(0).toUpperCase() + relation.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field" style={{ marginBottom: 10 }}>
              <span className="field-label">Their phone number</span>
              <input
                className="input"
                type="tel"
                value={contact.phone}
                onChange={(event) =>
                  setContacts((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, phone: event.target.value } : row)),
                  )
                }
                maxLength={20}
              />
            </label>

            <div className="field-row">
              <label className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Tell them after (hours)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={24}
                  value={Math.round(contact.notifyAfterMinutes / 60)}
                  onChange={(event) =>
                    setContacts((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              notifyAfterMinutes: Math.min(
                                24 * 60,
                                Math.max(15, Number(event.target.value) * 60),
                              ),
                            }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <label className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Or after this many misses</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={contact.notifyAfterConsecutiveMisses}
                  onChange={(event) =>
                    setContacts((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              notifyAfterConsecutiveMisses: Math.max(
                                1,
                                Math.min(10, Number(event.target.value)),
                              ),
                            }
                          : row,
                      ),
                    )
                  }
                />
              </label>
            </div>

            <button
              className="btn btn--danger"
              onClick={() => setContacts((rows) => rows.filter((_, i) => i !== index))}
            >
              Remove {contact.name || 'this person'}
            </button>
          </div>
        ))}

        {contacts.length === 0 && (
          <button
            className="btn btn--ghost"
            onClick={() =>
              setContacts([
                {
                  id: crypto.randomUUID(),
                  name: '',
                  relation: 'son',
                  phone: '',
                  notifyAfterMinutes: 180,
                  notifyAfterConsecutiveMisses: 2,
                },
              ])
            }
          >
            + Add someone
          </button>
        )}

        {/* --- The plain details ----------------------------------------- */}
        <div className="section-gap" />
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Your details
        </div>

        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Your phone</span>
            <input
              className="input"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={20}
            />
          </label>
          <label className="field">
            <span className="field-label">Date of birth</span>
            <input
              className="input"
              type="date"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Your height (cm)</span>
          <input
            className="input"
            type="number"
            min={50}
            max={250}
            value={heightCm}
            onChange={(event) => setHeightCm(event.target.value)}
            placeholder="Optional"
          />
          <span className="field-hint">
            Only ever used to give the weight chart something to be a share of.
          </span>
        </label>
      </div>

      <button className="btn btn--primary" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
