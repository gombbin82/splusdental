// X12 5010 837D (dental claim, implementation guide 005010X224A2) generator.
//
// Pure functions, no DOM and no I/O, so this can move into Kiwi Dental unchanged. Input is a plain
// object; output is the file text. `validateBatch` returns problems a person can fix; `build837D`
// assumes a valid batch (call validate first).
//
// Scope for the first DentalXChange test: primary insurance only (no 2320/2330 other-payer loops),
// original/replacement/void claims, line-level service dates, tooth/surface/area codes. No
// predeterminations, ortho (DN1), missing-tooth (DN2), attachments (PWK) or COB yet.
//
// This file never logs. Claim data is PHI: callers must not log or persist it either.

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string; // 2-letter
  zip: string; // 5 or 9 digits (billing provider: 9 required)
}

/** ISA/GS envelope and 1000A/1000B header values. Get these from the clearinghouse (or a Fuse export). */
export interface Envelope {
  senderQualifier: string; // ISA05, usually ZZ
  senderId: string; // ISA06 (padded to 15)
  receiverQualifier: string; // ISA07, usually ZZ
  receiverId: string; // ISA08 (padded to 15)
  gsSenderCode: string; // GS02
  gsReceiverCode: string; // GS03
  submitterName: string; // 1000A NM103
  submitterId: string; // 1000A NM109
  contactName: string; // 1000A PER02
  contactPhone: string; // 1000A PER04, 10 digits
  receiverName: string; // 1000B NM103
  receiverId1000B: string; // 1000B NM109
  usage: 'T' | 'P'; // ISA15
  ackRequested: boolean; // ISA14
}

export interface BillingProvider {
  entity: 'organization' | 'person';
  orgName: string; // or last name when entity = person
  firstName?: string;
  npi: string;
  taxId: string; // EIN, 9 digits
  taxonomy?: string; // 2000A PRV, e.g. 1223G0001X
  address: Address; // physical, no PO box; 9-digit zip
}

export interface RenderingProvider {
  lastName: string;
  firstName: string;
  npi: string;
  taxonomy: string;
}

export type Sex = 'M' | 'F' | 'U';

export interface Person {
  lastName: string;
  firstName: string;
  middle?: string;
  birthDate: string; // YYYY-MM-DD
  sex: Sex;
  address?: Address;
}

/** PAT01 relationship of patient to subscriber when they're different people. */
export type Relationship = '01' | '19' | '53' | 'G8'; // spouse, child, life partner, other

export interface ClaimLine {
  code: string; // CDT, e.g. D2391
  fee: string; // dollars, e.g. "125.00"
  serviceDate: string; // YYYY-MM-DD
  tooth?: string; // universal: 1–32, A–T, 51–82, AS–TS
  surfaces?: string; // e.g. "MOD" (M O D B L I F)
  area?: string; // SV304 oral cavity code, e.g. 10 (UR quadrant); for area procedures
  quantity?: number; // default 1
}

export interface Claim {
  controlNumber: string; // CLM01 patient control number, ≤ 20, unique per claim
  frequency: '1' | '7' | '8'; // original, replacement, void
  originalClaimNumber?: string; // payer claim # (REF*F8), required for 7/8
  placeOfService: string; // CLM05-1, 11 = office
  priorAuth?: string; // REF*G1
  payer: { name: string; id: string; filingIndicator: string }; // SBR09: CI commercial, MC Medicaid…
  subscriber: Person & { memberId: string; groupNumber?: string; groupName?: string };
  /** Omit when the patient is the subscriber. */
  patient?: Person & { relationship: Relationship };
  rendering?: RenderingProvider; // emitted when its NPI differs from the billing NPI
  lines: ClaimLine[];
}

export interface Batch {
  envelope: Envelope;
  billing: BillingProvider;
  claims: Claim[];
  /** ISA13 interchange control number (1–999999999). GS06 and ST02 are derived from it. */
  controlNumber: number;
  createdAt: Date;
}

export interface BuildOptions {
  /** Put a newline after each segment terminator. Most clearinghouses accept it; easier to read. */
  newlines?: boolean;
}

export interface Problem {
  path: string; // e.g. "claims[0].lines[1].tooth"
  message: string;
}

// ---------- formatting helpers ----------

const SEP = '*';
const COMP = ':';
const REP = '^';
const TERM = '~';

/**
 * X12 basic + extended character set, upper case, no delimiters. Anything else becomes a space and
 * runs of spaces collapse. Names on claims are upper case by convention.
 */
export function clean(v: string | undefined): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 !"&'()+,\-./;?=%@[\]_{}\\|<>#$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const digits = (v: string | undefined) => (v ?? '').replace(/\D/g, '');
const ymd = (iso: string) => iso.replace(/-/g, '');

