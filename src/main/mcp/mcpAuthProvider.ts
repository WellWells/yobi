import { randomBytes } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { clearAuthRecord, getAuthRecord, setAuthRecord } from './mcpTokenStore';

export interface McpAuthProviderDeps {
  isInteractive: () => boolean;
  openBrowser: (url: string) => Promise<void>;
  onNeedsAuth: () => void;
}

export class McpAuthProvider implements OAuthClientProvider {
  private codeVerifierValue: string | undefined;
  private readonly stateValue = randomBytes(16).toString('base64url');

  constructor(
    private readonly serverId: string,
    private readonly callbackUrl: string,
    private readonly deps: McpAuthProviderDeps,
  ) {}

  get expectedState(): string {
    return this.stateValue;
  }

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Yobi',
      redirect_uris: [this.callbackUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return getAuthRecord(this.serverId)?.client;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    setAuthRecord(this.serverId, { ...(getAuthRecord(this.serverId) ?? {}), client: clientInformation });
  }

  tokens(): OAuthTokens | undefined {
    return getAuthRecord(this.serverId)?.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    setAuthRecord(this.serverId, { ...(getAuthRecord(this.serverId) ?? {}), tokens });
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.codeVerifierValue) throw new Error('No PKCE code verifier saved for this authorization');
    return this.codeVerifierValue;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.deps.isInteractive()) {
      this.deps.onNeedsAuth();
      return;
    }
    await this.deps.openBrowser(authorizationUrl.toString());
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'verifier' || scope === 'all') this.codeVerifierValue = undefined;
    if (scope === 'all') {
      clearAuthRecord(this.serverId);
      return;
    }
    const record = getAuthRecord(this.serverId);
    if (!record) return;
    if (scope === 'client') setAuthRecord(this.serverId, { ...record, client: undefined });
    if (scope === 'tokens') setAuthRecord(this.serverId, { ...record, tokens: undefined });
  }
}
