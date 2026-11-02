// Bridges API 403 STEP_UP_REQUIRED responses to a global verification prompt.
// The API interceptor waits for the prompt to obtain a fresh access token and
// then retries the original request once.
let handler = null;
let pending = null;

export const registerStepUpHandler = (nextHandler) => {
  handler = nextHandler;
};

export const requestStepUp = () => {
  if (pending) return pending;
  if (typeof handler !== "function") {
    return Promise.reject(new Error("Step-up verification is unavailable"));
  }

  pending = Promise.resolve()
    .then(() => handler())
    .finally(() => {
      pending = null;
    });

  return pending;
};
