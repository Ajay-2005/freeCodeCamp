import chai from 'chai';
import { toString as __toString } from 'lodash-es';
import * as curriculumHelpers from '@freecodecamp/curriculum-helpers';
import { format as __format } from './utils/format';

const ctx: Worker & typeof globalThis = self as unknown as Worker &
  typeof globalThis;

const __utils = (() => {
  const MAX_LOGS_SIZE = 64 * 1024;

  let logs: string[] = [];

  function flushLogs() {
    if (logs.length) {
      ctx.postMessage({
        type: 'LOG',
        data: logs.join('\n')
      });
      logs = [];
    }
  }

  function pushLogs(logs: string[], args: string[]) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    logs.push(args.map(arg => __format(arg)).join(' '));
    if (logs.join('\n').length > MAX_LOGS_SIZE) {
      flushLogs();
    }
  }

  const oldLog = ctx.console.log.bind(ctx.console);
  function proxyLog(...args: string[]) {
    pushLogs(logs, args);
    return oldLog(...args);
  }

  const oldInfo = ctx.console.info.bind(ctx.console);
  function proxyInfo(...args: string[]) {
    pushLogs(logs, args);
    return oldInfo(...args);
  }

  const oldWarn = ctx.console.warn.bind(ctx.console);
  function proxyWarn(...args: string[]) {
    pushLogs(logs, args);
    return oldWarn(...args);
  }

  const oldError = ctx.console.error.bind(ctx.console);
  function proxyError(...args: string[]) {
    pushLogs(logs, args);
    return oldError(...args);
  }

  function log(...msgs: Error[]) {
    if (msgs && msgs[0] && !(msgs[0] instanceof chai.AssertionError)) {
      // discards the stack trace via toString as it only useful to debug the
      // site, not a specific challenge.
      console.log(...msgs.map(msg => msg.toString()));
    }
  }

  const toggleProxyLogger = (on: unknown) => {
    ctx.console.log = on ? proxyLog : oldLog;
    ctx.console.info = on ? proxyInfo : oldInfo;
    ctx.console.warn = on ? proxyWarn : oldWarn;
    ctx.console.error = on ? proxyError : oldError;
  };

  return {
    log,
    toggleProxyLogger,
    flushLogs
  };
})();

// We can't simply import these because of how webpack names them when building
// the bundle. Since both assert and __helpers have to exist in the global
// scope, we have to declare them.
const assert = chai.assert;
const __helpers = curriculumHelpers;

// We freeze to prevent learners from getting the tester into a weird
// state by modifying these objects.
Object.freeze(self);
Object.freeze(__utils);
Object.freeze(assert);
Object.freeze(__helpers);

interface TestEvaluatorEvent extends MessageEvent {
  data: {
    code: {
      contents: string;
      editableContents: string;
    };
    firstTest: unknown;
    testString: string;
    build: string;
  };
}

/* Run the test if there is one.  If not just evaluate the user code */
ctx.onmessage = async (e: TestEvaluatorEvent) => {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const code = e.data?.code?.contents || '';
  const editableContents = e.data?.code?.editableContents || '';

  // Build errors should be reported, but only once:
  __utils.toggleProxyLogger(e.data.firstTest);
  /* eslint-enable @typescript-eslint/no-unused-vars */
  try {
    // This can be reassigned by the eval inside the try block, so it should be declared as a let
    // eslint-disable-next-line prefer-const
    let __userCodeWasExecuted = false;
    try {
      // Logging is proxyed after the build to catch console.log messages
      // generated during testing.
      await eval(`${e.data.build}
__utils.flushLogs();
__userCodeWasExecuted = true;
__utils.toggleProxyLogger(true);
(async () => {${e.data.testString}})()`);
    } catch (err) {
      if (__userCodeWasExecuted) {
        // rethrow error, since test failed.
        throw err;
      }
      // log build errors unless they're related to import/export/require (there
      // are challenges that use them and they should not trigger warnings)
      if (
        (err as Error).name !== 'ReferenceError' ||
        ((err as Error).message !== 'require is not defined' &&
          (err as Error).message !== 'exports is not defined')
      ) {
        __utils.log(err as Error);
      }
      // the tests may not require working code, so they are evaluated even if
      // the user code does not get executed.
      eval(e.data.testString);
    }
    __utils.flushLogs();
    ctx.postMessage({ pass: true });
  } catch (err) {
    // Errors from testing go to the browser console only.
    __utils.toggleProxyLogger(false);
    // Report execution errors in case user code has errors that are only
    // uncovered during testing.
    __utils.log(err as Error);
    // Now that all logs have been created we can flush them.
    __utils.flushLogs();
    ctx.postMessage({
      err: {
        message: (err as Error).message,
        stack: (err as Error).stack,
        expected: (err as { expected?: string }).expected,
        actual: (err as { actual?: string }).actual
      }
    });
  }
};

ctx.postMessage({ type: 'contentLoaded' });
