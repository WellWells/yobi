import type { SmtpConfig } from './configTypes';

/**
 * Whether the saved SMTP account has what sending needs: host, user and password. The one
 * definition both the email step and flow readiness use, so a build cannot call an account
 * "not set up" that the step would send with, or the other way round.
 */
export function isSmtpAccountComplete(smtp: Pick<SmtpConfig, 'host' | 'user' | 'password'> | undefined): boolean {
  return Boolean(smtp?.host && smtp.user && smtp.password);
}
