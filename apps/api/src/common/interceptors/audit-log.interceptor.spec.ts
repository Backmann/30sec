import { redactSecrets } from './audit-log.interceptor';

/**
 * The admin audit log stores request bodies so an action can be reconstructed
 * later. Some of those bodies carry credentials, and a log is the last place a
 * password should sit in plain text. These tests pin that behaviour down.
 */
describe('redactSecrets', () => {
  it('replaces a password while keeping the rest of the request', () => {
    expect(redactSecrets({ email: 'a@b.c', password: 'hunter2' })).toEqual({
      email: 'a@b.c',
      password: '[redacted]',
    });
  });

  it('does not care how the key is capitalised', () => {
    const out = redactSecrets({
      Password: 'x',
      newPassword: 'y',
      CONFIRMPASSWORD: 'z',
    });
    expect(Object.values(out)).toEqual(['[redacted]', '[redacted]', '[redacted]']);
  });

  it('reaches into nested objects', () => {
    expect(redactSecrets({ user: { profile: { password: 'deep' } }, keep: 'me' })).toEqual({
      user: { profile: { password: '[redacted]' } },
      keep: 'me',
    });
  });

  it('reaches into arrays', () => {
    expect(redactSecrets({ items: [{ token: 't' }, { code: '123456' }] })).toEqual({
      items: [{ token: '[redacted]' }, { code: '[redacted]' }],
    });
  });

  it('redacts a Google credential — it is a bearer of identity, not a name', () => {
    expect(redactSecrets({ credential: 'eyJhbGciOi' })).toEqual({ credential: '[redacted]' });
  });

  it('leaves ordinary fields untouched, or the log becomes useless', () => {
    const body = { title: 'Weekly', type: 'WEEKLY', startAt: '2026-10-01', maxPlayers: 8 };
    expect(redactSecrets(body)).toEqual(body);
  });

  it('passes primitives and null through unchanged', () => {
    expect(redactSecrets({ a: null, b: 5, c: true })).toEqual({ a: null, b: 5, c: true });
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('plain')).toBe('plain');
  });

  it('redacts a null-valued secret key too, so its presence is not signalled', () => {
    expect(redactSecrets({ password: null })).toEqual({ password: '[redacted]' });
  });

  it('survives deeply nested input without throwing', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'bottom' } } } } } } };
    expect(() => redactSecrets(deep)).not.toThrow();
  });

  it('does not mutate what it was given', () => {
    const body = { password: 'secret', nested: { token: 'abc' } };
    const copy = JSON.parse(JSON.stringify(body));
    redactSecrets(body);
    expect(body).toEqual(copy);
  });
});
