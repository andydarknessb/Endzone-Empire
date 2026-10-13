// Whether the first FETCH_USER of this load has been answered. `user` is {} both
// before that answer and for a visitor, so the /home route needs this to tell
// "not logged in" from "not known yet".
const sessionReducer = (state = { resolved: false }, action) => {
  switch (action.type) {
    case 'FETCH_USER':
      return { resolved: false };
    case 'SET_USER':
    case 'UNSET_USER':
    case 'SESSION_RESOLVED':
      return { resolved: true };
    default:
      return state;
  }
};

// session will be on the redux state at:
// state.session
export default sessionReducer;
