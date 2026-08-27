/*
 * Clinical-engine test suite. Run with:  npm test
 * Covers the diagnostic + prognostic + extraction behaviours required for the
 * three-disease MPN workflow (PV, ET, overt MF): confirmation, suspicion,
 * missing-data handling, reactive mimics, non-MPN, gated prognosis, provenance.
 */
import {
  diagnose, prognose, classify, normalizeExtraction, mergeSources,
  EXAMPLES, FIELD_BY_KEY, DISEASE_NAME,
  type Variables, type Diagnosis, type DiseaseCode, type Extraction,
} from '../src/lib/engine.ts'
import { suite, test, eq, assert, includes, excludes, report } from './harness.ts'

// ---- helpers ---------------------------------------------------------------
function exampleVars(k: keyof typeof EXAMPLES): Variables {
  const inp = EXAMPLES[k].inputs
  const v: Variables = {}
  Object.keys(inp).forEach((key) => {
    if (key === 'clinical_note' || key === 'pathology_report') return
    if (FIELD_BY_KEY[key]) v[key] = inp[key] as never
  })
  return v
}
function get(dx: Diagnosis, d: DiseaseCode) {
  const a = dx.assessments.find((x) => x.disease === d)
  if (!a) throw new Error('no assessment for ' + d)
  return a
}
function crit(dx: Diagnosis, d: DiseaseCode, needle: string) {
  const c = get(dx, d).criteria.find((x) => x.label.toLowerCase().includes(needle.toLowerCase()))
  if (!c) throw new Error('no ' + d + ' criterion matching "' + needle + '"')
  return c
}
const EMPTY: Extraction = { variables: {}, sources: {}, fields: {}, needsReview: [], rationale: '', impression: '' }

// ============================================================ Confirmed cases
suite('Confirmed diagnoses (all criteria fulfilled)', () => {
  test('Confirmed PV — erythrocytosis + JAK2 + PV marrow', () => {
    const dx = diagnose(exampleVars('pv'))
    eq(dx.outcome, 'confirmed')
    eq(get(dx, 'PV').verdict, 'confirmed')
    includes(dx.confirmed, 'PV')
    // competitors suppressed
    eq(get(dx, 'ET').verdict, 'not')
    eq(get(dx, 'MF').verdict, 'not')
  })

  test('Confirmed ET — thrombocytosis + ET marrow + driver + reactive excluded', () => {
    const dx = diagnose(exampleVars('et'))
    eq(dx.outcome, 'confirmed')
    eq(get(dx, 'ET').verdict, 'confirmed')
  })

  test('Confirmed overt MF — atypical megs + fibrosis ≥2 + driver + minors', () => {
    const dx = diagnose(exampleVars('mf'))
    eq(dx.outcome, 'confirmed')
    eq(get(dx, 'MF').verdict, 'confirmed')
    eq(crit(dx, 'MF', 'fibrosis grade 2').status, 'met')
  })

  test('overt MF is NOT confirmed when fibrosis grade is below 2 (prefibrotic excluded)', () => {
    const v = { ...exampleVars('mf'), reticulin_fibrosis_grade: '1' }
    const dx = diagnose(v)
    assert(get(dx, 'MF').verdict !== 'confirmed', 'grade-1 fibrosis must not confirm overt MF')
    eq(crit(dx, 'MF', 'fibrosis grade 2').status, 'not_met')
  })
})

