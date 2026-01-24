/**
 * Medication constraint and interaction rules.
 *
 * These rules are used to generate constraints and warnings
 * when certain medications are present in a patient's regimen.
 */

export interface DrugRule {
  contraindications: string[];
  monitoring: string[];
  interactions: string[];
  warnings: string[];
}

export const drugConstraints: Record<string, DrugRule> = {
  // ============================================================================
  // Diabetes Medications
  // ============================================================================
  metformin: {
    contraindications: [
      "eGFR < 30 mL/min (contraindicated)",
      "Active hepatic disease",
      "Within 48 hours of iodinated contrast administration",
      "History of lactic acidosis",
    ],
    monitoring: [
      "Renal function annually (more frequently if eGFR 30-45)",
      "Vitamin B12 levels if on long-term therapy",
    ],
    interactions: [
      "Hold before iodinated contrast procedures",
      "Alcohol may increase lactic acidosis risk",
    ],
    warnings: [
      "Hold if acute illness with dehydration risk",
    ],
  },

  glipizide: {
    contraindications: [
      "Sulfa allergy (sulfonylurea class)",
      "Type 1 diabetes",
      "Diabetic ketoacidosis",
    ],
    monitoring: [
      "Blood glucose - risk of hypoglycemia",
      "HbA1c every 3 months initially",
    ],
    interactions: [
      "Beta-blockers may mask hypoglycemia symptoms",
      "NSAIDs may enhance hypoglycemic effect",
    ],
    warnings: [
      "Increased hypoglycemia risk in elderly",
      "Reduce dose if renal impairment",
    ],
  },

  insulin: {
    contraindications: [],
    monitoring: [
      "Fingerstick glucose before meals and at bedtime",
      "HbA1c every 3 months",
      "Signs of hypoglycemia",
    ],
    interactions: [
      "Beta-blockers may mask hypoglycemia symptoms",
      "Thiazolidinediones may increase fluid retention",
    ],
    warnings: [
      "Adjust dose with changes in diet, exercise, or illness",
      "Hypoglycemia unawareness requires adjusted targets",
    ],
  },

  // ============================================================================
  // Anticoagulants
  // ============================================================================
  warfarin: {
    contraindications: [
      "Active pathological bleeding",
      "Severe hepatic disease",
      "Pregnancy (teratogenic)",
      "Recent CNS surgery or hemorrhage",
    ],
    monitoring: [
      "INR target 2-3 (or 2.5-3.5 for mechanical valve)",
      "INR weekly until stable, then monthly",
      "Signs of bleeding",
    ],
    interactions: [
      "Avoid NSAIDs - increased bleeding risk",
      "Multiple drug interactions - check each new medication",
      "Vitamin K-rich foods affect INR",
      "Antibiotics may alter INR",
    ],
    warnings: [
      "Bridge with heparin for procedures if needed",
      "Genetic testing may guide dosing (CYP2C9, VKORC1)",
    ],
  },

  apixaban: {
    contraindications: [
      "CrCl < 15 mL/min (or on dialysis)",
      "Active pathological bleeding",
      "Mechanical heart valve",
      "Triple-positive antiphospholipid syndrome",
    ],
    monitoring: [
      "Renal function periodically",
      "Signs of bleeding",
      "No routine coagulation monitoring needed",
    ],
    interactions: [
      "Strong CYP3A4 inhibitors/inducers affect levels",
      "Dual antiplatelet therapy increases bleeding risk",
      "P-glycoprotein inhibitors",
    ],
    warnings: [
      "Reduce dose if age >= 80, weight <= 60 kg, or Cr >= 1.5",
      "Reversal agent: andexanet alfa",
    ],
  },

  heparin: {
    contraindications: [
      "History of heparin-induced thrombocytopenia (HIT)",
      "Active bleeding",
      "Severe thrombocytopenia",
    ],
    monitoring: [
      "aPTT for unfractionated heparin",
      "Platelet count at baseline and periodically (HIT risk)",
      "Signs of bleeding",
    ],
    interactions: [
      "Antiplatelet agents increase bleeding risk",
      "NSAIDs increase bleeding risk",
    ],
    warnings: [
      "Monitor for HIT (platelet drop > 50%)",
      "Use with caution in severe renal/hepatic impairment",
    ],
  },

  // ============================================================================
  // Cardiac Medications
  // ============================================================================
  metoprolol: {
    contraindications: [
      "Severe bradycardia (HR < 50)",
      "Heart block (2nd or 3rd degree without pacemaker)",
      "Decompensated heart failure",
      "Cardiogenic shock",
    ],
    monitoring: [
      "Heart rate and blood pressure",
      "Signs of heart failure worsening",
    ],
    interactions: [
      "Calcium channel blockers may cause additive bradycardia",
      "Insulin - may mask hypoglycemia symptoms",
      "Clonidine - risk of rebound hypertension",
    ],
    warnings: [
      "Do not abruptly discontinue - taper over 1-2 weeks",
      "Use with caution in asthma/COPD",
    ],
  },

  furosemide: {
    contraindications: [
      "Anuria",
      "Severe hypovolemia",
      "Severe hypokalemia or hyponatremia",
    ],
    monitoring: [
      "Serum electrolytes (K+, Na+, Mg2+)",
      "Renal function",
      "Blood pressure",
      "Volume status",
    ],
    interactions: [
      "NSAIDs may reduce diuretic effect",
      "Aminoglycosides - additive ototoxicity",
      "Digoxin - hypokalemia increases toxicity risk",
    ],
    warnings: [
      "Replace potassium as needed",
      "Monitor for volume depletion in elderly",
    ],
  },

  // ============================================================================
  // Antibiotics
  // ============================================================================
  vancomycin: {
    contraindications: [],
    monitoring: [
      "Trough level before 4th dose (goal varies by indication)",
      "Renal function - nephrotoxic",
      "AUC-based dosing preferred in serious infections",
    ],
    interactions: [
      "Aminoglycosides - additive nephrotoxicity",
      "Other nephrotoxins",
    ],
    warnings: [
      "Red man syndrome - infuse over at least 1 hour",
      "Ototoxicity risk with prolonged use",
    ],
  },

  piperacillin: {
    contraindications: [
      "Penicillin allergy (anaphylaxis history)",
    ],
    monitoring: [
      "Signs of allergic reaction",
      "Renal function - adjust dose if CrCl < 40",
      "Liver function if prolonged use",
    ],
    interactions: [
      "Methotrexate - reduced clearance",
      "Aminoglycosides - physical incompatibility (separate lines)",
    ],
    warnings: [
      "Contains sodium - caution in heart failure",
      "May cause C. difficile-associated diarrhea",
    ],
  },

  // ============================================================================
  // GI Medications
  // ============================================================================
  pantoprazole: {
    contraindications: [],
    monitoring: [
      "Magnesium if prolonged use",
      "Vitamin B12 if prolonged use",
    ],
    interactions: [
      "Clopidogrel - may reduce antiplatelet effect (controversial)",
      "Methotrexate - increased levels",
    ],
    warnings: [
      "Increased risk of C. difficile infection",
      "Long-term use associated with fracture risk",
      "May mask symptoms of gastric malignancy",
    ],
  },
};

