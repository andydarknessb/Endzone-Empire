const { starterStateView } = require('./starterState');

describe('starterStateView', () => {
  it('maps the three wire states to a marker kind and its accessible label', () => {
    expect(starterStateView('in_progress')).toEqual({ kind: 'live', label: 'In progress' });
    expect(starterStateView('final')).toEqual({ kind: 'final', label: 'Final' });
    expect(starterStateView('scheduled')).toEqual({ kind: 'scheduled', label: 'Yet to play' });
  });

  it('draws no marker for an unknown state', () => {
    expect(starterStateView(null)).toBeNull();
    expect(starterStateView(undefined)).toBeNull();
    expect(starterStateView('played')).toBeNull();
  });
});
