/**
 * Vitest Setup File
 * Runs before all tests to setup global mocks and environment
 */

import { vi, beforeEach } from 'vitest';

// Mock IndexedDB (not available in Node.js)
global.indexedDB = {
  open: vi.fn(),
  deleteDatabase: vi.fn(),
} as any;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock as any;

// Mock navigator.onLine
Object.defineProperty(global.navigator, 'onLine', {
  writable: true,
  value: true,
});

// Mock window.addEventListener for online/offline events
global.addEventListener = vi.fn();
global.removeEventListener = vi.fn();

// Mock crypto.randomUUID
Object.defineProperty(global, 'crypto', {
  value: {
    ...global.crypto,
    randomUUID: () => `test-uuid-${Math.random().toString(36).substring(2, 15)}`,
  },
  writable: true,
  configurable: true,
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
});
