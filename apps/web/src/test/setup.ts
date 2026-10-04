import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { resetAccessState } from "@/features/auth/access";
import { ACCESS_KEY } from "@/services/api/mock/access";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom gaps the Radix primitives assume (select poppers, pointer capture).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

afterEach(() => {
  cleanup();
});

// Tests start with the demo gate open and an account chosen; the gate's own tests lock it.
beforeEach(() => {
  window.localStorage.setItem("planora.profile", "hamster_knight");
  window.localStorage.setItem(ACCESS_KEY, "1");
  resetAccessState();
});
