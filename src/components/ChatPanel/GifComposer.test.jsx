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

    await userEvent.type(screen.getByLabelText('GIF description'), 'a waving hand');
    expect(screen.getByTestId('gif-send')).toBeEnabled();
  });

  test('sending emits the provider asset, description and optional caption, then closes', async () => {
    const onSendGif = jest.fn().mockResolvedValue(true);
    render(<GifComposer enabled onSendGif={onSendGif} />);
    await userEvent.click(screen.getByTestId('gif-picker-trigger'));

    await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
    await userEvent.type(screen.getByLabelText('GIF description'), 'a cat knocking a cup');
    await userEvent.type(screen.getByLabelText('GIF caption'), 'this is me');
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
    await userEvent.type(screen.getByLabelText('GIF description'), 'a waving hand');
    await userEvent.click(screen.getByTestId('gif-send'));
    expect(onSendGif).toHaveBeenCalledWith(expect.objectContaining({ caption: null }));
  });
});

test('enabled but no provider registered: send stays disabled and the panel says so (AC9)', async () => {
  // The capability is on but no provider has been approved/registered - the
  // pre-approval state. There is nothing to resolve an asset against, so no GIF
  // can be composed even with a description present.
  render(<GifComposer enabled onSendGif={() => true} />);
  await userEvent.click(screen.getByTestId('gif-picker-trigger'));
  await userEvent.type(screen.getByLabelText('GIF asset id'), 'abc123');
  await userEvent.type(screen.getByLabelText('GIF description'), 'a waving hand');
  expect(screen.getByTestId('gif-send')).toBeDisabled();
  expect(screen.getByText(/available once a provider is enabled/i)).toBeInTheDocument();
});
