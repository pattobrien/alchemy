export {
  TAILSCALE_API_KEY_ENV,
  TAILSCALE_AUTH_PROVIDER_NAME,
  TAILSCALE_OAUTH_CLIENT_ID_ENV,
  TAILSCALE_OAUTH_CLIENT_SECRET_ENV,
  TailscaleAuth,
  type TailscaleAuthConfig,
  type TailscaleResolvedCredentials,
} from "./AuthProvider.ts";
export * from "./Credentials.ts";
export * from "./Policy.ts";
export * from "./Providers.ts";