// ============================================================ Suspicious cases
suite('Suspicious cases (partial criteria, gaps unavailable not negative)', () => {
  test('Suspicious PV — erythrocytosis + JAK2 but marrow & EPO not performed', () => {
    const v: Variables = { sex: 'male', hemoglobin: 17.4, jak2_v617f: 'positive' }
    const dx = diagnose(v)
    eq(dx.outcome, 'suspicious')
    eq(get(dx, 'PV').verdict, 'suspicious')
    // the gaps are UNAVAILABLE, never not_met
    eq(crit(dx, 'PV', 'panmyelosis').status, 'unavailable')
    eq(crit(dx, 'PV', 'erythropoietin').status, 'unavailable')
    assert(get(dx, 'PV').outstanding.length > 0, 'must list outstanding investigations')
  })

  test('Suspicious ET — thrombocytosis + driver but no marrow', () => {
    const v: Variables = { platelets: 720, jak2_v617f: 'positive', bcr_abl1: 'negative' }
    const dx = diagnose(v)
    eq(dx.outcome, 'suspicious')
    eq(get(dx, 'ET').verdict, 'suspicious')
    eq(crit(dx, 'ET', 'megakaryocytes').status, 'unavailable')
  })

  test('Suspicious overt MF — atypical megs + driver but fibrosis not graded', () => {
    const v: Variables = {
      megakaryocyte_pattern: 'atypical_clustered', jak2_v617f: 'positive',
      splenomegaly: true, hemoglobin: 9.5, sex: 'male', bcr_abl1: 'negative',
    }
    const dx = diagnose(v)
    eq(dx.outcome, 'suspicious')
    eq(get(dx, 'MF').verdict, 'suspicious')
    eq(crit(dx, 'MF', 'fibrosis grade 2').status, 'unavailable')
  })

  test('label states diagnosis not confirmed', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 17.4, jak2_v617f: 'positive' })
    assert(get(dx, 'PV').label.toLowerCase().includes('not confirmed'), 'suspicious label must say "not confirmed"')
  })
})

// ============================================================ Missing investigations
suite('Missing required investigations (missing != negative)', () => {
  test('erythrocytosis + JAK2, marrow/EPO not done → suspicious PV, criteria unavailable not negative', () => {
    const v: Variables = { sex: 'male', hemoglobin: 18.0, hematocrit: 54, jak2_v617f: 'positive' }
    const dx = diagnose(v)
    eq(get(dx, 'PV').verdict, 'suspicious')
    // marrow & EPO absent -> unavailable, NOT not_met
    eq(crit(dx, 'PV', 'panmyelosis').status, 'unavailable')
    excludes([crit(dx, 'PV', 'panmyelosis').status], 'not_met')
  })

  test('a pending JAK2 does not become a negative major criterion', () => {
    // pending molecular must be omitted from variables entirely
    const ext = normalizeExtraction({
      variables: { jak2_v617f: 'not performed', hemoglobin: 18.5 },
      fields: { jak2_v617f: { status: 'not_performed' }, hemoglobin: { status: 'positive', snippet: '' } },
    })
    assert(ext.variables.jak2_v617f === undefined, 'pending JAK2 must not enter variables')
    const dx = diagnose(ext.variables)
    eq(crit(dx, 'PV', 'JAK2').status, 'unavailable')
  })
})

// ============================================================ Overlap
suite('Overlapping MPN features → each applicable suspicion shown', () => {
  test('JAK2+ with erythrocytosis AND thrombocytosis, no marrow → suspicious for PV and ET', () => {
    const v: Variables = { sex: 'male', hemoglobin: 17.2, platelets: 620, jak2_v617f: 'positive', bcr_abl1: 'negative' }
    const dx = diagnose(v)
    eq(dx.outcome, 'suspicious')
    includes(dx.suspicious, 'PV')
    includes(dx.suspicious, 'ET')
  })

  test('a confirmed disease suppresses suspicion for the others', () => {
    const dx = diagnose(exampleVars('pv'))
    eq(get(dx, 'ET').verdict, 'not')
    eq(get(dx, 'MF').verdict, 'not')
  })
})