function pad(v: string, n: number) {
  return v.length >= n ? v.slice(0, n) : v + ' '.repeat(n - v.length);
}

function two(n: number) {
  return String(n).padStart(2, '0');
}

/** Cents → X12 decimal ("125", "125.5", "0"): no trailing zeros, no leading $. */
export function amount(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let s = String(whole);
  if (frac) s += '.' + two(frac).replace(/0$/, '');
  return (neg ? '-' : '') + s;
}

/** "125", "125.5", "$1,250.00" → cents; NaN if not a money amount. */
export function toCents(v: string | undefined): number {
  const s = (v ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}

/** Drop trailing empty elements (X12 forbids trailing separators). */
function seg(...els: (string | undefined)[]): string {
  const a = els.map((e) => e ?? '');
  while (a.length > 1 && a[a.length - 1] === '') a.pop();
  return a.join(SEP);
}

// ---------- validation ----------

/** NPI check digit: Luhn over "80840" + first 9 digits. */
export function isValidNpi(npi: string): boolean {
  if (!/^[12]\d{9}$/.test(npi)) return false;
  const s = '80840' + npi.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}

const TOOTH_RE = /^([1-9]|[12]\d|3[0-2]|5[1-9]|[67]\d|8[0-2]|[A-T]|[A-T]S)$/;
const SURFACE_RE = /^[MODBLIF]{1,5}$/;
/** SV304 oral cavity designation: 00 whole mouth, 01/02 arch, 03–08 sextant, 10/20/30/40 quadrant. */
export const AREA_CODES: Record<string, string> = {
  '00': 'Entire oral cavity',
  '01': 'Maxillary arch',
  '02': 'Mandibular arch',
  '03': 'Upper right sextant',
  '04': 'Upper anterior sextant',
  '05': 'Upper left sextant',
  '06': 'Lower left sextant',
  '07': 'Lower anterior sextant',
  '08': 'Lower right sextant',
  '09': 'Other area',
  '10': 'Upper right quadrant',
  '20': 'Upper left quadrant',
  '30': 'Lower left quadrant',
  '40': 'Lower right quadrant',
};

export function isValidTooth(t: string) {
  return TOOTH_RE.test(t);
}

function isDate(v: string | undefined) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

function req(p: Problem[], path: string, v: string | undefined, label: string) {
  if (!clean(v)) p.push({ path, message: `${label} is required` });
}

function checkAddress(p: Problem[], path: string, a: Address | undefined, zip9: boolean) {
  if (!a) {
    p.push({ path, message: 'Address is required' });
    return;
  }
  req(p, `${path}.line1`, a.line1, 'Street address');
  req(p, `${path}.city`, a.city, 'City');
  if (!/^[A-Z]{2}$/.test(clean(a.state)))
    p.push({ path: `${path}.state`, message: 'State must be 2 letters' });
  const z = digits(a.zip);
  if (zip9 ? z.length !== 9 : z.length !== 5 && z.length !== 9) {
    p.push({
      path: `${path}.zip`,
      message: zip9
        ? 'ZIP must be ZIP+4 (9 digits) for the billing provider'
        : 'ZIP must be 5 or 9 digits',
    });
  }
  if (zip9 && /\bP\.?\s*O\.?\s*BOX\b/i.test(a.line1 + ' ' + (a.line2 ?? ''))) {
    p.push({
      path: `${path}.line1`,
      message: 'Billing provider address must be a street address, not a PO box',
    });
  }
}

function checkPerson(p: Problem[], path: string, x: Person | undefined, needDob: boolean) {
  if (!x) return;
  req(p, `${path}.lastName`, x.lastName, 'Last name');
  req(p, `${path}.firstName`, x.firstName, 'First name');
  if (needDob || x.birthDate) {
    if (!isDate(x.birthDate))
      p.push({ path: `${path}.birthDate`, message: 'Birth date is required (YYYY-MM-DD)' });
  }
}

export function validateBatch(b: Batch): Problem[] {
  const p: Problem[] = [];
  const e = b.envelope;
  for (const [k, label, max] of [
    ['senderId', 'Sender ID (ISA06)', 15],
    ['receiverId', 'Receiver ID (ISA08)', 15],
    ['gsSenderCode', 'Application sender code (GS02)', 15],
    ['gsReceiverCode', 'Application receiver code (GS03)', 15],
    ['submitterName', 'Submitter name', 60],
    ['submitterId', 'Submitter ID', 80],
    ['contactName', 'Contact name', 60],
    ['receiverName', 'Receiver name', 60],
    ['receiverId1000B', 'Receiver ID (1000B)', 80],
  ] as const) {
    const v = clean(e[k]);
    if (!v) p.push({ path: `envelope.${k}`, message: `${label} is required` });
    else if (v.length > max)
      p.push({ path: `envelope.${k}`, message: `${label} is longer than ${max}` });
  }
  if (!/^[A-Z0-9]{2}$/.test(e.senderQualifier))
    p.push({ path: 'envelope.senderQualifier', message: 'Qualifier must be 2 characters' });
  if (!/^[A-Z0-9]{2}$/.test(e.receiverQualifier))
    p.push({ path: 'envelope.receiverQualifier', message: 'Qualifier must be 2 characters' });
  if (digits(e.contactPhone).length !== 10)
    p.push({ path: 'envelope.contactPhone', message: 'Contact phone must be 10 digits' });
  if (!Number.isInteger(b.controlNumber) || b.controlNumber < 1 || b.controlNumber > 999_999_999) {
    p.push({ path: 'controlNumber', message: 'Control number must be 1 to 999999999' });
  }

  const bp = b.billing;
  req(p, 'billing.orgName', bp.orgName, bp.entity === 'person' ? 'Last name' : 'Practice name');
  if (bp.entity === 'person') req(p, 'billing.firstName', bp.firstName, 'First name');
  if (!isValidNpi(digits(bp.npi)))
    p.push({ path: 'billing.npi', message: 'Billing NPI is not a valid NPI' });
  if (digits(bp.taxId).length !== 9)
    p.push({ path: 'billing.taxId', message: 'Tax ID must be 9 digits' });
  if (bp.taxonomy && !/^[0-9A-Z]{9}X$/.test(clean(bp.taxonomy)))
    p.push({
      path: 'billing.taxonomy',
      message: 'Taxonomy code looks wrong (10 characters, ends in X)',
    });
  checkAddress(p, 'billing.address', bp.address, true);

  if (b.claims.length === 0) p.push({ path: 'claims', message: 'Add at least one claim' });
  const seen = new Set<string>();
  b.claims.forEach((c, i) => {
    const cp = `claims[${i}]`;
    const id = clean(c.controlNumber);
    if (!id) p.push({ path: `${cp}.controlNumber`, message: 'Claim number is required' });
    else if (id.length > 20)
      p.push({ path: `${cp}.controlNumber`, message: 'Claim number is longer than 20' });
    else if (seen.has(id))
      p.push({
        path: `${cp}.controlNumber`,
        message: 'Claim number repeats another claim in this file',
      });
    seen.add(id);
    if ((c.frequency === '7' || c.frequency === '8') && !clean(c.originalClaimNumber)) {
      p.push({
        path: `${cp}.originalClaimNumber`,
        message: "Replacement and void claims need the payer's original claim number",
      });
    }
    if (!/^\d{2}$/.test(c.placeOfService))
      p.push({ path: `${cp}.placeOfService`, message: 'Place of service must be 2 digits' });
    req(p, `${cp}.payer.name`, c.payer.name, 'Payer name');
    req(p, `${cp}.payer.id`, c.payer.id, 'Payer ID');
    if (!/^[0-9A-Z]{1,2}$/.test(c.payer.filingIndicator))
      p.push({
        path: `${cp}.payer.filingIndicator`,
        message: 'Claim filing indicator is required',
      });

    const isSelf = !c.patient;
    checkPerson(p, `${cp}.subscriber`, c.subscriber, isSelf);
    req(p, `${cp}.subscriber.memberId`, c.subscriber.memberId, 'Member ID');
    if (isSelf) checkAddress(p, `${cp}.subscriber.address`, c.subscriber.address, false);
    else if (c.subscriber.address?.line1)
      checkAddress(p, `${cp}.subscriber.address`, c.subscriber.address, false);
    if (c.patient) {
      checkPerson(p, `${cp}.patient`, c.patient, true);
      checkAddress(p, `${cp}.patient.address`, c.patient.address, false);
    }

    if (c.rendering) {
      req(p, `${cp}.rendering.lastName`, c.rendering.lastName, 'Rendering provider last name');
      req(p, `${cp}.rendering.firstName`, c.rendering.firstName, 'Rendering provider first name');
      if (!isValidNpi(digits(c.rendering.npi)))
        p.push({ path: `${cp}.rendering.npi`, message: 'Rendering NPI is not a valid NPI' });
      if (!/^[0-9A-Z]{9}X$/.test(clean(c.rendering.taxonomy)))
        p.push({
          path: `${cp}.rendering.taxonomy`,
          message: 'Rendering taxonomy is required (10 characters, ends in X)',
        });
    }

    if (c.lines.length === 0)
      p.push({ path: `${cp}.lines`, message: 'Add at least one procedure' });
    if (c.lines.length > 50)
      p.push({ path: `${cp}.lines`, message: 'A dental claim can have at most 50 procedures' });
    c.lines.forEach((l, j) => {
      const lp = `${cp}.lines[${j}]`;
      if (!/^D\d{4}$/.test(clean(l.code)))
        p.push({ path: `${lp}.code`, message: 'Procedure code must look like D1234' });
      const cents = toCents(l.fee);
      if (Number.isNaN(cents))
        p.push({ path: `${lp}.fee`, message: 'Fee must be an amount like 125.00' });
      if (!isDate(l.serviceDate))
        p.push({ path: `${lp}.serviceDate`, message: 'Service date is required' });
      else if (l.serviceDate > isoDay(b.createdAt))
        p.push({ path: `${lp}.serviceDate`, message: 'Service date is in the future' });
      const tooth = clean(l.tooth);
      if (tooth && !isValidTooth(tooth))
        p.push({
          path: `${lp}.tooth`,
          message: 'Tooth must be 1–32, A–T, or supernumerary (51–82, AS–TS)',
        });
      const surf = clean(l.surfaces);
      if (surf) {
        if (!tooth) p.push({ path: `${lp}.surfaces`, message: 'Surfaces need a tooth number' });
        if (!SURFACE_RE.test(surf) || new Set(surf).size !== surf.length)
          p.push({
            path: `${lp}.surfaces`,
            message: 'Surfaces: up to 5 of M O D B L I F, no repeats',
          });
      }
      const area = clean(l.area);
      if (area && !(area in AREA_CODES))
        p.push({ path: `${lp}.area`, message: 'Unknown area code' });
      if (
        l.quantity !== undefined &&
        (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99)
      ) {
        p.push({ path: `${lp}.quantity`, message: 'Quantity must be 1 to 99' });
      }
    });
  });
  return p;
}

function isoDay(d: Date) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// ---------- building ----------

function addressSegs(a: Address): string[] {
  const z = digits(a.zip);
  return [
    seg('N3', clean(a.line1), clean(a.line2) || undefined),
    seg('N4', clean(a.city), clean(a.state), z),
  ];
}

function personName(
  qual: string,
  x: { lastName: string; firstName: string; middle?: string },
  idQual?: string,
  id?: string,
) {
  return seg(
    'NM1',
    qual,
    '1',
    clean(x.lastName),
    clean(x.firstName),
    clean(x.middle) || undefined,
    undefined,
    undefined,
    idQual,
    id,
  );
}

export function claimTotalCents(c: Claim): number {
  return c.lines.reduce((s, l) => s + toCents(l.fee) * (l.quantity ?? 1), 0);
}

export function build837D(b: Batch, opts: BuildOptions = {}): string {
  const e = b.envelope;
  const d = b.createdAt;
  const ccyymmdd = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
  const hhmm = `${two(d.getHours())}${two(d.getMinutes())}`;
  const icn = String(b.controlNumber).padStart(9, '0');
  const gcn = String(b.controlNumber);
  const stcn = String(b.controlNumber).padStart(4, '0');

  const isa = [
    'ISA',
    '00',
    pad('', 10),
    '00',
    pad('', 10),
    e.senderQualifier,
    pad(clean(e.senderId), 15),
    e.receiverQualifier,
    pad(clean(e.receiverId), 15),
    ccyymmdd.slice(2),
    hhmm,
    REP,
    '00501',
    icn,
    e.ackRequested ? '1' : '0',
    e.usage,
    COMP,
  ].join(SEP);
  const gs = seg(
    'GS',
    'HC',
    clean(e.gsSenderCode),
    clean(e.gsReceiverCode),
    ccyymmdd,
    hhmm,
    gcn,
    'X',
    '005010X224A2',
  );

  // Transaction set body (ST..SE), counted for SE01.
  const t: string[] = [];
  t.push(seg('ST', '837', stcn, '005010X224A2'));
  t.push(seg('BHT', '0019', '00', icn, ccyymmdd, hhmm, 'CH'));
  // 1000A submitter, 1000B receiver
  t.push(
    seg(
      'NM1',
      '41',
      '2',
      clean(e.submitterName),
      undefined,
      undefined,
      undefined,
      undefined,
      '46',
      clean(e.submitterId),
    ),
  );
  t.push(seg('PER', 'IC', clean(e.contactName), 'TE', digits(e.contactPhone)));
  t.push(
    seg(
      'NM1',
      '40',
      '2',
      clean(e.receiverName),
      undefined,
      undefined,
      undefined,
      undefined,
      '46',
      clean(e.receiverId1000B),
    ),
  );

  // 2000A billing provider
  const bp = b.billing;
  let hl = 1;
  const billingHl = hl;
  t.push(seg('HL', String(billingHl), undefined, '20', '1'));
  if (bp.taxonomy) t.push(seg('PRV', 'BI', 'PXC', clean(bp.taxonomy)));
  t.push(
    bp.entity === 'organization'
      ? seg(
          'NM1',
          '85',
          '2',
          clean(bp.orgName),
          undefined,
          undefined,
          undefined,
          undefined,
          'XX',
          digits(bp.npi),
        )
      : seg(
          'NM1',
          '85',
          '1',
          clean(bp.orgName),
          clean(bp.firstName),
          undefined,
          undefined,
          undefined,
          'XX',
          digits(bp.npi),
        ),
  );
  t.push(...addressSegs(bp.address));
  t.push(seg('REF', 'EI', digits(bp.taxId)));

  for (const c of b.claims) {
    const self = !c.patient;
    const s = c.subscriber;
    // 2000B subscriber
    const subHl = ++hl;
    t.push(seg('HL', String(subHl), String(billingHl), '22', self ? '0' : '1'));
    const group = clean(s.groupNumber);
    t.push(
      seg(
        'SBR',
        'P',
        self ? '18' : undefined,
        group || undefined,
        group ? undefined : clean(s.groupName) || undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        c.payer.filingIndicator,
      ),
    );
    // 2010BA subscriber name
    t.push(personName('IL', s, 'MI', clean(s.memberId)));
    if (s.address && (self || s.address.line1)) t.push(...addressSegs(s.address));
    if (self || s.birthDate) t.push(seg('DMG', 'D8', ymd(s.birthDate), s.sex));
    // 2010BB payer
    t.push(
      seg(
        'NM1',
        'PR',
        '2',
        clean(c.payer.name),
        undefined,
        undefined,
        undefined,
        undefined,
        'PI',
        clean(c.payer.id),
      ),
    );

    // 2000C patient
    if (c.patient) {
      const pt = c.patient;
      t.push(seg('HL', String(++hl), String(subHl), '23', '0'));
      t.push(seg('PAT', pt.relationship));
      t.push(personName('QC', pt));
      if (pt.address) t.push(...addressSegs(pt.address));
      t.push(seg('DMG', 'D8', ymd(pt.birthDate), pt.sex));
    }

    // 2300 claim
    const total = claimTotalCents(c);
    t.push(
      seg(
        'CLM',
        clean(c.controlNumber),
        amount(total),
        undefined,
        undefined,
        [c.placeOfService, 'B', c.frequency].join(COMP),
        'Y',
        'A',
        'Y',
        'Y',
      ),
    );
    if (c.priorAuth) t.push(seg('REF', 'G1', clean(c.priorAuth)));
    if (c.frequency !== '1') t.push(seg('REF', 'F8', clean(c.originalClaimNumber)));

    // 2310B rendering provider, when it isn't the billing provider
    const r = c.rendering;
    if (r && digits(r.npi) !== digits(bp.npi)) {
      t.push(personName('82', r, 'XX', digits(r.npi)));
      t.push(seg('PRV', 'PE', 'PXC', clean(r.taxonomy)));
    }

    // 2400 lines
    c.lines.forEach((l, i) => {
      t.push(seg('LX', String(i + 1)));
      const qty = l.quantity ?? 1;
      const area = clean(l.area);
      t.push(
        seg(
          'SV3',
          ['AD', clean(l.code)].join(COMP),
          amount(toCents(l.fee) * qty),
          undefined,
          area || undefined,
          undefined,
          String(qty),
        ),
      );
      const tooth = clean(l.tooth);
      if (tooth) {
        const surf = clean(l.surfaces);
        t.push(seg('TOO', 'JP', tooth, surf ? surf.split('').join(COMP) : undefined));
      }
      t.push(seg('DTP', '472', 'D8', ymd(l.serviceDate)));
      t.push(seg('REF', '6R', String(i + 1)));
    });
  }

  t.push(seg('SE', String(t.length + 1), stcn));

  const all = [isa, gs, ...t, seg('GE', '1', gcn), seg('IEA', '1', icn)];
  const nl = opts.newlines ? '\n' : '';
  return all.map((x) => x + TERM).join(nl) + nl;
}

/** One segment per line, for showing the file on screen. */
export function prettyPrint(x12: string): string {
  return x12
    .split(TERM)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s + TERM)
    .join('\n');
}
