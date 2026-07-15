// GENERATED FILE -- do not edit by hand.
// Source of truth: contract.yaml. Regenerate with: node compile.js

// ---------- TypeScript interface ----------
export interface IrrContractFields {
  investigatorQuestion: string;
  authorizationSummary: string;
  authorizationRationale: string;
  knownLimitations: string;
  defensibilityRating: 'Critical Exposure' | 'At Risk' | 'Defensible with Gaps' | 'Inspection-Ready';
  evidenceReviewed_list: Array<Record<string, any>>;
  riskEvaluation: string;
  alternativesConsidered: string;
  regulatoryAlignment: string;
  residualExposureStatement: string;
  gapFlags_list: Array<Record<string, any>>;
  criticalGapsRanked_list: Array<string>;
  claimStatus_list: Array<{ claim: string; status: 'Claimed in rationale' | 'Supported by attached evidence' | 'Not traceable in record' }>;
  evidenceMatrix_list: Array<Record<string, any>>;
  evidenceTraceability_list: Array<{ claimId: string }>;
  unsupportedClaims_list: Array<Record<string, any>>;
  inspectorChallenge_list: Array<Record<string, any>>;
  remediationScaffold_list: Array<Record<string, any>>;
  executiveBriefBreakdown_list: Array<{ gap: any; defensibilityRating: string }>;
  executiveBrief: string;
}

// ---------- Prompt constraint fragments (one per model-generated field) ----------
export const PROMPT_CONSTRAINTS: Record<string, string> = {
  investigatorQuestion: "investigatorQuestion is a single prose string. Do not output an array, list, bullets, or numbered items.",
  authorizationSummary: "authorizationSummary is a single prose string. Do not output an array, list, bullets, or numbered items.",
  authorizationRationale: "authorizationRationale is a single prose string. Do not output an array, list, bullets, or numbered items.",
  knownLimitations: "knownLimitations is a single prose string. Do not output an array, list, bullets, or numbered items.",
  defensibilityRating: "defensibilityRating must be exactly one of: \"Critical Exposure\", \"At Risk\", \"Defensible with Gaps\", \"Inspection-Ready\".",
  evidenceReviewed_list: "evidenceReviewed_list is a JSON array whose items are JSON objects -- never bare strings.",
  riskEvaluation: "riskEvaluation is a single prose string. Do not output an array, list, bullets, or numbered items.",
  alternativesConsidered: "alternativesConsidered is a single prose string. Do not output an array, list, bullets, or numbered items.",
  regulatoryAlignment: "regulatoryAlignment is a single prose string. Do not output an array, list, bullets, or numbered items.",
  residualExposureStatement: "residualExposureStatement is a single prose string. Do not output an array, list, bullets, or numbered items.",
  gapFlags_list: "gapFlags_list is a JSON array whose items are JSON objects -- never bare strings.",
  criticalGapsRanked_list: "criticalGapsRanked_list is a JSON array whose items are plain strings.",
  claimStatus_list: "Each claimStatus_list entry MUST be a JSON object of the exact shape {\"claim\": <string>, \"status\": <\"Claimed in rationale\" | \"Supported by attached evidence\" | \"Not traceable in record\">} -- never a bare string, never a nested array, never additional keys.",
  evidenceMatrix_list: "evidenceMatrix_list is a JSON array whose items are JSON objects -- never bare strings.",
  evidenceTraceability_list: "Each evidenceTraceability_list entry MUST be a JSON object of the exact shape {\"claimId\": <string>} -- never a bare string, never a nested array, never additional keys.",
  unsupportedClaims_list: "unsupportedClaims_list is a JSON array whose items are JSON objects -- never bare strings.",
  inspectorChallenge_list: "inspectorChallenge_list is a JSON array whose items are JSON objects -- never bare strings.",
  remediationScaffold_list: "remediationScaffold_list is a JSON array whose items are JSON objects -- never bare strings.",
  executiveBrief: "executiveBrief is a single prose string. Do not output an array, list, bullets, or numbered items.",
};

// Returns the constraint lines for a given list of fields, in order, skipping
// any field with no generated fragment (e.g. derived/non-model fields).
export function constraintsFor(fieldNames: string[]): string[] {
  return fieldNames.map((f) => PROMPT_CONSTRAINTS[f]).filter((c): c is string => !!c);
}

// ---------- Runtime validators ----------
// Thrown errors match the { retryable, reason, message } shape the stage engine
// already expects, so a contract violation enters the existing retry path.
function fail(context: string, message: string): never {
  throw { retryable: true, reason: 'malformed_array_item', message: `${context}: ${message}` };
}

