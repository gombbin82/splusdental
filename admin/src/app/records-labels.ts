// Display labels, safe to import from .astro frontmatter (no browser code).
import type { Relationship } from './records-api';

export const RELATIONSHIPS: Record<Relationship, string> = {
  '18': 'Self',
  '01': 'Spouse',
  '19': 'Child',
  '53': 'Life partner',
  G8: 'Other',
};

export const FILING_INDICATORS: Record<string, string> = {
  CI: 'Commercial',
  '12': 'PPO',
  '17': 'Dental maintenance org (DMO)',
  HM: 'HMO',
  BL: 'Blue Cross / Blue Shield',
  MC: 'Medicaid',
  CH: 'TRICARE',
  FI: 'Federal employees (FEP)',
};