// ============================================================ Reactive mimics
suite('Reactive / secondary mimics → No confirmed MPN', () => {
  test('Reactive (secondary) erythrocytosis — high Hb but JAK2 negative, EPO high', () => {
    const v: Variables = { sex: 'male', hemoglobin: 19.2, hematocrit: 56, jak2_v617f: 'negative', jak2_exon12: 'negative', epo: 'high' }
    const dx = diagnose(v)
    eq(dx.outcome, 'none')
    eq(get(dx, 'PV').verdict, 'not')
    eq(crit(dx, 'PV', 'JAK2').status, 'not_met')
  })

  test('Reactive thrombocytosis — platelets high, drivers negative, reactive cause present', () => {
    const v: Variables = {
      platelets: 640, jak2_v617f: 'negative', jak2_exon12: 'negative', calr: 'negative', mpl: 'negative',
      bcr_abl1: 'negative', reactive_thrombocytosis_excluded: false, megakaryocyte_pattern: 'large_mature', reticulin_fibrosis_grade: '0',
    }
    const dx = diagnose(v)
    eq(dx.outcome, 'none')
    eq(get(dx, 'ET').verdict, 'not')
  })

  test('Secondary / non-MPN marrow fibrosis — fibrosis but reactive cause, drivers negative', () => {
    const v: Variables = {
      megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '2',
      jak2_v617f: 'negative', jak2_exon12: 'negative', calr: 'negative', mpl: 'negative',
      bcr_abl1: 'negative', reactive_cause_excluded: false, hemoglobin: 10.5, sex: 'male',
    }
    const dx = diagnose(v)
    eq(get(dx, 'MF').verdict, 'not')
    eq(crit(dx, 'MF', 'clonal marker').status, 'not_met')
    eq(dx.outcome, 'none')
  })

  test('Plain non-MPN case — normal counts, no mutations', () => {
    const v: Variables = { sex: 'female', hemoglobin: 13.6, platelets: 260, wbc: 6.8, jak2_v617f: 'negative', calr: 'negative', mpl: 'negative' }
    const dx = diagnose(v)
    eq(dx.outcome, 'none')
    eq(dx.headline, 'No confirmed MPN')
  })
})

// ============================================================ Prognosis gating
suite('Prognosis — gated on confirmation, no imputation', () => {
  test('no prognosis for suspicious cases', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 17.4, jak2_v617f: 'positive' })
    const p = prognose(dx, { sex: 'male', hemoglobin: 17.4, jak2_v617f: 'positive' })
    eq(p.gatedReason, 'suspicious')
    eq(p.order.length, 0)
    eq(p.primaryKey, null)
  })

  test('no prognosis for No-confirmed-MPN', () => {
    const v: Variables = { sex: 'female', hemoglobin: 13.6, platelets: 260, jak2_v617f: 'negative' }
    const dx = diagnose(v)
    const p = prognose(dx, v)
    eq(p.gatedReason, 'none')
    eq(p.order.length, 0)
  })

  test('confirmed PV runs ONLY the PV model', () => {
    const v = exampleVars('pv')
    const p = prognose(diagnose(v), v)
    eq(p.diseaseConfirmed, 'PV')
    eq(p.primaryKey, 'pv_conv')
    assert(!p.tools.dipss && !p.tools.ipset_t, 'must not run ET/MF models for PV')
  })

  test('confirmed diagnosis with incomplete prognostic variables → category not established', () => {
    // Confirmed PV via markedly-elevated counts + JAK2 + low EPO, but age and
    // thrombosis history unknown → conventional risk cannot be assigned.
    const v: Variables = {
      sex: 'male', hemoglobin: 19.6, hematocrit: 58, jak2_v617f: 'positive', epo: 'low', bcr_abl1: 'negative',
    }
    const dx = diagnose(v)
    eq(get(dx, 'PV').verdict, 'confirmed')
    const p = prognose(dx, v)
    eq(p.tools.pv_conv.status, 'not_established')
    eq(p.tools.pv_conv.category, null)
    assert(p.tools.pv_conv.requiredMissing.length > 0, 'must list required missing variables')
  })

  test('confirmed MF: molecular models not established when karyotype/molecular missing', () => {
    const v: Variables = {
      age: 70, sex: 'male', hemoglobin: 9.2, wbc: 24, platelets: 180, peripheral_blasts: 1, constitutional_symptoms: true,
      megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '2', jak2_v617f: 'positive',
      splenomegaly: true, bcr_abl1: 'negative',
    }
    const dx = diagnose(v)
    eq(get(dx, 'MF').verdict, 'confirmed')
    const p = prognose(dx, v)
    // DIPSS uses only clinical variables (all present) → established
    eq(p.tools.dipss.status, 'established')
    // MIPSS70+ v2 needs karyotype → not established, no imputed category
    eq(p.tools.mipss70v2.status, 'not_established')
    eq(p.tools.mipss70v2.category, null)
    includes(p.tools.mipss70v2.requiredMissing, FIELD_BY_KEY['karyotype_risk'].label)
  })

  test('ET IPSET-thrombosis high risk from a single known positive (prior thrombosis)', () => {
    const v = { ...exampleVars('et'), prior_thrombosis: true }
    const p = prognose(diagnose(v), v)
    eq(p.tools.ipset_t.status, 'established')
    eq(p.tools.ipset_t.tier, 'high')
  })

  test('ET IPSET-thrombosis not established when JAK2 unknown and no positive tier reached', () => {
    const v: Variables = {
      age: 50, platelets: 700, megakaryocyte_pattern: 'large_mature', reticulin_fibrosis_grade: '0',
      calr: 'type1', bcr_abl1: 'negative', prior_thrombosis: false, reactive_cause_excluded: true,
    }
    const dx = diagnose(v)
    eq(get(dx, 'ET').verdict, 'confirmed')
    const p = prognose(dx, v)
    eq(p.tools.ipset_t.status, 'not_established') // JAK2 status unknown, cannot resolve low vs very-low
    includes(p.tools.ipset_t.requiredMissing, FIELD_BY_KEY['jak2_v617f'].label)
  })
})