export const FIELD_SPECS: Record<string, any> = {
  "investigatorQuestion": {
    "type": "string",
    "format": "prose",
    "stage": 5,
    "source": "model",
    "description": "The specific question an inspector would ask about this decision."
  },
  "authorizationSummary": {
    "type": "string",
    "format": "prose",
    "stage": 5,
    "source": "model",
    "description": "Summary of who authorized the decision and on what basis."
  },
  "authorizationRationale": {
    "type": "string",
    "format": "prose",
    "stage": 5,
    "source": "model",
    "description": "The reasoning that justified the decision."
  },
  "knownLimitations": {
    "type": "string",
    "format": "prose",
    "stage": 5,
    "source": "model",
    "description": "Every distinct deficiency, explained in full exactly once."
  },
  "defensibilityRating": {
    "type": "string",
    "stage": 5,
    "source": "model",
    "enum": [
      "Critical Exposure",
      "At Risk",
      "Defensible with Gaps",
      "Inspection-Ready"
    ],
    "description": "Overall defensibility rating for the decision."
  },
  "evidenceReviewed_list": {
    "type": "array",
    "stage": 4,
    "source": "model",
    "items": {
      "type": "object"
    },
    "description": "Evidence items reviewed in support of the decision."
  },
  "riskEvaluation": {
    "type": "string",
    "format": "prose",
    "stage": 4,
    "source": "model",
    "description": "How regulatory risk was evaluated for this decision."
  },
  "alternativesConsidered": {
    "type": "string",
    "format": "prose",
    "stage": 4,
    "source": "model",
    "description": "Alternative interpretations or courses of action considered."
  },
  "regulatoryAlignment": {
    "type": "string",
    "format": "prose",
    "stage": 4,
    "source": "model",
    "description": "How the decision aligns with applicable regulatory expectations."
  },
  "residualExposureStatement": {
    "type": "string",
    "format": "prose",
    "stage": 4,
    "source": "model",
    "description": "What inspection exposure remains after this decision."
  },
  "gapFlags_list": {
    "type": "array",
    "stage": 6,
    "source": "model",
    "items": {
      "type": "object"
    },
    "description": "Documentation gaps, each paired with an imperative next action."
  },
  "criticalGapsRanked_list": {
    "type": "array",
    "stage": 6,
    "source": "model",
    "items": {
      "type": "string"
    },
    "description": "The 2-3 most inspection-critical gaps, ranked by severity, named specifically. INFERRED shape (string names) -- not previously validated at runtime; confirm against actual stage-6 output before relying on the item-shape check in production.\n"
  },
  "claimStatus_list": {
    "type": "array",
    "stage": 7,
    "source": "model",
    "items": {
      "type": "object",
      "properties": {
        "claim": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "Claimed in rationale",
            "Supported by attached evidence",
            "Not traceable in record"
          ]
        }
      }
    },
    "description": "Classification of every factual claim in the rationale."
  },
  "evidenceMatrix_list": {
    "type": "array",
    "stage": 8,
    "source": "model",
    "items": {
      "type": "object"
    },
    "description": "Matrix mapping claims to the specific evidence that supports them."
  },
  "evidenceTraceability_list": {
    "type": "array",
    "stage": 8,
    "source": "model",
    "items": {
      "type": "object",
      "properties": {
        "claimId": {
          "type": "string"
        }
      }
    },
    "description": "One entry per claim, tracing it to evidence or marking it unsupported."
  },
  "unsupportedClaims_list": {
    "type": "array",
    "stage": 9,
    "source": "model",
    "items": {
      "type": "object"
    },
    "description": "What the record fails to establish, for each unsupported claim."
  },
  "inspectorChallenge_list": {
    "type": "array",
    "stage": 10,
    "source": "model",
    "items": {
      "type": "object"
    },
    "description": "Inspector-facing challenge/response pairs, one per gap."
  },
  "remediationScaffold_list": {
    "type": "array",
    "stage": 11,
    "source": "model",
    "items": {
      "type": "object"
    },
    "description": "Bracketed-blank documentation scaffolds, one per gap."
  },
  "executiveBriefBreakdown_list": {
    "type": "array",
    "stage": 12,
    "source": "derived",
    "items": {
      "type": "object",
      "properties": {
        "gap": {},
        "defensibilityRating": {
          "type": "string"
        }
      }
    },
    "description": "Deterministically assembled from criticalGapsRanked_list + defensibilityRating. Not model-generated -- no prompt fragment is produced for this field.\n"
  },
  "executiveBrief": {
    "type": "string",
    "format": "prose",
    "stage": 13,
    "source": "model",
    "description": "2-3 sentence summary of the completed IRR analysis for a QA leader."
  }
};

// Generic validator: checks a field's array items against its contract.yaml
// spec (object vs string items, required properties, enum values). This is
// what replaces the old hand-written assertArrayOfObjects/assertClaimStatusShape --
// there is exactly one place that knows a field's shape, and it is generated.
export function validateFieldItems(fieldName: string, items: any[], context: string): void {
  const spec = FIELD_SPECS[fieldName];
  if (!spec || spec.type !== 'array') return;
  const itemSpec = spec.items;
  items.forEach((item: any, i: number) => {
    if (itemSpec.type === 'object') {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        fail(context, `${fieldName}[${i}] must be a JSON object but got ${Array.isArray(item) ? 'an array' : typeof item} (${JSON.stringify(item).slice(0, 120)}).`);
      }
      if (itemSpec.properties) {
        for (const [prop, propSpec] of Object.entries<any>(itemSpec.properties)) {
          const val = (item as any)[prop];
          if (propSpec.type === 'string' && typeof val !== 'string') {
            fail(context, `${fieldName}[${i}].${prop} must be a string (got ${JSON.stringify(val)}).`);
          }
          if (propSpec.enum && !propSpec.enum.includes(val)) {
            fail(context, `${fieldName}[${i}].${prop} "${val}" is not one of the allowed values: ${propSpec.enum.join(' | ')}.`);
          }
        }
      }
    } else if (itemSpec.type === 'string') {
      if (typeof item !== 'string') {
        fail(context, `${fieldName}[${i}] must be a string but got ${typeof item} (${JSON.stringify(item).slice(0, 120)}).`);
      }
    }
  });
}

// Top-level type contract line, generated from the spec rather than hand-typed --
// this is the sentence that drifted from the schema and caused the Stage 7 bug.
export const TYPE_CONTRACT_LINE = 'Type contract: any field name ending in "_list" must be a JSON array. Every other field must be a single string (never an array, object, or list) unless a constraint below states otherwise. When a field\'s array items are objects, the exact per-item shape is specified in the constraints below -- follow it precisely; never substitute a bare string for a required object item.';
