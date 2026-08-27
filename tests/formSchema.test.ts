/*
 * Structured-form schema tests. Run with:  npm test
 * Guards the gate / consistency rules of the manual entry form so the app can
 * never submit contradictory molecular, spleen, or thrombosis states.
 */
import {
  applyChange, reconcile, engineVariables, isVisible, deriveTripleNegative, anyMolecularTestOpen,
  UI_DRIVER_TESTED, UI_KARYOTYPE_TESTED, type FormState,
} from '../src/components/tool/formSchema.ts'
import { EXAMPLES, FIELD_BY_KEY } from '../src/lib/engine.ts'
import { suite, test, eq, assert, report } from './harness.ts'

function exampleForm(k: keyof typeof EXAMPLES): FormState {
  const inp = EXAMPLES[k].inputs
  const f: FormState = {}
  Object.keys(inp).forEach((key) => {
    if (key === 'clinical_note' || key === 'pathology_report') return
    if (FIELD_BY_KEY[key]) f[key] = inp[key] as never
  })
  return f
}

// ============================================================ HMR panel gate
suite('HMR panel gate: mutations and "performed" can never disagree', () => {
  test('selecting a mutation while the panel is unknown marks the panel performed', () => {
    const f = applyChange({ hmr_tested: true }, 'hmr_mutations', ['ASXL1'])
    eq(f.hmr_tested, true)
    eq(JSON.stringify(f.hmr_mutations), JSON.stringify(['ASXL1']))
  })
  test('answering "no" to the panel clears any selected mutations', () => {
    const f = applyChange({ hmr_tested: true, hmr_mutations: ['ASXL1', 'EZH2'] }, 'hmr_tested', false)
    eq(f.hmr_tested, false)
    eq(f.hmr_mutations, undefined)
  })
  test('answering "unknown" to the panel clears mutations too', () => {
    const f = applyChange({ hmr_tested: true, hmr_mutations: ['SRSF2'] }, 'hmr_tested', undefined)
    eq(f.hmr_tested, undefined)
    eq(f.hmr_mutations, undefined)
  })
  test('seeded extraction with mutations but no panel flag derives panel = performed', () => {
    const f = reconcile({ hmr_mutations: ['ASXL1'] })
    eq(f.hmr_tested, true)
  })
  test('seeded contradiction (mutations + panel=no): concrete evidence wins', () => {
    const f = reconcile({ hmr_mutations: ['ASXL1'], hmr_tested: false })
    eq(f.hmr_tested, true, 'a listed mutation proves the panel was performed')
    eq(JSON.stringify(f.hmr_mutations), JSON.stringify(['ASXL1']))
  })
  test('panel performed with nothing selected stays HMR-negative (known), not unknown', () => {
    const f = applyChange({}, 'hmr_tested', true)
    eq(f.hmr_tested, true)
    eq(f.hmr_mutations, undefined)
    const v = engineVariables(f)
    eq(v.hmr_tested, true)
    assert(!('hmr_mutations' in v), 'no mutation list sent')
  })
})

// ============================================================ driver gate + triple negative
suite('Driver gate: triple negative is derived, never contradictory', () => {
  test('all three drivers negative derives triple negative = true', () => {
    let f = applyChange({}, UI_DRIVER_TESTED, true)
    f = applyChange(f, 'jak2_v617f', 'negative')
    f = applyChange(f, 'calr', 'negative')
    f = applyChange(f, 'mpl', 'negative')
    eq(f.triple_negative, true)
  })
  test('a positive driver derives triple negative = false', () => {
    let f = applyChange({}, UI_DRIVER_TESTED, true)
    f = applyChange(f, 'jak2_v617f', 'positive')
    eq(f.triple_negative, false)
  })
  test('an untested driver leaves triple negative unknown (never assumed negative)', () => {
    let f = applyChange({}, UI_DRIVER_TESTED, true)
    f = applyChange(f, 'jak2_v617f', 'negative')
    f = applyChange(f, 'calr', 'negative')
    eq(f.triple_negative, undefined)
  })
  test('seeded "triple negative" without individual results fills the three drivers as negative', () => {
    const f = reconcile({ triple_negative: true })
    eq(f.jak2_v617f, 'negative'); eq(f.calr, 'negative'); eq(f.mpl, 'negative')
    eq(f[UI_DRIVER_TESTED], true)
    eq(f.triple_negative, true)
  })
  test('seeded contradiction (triple negative + JAK2 positive): individual result wins', () => {
    const f = reconcile({ triple_negative: true, jak2_v617f: 'positive' })
    eq(f.triple_negative, false)
    eq(f.jak2_v617f, 'positive')
  })
  test('answering "no" to driver testing clears all driver results and triple negative', () => {
    let f = reconcile({ jak2_v617f: 'positive', calr: 'negative', bcr_abl1: 'negative' })
    eq(f[UI_DRIVER_TESTED], true)
    f = applyChange(f, UI_DRIVER_TESTED, false)
    eq(f.jak2_v617f, undefined); eq(f.calr, undefined); eq(f.bcr_abl1, undefined)
    eq(f.triple_negative, undefined)
  })
  test('deriveTripleNegative ignores exon 12 for the "all negative" definition but a positive exon 12 rules it out', () => {
    eq(deriveTripleNegative({ jak2_v617f: 'negative', calr: 'negative', mpl: 'negative' }), true)
    eq(deriveTripleNegative({ jak2_v617f: 'negative', calr: 'negative', mpl: 'negative', jak2_exon12: 'positive' }), false)
  })
})

