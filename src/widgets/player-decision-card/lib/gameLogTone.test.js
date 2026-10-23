import { gameLogTone } from './gameLogTone';

const tones = (values) => values.map((v) => gameLogTone(v, values));

describe('gameLogTone', () => {
  it('tints FPTS against the column average', () => {
    expect(tones([3.4, 6.5, 9.6, 11.0, 5.2, 7.6])).toEqual([
      'below', 'typical', 'above', 'above', 'below', 'typical',
    ]);
  });

  it('puts 74 rush yards above the average, 1.25 times in', () => {
    expect(tones([35, 64, 74, 48, 52, 76])).toEqual([
      'below', 'typical', 'above', 'typical', 'typical', 'above',
    ]);
  });

  it('reads a column averaging zero as typical for every row', () => {
    expect(tones([0, 0, 0])).toEqual(['typical', 'typical', 'typical']);
  });
});
