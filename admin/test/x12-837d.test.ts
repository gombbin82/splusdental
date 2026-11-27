// All names, IDs and numbers below are invented. Never put real patient data in tests.
import { describe, expect, it } from 'vitest';
import {
  amount,
  build837D,
  clean,
  isValidNpi,
  isValidTooth,
  toCents,
  validateBatch,
  type Batch,
  type Claim,
} from '../src/app/x12/837d';

// 1234567893 is the CMS example NPI (valid check digit); 1245319599 is also valid.
const BILLING_NPI = '1234567893';
const RENDERING_NPI = '1245319599';

function claim(over: Partial<Claim> = {}): Claim {
  return {
    controlNumber: 'KD0001',
    frequency: '1',
    placeOfService: '11',
    payer: { name: 'Test Dental Insurance', id: '99999', filingIndicator: 'CI' },
    subscriber: {
      lastName: 'Doe',
      firstName: 'Jane',
      birthDate: '1980-02-03',
      sex: 'F',
      memberId: 'ABC123456',
      groupNumber: 'G100',
      address: { line1: '1 Main St', city: 'Seattle', state: 'WA', zip: '98101' },
    },
    rendering: { lastName: 'Smith', firstName: 'Alex', npi: RENDERING_NPI, taxonomy: '1223G0001X' },
    lines: [
      { code: 'D0120', fee: '65.00', serviceDate: '2026-11-20' },
      { code: 'D2391', fee: '180.50', serviceDate: '2026-11-20', tooth: '14', surfaces: 'MO' },
    ],
    ...over,
  };
}

function batch(claims: Claim[] = [claim()]): Batch {
  return {
    envelope: {
      senderQualifier: 'ZZ',
      senderId: 'SENDER1',
      receiverQualifier: 'ZZ',
      receiverId: 'RECEIVER1',
      gsSenderCode: 'SENDER1',
      gsReceiverCode: 'RECEIVER1',
      submitterName: 'Test Practice',
      submitterId: 'SUB1',
      contactName: 'Front Desk',
      contactPhone: '(206) 555-0100',
      receiverName: 'Test Clearinghouse',
      receiverId1000B: 'RCV1',
      usage: 'T',
      ackRequested: true,
    },
    billing: {
      entity: 'organization',
      orgName: 'Test Practice PLLC',
      npi: BILLING_NPI,
      taxId: '12-3456789',
      taxonomy: '1223G0001X',
      address: { line1: '100 Example Ave', city: 'Seattle', state: 'WA', zip: '98101-1234' },
    },
    claims,
    controlNumber: 42,
    createdAt: new Date(2026, 10, 26, 9, 5),
  };
}

const segs = (x: string) => x.split('~').filter(Boolean);
const find = (x: string, id: string) => segs(x).filter((s) => s.startsWith(id + '*'));

describe('helpers', () => {
  it('validates NPI check digits', () => {
    expect(isValidNpi(BILLING_NPI)).toBe(true);
    expect(isValidNpi(RENDERING_NPI)).toBe(true);
    expect(isValidNpi('1234567890')).toBe(false);
    expect(isValidNpi('123')).toBe(false);
  });

  it('formats amounts the X12 way', () => {
    expect(amount(12500)).toBe('125');
    expect(amount(12550)).toBe('125.5');
    expect(amount(12555)).toBe('125.55');
    expect(amount(5)).toBe('0.05');
    expect(amount(0)).toBe('0');
    expect(toCents('$1,250.5')).toBe(125050);
    expect(toCents('abc')).toBeNaN();
  });

  it('strips delimiters and accents, upper-cases', () => {
    expect(clean('José*O~Brien:^x')).toBe('JOSE O BRIEN X');
  });

  it('knows universal tooth numbers', () => {
    for (const t of ['1', '14', '32', 'A', 'T', '51', '82', 'AS', 'TS'])
      expect(isValidTooth(t), t).toBe(true);
    for (const t of ['0', '33', '50', '83', 'U', 'US']) expect(isValidTooth(t), t).toBe(false);
  });
});

describe('validateBatch', () => {
  it('accepts a complete claim', () => {
    expect(validateBatch(batch())).toEqual([]);
  });

  it('requires a 9-digit billing ZIP and a street address', () => {
    const b = batch();
    b.billing.address = { line1: 'PO Box 5', city: 'Seattle', state: 'WA', zip: '98101' };
    const paths = validateBatch(b).map((p) => p.path);
    expect(paths).toContain('billing.address.zip');
    expect(paths).toContain('billing.address.line1');
  });

  it('flags bad lines', () => {
    const b = batch([
      claim({
        lines: [
          { code: '2391', fee: 'x', serviceDate: '2099-01-01', tooth: '40', surfaces: 'MMQ' },
        ],
      }),
    ]);
    const paths = validateBatch(b).map((p) => p.path);
    for (const k of ['code', 'fee', 'serviceDate', 'tooth', 'surfaces']) {
      expect(paths).toContain(`claims[0].lines[0].${k}`);
    }
  });

  it('needs the original claim number to replace or void', () => {
    const paths = validateBatch(batch([claim({ frequency: '7' })])).map((p) => p.path);
    expect(paths).toContain('claims[0].originalClaimNumber');
  });

  it('needs patient demographics and address for a dependent', () => {
    const b = batch([
      claim({
        patient: { lastName: 'Doe', firstName: 'Kid', birthDate: '', sex: 'U', relationship: '19' },
      }),
    ]);
    const paths = validateBatch(b).map((p) => p.path);
    expect(paths).toContain('claims[0].patient.birthDate');
    expect(paths).toContain('claims[0].patient.address');
  });

  it('rejects duplicate claim numbers in one file', () => {
    const paths = validateBatch(batch([claim(), claim()])).map((p) => p.path);
    expect(paths).toContain('claims[1].controlNumber');
  });
});