/**
 * Allergy-based contraindications.
 *
 * Maps allergy types to medications/classes that should be avoided
 * and safe alternatives.
 */
export const allergyContraindications: Record<
  string,
  { avoid: string[]; alternatives: string[]; crossReactivity: string }
> = {
  penicillin: {
    avoid: ["penicillins", "ampicillin", "amoxicillin", "piperacillin"],
    alternatives: ["azithromycin", "fluoroquinolones", "vancomycin"],
    crossReactivity: "1-2% cross-reactivity with cephalosporins; use with caution",
  },

  sulfa: {
    avoid: ["sulfamethoxazole", "trimethoprim-sulfamethoxazole", "sulfonylureas"],
    alternatives: ["alternative antibiotics based on indication"],
    crossReactivity: "Thiazide diuretics generally safe but monitor",
  },

  nsaid: {
    avoid: ["ibuprofen", "naproxen", "ketorolac", "aspirin > 81mg"],
    alternatives: ["acetaminophen for pain"],
    crossReactivity: "May cross-react with all COX inhibitors",
  },

  cephalosporin: {
    avoid: ["cephalosporins"],
    alternatives: ["azithromycin", "fluoroquinolones", "vancomycin"],
    crossReactivity: "1-2% cross-reactivity with penicillins",
  },

  ace_inhibitor: {
    avoid: ["lisinopril", "enalapril", "ramipril", "all ACE inhibitors"],
    alternatives: ["ARBs (angiotensin receptor blockers)"],
    crossReactivity: "Angioedema risk; ARBs have lower but non-zero cross-reactivity",
  },

  contrast: {
    avoid: [],
    alternatives: [],
    crossReactivity:
      "Shellfish allergy does NOT contraindicate iodinated contrast. Premedicate if prior contrast reaction.",
  },
};

/**
 * Get constraints for a medication.
 */
export function getDrugConstraints(drugName: string): DrugRule | null {
  const normalizedName = drugName.toLowerCase().split(" ")[0];
  return drugConstraints[normalizedName] || null;
}

/**
 * Get allergy contraindications.
 */
export function getAllergyInfo(
  allergyType: string
): (typeof allergyContraindications)[keyof typeof allergyContraindications] | null {
  return allergyContraindications[allergyType.toLowerCase()] || null;
}

/**
 * Check if a drug is contraindicated given a patient's allergies.
 */
export function isDrugContraindicated(
  drugName: string,
  allergies: string[]
): { contraindicated: boolean; reason: string | null } {
  const normalizedDrug = drugName.toLowerCase();

  for (const allergy of allergies) {
    const allergyInfo = allergyContraindications[allergy.toLowerCase()];
    if (!allergyInfo) continue;

    for (const avoid of allergyInfo.avoid) {
      if (normalizedDrug.includes(avoid.toLowerCase())) {
        return {
          contraindicated: true,
          reason: `${drugName} contraindicated due to ${allergy} allergy`,
        };
      }
    }
  }

  return { contraindicated: false, reason: null };
}
