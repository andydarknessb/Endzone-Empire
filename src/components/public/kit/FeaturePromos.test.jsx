import React from 'react';
import { render, screen } from '@testing-library/react';
import FeaturePromos, { PROMOS } from './FeaturePromos';

describe('FeaturePromos', () => {
  it('advertises the mock draft with a deep link into the public tree', () => {
    render(<FeaturePromos />);
    expect(screen.getByRole('heading', { name: 'Mock Draft Simulator' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a mock draft' })).toHaveAttribute(
      'href',
      '/draft-simulator'
    );
  });

  it("advertises NFL Pick'em with a registration CTA (plain href across routers)", () => {
    render(<FeaturePromos />);
    expect(screen.getByRole('heading', { name: "NFL Pick'em" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a league' })).toHaveAttribute(
      'href',
      '/#/registration'
    );
  });

  it('pins the full pickem body so the kickoff clause cannot be trimmed silently', () => {
    render(<FeaturePromos />);
    expect(
      screen.getByText(
        "Pick NFL winners every week, straight up or with confidence points. A side game in a fantasy league, or the whole game in a pick'em league. Picks lock at kickoff and reveal game by game."
      )
    ).toBeInTheDocument();
  });

  it('marks both promos as new and stays one compact band', () => {
    render(<FeaturePromos />);
    expect(screen.getAllByText('New')).toHaveLength(PROMOS.length);
    expect(screen.getByRole('region', { name: 'New features' })).toBeInTheDocument();
  });
});
