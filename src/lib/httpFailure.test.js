import { readHttpFailure } from './httpFailure';

// An axios-style rejection: the failure response hangs off `err.response`, and
// the server envelope is `err.response.data`. `httpError` builds that shape;
// `bare` is anything thrown that is not an HTTP response at all.
const httpError = (status, data) => ({ isAxiosError: true, response: { status, data } });
const bare = (message) => Object.assign(new Error(message), { code: 'ERR_NETWORK' });

// One table proves totality: the reader returns { message, code, status } for
// every row and throws on none. The four server envelopes were enumerated by
// grepping origin/integration for `.json({ error`, `.json({ code`,
// `error: error.code` and `code: error.code`; the four distinct shapes that
// search surfaces are the first four rows.
const rows = [
  {
    name: 'envelope: copy in the first field (error holds a sentence)',
    input: httpError(423, { error: 'This team is locked.' }),
    expected: { message: 'This team is locked.', code: undefined, status: 423 },
  },
  {
    name: 'envelope: a code in the first field beside a message',
    input: httpError(423, { error: 'TEAM_LOCKED', message: 'This team is locked.' }),
    expected: { message: 'This team is locked.', code: 'TEAM_LOCKED', status: 423 },
  },
  {
    name: 'envelope: the fourth (code, message, requestId; no first field)',
    input: httpError(429, { code: 'RATE_LIMITED', message: 'Too many requests', requestId: 'r-1' }),
    expected: { message: 'Too many requests', code: 'RATE_LIMITED', status: 429 },
  },
  {
    name: 'envelope: a sentence in the first field beside a separate code key',
    input: httpError(404, { error: 'That draft has no market.', code: 'DRAFT_NO_MARKET' }),
    expected: { message: 'That draft has no market.', code: 'DRAFT_NO_MARKET', status: 404 },
  },
  {
    name: 'no response at all (cancelled or network-level failure)',
    input: bare('canceled'),
    expected: { message: undefined, code: undefined, status: undefined },
  },
  {
    name: 'a non-HTTP throw (a plain Error)',
    input: new Error('boom'),
    expected: { message: undefined, code: undefined, status: undefined },
  },
  {
    name: 'an HTML error page from the edge (body is a string, not an object)',
    input: httpError(502, '<html><body>502 Bad Gateway</body></html>'),
    expected: { message: undefined, code: undefined, status: 502 },
  },
  {
    name: 'a body whose fields are objects, not strings (rule 4)',
    input: httpError(500, { error: { nested: true }, message: { also: 'obj' }, code: ['x'] }),
    expected: { message: undefined, code: undefined, status: 500 },
  },
  {
    name: 'an empty envelope',
    input: httpError(500, {}),
    expected: { message: undefined, code: undefined, status: 500 },
  },
  {
    name: 'an envelope carrying only a requestId (no message, no code, no error)',
    input: httpError(500, { requestId: 'r-2' }),
    expected: { message: undefined, code: undefined, status: 500 },
  },
  {
    name: 'null',
    input: null,
    expected: { message: undefined, code: undefined, status: undefined },
  },
  {
    name: 'undefined',
    input: undefined,
    expected: { message: undefined, code: undefined, status: undefined },
  },
];

describe('readHttpFailure', () => {
  it.each(rows)('is total for: $name', ({ input, expected }) => {
    let result;
    expect(() => {
      result = readHttpFailure(input);
    }).not.toThrow();
    expect(result).toEqual(expected);
  });

  it('never invents a fallback sentence: an absent message stays absent', () => {
    expect(readHttpFailure(httpError(500, {})).message).toBeUndefined();
    expect(readHttpFailure(bare('x')).message).toBeUndefined();
  });
});
