import { createDeskDropRuntime } from './runtime.js';

const KEY = Symbol.for('404ksg.roam-desk-drop.runtime');

export function createExtensionLifecycle(windowRef = globalThis.window) {
  let runtime;
  return {
    onload() {
      if (!windowRef?.document) throw new Error('Desk Drop 需要 Roam 浏览器环境。');
      windowRef[KEY]?.stop?.();
      runtime?.stop();
      delete windowRef[KEY];
      const next = createDeskDropRuntime({ windowRef });
      try {
        next.start(); runtime = next; windowRef[KEY] = next;
      } catch (error) {
        next.stop(); runtime = null; throw error;
      }
    },
    onunload() {
      const current = runtime; runtime = null;
      current?.stop();
      if (windowRef && windowRef[KEY] === current) delete windowRef[KEY];
    },
  };
}

export default createExtensionLifecycle();
