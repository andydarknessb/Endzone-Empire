import React from 'react';
import { render, screen, act } from '@testing-library/react';
import useContainerWidth, { draftPaneLayout, DRAFT_PANE_MIN_WIDTH } from './useContainerWidth';

// The Draft room's wide-vs-narrow decision is made against the available
// CONTAINER width (issue #444 acceptance criterion 3), never a window media
// query. draftPaneLayout is the single place that reading is turned into a
// choice, so the "unknown is wide" rule is asserted here rather than inferred
// from the component.
describe('draftPaneLayout', () => {
  test('an unmeasured container (null) is panes, not tabs', () => {
    // Before the first measurement there is nothing that says the container is
    // narrow, so the full three-pane arrangement is the default - a real
    // browser measures before paint, and a layout-free test environment never
    // measures at all, and both should get panes rather than a flash of tabs.
    expect(draftPaneLayout(null)).toBe('panes');
  });

  test('a zero-width container is panes', () => {
    // jsdom (and a detached node) report width 0. That is "unmeasurable", not
    // "genuinely 0px wide", so it must not be read as narrow.
    expect(draftPaneLayout(0)).toBe('panes');
  });

  test('a container narrower than the threshold is tabs', () => {
    expect(draftPaneLayout(DRAFT_PANE_MIN_WIDTH - 1)).toBe('tabs');
    expect(draftPaneLayout(375)).toBe('tabs');
  });

  test('a container at or above the threshold is panes', () => {
    expect(draftPaneLayout(DRAFT_PANE_MIN_WIDTH)).toBe('panes');
    expect(draftPaneLayout(DRAFT_PANE_MIN_WIDTH + 600)).toBe('panes');
  });
});

describe('useContainerWidth', () => {
  function Probe() {
    const [ref, width] = useContainerWidth();
    return (
      <div ref={ref} data-testid="probe">
        {width == null ? 'null' : String(width)}
      </div>
    );
  }

  let observers;
  let originalResizeObserver;
  let originalGetBoundingClientRect;

  beforeEach(() => {
    observers = [];
    originalResizeObserver = global.ResizeObserver;
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    global.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }

      observe(node) {
        this.node = node;
      }

      disconnect() {
        this.disconnected = true;
      }
    };
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  const stubWidth = (w) => {
    Element.prototype.getBoundingClientRect = () => ({
      width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON() {},
    });
  };

  test('measures the container width when the ref attaches', () => {
    stubWidth(1200);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('1200');
  });

  test('updates the width when the ResizeObserver reports a resize', () => {
    stubWidth(1200);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('1200');

    // The container shrank (a split view opened beside it, an orientation
    // change): the observer callback is the live channel that carries that.
    act(() => {
      observers[0].callback([{ contentRect: { width: 480 } }]);
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('480');
  });

  test('disconnects its observer on unmount', () => {
    stubWidth(1000);
    const { unmount } = render(<Probe />);
    const observer = observers[0];
    expect(observer.disconnected).toBeFalsy();
    unmount();
    expect(observer.disconnected).toBe(true);
  });
});