// ============================================================ karyotype + clonal marker
suite('Cytogenetics gate and clonal marker', () => {
  test('karyotype values imply the test was performed; closing the gate clears them', () => {
    let f = reconcile({ karyotype_risk: 'unfavorable', karyotype_detail: 'del(20q)' })
    eq(f[UI_KARYOTYPE_TESTED], true)
    f = applyChange(f, UI_KARYOTYPE_TESTED, false)
    eq(f.karyotype_risk, undefined); eq(f.karyotype_detail, undefined)
  })
  test('closing the last open molecular test clears "other clonal marker"', () => {
    let f = applyChange({}, 'hmr_tested', true)
    f = applyChange(f, 'clonal_marker_present', true)
    assert(anyMolecularTestOpen(f), 'a test is open')
    f = applyChange(f, 'hmr_tested', false)
    eq(f.clonal_marker_present, undefined)
  })
  test('a seeded clonal marker with no gate open is preserved (not silently dropped)', () => {
    const f = reconcile({ clonal_marker_present: true })
    eq(f.clonal_marker_present, true)
  })
})

// ============================================================ demographics / labs dependencies
suite('Dependent clinical fields', () => {
  test('spleen size is hidden and cleared unless splenomegaly = yes', () => {
    eq(isVisible('spleen_cm', {}), false)
    eq(isVisible('spleen_cm', { splenomegaly: true }), true)
    const f = applyChange({ splenomegaly: true, spleen_cm: 6 }, 'splenomegaly', false)
    eq(f.spleen_cm, undefined)
  })
  test('a measured spleen > 0 cm implies splenomegaly on seeding', () => {
    const f = reconcile({ spleen_cm: 4 })
    eq(f.splenomegaly, true); eq(f.spleen_cm, 4)
  })
  test('thrombosis type is hidden and cleared unless prior thrombosis = yes', () => {
    eq(isVisible('thrombosis_type', {}), false)
    const f = applyChange({ prior_thrombosis: true, thrombosis_type: 'venous' }, 'prior_thrombosis', false)
    eq(f.thrombosis_type, undefined)
  })
  test('a documented thrombosis type implies prior thrombosis on seeding', () => {
    const f = reconcile({ thrombosis_type: 'arterial' })
    eq(f.prior_thrombosis, true)
  })
  test('LDH upper limit appears only once LDH is entered', () => {
    eq(isVisible('ldh_uln', {}), false)
    eq(isVisible('ldh_uln', { ldh: 420 }), true)
  })
})

// ============================================================ engine payload
suite('Engine payload', () => {
  test('UI-only gate keys and blanks never reach the engine', () => {
    const f = reconcile({ [UI_DRIVER_TESTED]: true, [UI_KARYOTYPE_TESTED]: false, jak2_v617f: 'positive', age: undefined, hmr_mutations: [] })
    const v = engineVariables(f)
    assert(!(UI_DRIVER_TESTED in v) && !(UI_KARYOTYPE_TESTED in v), 'ui keys stripped')
    assert(!('age' in v) && !('hmr_mutations' in v), 'blanks stripped')
    eq(v.jak2_v617f, 'positive')
  })
  test('reconcile is idempotent on every synthetic example', () => {
    (Object.keys(EXAMPLES) as (keyof typeof EXAMPLES)[]).forEach((k) => {
      const once = reconcile(exampleForm(k))
      const twice = reconcile(once)
      eq(JSON.stringify(twice), JSON.stringify(once), 'example ' + k)
    })
  })
  test('the MF example (HMR mutation listed, no panel flag) seeds a consistent panel state', () => {
    const f = reconcile(exampleForm('mf'))
    eq(f.hmr_tested, true)
  })
})

report()
