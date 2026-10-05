/**
 * Who may do what in the studio. Pure, so the layout, the pages and the
 * tests share one definition.
 *
 * - The **owner** sees and does everything.
 * - A **guest** (an account listed in `studio_guests`, e.g. dr@secret.com)
 *   sees only the Generate section and the history of what they generated.
 *   The owner can read every guest's history; a guest never sees anyone
 *   else's.
 */
export type StudioRole = "owner" | "guest";

/** What the database says about the signed-in account (`studio_role()`). */
export type DatabaseRole = "owner" | "guest" | "revoked";

/** Where each role lands after signing in, and where a guest is sent from any other page. */
export const HOME_BY_ROLE: Record<StudioRole, string> = { owner: "/", guest: "/generate" };

/** Sections a guest may open; everything else redirects to their home. */
const GUEST_SECTIONS = ["/generate"] as const;

export function homeFor(role: StudioRole): string {
  return HOME_BY_ROLE[role];
}

/** True when the role may open a navigation href (the section and its sub-pages). */
export function canOpen(role: StudioRole, href: string): boolean {
  if (role === "owner") return true;
  return GUEST_SECTIONS.some((section) => href === section || href.startsWith(`${section}/`));
}

/** Keeps the navigation items a role may open, in their order. */
export function navItemsFor<T extends { href: string }>(role: StudioRole, items: T[]): T[] {
  return items.filter((item) => canOpen(role, item.href));
}

/**
 * The role of a signed-in account, from the database's answer and the
 * `APP_OWNER_EMAIL` lock. A guest is whoever the guest list names; the owner
 * is anyone else who passes the email lock. A revoked guest, or an account
 * the lock refuses, gets null and is signed out.
 *
 * `databaseRole` is null when the database could not answer (for instance
 * before the guests migration ran): the studio then falls back to the email
 * lock alone, as it did before guests existed.
 */
export function resolveRole(input: {
  databaseRole: DatabaseRole | null;
  ownerAllowed: boolean;
}): StudioRole | null {
  if (input.databaseRole === "guest") return "guest";
  if (input.databaseRole === "revoked") return null;
  return input.ownerAllowed ? "owner" : null;
}

export function parseDatabaseRole(value: unknown): DatabaseRole | null {
  return value === "owner" || value === "guest" || value === "revoked" ? value : null;
}
