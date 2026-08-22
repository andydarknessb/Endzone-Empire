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

  it("advertises League Pick'em with a registration CTA (plain href across routers)", () => {
    render(<FeaturePromos />);
    expect(screen.getByRole('heading', { name: "League Pick'em" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a league' })).toHaveAttribute(
      'href',
      '/#/registration'
    );
  });

  it('marks both promos as new and stays one compact band', () => {
    render(<FeaturePromos />);
    expect(screen.getAllByText('New')).toHaveLength(PROMOS.length);
    expect(screen.getByRole('region', { name: 'New features' })).toBeInTheDocument();
  });
});