describe('build837D', () => {
  it('builds a valid envelope with fixed-width ISA', () => {
    const x = build837D(batch());
    const isa = segs(x)[0]!;
    expect(isa.length).toBe(105);
    expect(isa).toBe(
      'ISA*00*          *00*          *ZZ*SENDER1        *ZZ*RECEIVER1      *261126*0905*^*00501*000000042*1*T*:',
    );
    expect(find(x, 'GS')[0]).toBe('GS*HC*SENDER1*RECEIVER1*20261126*0905*42*X*005010X224A2');
    expect(find(x, 'GE')[0]).toBe('GE*1*42');
    expect(find(x, 'IEA')[0]).toBe('IEA*1*000000042');
  });

  it('counts segments in SE01 and matches ST02', () => {
    const x = build837D(batch());
    const all = segs(x);
    const st = all.findIndex((s) => s.startsWith('ST*'));
    const se = all.findIndex((s) => s.startsWith('SE*'));
    expect(all[st]).toBe('ST*837*0042*005010X224A2');
    expect(all[se]).toBe(`SE*${se - st + 1}*0042`);
  });

  it('writes the subscriber-is-patient claim', () => {
    const x = build837D(batch());
    expect(segs(x)).toEqual(
      expect.arrayContaining([
        'BHT*0019*00*000000042*20261126*0905*CH',
        'NM1*41*2*TEST PRACTICE*****46*SUB1',
        'PER*IC*FRONT DESK*TE*2065550100',
        'NM1*40*2*TEST CLEARINGHOUSE*****46*RCV1',
        'HL*1**20*1',
        'PRV*BI*PXC*1223G0001X',
        `NM1*85*2*TEST PRACTICE PLLC*****XX*${BILLING_NPI}`,
        'N3*100 EXAMPLE AVE',
        'N4*SEATTLE*WA*981011234',
        'REF*EI*123456789',
        'HL*2*1*22*0',
        'SBR*P*18*G100******CI',
        'NM1*IL*1*DOE*JANE****MI*ABC123456',
        'DMG*D8*19800203*F',
        'NM1*PR*2*TEST DENTAL INSURANCE*****PI*99999',
        'CLM*KD0001*245.5***11:B:1*Y*A*Y*Y',
        `NM1*82*1*SMITH*ALEX****XX*${RENDERING_NPI}`,
        'PRV*PE*PXC*1223G0001X',
        'LX*1',
        'SV3*AD:D0120*65****1',
        'LX*2',
        'SV3*AD:D2391*180.5****1',
        'TOO*JP*14*M:O',
        'DTP*472*D8*20261120',
        'REF*6R*2',
      ]),
    );
    expect(find(x, 'HL')).toHaveLength(2);
    expect(find(x, 'PAT')).toHaveLength(0);
  });

  it('adds a patient loop for a dependent', () => {
    const c = claim({
      patient: {
        lastName: 'Doe',
        firstName: 'Kid',
        birthDate: '2015-06-07',
        sex: 'M',
        relationship: '19',
        address: { line1: '1 Main St', city: 'Seattle', state: 'WA', zip: '98101' },
      },
    });
    const x = build837D(batch([c]));
    const s = segs(x);
    const i = s.indexOf('HL*3*2*23*0');
    expect(s.indexOf('HL*2*1*22*1')).toBeGreaterThan(0);
    expect(s.slice(i, i + 6)).toEqual([
      'HL*3*2*23*0',
      'PAT*19',
      'NM1*QC*1*DOE*KID',
      'N3*1 MAIN ST',
      'N4*SEATTLE*WA*98101',
      'DMG*D8*20150607*M',
    ]);
    expect(find(x, 'SBR')[0]).toBe('SBR*P**G100******CI');
  });

  it('omits the rendering provider when it is the billing provider', () => {
    const c = claim({
      rendering: { lastName: 'Smith', firstName: 'A', npi: BILLING_NPI, taxonomy: '1223G0001X' },
    });
    expect(find(build837D(batch([c])), 'NM1').some((s) => s.startsWith('NM1*82'))).toBe(false);
  });

  it('writes area codes, quantity and replacement references', () => {
    const c = claim({
      frequency: '7',
      originalClaimNumber: 'PAYER-77',
      lines: [{ code: 'D4341', fee: '200', serviceDate: '2026-11-20', area: '10', quantity: 1 }],
    });
    const x = build837D(batch([c]));
    expect(find(x, 'SV3')[0]).toBe('SV3*AD:D4341*200**10**1');
    expect(find(x, 'CLM')[0]).toBe('CLM*KD0001*200***11:B:7*Y*A*Y*Y');
    expect(find(x, 'REF')).toContain('REF*F8*PAYER-77');
  });

  it('can put each segment on its own line', () => {
    const x = build837D(batch(), { newlines: true });
    expect(x.split('\n')[1]).toMatch(/^GS\*/);
  });

  it('numbers HLs across several claims', () => {
    const x = build837D(batch([claim(), claim({ controlNumber: 'KD0002' })]));
    expect(find(x, 'HL')).toEqual(['HL*1**20*1', 'HL*2*1*22*0', 'HL*3*1*22*0']);
  });
});

describe('blank input', () => {
  it('reports blank fields instead of throwing', () => {
    const b = batch([claim({ lines: [{ code: '', fee: '', serviceDate: '' }] })]);
    const paths = validateBatch(b).map((p) => p.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'claims[0].lines[0].code',
        'claims[0].lines[0].fee',
        'claims[0].lines[0].serviceDate',
      ]),
    );
    expect(toCents(undefined)).toBeNaN();
  });
});
