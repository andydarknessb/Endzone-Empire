import React, { Suspense } from 'react';
import { useSelector } from 'react-redux';
import { lazyWithReload } from '../../shared/lib/lazyWithReload';

// Only a logged-out visitor lands on the login screen.
const LoginPage = lazyWithReload(() => import('../LoginPage/LoginPage'));

// A Custom Wrapper Component -- This will keep our code DRY.
// Responsible for watching redux state, and returning an appropriate component.
// Takes children to render and returns either the children or LoginPage based on auth.

// THIS IS NOT SECURITY! That must be done on the server
// A malicious user could change the code and see any view
// so your server-side route must implement real security
// by checking req.isAuthenticated for authentication
// and by checking req.user for authorization

function ProtectedRoute({ children }) {
  const user = useSelector((store) => store.user);

  return user.id ? children : (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}

export default ProtectedRoute;
