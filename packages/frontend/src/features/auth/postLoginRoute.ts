import { api } from '../../services/api';

/**
 * Where to send someone the moment they finish signing in.
 *
 * Everyone without a second factor goes to /mfa-setup first, including those
 * who still have skips left — the screen offers them a way out, so it costs a
 * click, not access. This is the nudge; `mfaEnrollmentGate` on the backend is
 * the rule.
 *
 * Never blocks the login itself. If the status call fails, the user goes where
 * they were always going and the gate catches them on their first real request.
 */
export async function postLoginRoute(role?: string): Promise<string> {
  const home = role === 'provider' ? '/portal' : '/';

  try {
    const { data } = await api.get<{ data: { enrolled: boolean } }>('/auth/mfa/status');
    return data.data.enrolled ? home : '/mfa-setup';
  } catch {
    return home;
  }
}
