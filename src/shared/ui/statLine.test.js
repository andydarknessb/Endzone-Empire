import { statLine } from './statLine';

test('orders an offensive line by salience and drops zeros', () => {
  expect(statLine({ receivingYards: 120, receptions: 8, receivingTDs: 1, fumbles: 0 })).toBe(
    '8 Rec, 120 Rec Yds, 1 Rec TD'
  );
  expect(statLine({ passingYards: 305, passingTDs: 3, interceptions: 1 })).toBe(
    '305 Pass Yds, 3 Pass TD, 1 INT'
  );
});

test('renders a team-defense line, keeping a shutout visible', () => {
  expect(
    statLine({
      sack: 4, interceptionReturn: 2, fumbleRecovery: 1, defensiveTD: 0,
      safety: 0, blockedKick: 0, pointsAllowed: 13, yardsAllowed: 310,
    })
  ).toBe('4 Sk, 2 INT, 1 FR, 13 PA, 310 YdA');
  // Zero points allowed is the headline stat of the week, not an absent one.
  expect(statLine({ sack: 2, pointsAllowed: 0, yardsAllowed: 95 })).toBe('2 Sk, 0 PA, 95 YdA');
});

test('renders an IDP line and omits the bonus-only yardage keys', () => {
  expect(
    statLine({
      soloTackle: 6, assistedTackle: 3, idpSack: 1, idpInterception: 0,
      forcedFumble: 1, passDeflection: 2, qbHit: 1, tacklesForLoss: 1,
      idpSackYards: 8, idpTacklesForLossYards: 3,
    })
  ).toBe('6 Solo, 3 Ast, 1 Sk, 1 FF, 2 PD, 1 QBH, 1 TFL');
});

test('falls back to a dash with nothing to show', () => {
  expect(statLine(null)).toBe('-');
  expect(statLine({})).toBe('-');
  expect(statLine({ receivingYards: 0 })).toBe('-');
});
