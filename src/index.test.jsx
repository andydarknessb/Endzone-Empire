import React from 'react';
import { act } from '@testing-library/react';

// index.js renders the real store + App tree. The store itself is
// side-effect-free to construct (verified in redux/store.test.js), but App
// pulls in every page component; mock App out here so this stays a pure
// "does the mount mechanism work" smoke test rather than duplicating
// App.test.jsx's routing coverage.
jest.mock('./components/App/App', () => function MockApp() {
  return <div data-testid="mock-app">mounted</div>;
});

test('mounts the app into #react-root without throwing', () => {
  document.body.innerHTML = '<div id="react-root"></div>';

  expect(() => {
    act(() => {
      require('./index.js');
    });
  }).not.toThrow();

  expect(document.getElementById('react-root')).toHaveTextContent('mounted');
});