// ============================================================ Extraction / provenance
suite('Extraction — status semantics, provenance, no-fabrication', () => {
  test('absence tokens on a boolean do NOT become false', () => {
    const ext = normalizeExtraction({ variables: { splenomegaly: 'NA', panmyelosis: 'not performed' } })
    assert(ext.variables.splenomegaly === undefined, 'NA splenomegaly must be omitted, not false')
    assert(ext.variables.panmyelosis === undefined, 'not-performed panmyelosis must be omitted')
  })

  test('non-option enum value is treated as unavailable', () => {
    const ext = normalizeExtraction({ variables: { jak2_v617f: 'pending' } })
    assert(ext.variables.jak2_v617f === undefined, 'pending enum must not enter variables')
    includes(ext.needsReview, 'jak2_v617f')
  })

  test('documented findings populate variables with provenance snippet', () => {
    const src = 'JAK2 V617F mutation detected. Hemoglobin 18.9 g/dL.'
    const ext = normalizeExtraction({
      variables: { jak2_v617f: 'positive', hemoglobin: 18.9 },
      fields: {
        jak2_v617f: { status: 'positive', snippet: 'JAK2 V617F mutation detected', sourceTag: 'pathology' },
        hemoglobin: { status: 'positive', snippet: 'Hemoglobin 18.9 g/dL', unit: 'g/dL' },
      },
    }, src)
    eq(ext.variables.jak2_v617f, 'positive')
    eq(ext.variables.hemoglobin, 18.9)
    eq(ext.fields.jak2_v617f.snippet, 'JAK2 V617F mutation detected')
    eq(ext.fields.jak2_v617f.sourceTag, 'pathology')
  })

  test('ungrounded snippet (not in source) is distrusted and left for review', () => {
    const src = 'Unremarkable marrow.'
    const ext = normalizeExtraction({
      variables: { jak2_v617f: 'positive' },
      fields: { jak2_v617f: { status: 'positive', snippet: 'JAK2 V617F detected in blood' } },
    }, src)
    assert(ext.variables.jak2_v617f === undefined, 'ungrounded value must be withheld from variables')
    includes(ext.needsReview, 'jak2_v617f')
  })
})

// ============================================================ Conflict resolution
suite('Conflicting findings across documents / sources', () => {
  test('manually-entered structured value overrides extracted one (source priority)', () => {
    const extracted: Extraction = {
      ...EMPTY,
      variables: { jak2_v617f: 'negative' },
      sources: { jak2_v617f: 'note' },
    }
    const merged = mergeSources({ jak2_v617f: 'positive' }, extracted)
    eq(merged.variables.jak2_v617f, 'positive')
    eq(merged.sources.jak2_v617f, 'structured')
  })

  test('end-to-end classify(): structured erythrocytosis + extracted JAK2 → confirmed PV path', () => {
    const extracted: Extraction = {
      ...EMPTY,
      variables: { jak2_v617f: 'positive', megakaryocyte_pattern: 'pleomorphic', epo: 'low' },
      sources: { jak2_v617f: 'pathology', megakaryocyte_pattern: 'pathology', epo: 'note' },
    }
    const structured: Variables = { sex: 'male', hemoglobin: 19.1, hematocrit: 57, age: 66 }
    const r = classify(structured, extracted)
    eq(r.diagnosis.outcome, 'confirmed')
    eq(r.merged.sources.hemoglobin, 'structured')
    eq(r.merged.sources.jak2_v617f, 'pathology')
  })
})

