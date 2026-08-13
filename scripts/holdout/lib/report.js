'use strict';

/**
 * Markdown rendering of an `evaluate()` result. Pure function of the result
 * object: identical input, identical bytes. Every §8 number appears; nothing
 * here recomputes anything.
 */

const round = (v, places = 4) => (v === null || v === undefined ? '-' : Number(v).toFixed(places));

function renderComponent(c) {
  if (c.method === 'exact-sign-test') {
    return `| ${c.label} | exact sign test (${c.triggerReason}) | n=${c.exact.n} favorable=${c.exact.favorable} p=${round(c.exact.p, 6)} vs boundary ${c.boundary} | ${c.passes ? 'PASS' : 'FAIL'} |`;
  }
  return `| ${c.label} | bootstrap q${c.quantile} | bound ${round(c.bound)} vs boundary ${c.boundary} (mean ${round(c.mean)}, n=${c.n}) | ${c.passes ? 'PASS' : 'FAIL'} |`;
}

function renderReport(result) {
  const lines = [];
  lines.push(`# ${result.studyId} - evaluation report`);
  lines.push('');
  lines.push(`Season ${result.season}. Weeks: ${result.weeks.provided} captured, ${result.weeks.surviving} surviving.`);
  if (result.config.overriddenKeys.length > 0) {
    lines.push('');
    lines.push(`**NOT THE SEALED STUDY: config overrides in effect** - ${result.config.overriddenKeys.join(', ')}. `
      + 'A run under overridden values is a rehearsal, never a verdict.');
  }
  lines.push('');
  lines.push('## Week survival');
  lines.push('');
  if (result.weeks.dropped.length === 0) lines.push('Every captured week survived.');
  for (const d of result.weeks.dropped) lines.push(`- week ${d.week} dropped: ${d.reason}`);
  lines.push('');

  if (!result.evaluable) {
    lines.push(`## UNEVALUABLE`);
    lines.push('');
    lines.push(result.reason);
    lines.push('');
    return lines.join('\n');
  }

  const a = result.candidateA;
  lines.push('## Candidate A - lineup decision rule (rank by mean)');
  lines.push('');
  lines.push(`Verdict: **${a.verdict.toUpperCase()}**`);
  for (const v of a.voids) lines.push(`- VOID: ${v}`);
  lines.push('');
  if (a.component) {
    lines.push('| component | method | evidence | outcome |');
    lines.push('| --- | --- | --- | --- |');
    lines.push(renderComponent(a.component));
    lines.push('');
  }
  if (a.permutationFloor) {
    lines.push(`Permutation floor: p = ${round(a.permutationFloor.p, 6)} over ${a.permutationFloor.permutations} `
      + `shuffles against threshold ${a.permutationFloor.threshold}; control mean regret ${round(a.controlMeanRegret, 3)}.`);
    lines.push('');
  }
  lines.push('| week | control regret | candidate regret | delta |');
  lines.push('| ---: | ---: | ---: | ---: |');
  for (const w of a.weekly) {
    lines.push(`| ${w.week} | ${round(w.control, 3)} | ${round(w.candidate, 3)} | ${round(w.delta, 3)} |`);
  }
  lines.push('');

  lines.push('## Candidate B - interval calibration');
  lines.push('');
  lines.push(`Verdict: **${result.candidateB.verdict.toUpperCase()}**`);
  for (const v of result.candidateB.voids) {
    lines.push(`- VOID (candidate-wide, per prereg section 9 - no cell can be selected): ${v}`);
  }
  lines.push('');
  lines.push(`Selected cell: **${result.candidateB.selected || 'none'}** (fixed order, first passer; a section-9 void selects nothing).`);
  lines.push('');
  for (const cell of result.candidateB.cells) {
    lines.push(`### ${cell.cellKind}`);
    lines.push('');
    lines.push(`Verdict: **${cell.verdict.toUpperCase()}**`);
    for (const v of cell.voids) lines.push(`- VOID: ${v}`);
    lines.push('');
    lines.push(`Mean bit-equality: ${cell.meanEquality.mismatches} mismatches over ${cell.meanEquality.checked} rows. `
      + `Median shift: signed mean ${round(cell.medianShift.signedMean)} (|abs| ${round(cell.medianShift.absMean)}) `
      + `over ${cell.medianShift.rows} rows, bound +/-${result.config.medianShiftBound}.`);
    lines.push('');
    lines.push('| component | method | evidence | outcome |');
    lines.push('| --- | --- | --- | --- |');
    for (const c of cell.components) lines.push(renderComponent(c));
    for (const b of cell.bands) {
      lines.push(`| ${b.label} | point estimate | ${round(b.value)} in [${b.band[0]}, ${b.band[1]}] | ${b.passes ? 'PASS' : 'FAIL'} |`);
    }
    lines.push('');
    lines.push('| week | ctrl cov80 | cell cov80 | ctrl cov50 | cell cov50 | ctrl WIS | cell WIS | cell width |');
    lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const w of cell.weekly) {
      lines.push(`| ${w.week} | ${round(w.ctrl.cov80)} | ${round(w.cell.cov80)} | ${round(w.ctrl.cov50)} | ${round(w.cell.cov50)} | ${round(w.ctrl.wis, 3)} | ${round(w.cell.wis, 3)} | ${round(w.cell.width, 2)} |`);
    }
    lines.push('');
  }

  const sens = result.sensitivityWeeks1to17;
  lines.push('## Weeks 1-17 sensitivity (non-selecting)');
  lines.push('');
  if (!sens) lines.push('Not computed.');
  else if (sens.skipped) lines.push(sens.skipped);
  else {
    lines.push('Published per prereg sections 4 and 11; gates NOTHING.');
    lines.push('');
    lines.push('| component | method | evidence | outcome |');
    lines.push('| --- | --- | --- | --- |');
    if (sens.candidateA) lines.push(renderComponent(sens.candidateA));
    for (const cell of sens.cells) {
      for (const c of cell.components) lines.push(renderComponent(c));
      lines.push(`| ${cell.cellKind} points | point estimate | cov80 ${round(cell.cov80Point)}, cov50 ${round(cell.cov50Point)} | - |`);
    }
  }
  lines.push('');

  lines.push('## What flips');
  lines.push('');
  lines.push(`- decision.lineupRanking -> ${result.flips.lineupRanking ? `'mean'` : 'no change'}`);
  lines.push(`- calibration -> ${result.flips.calibration ? `${result.flips.calibration} constants` : 'no change'}`);
  lines.push(`- MODEL_VERSION bump (free_baseline_v3.2): ${result.flips.modelVersionBump ? 'YES' : 'no'}`);
  lines.push('');
  return lines.join('\n');
}

module.exports = { renderReport };
