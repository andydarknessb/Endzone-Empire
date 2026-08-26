import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import publicApiClient from '../../api/publicApiClient';
import renderWithProviders from '../../test-utils/renderWithProviders';
import PublicApp from './PublicApp';
import LandingPage from '../LandingPage/LandingPage';
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, SITE_NAME, SITE_ORIGIN } from './PublicSeo';

jest.mock('../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// The static shell is the only metadata a crawler or link unfurler gets for
// every hash-routed URL (#351). It cannot import the constants, so the file is
// read from disk and held to them here.
const SHELL_PATH = path.resolve(__dirname, '../../../public/index.html');
const shellHtml = fs.readFileSync(SHELL_PATH, 'utf8');

function shellHead() {
  return new DOMParser().parseFromString(shellHtml, 'text/html').head;
}

function shellContent(selector) {
  // eslint-disable-next-line testing-library/no-node-access -- the subject is document.head, which Testing Library queries do not reach
  const node = shellHead().querySelector(selector);
  return node ? node.getAttribute('content') : null;
}

// Puts the shell's metadata into the test document the way a browser has it
// before React runs; jsdom never loads index.html on its own.
function installShellHead() {
  // eslint-disable-next-line testing-library/no-node-access -- the subject is document.head, which Testing Library queries do not reach
  const nodes = Array.from(shellHead().querySelectorAll('meta[name], meta[property]'));
  const installed = nodes.map((node) => document.head.appendChild(document.importNode(node, true)));
  return () => installed.forEach((node) => node.parentNode && node.parentNode.removeChild(node));
}

function descriptions() {
  // eslint-disable-next-line testing-library/no-node-access -- the subject is document.head, which Testing Library queries do not reach
  return Array.from(document.head.querySelectorAll('meta[name="description"]')).map((node) =>
    node.getAttribute('content')
  );
}

beforeEach(() => {
  publicApiClient.get.mockResolvedValue({ data: {} });
});

afterEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line testing-library/no-node-access -- the subject is document.head, which Testing Library queries do not reach
  document.head.querySelectorAll('meta[data-rh]').forEach((node) => node.remove());
  window.history.pushState({}, '', '/');
});

test('the shell declares the site-wide description, Open Graph and Twitter metadata from the shared constants', () => {
  // eslint-disable-next-line testing-library/no-node-access -- the subject is document.head, which Testing Library queries do not reach
  const title = shellHead().querySelector('title').textContent;
  expect(title).toBe(SITE_NAME);

  expect(shellContent('meta[name="description"]')).toBe(DEFAULT_DESCRIPTION);
  expect(shellContent('meta[property="og:description"]')).toBe(DEFAULT_DESCRIPTION);
  expect(shellContent('meta[name="twitter:description"]')).toBe(DEFAULT_DESCRIPTION);

  expect(shellContent('meta[property="og:type"]')).toBe('website');
  expect(shellContent('meta[property="og:site_name"]')).toBe(SITE_NAME);
  expect(shellContent('meta[property="og:title"]')).toBe(title);
  expect(shellContent('meta[property="og:url"]')).toBe(`${SITE_ORIGIN}/`);
  expect(shellContent('meta[property="og:image"]')).toBe(DEFAULT_OG_IMAGE);
  expect(shellContent('meta[property="og:image:width"]')).toBe('1200');
  expect(shellContent('meta[property="og:image:height"]')).toBe('630');

  expect(shellContent('meta[name="twitter:card"]')).toBe('summary_large_image');
  expect(shellContent('meta[name="twitter:title"]')).toBe(title);
  expect(shellContent('meta[name="twitter:image"]')).toBe(DEFAULT_OG_IMAGE);
});

test('the default description is fantasy-led, carries the pick\'em clause, and fits a search snippet', () => {
  // #50 ruling: fantasy first, pick'em as the second clause. House style: no em-dashes.
  expect(DEFAULT_DESCRIPTION).toMatch(/^Fantasy football/);
  expect(DEFAULT_DESCRIPTION).toMatch(/pick'em/);
  expect(DEFAULT_DESCRIPTION).not.toMatch(/—/);
  expect(DEFAULT_DESCRIPTION.length).toBeLessThanOrEqual(160);
});

test('a public route replaces the shell metadata with its own, leaving exactly one description', async () => {
  const uninstall = installShellHead();
  window.history.pushState({}, '', '/draft-simulator');

  render(<PublicApp />);

  await screen.findByRole('heading', { name: 'Mock Draft Simulator' }, { timeout: 5000 });
  await waitFor(() => expect(document.title).toBe('Fantasy Football Mock Draft Simulator | Endzone Empire'));

  // react-helmet-async only replaces head tags that carry its data-rh marker;
  // an unmarked static tag would survive beside the route's own.
  const found = descriptions();
  expect(found).toHaveLength(1);
  expect(found[0]).not.toBe(DEFAULT_DESCRIPTION);
  // eslint-disable-next-line testing-library/no-node-access -- the subject is document.head, which Testing Library queries do not reach
  expect(document.head.querySelectorAll('meta[property="og:description"]')).toHaveLength(1);
  // eslint-disable-next-line testing-library/no-node-access -- the subject is document.head, which Testing Library queries do not reach
  expect(document.head.querySelectorAll('meta[property="og:image"]')).toHaveLength(1);
  uninstall();
});

test('the landing page leaves the shell metadata intact', () => {
  const uninstall = installShellHead();

  renderWithProviders(<LandingPage />);

  expect(screen.getByRole('heading', { name: 'Welcome to Endzone Empire' })).toBeInTheDocument();
  expect(descriptions()).toEqual([DEFAULT_DESCRIPTION]);
  uninstall();
});
