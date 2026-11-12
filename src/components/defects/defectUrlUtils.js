import { Linking } from 'react-native';

/**
 * Validates that a defect externalUrl is a well-formed HTTP or HTTPS URL and
 * strictly rejects unsafe or non-web schemes (such as `javascript:`, `file:`,
 * `data:`, `vbscript:`, `intent:`, `ftp:`, `mailto:`, etc.).
 *
 * @param {any} rawUrl
 * @returns {{
 *   isValid: boolean,
 *   normalizedUrl: string | null,
 *   protocol: string | null,
 *   hostname: string | null,
 *   reason: string | null
 * }}
 */
export function validateDefectExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string') {
    return {
      isValid: false,
      normalizedUrl: null,
      protocol: null,
      hostname: null,
      reason: 'EMPTY',
    };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      isValid: false,
      normalizedUrl: null,
      protocol: null,
      hostname: null,
      reason: 'EMPTY',
    };
  }

  // Reject embedded whitespace or control characters
  if (/[\u0000-\u001F\u007F\s]/.test(trimmed)) {
    return {
      isValid: false,
      normalizedUrl: null,
      protocol: null,
      hostname: null,
      reason: 'INVALID_CHARACTERS',
    };
  }

  // Explicitly check scheme prefix before URL parsing
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!schemeMatch) {
    return {
      isValid: false,
      normalizedUrl: null,
      protocol: null,
      hostname: null,
      reason: 'MISSING_PROTOCOL',
    };
  }

  const rawProtocol = `${schemeMatch[1].toLowerCase()}:`;
  if (rawProtocol !== 'http:' && rawProtocol !== 'https:') {
    return {
      isValid: false,
      normalizedUrl: null,
      protocol: rawProtocol,
      hostname: null,
      reason: 'UNSUPPORTED_PROTOCOL',
    };
  }

  // Require standard authority separator (http:// or https://)
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      isValid: false,
      normalizedUrl: null,
      protocol: rawProtocol,
      hostname: null,
      reason: 'INVALID_AUTHORITY',
    };
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = (parsed.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        isValid: false,
        normalizedUrl: null,
        protocol,
        hostname: null,
        reason: 'UNSUPPORTED_PROTOCOL',
      };
    }

    const hostname = (parsed.hostname || '').trim().toLowerCase();
    if (
      !hostname ||
      hostname.startsWith('.') ||
      hostname.endsWith('.') ||
      hostname.includes('..')
    ) {
      return {
        isValid: false,
        normalizedUrl: null,
        protocol,
        hostname: hostname || null,
        reason: 'INVALID_HOSTNAME',
      };
    }

    const isLocalhost = hostname === 'localhost';
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    const isIpv6 = hostname.startsWith('[') && hostname.endsWith(']');
    const isDomainWithTld =
      hostname.includes('.') &&
      /^[a-z0-9.-]+$/i.test(hostname) &&
      /\.[a-z0-9-]{2,}$/i.test(hostname);

    if (!isLocalhost && !isIpv4 && !isIpv6 && !isDomainWithTld) {
      return {
        isValid: false,
        normalizedUrl: null,
        protocol,
        hostname,
        reason: 'INVALID_HOSTNAME',
      };
    }

    return {
      isValid: true,
      normalizedUrl: parsed.toString(),
      protocol,
      hostname,
      reason: null,
    };
  } catch {
    return {
      isValid: false,
      normalizedUrl: null,
      protocol: rawProtocol,
      hostname: null,
      reason: 'INVALID_URL',
    };
  }
}

/**
 * Safely validates and opens a defect `externalUrl` via React Native's
 * `Linking.openURL()`, rejecting unsafe or malformed URLs and catching runtime
 * errors gracefully.
 *
 * @param {any} rawUrl
 * @param {{ linking?: { openURL: (url: string) => Promise<any> }, onError?: (message: string) => void }} [options]
 * @returns {Promise<{ ok: boolean, url: string | null, reason: string | null, error: string | null }>}
 */
export async function openDefectExternalUrl(rawUrl, options = {}) {
  const linkingApi =
    options && options.linking ? options.linking : Linking;
  const onError =
    options && typeof options.onError === 'function' ? options.onError : null;

  const validation = validateDefectExternalUrl(rawUrl);
  if (!validation.isValid || !validation.normalizedUrl) {
    const errorMsg =
      'Cannot open external link: only valid http:// or https:// URLs are supported.';
    if (onError) {
      onError(errorMsg);
    }
    return {
      ok: false,
      url: null,
      reason: validation.reason || 'INVALID_URL',
      error: errorMsg,
    };
  }

  try {
    if (!linkingApi || typeof linkingApi.openURL !== 'function') {
      throw new Error('Linking API is unavailable.');
    }
    await linkingApi.openURL(validation.normalizedUrl);
    return {
      ok: true,
      url: validation.normalizedUrl,
      reason: null,
      error: null,
    };
  } catch {
    const errorMsg =
      'Unable to open external issue link on this device. Please verify that a browser is installed.';
    if (onError) {
      onError(errorMsg);
    }
    return {
      ok: false,
      url: validation.normalizedUrl,
      reason: 'OPEN_FAILED',
      error: errorMsg,
    };
  }
}

export function formatShortTimestamp(value) {
  if (!value) return '—';
  const raw = String(value);
  if (raw.includes('T')) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().replace('T', ' ').slice(0, 16);
    }
  }
  return raw;
}
