import "@testing-library/jest-dom/vitest";

if (typeof window.localStorage?.getItem !== "function") {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      }
    }
  });
}

Object.defineProperty(window, "EventSource", {
  configurable: true,
  value: undefined,
  writable: true
});

if (!HTMLElement.prototype.attachInternals) {
  Object.defineProperty(HTMLElement.prototype, "attachInternals", {
    configurable: true,
    value() {
      return {
        ariaLabel: "",
        ariaLabelledByElements: null,
        ariaDescribedByElements: null,
        form: null,
        labels: [],
        role: "",
        states: new Set(),
        validationMessage: "",
        validity: {},
        willValidate: false,
        checkValidity: () => true,
        reportValidity: () => true,
        setFormValue: () => undefined,
        setValidity: () => undefined
      };
    }
  });
}
