// Rollfi requires EXACT field name strings (matching their UI form labels) in companyStateRegistration.
// Each state can have different required fields.
// Update entries here as confirmed from the Rollfi portal UI.

interface StateFieldMap {
  unemploymentRate: string;        // maps to our suiRate
  withholdingAccount?: string;     // maps to our stateEmployerId (state income tax withholding)
  ucAccount?: string;              // maps to our suiAccountNumber (unemployment compensation)
  extras?: Record<string, string>; // state-specific extras (e.g. SDI, city tax)
}

export const STATE_FIELD_MAP: Record<string, StateFieldMap> = {
  // ── Confirmed from Rollfi portal screenshots ──
  AL: {
    unemploymentRate: "Unemployment Rate",
    withholdingAccount: "Withholding Tax Account Number",
    ucAccount: "UC Account Number",
    // AL also has "City Occupational Tax ID" but we don't capture that field yet
  },
  // NY: Employer Registration Number (stateEmployerId), Withholding ID Number (suiAccountNumber), Unemployment Rate
  NY: {
    unemploymentRate: "Unemployment Rate",
    withholdingAccount: "Employer Registration Number",
    ucAccount: "Withholding ID Number",
  },
  // NJ: NJ Employer Registration Number (stateEmployerId), NJ Department of Labor Account Number (suiAccountNumber),
  //     Unemployment Rate, Disability Rate (NJ-specific — defaulted to 0.5 if not captured)
  NJ: {
    unemploymentRate: "Unemployment Rate",
    withholdingAccount: "NJ Employer Registration Number",
    ucAccount: "NJ Department of Labor Account Number",
    extras: { "Disability Rate": "0.5" },
  },
};

export const DEFAULT_STATE_FIELDS: StateFieldMap = {
  unemploymentRate: "Unemployment Rate",
  withholdingAccount: "Withholding Tax Account Number",
  ucAccount: "UC Account Number",
};

export function buildStateRegistrationPayload(
  stateCode: string,
  stateEmployerId: string,
  suiAccountNumber: string | undefined | null,
  suiRate: number
): Record<string, string> {
  const fields = STATE_FIELD_MAP[stateCode] ?? DEFAULT_STATE_FIELDS;
  const payload: Record<string, string> = {
    [fields.unemploymentRate]: String(suiRate),
  };
  if (fields.withholdingAccount) {
    payload[fields.withholdingAccount] = stateEmployerId;
  }
  if (fields.ucAccount && suiAccountNumber) {
    payload[fields.ucAccount] = suiAccountNumber;
  } else if (fields.ucAccount && !fields.withholdingAccount) {
    payload[fields.ucAccount] = stateEmployerId;
  }
  if (fields.extras) {
    Object.assign(payload, fields.extras);
  }
  return payload;
}
