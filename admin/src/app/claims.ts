// Insurance claim file page: a form that builds an X12 837D file in the browser and downloads it.
//
// PHI rule: claim data (patient, subscriber, procedures) never leaves this tab. It is not sent to
// the API, not logged, and not saved; only the practice/clearinghouse settings are kept, in
// localStorage, and they hold no patient data.

import { fetchProviders, providerName, type Provider } from './providers-api';
import {
  RELATIONSHIPS,
  fetchPatients,
  fetchPayers,
  patientName,
  type Patient,
  type Payer,
} from './records-api';
import { $ } from './shell';
import {
  build837D,
  claimTotalCents,
  prettyPrint,
  toCents,
  validateBatch,
  type Address,
  type Batch,
  type BillingProvider,
  type Claim,
  type ClaimLine,
  type Envelope,
  type Problem,
  type RenderingProvider,
} from './x12/837d';

const SETTINGS_KEY = 'splus-claims-settings-v1';

type Field = HTMLInputElement | HTMLSelectElement;

interface Settings {
  envelope: Envelope;
  billing: BillingProvider;
  rendering: RenderingProvider;
  controlNumber: number;
  newlines: boolean;
}

const DEFAULTS: Settings = {
  envelope: {
    senderQualifier: 'ZZ',
    senderId: '',
    receiverQualifier: 'ZZ',
    receiverId: '',
    gsSenderCode: '',
    gsReceiverCode: '',
    submitterName: 'S PLUS DENTAL',
    submitterId: '',
    contactName: '',
    contactPhone: '',
    receiverName: 'DENTALXCHANGE',
    receiverId1000B: '',
    usage: 'T',
    ackRequested: false,
  },
  billing: {
    entity: 'organization',
    orgName: '',
    firstName: '',
    npi: '',
    taxId: '',
    taxonomy: '1223G0001X',
    address: { line1: '', line2: '', city: 'Mountlake Terrace', state: 'WA', zip: '' },
  },
  rendering: { firstName: '', lastName: '', npi: '', taxonomy: '1223G0001X' },
  controlNumber: 1,
  newlines: false,
};

// ---------- generic form <-> object by dotted names ----------

function fields(form: HTMLFormElement): Field[] {
  return [...form.querySelectorAll<Field>('input[name], select[name]')].filter(
    (el) => !(el instanceof HTMLInputElement && el.type === 'radio'),
  );
}

function getPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}

function readValue(el: Field): string | boolean {
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked;
  return el.value.trim();
}

function writeValue(el: Field, v: unknown) {
  if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
  else el.value = v === undefined || v === null ? '' : String(v);
}

// ---------- settings ----------

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return {
        ...DEFAULTS,
        ...s,
        envelope: { ...DEFAULTS.envelope, ...s.envelope },
        billing: {
          ...DEFAULTS.billing,
          ...s.billing,
          address: { ...DEFAULTS.billing.address, ...s.billing?.address },
        },
        rendering: { ...DEFAULTS.rendering, ...s.rendering },
      };
    }
  } catch {
    // corrupt or blocked storage: start from defaults
  }
  return structuredClone(DEFAULTS);
}

function readSettings(form: HTMLFormElement): Settings {
  const s = structuredClone(DEFAULTS) as unknown as Record<string, unknown>;
  for (const el of fields(form)) setPath(s, el.name, readValue(el));
  const out = s as unknown as Settings;
  out.controlNumber = Number(String(out.controlNumber).replace(/\D/g, '')) || 0;
  out.envelope.senderQualifier = out.envelope.senderQualifier.toUpperCase();
  out.envelope.receiverQualifier = out.envelope.receiverQualifier.toUpperCase();
  return out;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked; settings just won't persist
  }
}

// ---------- claim ----------

function emptyToUndef<T extends object>(o: T): T {
  for (const [k, v] of Object.entries(o)) if (v === '') delete (o as Record<string, unknown>)[k];
  return o;
}

function readAddress(form: HTMLFormElement, prefix: string): Address {
  const g = (k: string) => (form.elements.namedItem(`${prefix}.${k}`) as Field).value.trim();
  return emptyToUndef({
    line1: g('line1'),
    line2: g('line2'),
    city: g('city'),
    state: g('state').toUpperCase(),
    zip: g('zip'),
  });
}

