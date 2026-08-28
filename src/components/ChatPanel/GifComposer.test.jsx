import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GifComposer from './GifComposer';
import { registerGifProvider, clearGifProviders } from '../../lib/gifProvider';
import { FAKE_PROVIDER_ID, fakeGifResolver } from '../../lib/gifProviderFake';

afterEach(() => clearGifProviders());

// AC7: the picker is ABSENT when the capability is disabled. A negative-only
// assertion would pass just as well if the query were wrong or the tree never
// rendered, so the SAME query is proven capable of a positive in the enabled
// case right below - two assertions from one query is what makes the negative
// one mean something.
test('the GIF picker trigger is absent when the capability is disabled (AC7)', () => {
  render(<GifComposer enabled={false} onSendGif={() => {}} />);
  expect(screen.queryByTestId('gif-picker-trigger')).not.toBeInTheDocument();
});

test('POSITIVE CONTROL: the same query FINDS the trigger when the capability is enabled (AC7)', () => {
  render(<GifComposer enabled onSendGif={() => {}} />);
  expect(screen.getByTestId('gif-picker-trigger')).toBeInTheDocument();
});

describe('GifComposer - enabled with a registered provider', () => {
  beforeEach(() => registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver));

  test('a missing description blocks send; adding one enables it (AC3 client mirror)', async () => {
    render(<GifComposer enabled onSendGif={() => true} />);
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));

    await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
    // Asset present, description absent: send is refused client-side.
    expect(screen.getByTestId('gif-send')).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/description/i), 'a waving hand');
    expect(screen.getByTestId('gif-send')).toBeEnabled();
  });

  test('sending emits the provider asset, description and optional caption, then closes', async () => {
    const onSendGif = jest.fn().mockResolvedValue(true);
    render(<GifComposer enabled onSendGif={onSendGif} />);
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));

    await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
    await userEvent.type(screen.getByLabelText(/description/i), 'a cat knocking a cup');
    await userEvent.type(screen.getByLabelText(/caption/i), 'this is me');
    await userEvent.click(screen.getByTestId('gif-send'));

    expect(onSendGif).toHaveBeenCalledWith({
      provider: FAKE_PROVIDER_ID,
      assetId: 'abc123',
      description: 'a cat knocking a cup',
      caption: 'this is me',
    });
    // A successful send closes the panel (the form fields are gone).
    expect(screen.queryByLabelText('GIF description')).not.toBeInTheDocument();
  });

  test('an absent caption is sent as null, never an empty string (AC1)', async () => {
    const onSendGif = jest.fn().mockResolvedValue(true);
    render(<GifComposer enabled onSendGif={onSendGif} />);
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
    await userEvent.type(screen.getByLabelText(/description/i), 'a waving hand');
    await userEvent.click(screen.getByTestId('gif-send'));
    expect(onSendGif).toHaveBeenCalledWith(expect.objectContaining({ caption: null }));
  });
});

describe('GifComposer - accessibility (#446 review)', () => {
  test('field visible labels ARE their accessible names, no aria-label override (WCAG 2.5.3)', async () => {
    render(<GifComposer enabled onSendGif={() => {}} />);
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    // Found by the visible label text, and the accessible name matches it - a
    // voice-control user saying the visible label reaches the field.
    expect(screen.getByLabelText(/description/i)).toHaveAccessibleName(/description/i);
    expect(screen.getByLabelText(/caption/i)).toHaveAccessibleName(/caption/i);
    expect(screen.getByLabelText('GIF asset id')).toHaveAccessibleName('GIF asset id');
  });

  test('a touched-then-empty description gets a programmatically associated error (FIX 6)', async () => {
    render(<GifComposer enabled onSendGif={() => {}} />);
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    const description = screen.getByLabelText(/description/i);
    // Untouched: not marked invalid, so a fresh form is not shouting.
    expect(description).not.toHaveAttribute('aria-invalid', 'true');
    // Focus then leave it empty: now it is invalid and says why, so the reason
    // send is unavailable is not conveyed by a silent disabled button alone.
    await userEvent.click(description);
    await userEvent.tab();
    expect(description).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/description is required/i)).toBeInTheDocument();
  });

  test('Cancel returns focus to the trigger, never stranding it on the body (FIX 3)', async () => {
    render(<GifComposer enabled onSendGif={() => {}} />);
    const trigger = screen.getByTestId('gif-picker-trigger');
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByTestId('gif-picker-panel')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('a successful send returns focus to the trigger (FIX 3)', async () => {
    registerGifProvider(FAKE_PROVIDER_ID, fakeGifResolver);
    render(<GifComposer enabled onSendGif={() => Promise.resolve(true)} />);
    const trigger = screen.getByTestId('gif-picker-trigger');
    await userEvent.click(trigger);
    await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
    await userEvent.type(screen.getByLabelText(/description/i), 'a waving hand');
    await userEvent.click(screen.getByTestId('gif-send'));
    expect(screen.queryByTestId('gif-picker-panel')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('Escape dismisses the panel (worth-doing)', async () => {
    render(<GifComposer enabled onSendGif={() => {}} />);
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));
    expect(screen.getByTestId('gif-picker-panel')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('GIF asset id'), '{Escape}');
    expect(screen.queryByTestId('gif-picker-panel')).not.toBeInTheDocument();
  });
});

test('enabled but no provider registered: send stays disabled and the panel says so (AC9)', async () => {
  // The capability is on but no provider has been approved/registered - the
  // pre-approval state. There is nothing to resolve an asset against, so no GIF
  // can be composed even with a description present.
  render(<GifComposer enabled onSendGif={() => true} />);
  await userEvent.click(screen.getByTestId('gif-picker-trigger'));
  await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
  await userEvent.type(screen.getByLabelText(/description/i), 'a waving hand');
  expect(screen.getByTestId('gif-send')).toBeDisabled();
  expect(screen.getByText(/available once a provider is enabled/i)).toBeInTheDocument();
});