// ============================================================ Meta
// ============================================================ Verification regressions
suite('Marrow-waiver & documented-contradiction guards (PV)', () => {
  test('PV marrow-waiver does NOT confirm over a marrow diagnostic of MF', () => {
    const v: Variables = {
      sex: 'male', hemoglobin: 19.0, hematocrit: 57, jak2_v617f: 'positive', epo: 'low',
      megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '3', bcr_abl1: 'negative',
      wbc: 13, splenomegaly: true,
    }
    const dx = diagnose(v)
    excludes(dx.confirmed, 'PV') // pathway B must not fire over a not_met marrow
    includes(dx.confirmed, 'MF')
    assert(dx.caveats.some((c) => /erythrocytosis/i.test(c)), 'overlap caveat expected')
  })

  test('PV suspicious does NOT fire on a documented non-PV marrow (normal megs)', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 17.4, jak2_v617f: 'positive', megakaryocyte_pattern: 'normal' })
    assert(get(dx, 'PV').verdict !== 'suspicious', 'documented non-PV marrow must block PV suspicion')
    eq(crit(dx, 'PV', 'panmyelosis').status, 'not_met')
  })

  test('PV via JAK2 exon 12 (V617F negative)', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 19.0, hematocrit: 57, jak2_v617f: 'negative', jak2_exon12: 'positive', epo: 'low', megakaryocyte_pattern: 'pleomorphic', panmyelosis: true, bcr_abl1: 'negative' })
    eq(get(dx, 'PV').verdict, 'confirmed')
  })

  test('sex-unknown erythrocytosis in ambiguous band → unavailable, not negative', () => {
    const dx = diagnose({ hemoglobin: 16.3 })
    eq(crit(dx, 'PV', 'erythrocytosis').status, 'unavailable')
  })

  test('erythrocytosis threshold is strict (Hb 16.5 male = not met)', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 16.5 })
    eq(crit(dx, 'PV', 'erythrocytosis').status, 'not_met')
    eq(get(dx, 'PV').verdict, 'not')
  })
})

suite('Blast-phase guards (all three diseases)', () => {
  test('ET with ≥20% blasts is hard-excluded, not confirmed', () => {
    const dx = diagnose({ platelets: 800, jak2_v617f: 'positive', megakaryocyte_pattern: 'large_mature', reticulin_fibrosis_grade: '0', bcr_abl1: 'negative', reactive_cause_excluded: true, peripheral_blasts: 25 })
    eq(get(dx, 'ET').verdict, 'not')
    assert(dx.outcome !== 'confirmed', 'blast phase must not confirm ET')
  })
  test('PV with ≥20% blasts is hard-excluded, not confirmed', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 19.0, hematocrit: 57, jak2_v617f: 'positive', epo: 'low', megakaryocyte_pattern: 'pleomorphic', panmyelosis: true, peripheral_blasts: 25, bcr_abl1: 'negative' })
    eq(get(dx, 'PV').verdict, 'not')
  })
  test('overt MF with ≥20% blasts is hard-excluded', () => {
    const v = { ...exampleVars('mf'), peripheral_blasts: 22 }
    const dx = diagnose(v)
    eq(get(dx, 'MF').verdict, 'not')
    const p = prognose(dx, v)
    eq(p.order.length, 0)
  })
})

