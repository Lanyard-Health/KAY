// Dropdown options for the practice intake forms. Each select also offers an
// "Other" choice that reveals a free-text input, so these lists never block an
// unlisted value. Sourced from 2025/2026 market research (see the plan), and
// safe to edit/extend here without touching form logic.

export const OTHER_OPTION = 'Other';

export const ENTITY_TYPES = [
  'Sole Proprietorship',
  'Partnership',
  'Professional Corporation (PC)',
  'Professional LLC (PLLC)',
  'Limited Liability Company (LLC)',
  'S Corporation',
  'C Corporation',
  'Non-Profit',
] as const;

// Grouped so the <select> can render <optgroup>s.
export const EMR_VENDOR_GROUPS: { label: string; options: string[] }[] = [
  {
    label: 'Primary care / general',
    options: [
      'Epic', 'eClinicalWorks', 'athenahealth', 'NextGen Healthcare', 'Elation Health',
      'Tebra (formerly Kareo)', 'Practice Fusion', 'DrChrono', 'AdvancedMD', 'Greenway Health',
      'CharmHealth', 'OptiMantra', 'Oracle Health (Cerner)', 'MEDITECH', 'Praxis EMR',
    ],
  },
  {
    label: 'Behavioral health',
    options: [
      'SimplePractice', 'Ensora Health (formerly TheraNest)', 'TherapyNotes', 'Valant', 'ICANotes',
      'Kipu Health', 'Qualifacts (CareLogic)', 'Sunwave Health', 'Alleva', 'Procentive',
    ],
  },
];

export const BILLING_VENDORS = [
  'We bill in-house', 'Local or independent billing company', 'Optum', 'R1 RCM', 'Access Healthcare',
  'CureMD', 'Tebra', 'athenahealth (athenaCollector)', 'AdvancedMD', 'CareCloud',
  'eClinicalWorks RCM', 'Conifer Health Solutions',
] as const;

export const CLEARINGHOUSES = [
  'Availity', 'Waystar', 'Change Healthcare (Optum)', 'TriZetto Provider Solutions (Cognizant)',
  'Office Ally', 'Claim.MD', 'Apex EDI', 'Inovalon',
] as const;

// Flattened EMR list for "is this value one of the known options?" checks.
export const EMR_VENDOR_FLAT: string[] = EMR_VENDOR_GROUPS.flatMap((g) => g.options);
