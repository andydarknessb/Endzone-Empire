/**
 * The wall clock, behind one seam. Reading "now" through clock.now() instead
 * of `new Date()` inline lets a route or a service be driven at a fixed
 * instant in a test (t.mock.method(clock, 'now', ...)) without a query
 * parameter that would be a public time-travel surface. Production behaviour
 * is a plain `new Date()`.
 *
 * The matchup surfaces (expectedFinal.service and its three callers) read the
 * clock here and pass `now` through, so the list route, the detail route and
 * the score emit all price the same week against the same instant when a test
 * pins it (#862).
 */
function now() {
  return new Date();
}

module.exports = { now };