suite('Non-JAK2 ET drivers & triple-negative MF', () => {
  test('CALR type-1 confirmed ET (JAK2 negative)', () => {
    const dx = diagnose({ age: 50, sex: 'female', platelets: 700, megakaryocyte_pattern: 'large_mature', reticulin_fibrosis_grade: '0', jak2_v617f: 'negative', calr: 'type1', mpl: 'negative', bcr_abl1: 'negative', reactive_cause_excluded: true })
    eq(get(dx, 'ET').verdict, 'confirmed')
  })
  test('MPL-positive confirmed ET', () => {
    const dx = diagnose({ age: 55, sex: 'male', platelets: 620, megakaryocyte_pattern: 'large_mature', reticulin_fibrosis_grade: '1', jak2_v617f: 'negative', calr: 'negative', mpl: 'positive', bcr_abl1: 'negative', reactive_cause_excluded: true })
    eq(get(dx, 'ET').verdict, 'confirmed')
  })
  test('triple-negative overt MF via reactive-fibrosis-excluded arm', () => {
    const dx = diagnose({ megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '3', jak2_v617f: 'negative', jak2_exon12: 'negative', calr: 'negative', mpl: 'negative', reactive_cause_excluded: true, hemoglobin: 10, sex: 'male', wbc: 12, splenomegaly: true, bcr_abl1: 'negative' })
    eq(get(dx, 'MF').verdict, 'confirmed')
  })
  test('prefibrotic (grade 1) is hard-excluded from overt MF, not suspicious', () => {
    const dx = diagnose({ megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '1', jak2_v617f: 'positive', splenomegaly: true, hemoglobin: 10, wbc: 12, sex: 'male', bcr_abl1: 'negative' })
    eq(get(dx, 'MF').verdict, 'not')
  })
  test('driver + single minor with no marrow does NOT raise overt-MF suspicion', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 17.2, platelets: 620, jak2_v617f: 'positive', splenomegaly: true, bcr_abl1: 'negative' })
    eq(get(dx, 'MF').verdict, 'not')
  })
})

suite('MF prognosis — no HMR imputation, established happy-path', () => {
  const confirmedMFbase: Variables = {
    age: 70, sex: 'male', hemoglobin: 9.2, wbc: 24, platelets: 180, peripheral_blasts: 1, constitutional_symptoms: true,
    megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '2', jak2_v617f: 'positive',
    calr: 'negative', mpl: 'negative', splenomegaly: true, bcr_abl1: 'negative', karyotype_risk: 'unfavorable',
  }
  test('drivers tested but HMR panel not performed → MIPSS70 / MIPSS70+ v2 not established', () => {
    const dx = diagnose(confirmedMFbase)
    eq(get(dx, 'MF').verdict, 'confirmed')
    const p = prognose(dx, confirmedMFbase)
    eq(p.tools.mipss70.status, 'not_established')
    eq(p.tools.mipss70v2.status, 'not_established')
    includes(p.tools.mipss70.requiredMissing, FIELD_BY_KEY['hmr_mutations'].label)
    eq(p.tools.dipss.status, 'established') // clinical-only model still computable
  })
  test('explicit HMR/NGS panel performed → molecular models established (sequenced-negative)', () => {
    const v = { ...confirmedMFbase, hmr_tested: true, transfusion_dependent: true }
    const p = prognose(diagnose(v), v)
    eq(p.tools.mipss70.status, 'established')
    assert(p.tools.mipss70.category !== null, 'category must be assigned once sequenced')
    eq(p.tools.mipss70v2.status, 'established')
  })
  test('DIPSS+ isolation: established DIPSS but DIPSS+ not established without karyotype/plt/transfusion', () => {
    const v: Variables = { age: 70, sex: 'male', hemoglobin: 9.2, wbc: 24, peripheral_blasts: 1, constitutional_symptoms: true, megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '2', jak2_v617f: 'positive', splenomegaly: true, bcr_abl1: 'negative' }
    const p = prognose(diagnose(v), v)
    eq(p.tools.dipss.status, 'established')
    eq(p.tools.dipss_plus.status, 'not_established')
  })
  test('full MF example → MIPSS70+ v2 established Very high risk', () => {
    const v = exampleVars('mf')
    const p = prognose(diagnose(v), v)
    eq(p.tools.mipss70v2.status, 'established')
    eq(p.tools.mipss70v2.category, 'Very high risk')
    eq(p.primaryKey, 'mipss70v2')
  })
})

