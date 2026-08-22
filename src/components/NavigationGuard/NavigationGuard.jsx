import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { UNSAFE_NavigationContext as NavigationContext } from 'react-router-dom';

const GuardContext = createContext({
  requestTransition: (transition) => transition(),
  setUnsavedChanges: () => {},
});

export function useUnsavedChangesGuard(hasUnsavedChanges) {
  const { requestTransition, setUnsavedChanges } = useContext(GuardContext);

  useEffect(() => {
    setUnsavedChanges(hasUnsavedChanges);
  }, [hasUnsavedChanges, setUnsavedChanges]);

  useEffect(() => () => setUnsavedChanges(false), [setUnsavedChanges]);

  return requestTransition;
}

export default function NavigationGuard({ children }) {
  const navigation = useContext(NavigationContext);
  const unsavedChangesRef = useRef(false);
  const historyIndexRef = useRef(typeof window === 'undefined' ? null : window.history.state?.idx);
  const restoringPopRef = useRef(false);
  const [pendingTransition, setPendingTransition] = useState(null);
  // True from the moment we issue history.go(-delta) to restore a blocked POP
  // until the restoration POP actually lands. The replayed traversal must wait
  // for this, so "Discard changes" stays disabled while it is set.
  const [restorationPending, setRestorationPending] = useState(false);

  const setUnsavedChanges = useCallback((value) => {
    unsavedChangesRef.current = Boolean(value);
  }, []);

  const requestTransition = useCallback((transition) => {
    if (!unsavedChangesRef.current) {
      transition();
      return;
    }
    setPendingTransition(() => transition);
  }, []);

  const guardedNavigator = useMemo(() => ({
    ...navigation.navigator,
    push: (...args) => requestTransition(() => {
      navigation.navigator.push(...args);
      historyIndexRef.current = window.history.state?.idx;
    }),
    replace: (...args) => requestTransition(() => {
      navigation.navigator.replace(...args);
      historyIndexRef.current = window.history.state?.idx;
    }),
    go: (...args) => requestTransition(() => navigation.navigator.go(...args)),
  }), [navigation.navigator, requestTransition]);

  useEffect(() => {
    const handlePopState = (event) => {
      const nextIndex = event.state?.idx;
      const currentIndex = historyIndexRef.current;

      if (restoringPopRef.current) {
        // We are mid-restoration. Only the POP that returns us to the entry we
        // left is the completion signal. Any other index means an extra
        // Back/Forward press slipped in during the async restore, so bounce it
        // back and stay pending — this coalesces rapid presses instead of
        // letting one through unguarded.
        if (Number.isInteger(nextIndex) && Number.isInteger(currentIndex) && nextIndex !== currentIndex) {
          event.stopImmediatePropagation();
          window.history.go(currentIndex - nextIndex);
          return;
        }
        restoringPopRef.current = false;
        setRestorationPending(false);
        historyIndexRef.current = nextIndex;
        return;
      }
      if (!unsavedChangesRef.current) {
        historyIndexRef.current = nextIndex;
        return;
      }
      if (!Number.isInteger(currentIndex) || !Number.isInteger(nextIndex) || currentIndex === nextIndex) return;

      // Browser POP navigation changes history before notifying listeners.
      // Stop HashRouter from consuming the blocked location, restore the
      // current entry, then replay the original delta only after confirmation.
      event.stopImmediatePropagation();
      const delta = nextIndex - currentIndex;
      restoringPopRef.current = true;
      setRestorationPending(true);
      window.history.go(-delta);
      requestTransition(() => window.history.go(delta));
    };
    window.addEventListener('popstate', handlePopState, true);
    return () => window.removeEventListener('popstate', handlePopState, true);
  }, [requestTransition]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!unsavedChangesRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const discardAndContinue = () => {
    const transition = pendingTransition;
    setPendingTransition(null);
    unsavedChangesRef.current = false;
    transition?.();
  };

  const contextValue = useMemo(() => ({ requestTransition, setUnsavedChanges }), [requestTransition, setUnsavedChanges]);

  return (
    <GuardContext.Provider value={contextValue}>
      <NavigationContext.Provider value={{ ...navigation, navigator: guardedNavigator }}>
        {children}
        <Dialog open={Boolean(pendingTransition)} onClose={() => setPendingTransition(null)}>
          <DialogTitle>You have unsaved changes. Discard them?</DialogTitle>
          <DialogContent><DialogContentText>Your edits on this tab will be lost.</DialogContentText></DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingTransition(null)}>Keep editing</Button>
            <Button color="error" variant="contained" disabled={restorationPending} onClick={discardAndContinue}>Discard changes</Button>
          </DialogActions>
        </Dialog>
      </NavigationContext.Provider>
    </GuardContext.Provider>
  );
}

NavigationGuard.propTypes = { children: PropTypes.node.isRequired };
