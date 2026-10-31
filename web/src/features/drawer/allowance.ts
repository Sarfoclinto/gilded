/**
 * The office allowance: paid each day out of the drawer, a fixed amount per person in the office.
 * The rate lives here until the company settings page holds it; one place to change, used by the form and its check.
 */
export const ALLOWANCE_PER_PERSON = 100;

export const allowanceDue = (people: number, rate = ALLOWANCE_PER_PERSON) =>
  Number.isInteger(people) && people > 0 ? people * rate : 0;
