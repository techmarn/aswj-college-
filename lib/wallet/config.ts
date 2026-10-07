import 'server-only';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type WalletEnvironment = 'dev' | 'production';

type WalletBaseConfiguration = {
  environment: WalletEnvironment;
  idSecret: string;
  appBaseUrl: string;
  appHostname: string;
};

export type AppleWalletConfiguration = WalletBaseConfiguration & {
  passTypeIdentifier: string;
  teamIdentifier: string;
  signerCertPem: string;
  privateKeyPkcs8Pem: string;
  wwdrPem: string;
};

export type GoogleWalletConfiguration = WalletBaseConfiguration & {
  issuerId: string;
  classId: string;
  clientEmail: string;
  privateKeyPkcs8Pem: string;
};

export type WalletProviderConfigurationStatus<T> =
  | { state: 'disabled'; missing: [] }
  | { state: 'not_configured'; missing: string[] }
  | { state: 'ready'; missing: []; config: T };

type WalletBaseStatus =
  | { state: 'disabled'; missing: [] }
  | { state: 'not_configured'; missing: string[] }
  | { state: 'ready'; missing: []; config: WalletBaseConfiguration };

type ServiceAccount = {
  type?: unknown;
  client_email?: unknown;
  private_key?: unknown;
};

function clean(value: string | undefined) {
  return value?.trim() ?? '';
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function safeSecret(value: string) {
  return value.length >= 32
    && value.length <= 500
    && !/[\s\u0000-\u001f\u007f]/.test(value);
}

function normalizedBaseUrl(value: string) {
  try {
    const url = new URL(value);
    const localDevelopment = process.env.NODE_ENV !== 'production'
      && ['localhost', '127.0.0.1'].includes(url.hostname);

    if (
      (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:'))
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function supabaseProjectRef(value: string) {
  try {
    const match = new URL(value).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function safeProjectRef(value: string) {
  return /^[a-z0-9]{20}$/.test(value) ? value : null;
}

function decodeBase64Text(value: string, maximumBytes = 100_000) {
  if (!value || value.length > Math.ceil(maximumBytes * 1.5)) return null;

  try {
    const buffer = Buffer.from(value, 'base64');
    if (!buffer.length || buffer.length > maximumBytes) return null;
    const normalizedInput = value.replace(/\s+/g, '').replace(/=+$/, '');
    const normalizedRoundTrip = buffer.toString('base64').replace(/=+$/, '');
    if (normalizedInput !== normalizedRoundTrip) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

function isPem(value: string | null, label: string) {
  if (!value || /\u0000/.test(value)) return false;
  return value.includes(`-----BEGIN ${label}-----`)
    && value.includes(`-----END ${label}-----`);
}

function getWalletBaseStatus(): WalletBaseStatus {
  if (clean(process.env.WALLET_PASSES_ENABLED).toLowerCase() !== 'true') {
    return { state: 'disabled', missing: [] };
  }

  const missing: string[] = [];
  const environmentValue = clean(process.env.WALLET_ENVIRONMENT).toLowerCase();
  const environment = environmentValue === 'dev' || environmentValue === 'production'
    ? environmentValue
    : null;
  const idSecret = clean(process.env.WALLET_ID_SECRET);
  const rawBaseUrl = clean(process.env.WALLET_APP_BASE_URL)
    || clean(process.env.EMAIL_APP_BASE_URL);
  const appUrl = normalizedBaseUrl(rawBaseUrl);
  const currentProjectRef = supabaseProjectRef(clean(process.env.NEXT_PUBLIC_SUPABASE_URL));
  const expectedProjectRef = safeProjectRef(
    clean(process.env.WALLET_EXPECTED_SUPABASE_PROJECT_REF).toLowerCase()
  );
  const productionProjectRef = safeProjectRef(
    clean(process.env.WALLET_PRODUCTION_SUPABASE_PROJECT_REF).toLowerCase()
  );
  const isVercelProduction = process.env.VERCEL_ENV === 'production';

  if (!environment) missing.push('WALLET_ENVIRONMENT');
  if (!safeSecret(idSecret)) missing.push('WALLET_ID_SECRET');
  if (!appUrl) missing.push('WALLET_APP_BASE_URL');
  if (!currentProjectRef) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!expectedProjectRef || currentProjectRef !== expectedProjectRef) {
    missing.push('WALLET_EXPECTED_SUPABASE_PROJECT_REF');
  }
  if (isVercelProduction && environment !== 'production') {
    missing.push('WALLET_ENVIRONMENT');
  }
  if (!isVercelProduction && environment !== 'dev') {
    missing.push('WALLET_ENVIRONMENT');
  }
  if (environment === 'production') {
    if (!productionProjectRef || currentProjectRef !== productionProjectRef) {
      missing.push('WALLET_PRODUCTION_SUPABASE_PROJECT_REF');
    }
  } else if (
    environment === 'dev'
    && (!productionProjectRef || currentProjectRef === productionProjectRef)
  ) {
    missing.push('WALLET_PRODUCTION_SUPABASE_PROJECT_REF');
  }

  if (missing.length || !environment || !appUrl) {
    return { state: 'not_configured', missing: unique(missing) };
  }

  return {
    state: 'ready',
    missing: [],
    config: {
      environment,
      idSecret,
      appBaseUrl: appUrl.origin,
      appHostname: appUrl.hostname,
    },
  };
}

export function getAppleWalletConfigurationStatus(): WalletProviderConfigurationStatus<AppleWalletConfiguration> {
  const base = getWalletBaseStatus();
  if (base.state !== 'ready') return base;

  const missing: string[] = [];
  const passTypeIdentifier = clean(process.env.APPLE_WALLET_PASS_TYPE_ID);
  const teamIdentifier = clean(process.env.APPLE_WALLET_TEAM_ID);
  const signerCertPem = decodeBase64Text(
    clean(process.env.APPLE_WALLET_SIGNER_CERT_PEM_BASE64)
  );
  const privateKeyPkcs8Pem = decodeBase64Text(
    clean(process.env.APPLE_WALLET_PRIVATE_KEY_PEM_BASE64)
  );
  const wwdrPem = decodeBase64Text(
    clean(process.env.APPLE_WALLET_WWDR_CERT_PEM_BASE64)
  );
  const officialBadgeAccepted = clean(
    process.env.APPLE_WALLET_BADGE_LICENSE_ACCEPTED
  ).toLowerCase() === 'true';
  const officialBadgeExists = existsSync(
    join(process.cwd(), 'public', 'wallet', 'add-to-apple-wallet.svg')
  );

  if (!/^pass\.[A-Za-z0-9.-]{3,200}$/.test(passTypeIdentifier)) {
    missing.push('APPLE_WALLET_PASS_TYPE_ID');
  }
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
    missing.push('APPLE_WALLET_TEAM_ID');
  }
  if (!isPem(signerCertPem, 'CERTIFICATE')) {
    missing.push('APPLE_WALLET_SIGNER_CERT_PEM_BASE64');
  }
  if (!isPem(privateKeyPkcs8Pem, 'PRIVATE KEY')) {
    missing.push('APPLE_WALLET_PRIVATE_KEY_PEM_BASE64');
  }
  if (!isPem(wwdrPem, 'CERTIFICATE')) {
    missing.push('APPLE_WALLET_WWDR_CERT_PEM_BASE64');
  }
  if (!officialBadgeAccepted || !officialBadgeExists) {
    missing.push('APPLE_WALLET_BADGE_LICENSE_ACCEPTED');
  }
  if (base.config.environment === 'dev' && !passTypeIdentifier.toLowerCase().includes('.dev')) {
    missing.push('APPLE_WALLET_PASS_TYPE_ID');
  }

  if (missing.length || !signerCertPem || !privateKeyPkcs8Pem || !wwdrPem) {
    return { state: 'not_configured', missing: unique(missing) };
  }

  return {
    state: 'ready',
    missing: [],
    config: {
      ...base.config,
      passTypeIdentifier,
      teamIdentifier,
      signerCertPem,
      privateKeyPkcs8Pem,
      wwdrPem,
    },
  };
}

export function getGoogleWalletConfigurationStatus(): WalletProviderConfigurationStatus<GoogleWalletConfiguration> {
  const base = getWalletBaseStatus();
  if (base.state !== 'ready') return base;

  const missing: string[] = [];
  const issuerId = clean(process.env.GOOGLE_WALLET_ISSUER_ID);
  const classId = clean(process.env.GOOGLE_WALLET_CLASS_ID);
  const serviceAccountText = decodeBase64Text(
    clean(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64),
    64_000
  );
  let serviceAccount: ServiceAccount | null = null;

  try {
    const parsed = JSON.parse(serviceAccountText ?? 'null');
    serviceAccount = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as ServiceAccount
      : null;
  } catch {
    serviceAccount = null;
  }

  const clientEmail = typeof serviceAccount?.client_email === 'string'
    ? serviceAccount.client_email.trim()
    : '';
  const privateKeyPkcs8Pem = typeof serviceAccount?.private_key === 'string'
    ? serviceAccount.private_key.trim()
    : '';

  if (!/^\d{12,30}$/.test(issuerId)) missing.push('GOOGLE_WALLET_ISSUER_ID');
  if (!new RegExp(`^${issuerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[A-Za-z0-9._-]{1,100}$`).test(classId)) {
    missing.push('GOOGLE_WALLET_CLASS_ID');
  }
  if (serviceAccount?.type !== 'service_account') {
    missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64');
  }
  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
    missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64');
  }
  if (!isPem(privateKeyPkcs8Pem, 'PRIVATE KEY')) {
    missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64');
  }
  if (base.config.environment === 'dev' && !classId.toLowerCase().includes('dev')) {
    missing.push('GOOGLE_WALLET_CLASS_ID');
  }

  if (missing.length) {
    return { state: 'not_configured', missing: unique(missing) };
  }

  return {
    state: 'ready',
    missing: [],
    config: {
      ...base.config,
      issuerId,
      classId,
      clientEmail,
      privateKeyPkcs8Pem,
    },
  };
}

export function getWalletAvailability() {
  const apple = getAppleWalletConfigurationStatus();
  const google = getGoogleWalletConfigurationStatus();
  return {
    apple: apple.state === 'ready',
    google: google.state === 'ready',
    enabled: apple.state !== 'disabled' || google.state !== 'disabled',
  };
}