suite('mergeSources sanitation via exported API', () => {
  test('structured absence token / invalid enum never becomes a negative', () => {
    const m = mergeSources({ jak2_v617f: 'unknown' }, EMPTY)
    assert(m.variables.jak2_v617f === undefined, 'unknown must not enter variables')
    const dx = diagnose(m.variables)
    eq(crit(dx, 'PV', 'JAK2').status, 'unavailable')
  })
  test('structured stringized boolean is parsed, not coerced true', () => {
    const m = mergeSources({ prior_thrombosis: 'no' }, EMPTY)
    eq(m.variables.prior_thrombosis, false)
  })
})

suite('normalizeExtraction — documented negatives are retained', () => {
  test('a grounded negative enters variables and excludes the disease', () => {
    const ext = normalizeExtraction({ variables: { jak2_v617f: 'negative' }, fields: { jak2_v617f: { status: 'negative' } } })
    eq(ext.variables.jak2_v617f, 'negative')
    const dx = diagnose(ext.variables)
    eq(crit(dx, 'PV', 'JAK2').status, 'not_met')
  })
})

suite('Prognosis conflict guard', () => {
  test('gatedReason=conflict when >1 disease confirmed', () => {
    const fake: Diagnosis = {
      outcome: 'confirmed', code: 'PV', headline: '', whoEdition: 'WHO 2016 / 2022', summary: '',
      assessments: [], confirmed: ['PV', 'ET'], suspicious: [], caveats: [], conflict: true,
    }
    const p = prognose(fake, {})
    eq(p.gatedReason, 'conflict')
    eq(p.order.length, 0)
  })
})

suite('Diagnosis object integrity', () => {
  test('always reports all three diseases independently', () => {
    const dx = diagnose({})
    eq(dx.assessments.length, 3)
    eq(dx.assessments.map((a) => a.disease).join(','), 'PV,ET,MF')
  })
  test('empty input → No confirmed MPN, no crash', () => {
    const dx = diagnose({})
    eq(dx.outcome, 'none')
  })
  test('disease names are the three in scope only', () => {
    eq(DISEASE_NAME.MF, 'Overt myelofibrosis')
  })
})

