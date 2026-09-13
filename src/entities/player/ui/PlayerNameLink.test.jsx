import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerNameLink from './PlayerNameLink';

test('renders the player name as an accessible button', () => {
  render(<PlayerNameLink name="Justin Jefferson" playerId={7} onOpen={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Justin Jefferson' })).toBeInTheDocument();
});

// The component's own contract (docblock): a real <button> with
// stopPropagation, so a name click never also fires a row/Draft handler
// wrapping it - the draft room's name and Draft/Queue buttons must stay
// separate click targets.
test('calls onOpen with the player id and does not bubble to a wrapping handler', async () => {
  const onOpen = jest.fn();
  const onRowClick = jest.fn();
  render(
    <div onClick={onRowClick}>
      <PlayerNameLink name="Justin Jefferson" playerId={7} onOpen={onOpen} />
    </div>
  );

  await userEvent.click(screen.getByRole('button', { name: 'Justin Jefferson' }));

  expect(onOpen).toHaveBeenCalledWith(7);
  expect(onRowClick).not.toHaveBeenCalled();
});
