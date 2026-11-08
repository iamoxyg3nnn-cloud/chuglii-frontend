import { describe, expect, it } from "vitest";
import { isActiveNavigationRoute } from "../navigation";

describe("isActiveNavigationRoute", () => {
  it("matches the root route only at the root", () => {
    expect(isActiveNavigationRoute("/", "/")).toBe(true);
    expect(isActiveNavigationRoute("/", "/browse")).toBe(false);
  });

  it("matches the exact route and nested routes", () => {
    expect(isActiveNavigationRoute("/tags", "/tags")).toBe(true);
    expect(isActiveNavigationRoute("/tags", "/tags/topic")).toBe(true);
  });

  it("supports query strings and fragments on the current route", () => {
    expect(isActiveNavigationRoute("/browse", "/browse?sort=popular")).toBe(true);
    expect(isActiveNavigationRoute("/browse", "/browse#results")).toBe(true);
  });

  it("does not match a route that merely shares the same prefix", () => {
    expect(isActiveNavigationRoute("/tags", "/tags-extra")).toBe(false);
    expect(isActiveNavigationRoute("/browse", "/browser")).toBe(false);
  });
});
