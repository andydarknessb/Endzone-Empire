import React from 'react';
import { Container, Link, Paper, Stack, Typography } from '@mui/material';
import PublicSeo from '../PublicSeo';

const EFFECTIVE_DATE = 'July 23, 2026';

const documents = {
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['Data we collect', 'Account identifiers, league and team activity, chat messages, notification preferences, uploaded avatars, push-subscription data, and security/request logs. Passwords and session tokens are stored only as cryptographic hashes where applicable.'],
      ['How we use data', 'To operate fantasy leagues, authenticate accounts, deliver requested notifications, prevent abuse, maintain security, troubleshoot failures, and comply with valid legal obligations. Endzone Empire is currently a free-to-play service.'],
      ['Service providers', 'Hosting, database, storage, sports-data, email-delivery, error-monitoring, and content-processing providers process data only to deliver application functions. Current providers and transfer safeguards are reviewed in the production data inventory.'],
      ['Retention', 'Account tokens expire automatically. Operational logs, notifications, chat, and backups are retained for documented periods based on security, league-history, and recovery needs. Deleted data may remain in immutable backups until those backups expire.'],
      ['Your choices and rights', 'Account Settings provides a portable JSON export and account deletion. Deletion anonymizes retained league history and removes active credentials, messages, notifications, push subscriptions, avatars, and any co-commissioner roles you hold in other leagues. If you created leagues, you must first delete them. Applicable law may provide additional access, correction, deletion, or appeal rights.'],
      ['Security and incidents', 'We use access controls, encryption in transit, least-privilege service credentials, monitoring, and tested recovery procedures. No online service can guarantee absolute security. Material incidents are handled under the incident-response procedure.'],
      ['Children', 'Endzone Empire is not directed to children under 13. Do not register or submit personal information if you are under 13.'],
      ['Contact', 'Use the privacy export and deletion controls in Account Settings. The deployed service must publish its operator privacy contact before public launch for requests that cannot be completed in-app.'],
    ],
  },
  terms: {
    title: 'Terms of Service',
    sections: [
      ['Eligibility', 'You must be at least 13 years old and legally able to accept these terms. The service is free-to-play and does not provide paid-entry contests, wagering, wallets, or prizes.'],
      ['Account security', 'Provide accurate account information, protect access to your account, and notify the operator if you suspect unauthorized use. You are responsible for activity performed through your account.'],
      ['League conduct', 'Commissioners administer league settings and may moderate league activity. Do not manipulate drafts, scoring, trades, waivers, or access controls, and do not use automation that degrades the service.'],
      ['Content and intellectual property', 'You retain rights in content you submit and grant the limited permission needed to store, display, moderate, and process it for the service. Do not upload content you lack permission to use. Endzone Empire is not affiliated with or endorsed by the NFL.'],
      ['Availability and changes', 'Features, sports data, and availability may change. The service may suspend access to protect users, investigate abuse, perform maintenance, or comply with law.'],
      ['Termination', 'You may delete your account through Account Settings after deleting leagues you created. The operator may restrict accounts that violate these terms or the Acceptable Use Policy.'],
      ['Disclaimers', 'Fantasy projections, rankings, injury information, and sports data are informational and may be delayed or inaccurate. They are not guarantees of player performance.'],
    ],
  },
  'acceptable-use': {
    title: 'Acceptable Use Policy',
    sections: [
      ['Prohibited conduct', 'Do not harass, threaten, impersonate, discriminate, publish private information, distribute malware, exploit vulnerabilities, evade access controls, spam users, or interfere with league operations.'],
      ['User-generated content', 'League chat must remain lawful and appropriate for the league. Members can block users and report messages. Commissioners and platform administrators may review reports, remove content, preserve necessary evidence, and restrict abusive accounts.'],
      ['Security research', 'Do not test production accounts or data without written authorization. Report suspected vulnerabilities privately through the operator support method published with the deployed service.'],
      ['Enforcement', 'Responses may include warnings, content removal, feature restrictions, account suspension, or termination. Reports are reviewed in context and recorded for accountability.'],
    ],
  },
};

function LegalPage({ document }) {
  const content = documents[document] || documents.privacy;
  return (
    <>
      <PublicSeo
        title={content.title}
        description={`${content.title} for the Endzone Empire fantasy football service.`}
        path={`/${document}`}
      />
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 } }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 } }}>
          <Stack spacing={3}>
            <div>
              <Typography component="h1" variant="h3">{content.title}</Typography>
              <Typography color="text.secondary">Effective {EFFECTIVE_DATE}</Typography>
            </div>
            {content.sections.map(([heading, body]) => (
              <section key={heading}>
                <Typography component="h2" variant="h5" gutterBottom>{heading}</Typography>
                <Typography>{body}</Typography>
              </section>
            ))}
            <Typography variant="body2">
              Related: <Link href="/privacy">Privacy</Link>{' · '}
              <Link href="/terms">Terms</Link>{' · '}
              <Link href="/acceptable-use">Acceptable Use</Link>
            </Typography>
          </Stack>
        </Paper>
      </Container>
    </>
  );
}

export default LegalPage;
