import test from "node:test";
import assert from "node:assert/strict";

import authReducer, {
  setSession,
  setUser,
  setStatus,
  clearSession,
} from "../src/store/authSlice.js";

const initial = authReducer(undefined, { type: "@@INIT" });

test("auth state starts in the checking state with no stored token", () => {
  assert.equal(initial.status, "checking");
  assert.equal(initial.user, null);
  assert.equal(initial.accessToken, null);
  assert.equal(initial.isAuthenticated, false);
});

test("setSession stores the access token in memory only", () => {
  const user = { id: "user-1", role: "CUSTOMER" };
  const state = authReducer(
    initial,
    setSession({ user, accessToken: "short-lived-access-token" })
  );

  assert.equal(state.status, "authenticated");
  assert.equal(state.isAuthenticated, true);
  assert.deepEqual(state.user, user);
  assert.equal(state.accessToken, "short-lived-access-token");
});

test("clearSession removes the access token and marks the session anonymous", () => {
  const authenticated = authReducer(
    initial,
    setSession({ user: { id: "user-1" }, accessToken: "token" })
  );
  const state = authReducer(authenticated, clearSession());

  assert.equal(state.status, "anonymous");
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.user, null);
  assert.equal(state.accessToken, null);
});

test("setUser updates profile data without changing the token or status", () => {
  const authenticated = authReducer(
    initial,
    setSession({ user: { id: "user-1", role: "CUSTOMER" }, accessToken: "token" })
  );
  const state = authReducer(
    authenticated,
    setUser({ id: "user-1", role: "OFFICER" })
  );

  assert.equal(state.accessToken, "token");
  assert.equal(state.status, "authenticated");
  assert.equal(state.user.role, "OFFICER");
});

test("setStatus supports the bootstrap transition", () => {
  const checking = authReducer(initial, setStatus("checking"));
  assert.equal(checking.status, "checking");
  assert.equal(checking.isAuthenticated, false);
});
