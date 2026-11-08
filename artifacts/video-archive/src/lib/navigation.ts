/**
 * Match a navigation destination without accidentally activating similarly
 * prefixed routes (for example, /tags-extra while viewing /tags).
 */
export function isActiveNavigationRoute(href: string, location: string): boolean {
  if (href === "/") return location === "/";
  return (
    location === href ||
    location.startsWith(`${href}/`) ||
    location.startsWith(`${href}?`) ||
    location.startsWith(`${href}#`)
  );
}
