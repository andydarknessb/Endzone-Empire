import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GifMessage from './GifMessage';
import { registerGifProvider, clearGifProviders } from '../../lib/gifProvider';
import { FAKE_PROVIDER_ID, fakeGifResolver } from '../../lib/gifProviderFake';

const media = (over = {}) => ({
  provider: FAKE_PROVIDER_ID,
  assetId: 'abc123',
  description: 'a cat knocking a cup off a table',
  ...over,
});

// prefers-reduced-motion is read through useMediaQuery, mocked the same way
// TeamAvatar.test.jsx mocks it (the house precedent for the still-vs-animated
// choice). Default off; a test flips it before rendering.
let reducedMotion = false;
beforeEach(() => {
  reducedMotion = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: reducedMotion,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
afterEach(() => clearGifProviders());

describe('GifMessage - unavailable (production default: no provider registered, AC5/AC9)', () => {
  test('renders a stable GIF unavailable tile that preserves the description and caption', () => {
    // No provider registered, so the asset cannot resolve - the production state.
    render(<GifMessage media={media()} caption="this is me at 3pm" />);

    expect(screen.getByTestId('gif-unavailable')).toBeInTheDocument();
    expect(screen.getByText(/GIF unavailable/i)).toBeInTheDocument();
    // The description survives so a screen-reader user still learns what was sent.
    expect(screen.getByTestId('gif-unavailable-description')).toHaveTextContent('a cat knocking a cup off a table');
    // The caption survives too (AC5).
    expect(screen.getByText('this is me at 3pm')).toBeInTheDocument();
    // No image and no attribution when unavailable.
    expect(screen.queryByTestId('gif-message')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('the unavailable tile copy contains no em dash (ADR 0016)', () => {
    render(<GifMessage media={media()} caption="hi" />);
    const tile = screen.getByTestId('gif-unavailable');
    expect(tile.textContent).not.toMatch(/—/);
  });
});

describe('GifMessage - available (a provider resolves the asset, AC4/AC6/AC8)', () => {
  beforeEach(() => registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver));

  test('with no motion preference: autoplays the animation AND offers a pause toggle (WCAG 2.2.2)', async () => {
    render(<GifMessage media={media()} caption="this is me at 3pm" />);

    const animated = screen.getByTestId('gif-animated');
    // The fake answers FROM the assetId, so the rendition proves the asset flowed
    // through rather than a canned response (AC8).
    expect(animated.getAttribute('src')).toContain('abc123');
    expect(animated).toHaveAttribute('alt', 'a cat knocking a cup off a table');
    // The motion toggle has a STABLE accessible name; state rides on aria-pressed
    // (#512), and it is PRESSED while autoplaying. It exists so even a
    // no-preference viewer can stop the looping animation (WCAG 2.2.2).
    const toggle = screen.getByRole('button', { name: /play gif animation/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    // Pausing returns to the still; the toggle stays mounted (focus is not
    // stranded) and now reads not-pressed.
    expect(screen.getByTestId('gif-still')).toBeInTheDocument();
    expect(screen.queryByTestId('gif-animated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /play gif animation/i })).toHaveAttribute('aria-pressed', 'false');
  });

  test('reduced-motion: shows the STILL by default with a play toggle that swaps to the animation (AC4)', async () => {
    reducedMotion = true;
    render(<GifMessage media={media()} caption="hi" />);

    const still = screen.getByTestId('gif-still');
    expect(still.getAttribute('src')).toContain('abc123');
    expect(still).toHaveAttribute('alt', 'a cat knocking a cup off a table');
    expect(screen.queryByTestId('gif-animated')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /play gif animation/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(screen.getByTestId('gif-animated')).toBeInTheDocument();
    expect(screen.queryByTestId('gif-still')).not.toBeInTheDocument();
    // The toggle PERSISTS across activation (focus is never stranded, and it can
    // pause), now pressed.
    expect(screen.getByRole('button', { name: /play gif animation/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a still-only rendition renders the still, in both motion states, with no toggle (FIX 1 - logic)', () => {
    // A provider that returns ONLY a still (no animation). This shape is admitted
    // by the guard; it must render the still, never nothing. Regression for the
    // reviewer-found case where imgSrc fell through to null.
    clearGifProviders();
    registerGifProvider(FAKE_PROVIDER_ID, (m) => ({ still: `still:${m.assetId}`, animated: null, attribution: null }));

    const { rerender } = render(<GifMessage media={media()} caption="hi" />);
    expect(screen.getByTestId('gif-still').getAttribute('src')).toContain('abc123');
    // Nothing to animate, so no motion toggle.
    expect(screen.queryByRole('button', { name: /play gif animation/i })).not.toBeInTheDocument();

    reducedMotion = true;
    rerender(<GifMessage media={media()} caption="hi" />);
    expect(screen.getByTestId('gif-still').getAttribute('src')).toContain('abc123');
    expect(screen.queryByRole('button', { name: /play gif animation/i })).not.toBeInTheDocument();
  });

  test('reduced-motion with an animation but NO still holds the motion behind the toggle, not autoplay (AC4 edge)', async () => {
    clearGifProviders();
    registerGifProvider(FAKE_PROVIDER_ID, (m) => ({ animated: `anim:${m.assetId}`, still: null, attribution: null }));
    reducedMotion = true;
    render(<GifMessage media={media()} caption="hi" />);

    expect(screen.queryByTestId('gif-animated')).not.toBeInTheDocument();
    expect(screen.getByTestId('gif-held-description')).toHaveTextContent('a cat knocking a cup off a table');
    await userEvent.click(screen.getByRole('button', { name: /play gif animation/i }));
    expect(screen.getByTestId('gif-animated')).toBeInTheDocument();
  });

  test('surfaces attribution derived from the asset, behind the provider boundary (AC6)', () => {
    render(<GifMessage media={media()} caption="hi" />);
    const attribution = screen.getByTestId('gif-attribution');
    expect(attribution).toHaveTextContent('Fake GIF Library');
    expect(attribution).toHaveTextContent('creator-abc123');
    // House separator is the middot, never an em dash.
    expect(attribution.textContent).not.toMatch(/—/);
  });

  test('a different asset id yields different renditions (the fake is not canned, AC8)', () => {
    const { rerender } = render(<GifMessage media={media({ assetId: 'id-one' })} caption="hi" />);
    expect(screen.getByTestId('gif-animated').getAttribute('src')).toContain('id-one');
    rerender(<GifMessage media={media({ assetId: 'id-two' })} caption="hi" />);
    expect(screen.getByTestId('gif-animated').getAttribute('src')).toContain('id-two');
  });
});