function readLines(body: HTMLTableSectionElement): ClaimLine[] {
  return [...body.rows].map((tr) => {
    const g = (k: string) => (tr.querySelector<Field>(`[data-k="${k}"]`)!.value ?? '').trim();
    // Required keys stay (blank → a validation message); optional ones drop when empty.
    const line: ClaimLine = {
      serviceDate: g('serviceDate'),
      code: g('code').toUpperCase(),
      fee: g('fee'),
    };
    const opt = {
      tooth: g('tooth').toUpperCase(),
      surfaces: g('surfaces').toUpperCase(),
      area: g('area'),
    };
    return { ...line, ...emptyToUndef(opt) };
  });
}

function readClaim(
  form: HTMLFormElement,
  body: HTMLTableSectionElement,
  rendering: RenderingProvider,
): Claim {
  const v = (name: string) => {
    const el = form.elements.namedItem(name) as Field | null;
    return el ? el.value.trim() : '';
  };
  const subAddress = readAddress(form, 'subscriber.address');
  const dependent = (form.elements.namedItem('who') as RadioNodeList).value === 'dependent';
  const sameAddress = (form.elements.namedItem('sameAddress') as HTMLInputElement).checked;

  const claim: Claim = {
    controlNumber: v('controlNumber'),
    frequency: v('frequency') as Claim['frequency'],
    placeOfService: v('placeOfService'),
    payer: {
      name: v('payer.name'),
      id: v('payer.id'),
      filingIndicator: v('payer.filingIndicator'),
    },
    subscriber: emptyToUndef({
      firstName: v('subscriber.firstName'),
      middle: v('subscriber.middle'),
      lastName: v('subscriber.lastName'),
      birthDate: v('subscriber.birthDate'),
      sex: v('subscriber.sex') as Claim['subscriber']['sex'],
      memberId: v('subscriber.memberId'),
      groupNumber: v('subscriber.groupNumber'),
      groupName: v('subscriber.groupName'),
      address: subAddress,
    }),
    lines: readLines(body),
  };
  // The validator expects these keys present even when blank.
  claim.subscriber.firstName ??= '';
  claim.subscriber.lastName ??= '';
  claim.subscriber.birthDate ??= '';
  claim.subscriber.memberId ??= '';

  if (claim.frequency !== '1') claim.originalClaimNumber = v('originalClaimNumber');
  if (v('priorAuth')) claim.priorAuth = v('priorAuth');
  if (dependent) {
    claim.patient = {
      firstName: v('patient.firstName'),
      middle: v('patient.middle') || undefined,
      lastName: v('patient.lastName'),
      birthDate: v('patient.birthDate'),
      sex: v('patient.sex') as Claim['subscriber']['sex'],
      relationship: v('patient.relationship') as NonNullable<Claim['patient']>['relationship'],
      address: sameAddress ? subAddress : readAddress(form, 'patient.address'),
    };
  }
  if (rendering.npi || rendering.lastName) claim.rendering = rendering;
  return claim;
}

function defaultClaimNumber() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const rand = Math.floor(Math.random() * 1e4)
    .toString()
    .padStart(4, '0');
  return `SP${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${rand}`;
}

function todayIso() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// ---------- page ----------

