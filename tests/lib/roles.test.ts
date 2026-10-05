import { describe, expect, it } from "vitest";

import { canOpen, homeFor, navItemsFor, parseDatabaseRole, resolveRole } from "@/lib/auth/roles";
import { NAV_ITEMS } from "@/components/layout/nav-items";

describe("studio roles", () => {
  it("a listed guest is a guest whatever the owner lock says", () => {
    expect(resolveRole({ databaseRole: "guest", ownerAllowed: false })).toBe("guest");
    expect(resolveRole({ databaseRole: "guest", ownerAllowed: true })).toBe("guest");
  });

  it("anyone else who passes the owner lock is the owner", () => {
    expect(resolveRole({ databaseRole: "owner", ownerAllowed: true })).toBe("owner");
    expect(resolveRole({ databaseRole: "owner", ownerAllowed: false })).toBeNull();
  });

  it("a revoked guest is signed out even when the lock would let them in", () => {
    expect(resolveRole({ databaseRole: "revoked", ownerAllowed: true })).toBeNull();
  });

  it("falls back to the email lock when the database cannot answer", () => {
    expect(resolveRole({ databaseRole: null, ownerAllowed: true })).toBe("owner");
    expect(resolveRole({ databaseRole: null, ownerAllowed: false })).toBeNull();
  });

  it("reads only the three known database answers", () => {
    expect(parseDatabaseRole("guest")).toBe("guest");
    expect(parseDatabaseRole("revoked")).toBe("revoked");
    expect(parseDatabaseRole("admin")).toBeNull();
    expect(parseDatabaseRole(null)).toBeNull();
  });
});

describe("what a guest may open", () => {
  it("is Generate and its sub-pages only", () => {
    expect(canOpen("guest", "/generate")).toBe(true);
    expect(canOpen("guest", "/generate/anything")).toBe(true);
    expect(canOpen("guest", "/")).toBe(false);
    expect(canOpen("guest", "/library")).toBe(false);
    expect(canOpen("guest", "/settings")).toBe(false);
    expect(canOpen("guest", "/generated")).toBe(false);
  });

  it("filters the navigation down to Generate for guests and keeps it whole for the owner", () => {
    expect(navItemsFor("guest", NAV_ITEMS).map((item) => item.href)).toEqual(["/generate"]);
    expect(navItemsFor("owner", NAV_ITEMS)).toEqual(NAV_ITEMS);
  });

  it("sends each role to its own home", () => {
    expect(homeFor("owner")).toBe("/");
    expect(homeFor("guest")).toBe("/generate");
  });
});
