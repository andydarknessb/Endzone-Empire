import React from 'react';
import { Box } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

/**
 * Reading-column typography for article bodies. Wraps freeform content and
 * styles the standard elements (headings, paragraphs, lists, blockquotes,
 * links) with a comfortable measure and line-height. Colors come from theme
 * tokens so it reads well in both light and dark.
 *
 * Articles compose their body from the primitives below (P, H2, H3, UL, OL, LI,
 * Quote, Lead, Link) so no article file hard-codes styling or routing.
 */
function Prose({ children, sx }) {
  return (
    <Box
      sx={{
        color: 'text.primary',
        fontSize: '1.075rem',
        lineHeight: 1.7,
        '& p': { my: 2.25 },
        '& h2': { mt: 5, mb: 1.5, fontWeight: 800, fontSize: '1.6rem', lineHeight: 1.25 },
        '& h3': { mt: 4, mb: 1, fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.3 },
        '& ul, & ol': { my: 2, pl: 3 },
        '& li': { my: 0.75 },
        '& a': { color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 3 },
        '& strong': { fontWeight: 700 },
        '& blockquote': {
          my: 3,
          mx: 0,
          pl: 2.5,
          py: 0.5,
          borderLeft: '3px solid var(--accent)',
          color: 'text.secondary',
          fontStyle: 'italic',
        },
        '& table': { width: '100%', borderCollapse: 'collapse', my: 3, fontSize: '0.95rem' },
        '& thead th': { textAlign: 'left', fontWeight: 700, py: 1, px: 1.5, borderBottom: '2px solid', borderColor: 'divider', whiteSpace: 'nowrap' },
        '& td': { py: 0.75, px: 1.5, borderBottom: '1px solid', borderColor: 'divider' },
        '& tbody tr:hover': { bgcolor: 'action.hover' },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

// Composable body primitives for typed-JSX articles.
export const Lead = ({ children }) => (
  <Box component="p" sx={{ fontSize: '1.2rem', color: 'text.secondary', lineHeight: 1.6, my: 2.5 }}>
    {children}
  </Box>
);
export const P = ({ children }) => <p>{children}</p>;
export function headingId(children) {
  return React.Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join(' ')
    .toLocaleLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
export const H2 = ({ children, id }) => <h2 id={id || headingId(children)}>{children}</h2>;
export const H3 = ({ children }) => <h3>{children}</h3>;
export const UL = ({ children }) => <ul>{children}</ul>;
export const OL = ({ children }) => <ol>{children}</ol>;
export const LI = ({ children }) => <li>{children}</li>;
export const Quote = ({ children }) => <blockquote>{children}</blockquote>;

// An absolute URL (scheme-qualified or protocol-relative) leaves the app; a
// path stays in it.
const isExternal = (to) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(String(to));

/**
 * The only link an article body should use. Internal paths route through the
 * client router, so an in-app hop keeps the app shell instead of full-page
 * reloading; absolute URLs become a plain anchor that opens away from the app
 * with the rel guard already applied, so no article file has to remember it.
 */
export const Link = ({ to, children, ...props }) => (isExternal(to)
  ? <a href={to} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
  : <RouterLink to={to} {...props}>{children}</RouterLink>);

// A wide table must scroll inside its own box. Without this a six-column
// cheat sheet is wider than a phone viewport and pushes the whole PAGE
// sideways, which breaks every other section too, not just the table.
export const Table = ({ children, ...props }) => (
  <Box sx={{ overflowX: 'auto', maxWidth: '100%' }}>
    <table {...props}>{children}</table>
  </Box>
);
export const THead = ({ children }) => <thead>{children}</thead>;
export const TBody = ({ children }) => <tbody>{children}</tbody>;
export const TR = ({ children }) => <tr>{children}</tr>;
export const TH = ({ children, ...props }) => <th {...props}>{children}</th>;
export const TD = ({ children, ...props }) => <td {...props}>{children}</td>;

export default Prose;
