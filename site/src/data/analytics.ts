// Cloudflare Web Analytics, the cookie-free beacon.
// The token is public: it is printed into the page. It is not a Worker secret, and a runtime
// variable on the Worker never reaches this file, because the page is built before it is deployed.
//
// Leave both empty to ship with no beacon (the site still builds). Set one of them:
//   PUBLIC_CF_BEACON_TOKEN   the build environment, which wins if both are set
//   TOKEN_IN_SOURCE          paste the token here
//
// Lin, in the Cloudflare dashboard: Analytics & logs → Web Analytics → Add a site →
// linercode.dev. Choose the manual snippet, not automatic injection (that would load the
// beacon twice). Copy the token out of data-cf-beacon='{"token":"..."}' and set it as a
// build variable named PUBLIC_CF_BEACON_TOKEN for the liner-code Worker build (root directory
// site, command npm run build), then redeploy. The beacon is the marketing site only. It does
// not change what the app sends.
const TOKEN_IN_SOURCE = '';

function fromEnv(): string {
  try {
    return (process.env.PUBLIC_CF_BEACON_TOKEN ?? '').trim();
  } catch {
    return '';
  }
}

export const CF_BEACON_TOKEN = fromEnv() || TOKEN_IN_SOURCE.trim();
