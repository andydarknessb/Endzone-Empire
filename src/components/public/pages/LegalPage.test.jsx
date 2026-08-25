import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import LegalPage from './LegalPage';

const renderPage = (document) => render(
  <AppThemeProvider>
    <HelmetProvider>
      <MemoryRouter>
        <LegalPage document={document} />
      </MemoryRouter>
    </HelmetProvider>
  </AppThemeProvider>
);

// Pins the #275 deletion-rule wording approved by the maintainer on #312 so the
// Terms of Service and Privacy Policy strings cannot silently drift from the
// in-app copy (ProfileSettingsModal) and service error message again.
test('Terms of Service Termination clause uses the approved deletion wording', () => {
  renderPage('terms');

  expect(screen.getByText(
    'You may delete your account through Account Settings after deleting leagues you created. '
      + 'The operator may restrict accounts that violate these terms or the Acceptable Use Policy.'
  )).toBeInTheDocument();
});

test('Privacy Policy "Your choices and rights" enumerates the approved deletion effects', () => {
  renderPage('privacy');

  expect(screen.getByText(
    'Account Settings provides a portable JSON export and account deletion. '
      + 'Deletion anonymizes retained league history and removes active credentials, messages, '
      + 'notifications, push subscriptions, avatars, and any co-commissioner roles you hold in other leagues. '
      + 'If you created leagues, you must first delete them. '
      + 'Applicable law may provide additional access, correction, deletion, or appeal rights.'
  )).toBeInTheDocument();
});