export function initClaims() {
  const settingsForm = $<HTMLFormElement>('settings-form');
  const claimForm = $<HTMLFormElement>('claim-form');
  const linesBody = $<HTMLTableSectionElement>('lines-body');
  const tplLine = $<HTMLTemplateElement>('tpl-line');
  const details = $<HTMLDetailsElement>('settings');
  const preview = $<HTMLPreElement>('preview');

  // Settings: fill, persist on every change.
  const initial = loadSettings();
  for (const el of fields(settingsForm)) writeValue(el, getPath(initial, el.name));
  const syncEntity = () => {
    const person =
      (settingsForm.elements.namedItem('billing.entity') as HTMLSelectElement).value === 'person';
    settingsForm
      .querySelectorAll<HTMLElement>('[data-show-entity="person"]')
      .forEach((el) => (el.hidden = !person));
  };
  const settingsStatus = () => {
    const s = readSettings(settingsForm);
    const missing = validateBatch({ ...batchFrom(s, []), claims: [] }).filter(
      (p) => p.path !== 'claims',
    ).length;
    const el = $('settings-status');
    el.textContent = missing
      ? `${missing} to fill in`
      : `Mode ${s.envelope.usage === 'T' ? 'test' : 'production'} · next #${s.controlNumber}`;
    el.classList.toggle('warn', missing > 0);
    return missing;
  };
  settingsForm.addEventListener('input', () => {
    syncEntity();
    saveSettings(readSettings(settingsForm));
    settingsStatus();
  });
  syncEntity();
  if (settingsStatus() > 0) details.open = true;

  // Claim form show/hide.
  const sync = () => {
    const dependent = (claimForm.elements.namedItem('who') as RadioNodeList).value === 'dependent';
    $('patient-fields').hidden = !dependent;
    const same = (claimForm.elements.namedItem('sameAddress') as HTMLInputElement).checked;
    $('patient-address').hidden = same;
    const freq = (claimForm.elements.namedItem('frequency') as HTMLSelectElement).value;
    claimForm
      .querySelectorAll<HTMLElement>('[data-show-frequency]')
      .forEach((el) => (el.hidden = freq === '1'));
    const cents = readLines(linesBody).reduce((s, l) => s + (toCents(l.fee) || 0), 0);
    $('total').textContent = money(cents);
  };
  claimForm.addEventListener('input', () => {
    sync();
    preview.hidden = true;
  });
  claimForm.addEventListener('change', sync);

  // Procedure rows.
  const addLine = (copyDateFrom?: HTMLTableRowElement) => {
    const row = (tplLine.content.cloneNode(true) as DocumentFragment)
      .firstElementChild as HTMLTableRowElement;
    const date = row.querySelector<HTMLInputElement>('[data-k="serviceDate"]')!;
    date.value =
      copyDateFrom?.querySelector<HTMLInputElement>('[data-k="serviceDate"]')?.value || todayIso();
    date.max = todayIso();
    row.querySelector('[data-remove]')!.addEventListener('click', () => {
      row.remove();
      if (linesBody.rows.length === 0) addLine();
      sync();
    });
    linesBody.append(row);
    return row;
  };
  $('add-line').addEventListener('click', () => {
    const last = linesBody.rows[linesBody.rows.length - 1];
    addLine(last)?.querySelector<HTMLInputElement>('[data-k="code"]')?.focus();
  });

  const reset = () => {
    claimForm.reset();
    linesBody.replaceChildren();
    addLine();
    (claimForm.elements.namedItem('controlNumber') as HTMLInputElement).value =
      defaultClaimNumber();
    clearProblems();
    preview.hidden = true;
    preview.textContent = '';
    afterReset();
    sync();
  };
  let afterReset = () => {};
  $('clear').addEventListener('click', reset);
  reset();

  // Build, validate, show problems.
  function clearProblems() {
    document
      .querySelectorAll('[aria-invalid="true"]')
      .forEach((el) => el.removeAttribute('aria-invalid'));
    $('problems').hidden = true;
    $('problems-list').replaceChildren();
  }

  function fieldFor(p: Problem): { el: Field | null; label: string } {
    const m = /^claims\[0\]\.lines\[(\d+)\]\.(\w+)/.exec(p.path);
    if (m) {
      const row = linesBody.rows[Number(m[1])];
      return {
        el: row?.querySelector<Field>(`[data-k="${m[2]}"]`) ?? null,
        label: `Procedure ${Number(m[1]) + 1}`,
      };
    }
    const local = p.path.replace(/^claims\[0\]\./, '');
    if (local.startsWith('rendering.') || !p.path.startsWith('claims')) {
      return { el: settingsForm.querySelector<Field>(`[name="${local}"]`), label: 'Settings' };
    }
    if (
      local.startsWith('patient.address') &&
      (claimForm.elements.namedItem('sameAddress') as HTMLInputElement).checked
    ) {
      return {
        el: claimForm.querySelector<Field>(`[name="${local.replace('patient.', 'subscriber.')}"]`),
        label: 'Patient',
      };
    }
    const base = local.replace(/\.address$/, '.address.line1');
    return { el: claimForm.querySelector<Field>(`[name="${base}"]`), label: '' };
  }

  function showProblems(problems: Problem[]) {
    clearProblems();
    const list = $('problems-list');
    let first: Field | null = null;
    for (const p of problems) {
      const { el, label } = fieldFor(p);
      if (el) {
        el.setAttribute('aria-invalid', 'true');
        first ??= el;
        if (settingsForm.contains(el)) details.open = true;
        // A saved record is missing something this claim needs: show its fields to fix here.
        const block = el.closest<HTMLElement>('.manual-block');
        if (block) block.hidden = false;
      }
      const li = document.createElement('li');
      li.textContent = label ? `${label}: ${p.message}` : p.message;
      list.append(li);
    }
    $('problems').hidden = false;
    first?.focus();
  }

  function batchFrom(s: Settings, claims: Claim[]): Batch {
    return {
      envelope: s.envelope,
      billing: s.billing,
      claims,
      controlNumber: s.controlNumber,
      createdAt: new Date(),
    };
  }

  function build(): { text: string; settings: Settings } | null {
    const unpicked = pickers.missing();
    if (unpicked.length) {
      clearProblems();
      for (const [sel, msg] of unpicked) {
        sel.setAttribute('aria-invalid', 'true');
        const li = document.createElement('li');
        li.textContent = msg;
        $('problems-list').append(li);
      }
      $('problems').hidden = false;
      unpicked[0]![0].focus();
      return null;
    }
    const s = readSettings(settingsForm);
    const claim = readClaim(claimForm, linesBody, s.rendering);
    const batch = batchFrom(s, [claim]);
    const problems = validateBatch(batch);
    if (problems.length) {
      showProblems(problems);
      return null;
    }
    clearProblems();
    $('total').textContent = money(claimTotalCents(claim));
    return { text: build837D(batch, { newlines: s.newlines }), settings: s };
  }

  $('preview-btn').addEventListener('click', () => {
    const r = build();
    if (!r) return;
    preview.textContent = prettyPrint(r.text);
    preview.hidden = false;
    preview.focus();
  });

  claimForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const r = build();
    if (!r) return;
    const blob = new Blob([r.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // No patient details in the file name.
    a.download = `837D-${String(r.settings.controlNumber).padStart(9, '0')}.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Each file needs a new interchange control number.
    const next = r.settings.controlNumber >= 999_999_999 ? 1 : r.settings.controlNumber + 1;
    writeValue(settingsForm.querySelector<Field>('[name="controlNumber"]')!, next);
    saveSettings({ ...r.settings, controlNumber: next });
    settingsStatus();
    preview.textContent = prettyPrint(r.text);
    preview.hidden = false;
  });

  const pickers = setupPickers({
    settingsForm,
    claimForm,
    settingsChanged: () => {
      syncEntity();
      saveSettings(readSettings(settingsForm));
      if (settingsStatus() === 0) details.open = false;
    },
    claimChanged: sync,
  });
  afterReset = pickers.afterReset;
  // A new pick makes earlier problems stale.
  $('pickers').addEventListener('change', clearProblems);
}

// ---------- saved providers, payers and patients ----------

const MANUAL = 'manual';
const X12_SEX: Record<Patient['sex'], string> = {
  female: 'F',
  male: 'M',
  other: 'U',
  unknown: 'U',
};

/**
 * The three pickers at the top of the claim form. Picking a saved record fills the (hidden)
 * detail fields; "Enter manually…" shows them. Without a database the pickers stay hidden and the
 * manual fields work as before.
 */
function setupPickers(o: {
  settingsForm: HTMLFormElement;
  claimForm: HTMLFormElement;
  settingsChanged: () => void;
  claimChanged: () => void;
}) {
  const sel = {
    billing: $<HTMLSelectElement>('billing-pick'),
    rendering: $<HTMLSelectElement>('rendering-pick'),
    patient: $<HTMLSelectElement>('patient-pick'),
  };
  let active = false;
  let patients = new Map<string, Patient>();
  let payers = new Map<string, Payer>();

  const setIn = (form: HTMLFormElement, name: string, v: string | null | undefined) => {
    const el = form.elements.namedItem(name) as Field | null;
    if (el) el.value = v ?? '';
  };
  const S = (n: string, v: string | null | undefined) => setIn(o.settingsForm, n, v);
  const C = (n: string, v: string | null | undefined) => setIn(o.claimForm, n, v);
  const summary = (id: string, text: string, warn = false) => {
    const el = $(id);
    el.textContent = text;
    el.classList.toggle('warn', warn);
  };

  function options(select: HTMLSelectElement, first: string, items: [string, string][]) {
    const mk = (v: string, l: string) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = l;
      return opt;
    };
    select.replaceChildren(
      mk('', first),
      ...items.map(([v, l]) => mk(v, l)),
      mk(MANUAL, 'Enter manually…'),
    );
  }

  /** Make the choice survive the claim form's reset(). */
  function choose(select: HTMLSelectElement, value: string) {
    for (const opt of select.options) opt.defaultSelected = opt.value === value;
    select.value = value;
  }

  const fmtTaxId = (t: string | null) => (t ? `EIN ${t.slice(0, 2)}-${t.slice(2)}` : '');
  const join = (...parts: (string | null | undefined | false)[]) =>
    parts.filter(Boolean).join(' · ');

  function applyBilling(list: Provider[]) {
    const v = sel.billing.value;
    const p = list.find((x) => x.id === v);
    $('billing-manual').hidden = v !== MANUAL;
    if (!p) return summary('billing-summary', '');
    S('billing.entity', p.kind);
    S('billing.orgName', p.kind === 'organization' ? p.orgName : p.lastName);
    S('billing.firstName', p.kind === 'person' ? p.firstName : '');
    S('billing.npi', p.npi);
    S('billing.taxId', p.taxId);
    S('billing.taxonomy', p.taxonomy);
    S('billing.address.line1', p.address1);
    S('billing.address.line2', p.address2);
    S('billing.address.city', p.city);
    S('billing.address.state', p.state);
    S('billing.address.zip', p.zip);
    summary(
      'billing-summary',
      join(`NPI ${p.npi}`, fmtTaxId(p.taxId), p.city && `${p.city}, ${p.state}`),
    );
  }

  function applyRendering(list: Provider[]) {
    const v = sel.rendering.value;
    const p = list.find((x) => x.id === v);
    $('rendering-manual').hidden = v !== MANUAL;
    if (!p) return summary('rendering-summary', '');
    S('rendering.firstName', p.firstName);
    S('rendering.lastName', p.lastName);
    S('rendering.npi', p.npi);
    S('rendering.taxonomy', p.taxonomy);
    summary('rendering-summary', join(`NPI ${p.npi}`, p.taxonomy));
  }

  function fillPerson(prefix: string, p: Patient) {
    C(`${prefix}.firstName`, p.firstName);
    C(`${prefix}.middle`, p.middleName);
    C(`${prefix}.lastName`, p.lastName);
    C(`${prefix}.birthDate`, p.birthDate);
    C(`${prefix}.sex`, X12_SEX[p.sex]);
    C(`${prefix}.address.line1`, p.address1);
    C(`${prefix}.address.line2`, p.address2);
    C(`${prefix}.address.city`, p.city);
    C(`${prefix}.address.state`, p.state);
    C(`${prefix}.address.zip`, p.zip);
  }

  function applyPatient() {
    const v = sel.patient.value;
    const manual = $('patient-manual');
    manual.hidden = v !== MANUAL;
    const p = patients.get(v);
    if (!p) return summary('patient-summary', '');
    const c = p.coverage;
    const payer = c ? payers.get(c.payerId) : undefined;
    const self = !c || c.relationship === '18';
    const sub = self ? p : patients.get(c.subscriberId);

    (
      o.claimForm.querySelector(
        `input[name="who"][value="${self ? 'self' : 'dependent'}"]`,
      ) as HTMLInputElement
    ).checked = true;
    if (sub) fillPerson('subscriber', sub);
    C('subscriber.memberId', c?.memberId);
    C('subscriber.groupNumber', c?.groupNumber);
    C('subscriber.groupName', c?.groupName);
    C('payer.name', payer?.name);
    C('payer.id', payer?.payerId);
    if (payer) C('payer.filingIndicator', payer.filingIndicator);
    if (!self) {
      fillPerson('patient', p);
      C('patient.relationship', c.relationship);
      (o.claimForm.elements.namedItem('sameAddress') as HTMLInputElement).checked = false;
    }
    o.claimChanged();

    if (!c || !payer) {
      manual.hidden = false;
      return summary(
        'patient-summary',
        'No insurance on file. Add it on Patients, or fill it in below.',
        true,
      );
    }
    summary(
      'patient-summary',
      join(
        `${payer.name} (${payer.payerId})`,
        `Member ${c.memberId}`,
        self
          ? 'Self'
          : sub
            ? `${RELATIONSHIPS[c.relationship]} of ${sub.firstName} ${sub.lastName}`
            : '',
      ),
    );
  }

  async function load() {
    let provs: Provider[] | null, pays: Payer[] | null, pts: Patient[] | null;
    try {
      [provs, pays, pts] = await Promise.all([fetchProviders(), fetchPayers(), fetchPatients()]);
    } catch {
      return; // auth problems are handled by the shell; manual entry still works
    }
    if (!provs || !pays || !pts) return; // no database here
    active = true;
    payers = new Map(pays.map((x) => [x.id, x]));
    patients = new Map(pts.map((x) => [x.id, x]));
    const live = provs.filter((p) => p.active);
    const billing = [...live].sort((a, b) =>
      a.kind === b.kind ? 0 : a.kind === 'organization' ? -1 : 1,
    );
    const people = live.filter((p) => p.kind === 'person');
    const label = (p: Provider) => providerName(p);
    options(
      sel.billing,
      'Choose…',
      billing.map((p) => [p.id, label(p)]),
    );
    options(
      sel.rendering,
      'Choose…',
      people.map((p) => [p.id, label(p)]),
    );
    options(
      sel.patient,
      'Choose a patient…',
      pts
        .filter((p) => p.active)
        .map((p) => [p.id, `${patientName(p)}${p.chartNumber ? ` · #${p.chartNumber}` : ''}`]),
    );

    const npi = (n: string) =>
      (o.settingsForm.elements.namedItem(n) as Field).value.replace(/\D/g, '');
    // Preselect: what the saved settings point at; else the single practice / single dentist.
    const initial = (list: Provider[], current: string, only: Provider[]) =>
      list.find((p) => p.npi === current)?.id ??
      (current ? MANUAL : only.length === 1 ? only[0]!.id : '');
    const orgs = billing.filter((p) => p.kind === 'organization');
    choose(sel.billing, initial(billing, npi('billing.npi'), orgs.length ? orgs : billing));
    choose(sel.rendering, initial(people, npi('rendering.npi'), people));

    sel.billing.addEventListener('change', () => {
      choose(sel.billing, sel.billing.value);
      applyBilling(billing);
      o.settingsChanged();
    });
    sel.rendering.addEventListener('change', () => {
      choose(sel.rendering, sel.rendering.value);
      applyRendering(people);
      o.settingsChanged();
    });
    sel.patient.addEventListener('change', applyPatient);

    applyBilling(billing);
    applyRendering(people);
    applyPatient();
    o.settingsChanged();
    $('pickers').hidden = false;
  }
  void load();

  return {
    /** Pickers left on "Choose…", as [select, message]. */
    missing(): [HTMLSelectElement, string][] {
      if (!active) return [];
      const out: [HTMLSelectElement, string][] = [];
      if (!sel.billing.value) out.push([sel.billing, 'Choose a billing provider']);
      if (!sel.rendering.value) out.push([sel.rendering, 'Choose the treating dentist']);
      if (!sel.patient.value) out.push([sel.patient, 'Choose a patient']);
      return out;
    },
    afterReset() {
      if (!active) return;
      applyPatient();
    },
  };
}
