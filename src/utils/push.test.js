import { urlBase64ToUint8Array } from './push';

test('decodes a standard base64 string into the matching bytes', () => {
  // "hello" base64-encoded
  const result = urlBase64ToUint8Array('aGVsbG8=');
  expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]);
});

test('decodes a URL-safe base64 string (- and _, no padding)', () => {
  // bytes [0xfb, 0xff, 0xbf] base64url-encoded (no "+", "/", or "=" needed to demonstrate translation)
  const standard = Buffer.from([0xfb, 0xff, 0xbf]).toString('base64'); // "+/+/"
  const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const result = urlBase64ToUint8Array(urlSafe);

  expect(Array.from(result)).toEqual([0xfb, 0xff, 0xbf]);
});

test('returns a Uint8Array', () => {
  const result = urlBase64ToUint8Array('aGVsbG8=');
  expect(result).toBeInstanceOf(Uint8Array);
});
