import "@testing-library/jest-dom";

// This setup runs for every test file. React tests use jsdom; Node-only
// tests (api/lib/__tests__/*) run in the "node" env and have no `window`.
// Guard the matchMedia stub so the Node tests don't crash on import.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
