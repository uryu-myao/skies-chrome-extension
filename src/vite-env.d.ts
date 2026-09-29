/// <reference types="vite/client" />

// The build target, fixed at compile time by vite.config.ts (`--mode firefox`
// builds Firefox; everything else, dev and tests included, is Chrome).
declare const __TARGET__: 'chrome' | 'firefox';
