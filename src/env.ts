/**
 * Safari evicts script-writable storage (OPFS included) after seven days
 * without a visit, so a downloaded region can silently disappear.
 * Other iOS browsers run on WebKit too and may behave the same; that is
 * unverified and tracked in TODO.md, so only Safari itself is flagged here.
 */
export function isSafari(ua: string): boolean {
  if (!/Safari\//.test(ua) || !/AppleWebKit\//.test(ua)) return false;
  // Chrome, Edge, Firefox, Opera and friends on Apple and Android platforms.
  if (/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|EdgA?|OPR|OPiOS|SamsungBrowser|Android)\//.test(ua)) return false;
  if (/Android/.test(ua)) return false;
  return /Version\//.test(ua);
}