// ============================================================ Audit regressions
suite('Audit regressions: exclusions, guards, extraction consistency', () => {
  test('BCR-ABL1 positive excludes PV even with a full PV profile', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 19, jak2_v617f: 'positive', megakaryocyte_pattern: 'pleomorphic', epo: 'low', bcr_abl1: 'positive' })
    eq(get(dx, 'PV').verdict, 'not')
    eq(dx.outcome, 'none')
    assert(dx.caveats.some((c) => c.includes('BCR-ABL1')), 'CML caveat present')
  })
  test('a non-positive LDH upper limit falls back to 250 and is labelled assumed', () => {
    const base: Variables = { megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '3', jak2_v617f: 'positive', bcr_abl1: 'negative', ldh: 180 }
    const neg = crit(diagnose({ ...base, ldh_uln: -250 }), 'MF', 'LDH')
    eq(neg.status, 'not_met', 'LDH 180 is not above 250')
    assert(neg.detail.includes('assumed'), 'detail says the ULN was assumed')
    const given = crit(diagnose({ ...base, ldh_uln: 150 }), 'MF', 'LDH')
    eq(given.status, 'met')
    assert(!given.detail.includes('assumed'), 'a supplied ULN is not labelled assumed')
  })
  test('driverLabel never says triple-negative next to a positive driver', () => {
    const dx = diagnose({ platelets: 600, megakaryocyte_pattern: 'large_mature', reticulin_fibrosis_grade: '0', jak2_v617f: 'positive', triple_negative: true, bcr_abl1: 'negative' })
    const d = crit(dx, 'ET', 'JAK2, CALR').detail
    assert(!d.includes('triple'), 'got: ' + d)
  })
  test('ET minor reads reactive THROMBOCYTOSIS exclusion, not the MF fibrosis field', () => {
    const base: Variables = { platelets: 640, jak2_v617f: 'negative', jak2_exon12: 'negative', calr: 'negative', mpl: 'negative', bcr_abl1: 'negative', megakaryocyte_pattern: 'large_mature', reticulin_fibrosis_grade: '0' }
    eq(crit(diagnose({ ...base, reactive_cause_excluded: true }), 'ET', 'Clonal marker').status, 'unavailable', 'fibrosis exclusion alone does not satisfy the ET minor')
    eq(crit(diagnose({ ...base, reactive_thrombocytosis_excluded: true }), 'ET', 'Clonal marker').status, 'met')
  })
  test('an explicitly negative HMR panel (empty list, status negative) sets hmr_tested', () => {
    const ext = normalizeExtraction({ variables: { hmr_mutations: [] }, fields: { hmr_mutations: { value: [], status: 'negative', snippet: 'no ASXL1, EZH2, SRSF2, IDH1, IDH2 or U2AF1 mutations detected', sourceTag: 'note' } } },
      'NGS panel: no ASXL1, EZH2, SRSF2, IDH1, IDH2 or U2AF1 mutations detected.')
    eq(ext.variables.hmr_tested, true)
    assert(!('hmr_mutations' in ext.variables), 'no mutation list')
  })
  test('unlisted genes are dropped from hmr_mutations and flagged for review; aliases normalise', () => {
    const ext = normalizeExtraction({ variables: { hmr_mutations: ['TET2', 'ASXL1', 'u2af1 q157'] } }, 'TET2, ASXL1 and U2AF1 Q157 mutations identified.')
    eq(JSON.stringify(ext.variables.hmr_mutations), JSON.stringify(['ASXL1', 'U2AF1Q157']))
    includes(ext.needsReview, 'hmr_mutations')
  })
  test('the model cannot claim a "structured" source', () => {
    const ext = normalizeExtraction({ variables: { ldh: 450 }, sources: { ldh: 'structured' } }, 'LDH 450')
    eq(ext.sources.ldh, 'note')
  })
  test('extracted contradictions are resolved toward the concrete result and flagged', () => {
    const ext = normalizeExtraction({ variables: { triple_negative: true, jak2_v617f: 'positive', hmr_tested: false, hmr_mutations: ['ASXL1'], splenomegaly: false, spleen_cm: 6, prior_thrombosis: false, thrombosis_type: 'venous' } }, 'x')
    assert(!('triple_negative' in ext.variables), 'triple_negative dropped'); eq(ext.variables.jak2_v617f, 'positive')
    assert(!('hmr_tested' in ext.variables), 'hmr_tested=false dropped'); eq(JSON.stringify(ext.variables.hmr_mutations), JSON.stringify(['ASXL1']))
    assert(!('splenomegaly' in ext.variables), 'splenomegaly=false dropped'); eq(ext.variables.spleen_cm, 6)
    assert(!('prior_thrombosis' in ext.variables), 'prior_thrombosis=false dropped'); eq(ext.variables.thrombosis_type, 'venous')
    ;['triple_negative', 'hmr_tested', 'splenomegaly', 'prior_thrombosis'].forEach((k) => includes(ext.needsReview, k))
  })
  test('discordant Hb / Hct raises a caveat; a not-palpable spleen with a measured size is a conflict', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 17, hematocrit: 32 })
    assert(dx.caveats.some((c) => c.includes('inconsistent with each other')), 'Hb/Hct caveat')
    const mf = diagnose({ splenomegaly: false, spleen_cm: 6, reticulin_fibrosis_grade: '2', megakaryocyte_pattern: 'atypical_clustered', jak2_v617f: 'positive', bcr_abl1: 'negative' })
    eq(crit(mf, 'MF', 'splenomegaly').status, 'unavailable', 'conflict is not scored as met')
    assert(mf.caveats.some((c) => c.includes('not palpable')), 'spleen conflict caveat')
  })
  test('caveats: normal red cell mass / high EPO with a PV profile; transfusion dependence with normal Hb', () => {
    const dx = diagnose({ sex: 'male', hemoglobin: 19, jak2_v617f: 'positive', megakaryocyte_pattern: 'pleomorphic', red_cell_mass: 'normal', epo: 'high' })
    assert(dx.caveats.some((c) => c.includes('argues against polycythemia vera')), 'RCM/EPO caveat')
    const dx2 = diagnose({ transfusion_dependent: true, hemoglobin: 15 })
    assert(dx2.caveats.some((c) => c.includes('Transfusion dependence')), 'transfusion caveat')
  })
})

report()
