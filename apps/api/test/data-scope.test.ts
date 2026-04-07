import { describe, expect, it } from "vitest";

import { assignedUserScopeWhere, parseDataScope } from "../src/lib/data-scope.js";

describe("data-scope (Story 1.5)", () => {
  it("parseDataScope — valores inválidos caem em own", () => {
    expect(parseDataScope("all")).toBe("all");
    expect(parseDataScope("team")).toBe("team");
    expect(parseDataScope("own")).toBe("own");
    expect(parseDataScope("")).toBe("own");
    expect(parseDataScope("nope")).toBe("own");
  });

  it("assignedUserScopeWhere — all / own / team", () => {
    const uid = "00000000-0000-4000-8000-000000000001";
    const team = ["00000000-0000-4000-8000-000000000002"];

    expect(assignedUserScopeWhere("all", uid)).toEqual({});
    expect(assignedUserScopeWhere("own", uid)).toEqual({
      assignedUserId: uid,
    });
    expect(assignedUserScopeWhere("team", uid, team)).toEqual({
      assignedUserId: { in: [uid, ...team] },
    });
  });
});
