const COMPANY_KEY = "gold.company.v1";

/** The company this device last signed in to ('' = the default company). */
export function savedCompany(): string {
  try {
    return localStorage.getItem(COMPANY_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveCompany(company: string) {
  try {
    localStorage.setItem(COMPANY_KEY, company);
  } catch {
    /* private mode: just do not remember it */
  }
}
