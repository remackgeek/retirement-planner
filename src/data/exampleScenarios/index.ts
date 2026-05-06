import type { Scenario } from '../../types/Scenario';
import { nearRetirement } from './nearRetirement';
import { retiredEarly } from './retiredEarly';
import { midCareer } from './midCareer';

export interface ExampleTemplate {
  key: string;
  label: string;
  description: string;
  template: Omit<Scenario, 'id'>;
}

export const EXAMPLE_SCENARIOS: ExampleTemplate[] = [
  {
    key: 'near-retirement',
    label: 'Near retirement',
    description: 'Age 62, MFJ, ~$1.2M across Traditional / Roth / Taxable, SS at 67.',
    template: nearRetirement,
  },
  {
    key: 'retired-early',
    label: 'Retired early',
    description: 'Age 50, ~$2M, no SS yet, ACA healthcare gap, Roth conversion ladder.',
    template: retiredEarly,
  },
  {
    key: 'mid-career',
    label: 'Mid-career',
    description: 'Age 35, $110k salary with 401(k) match + Roth IRA, long horizon.',
    template: midCareer,
  },
];
