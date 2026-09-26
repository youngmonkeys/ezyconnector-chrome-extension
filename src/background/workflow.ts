import { WorkflowCommand, WorkflowPayload } from './types';

type Values = Record<string, unknown>;
type CommandHandler = (args: Values) => Promise<unknown>;
const handlers = new Map<string, CommandHandler>();
const LOG_PREFIX = '[EzyConnector][Workflow]';
interface DownloadedFile { base64: string; name: string; type: string }

function requiredString(args: Values, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}

function requiredTabId(args: Values): number {
  if (!Number.isInteger(args.tabId)) throw new Error('tabId must be an integer');
  return args.tabId as number;
}

async function waitForTab(tab: chrome.tabs.Tab, timeoutMs: number): Promise<chrome.tabs.Tab> {
  if (tab.status === 'complete') return tab;
  if (tab.id === undefined) throw new Error('Tab does not have an id');
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: chrome.tabs.Tab) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve(value as chrome.tabs.Tab);
    };
    const listener = (id: number, info: chrome.tabs.TabChangeInfo, updated: chrome.tabs.Tab) => {
      if (id === tab.id && info.status === 'complete') finish(undefined, updated);
    };
    const timeout = setTimeout(() => finish(new Error('Timed out waiting for tab to load')), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function isAtUrl(tabUrl: string | undefined, url: string): boolean {
  return tabUrl === url || tabUrl?.startsWith(`${url}?`) === true || tabUrl?.startsWith(`${url}#`) === true;
}

handlers.set('tab.ensure', async (args) => {
  const url = requiredString(args, 'url');
  const tabs = await chrome.tabs.query({
    url: typeof args.urlPattern === 'string' ? args.urlPattern : url,
  });
  const matched = tabs.find((candidate) => isAtUrl(candidate.url, url)) ?? tabs[0];
  let tab: chrome.tabs.Tab;
  if (!matched) {
    tab = await chrome.tabs.create({ url, active: args.active !== false });
  } else if (matched.id === undefined) {
    throw new Error('Could not create or find tab');
  } else if (isAtUrl(matched.url, url)) {
    tab = matched;
  } else {
    tab = await chrome.tabs.update(matched.id, { url });
  }
  if (tab.id === undefined) throw new Error('Could not create or find tab');
  if (args.active !== false) {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  }
  const loaded = await waitForTab(tab, Number(args.timeoutMs) || 15000);
  return { id: loaded.id, windowId: loaded.windowId, url: loaded.url };
});

handlers.set('tab.create', (args) => chrome.tabs.create({
  url: requiredString(args, 'url'),
  active: args.active !== false,
}));
handlers.set('tab.update', (args) => chrome.tabs.update(
  requiredTabId(args),
  args.properties as chrome.tabs.UpdateProperties,
));
handlers.set('tab.reload', async (args) => {
  await chrome.tabs.reload(requiredTabId(args));
  return true;
});
handlers.set('tab.remove', async (args) => {
  await chrome.tabs.remove(requiredTabId(args));
  return true;
});
handlers.set('delay', async (args) => {
  const minimum = Number(args.minDurationMs ?? args.durationMs) || 0;
  const maximum = Number(args.maxDurationMs ?? args.durationMs) || minimum;
  if (minimum < 0 || maximum < minimum) {
    throw new Error('delay requires 0 <= minDurationMs <= maxDurationMs');
  }
  const durationMs = Math.min(
    Math.floor(Math.random() * (maximum - minimum + 1)) + minimum,
    60000,
  );
  const startedAt = Date.now();
  console.info(LOG_PREFIX, 'delay started', {
    timerContext: Number.isInteger(args.tabId) ? 'tab' : 'service-worker',
    tabId: args.tabId,
    minDurationMs: minimum,
    maxDurationMs: maximum,
    selectedDurationMs: durationMs,
  });
  if (Number.isInteger(args.tabId)) {
    await chrome.scripting.executeScript({
      target: { tabId: args.tabId as number },
      world: 'MAIN',
      func: (delayMs) => new Promise((resolve) => window.setTimeout(resolve, delayMs)),
      args: [durationMs],
    });
  } else {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }
  const actualDurationMs = Date.now() - startedAt;
  console.info(LOG_PREFIX, 'delay completed', {
    selectedDurationMs: durationMs,
    actualDurationMs,
    timerContext: Number.isInteger(args.tabId) ? 'tab' : 'service-worker',
  });
  return { durationMs, actualDurationMs };
});

async function runDom(args: Values, action: string): Promise<unknown> {
  const selector = requiredString(args, 'selector');
  const timeoutMs = Math.max(0, Math.min(Number(args.timeoutMs) || 5000, 60000));
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: requiredTabId(args) },
    world: 'MAIN',
    func: async (operation, cssSelector, values, timeout) => {
      const deadline = Date.now() + timeout;
      let element: Element | null = null;
      do {
        element = document.querySelector(cssSelector);
        if (element) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      if (!(element instanceof HTMLElement)) throw new Error(`Element not found: ${cssSelector}`);
      if (operation === 'wait') return { found: true };
      if (operation === 'click') { element.click(); return { clicked: true }; }
      if (operation === 'fill') {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          throw new Error(`Element cannot receive a value: ${cssSelector}`);
        }
        const prototype = element instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        const value = String(values.value ?? '');
        valueSetter?.call(element, '');
        element.dispatchEvent(new Event('input', { bubbles: true }));
        const beforeTypeMinimum = Number(values.minBeforeTypeDelayMs) || 0;
        const beforeTypeMaximum = Number(values.maxBeforeTypeDelayMs) || beforeTypeMinimum;
        if (beforeTypeMinimum < 0 || beforeTypeMaximum < beforeTypeMinimum || beforeTypeMaximum > 5000) {
          throw new Error('Invalid before-type delay range');
        }
        if (beforeTypeMaximum > 0) {
          const duration = Math.floor(
            Math.random() * (beforeTypeMaximum - beforeTypeMinimum + 1),
          ) + beforeTypeMinimum;
          await new Promise((resolve) => setTimeout(resolve, duration));
        }
        const minimum = Number(values.minCharacterDelayMs) || 0;
        const maximum = Number(values.maxCharacterDelayMs) || minimum;
        if (minimum < 0 || maximum < minimum || maximum > 5000) {
          throw new Error('Invalid character delay range');
        }
        if (maximum > 0) {
          let typedValue = '';
          for (const character of value) {
            element.dispatchEvent(new KeyboardEvent('keydown', {
              key: character, bubbles: true, cancelable: true,
            }));
            typedValue += character;
            valueSetter?.call(element, typedValue);
            element.dispatchEvent(new InputEvent('input', {
              inputType: 'insertText', data: character, bubbles: true,
            }));
            element.dispatchEvent(new KeyboardEvent('keyup', {
              key: character, bubbles: true,
            }));
            const duration = Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
            await new Promise((resolve) => setTimeout(resolve, duration));
          }
        } else {
          valueSetter?.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.focus();
        return { filled: true };
      }
      if (operation === 'assertTextAbsent') {
        const text = String(values.text ?? '');
        if (!text) throw new Error('text is required');
        if (element.innerText.includes(text)) {
          throw new Error(String(values.errorMessage || `Text is present: ${text}`));
        }
        return { absent: true };
      }
      if (operation === 'keypress') {
        element.focus();
        const key = String(values.key ?? 'Enter');
        element.dispatchEvent(new KeyboardEvent('keydown', {
          key, code: key, bubbles: true, cancelable: true,
        }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
        return { key };
      }
      throw new Error(`Unsupported DOM operation: ${operation}`);
    },
    args: [action, selector, args, timeoutMs],
  });
  return result;
}

for (const action of ['wait', 'click', 'fill', 'keypress', 'assertTextAbsent']) {
  handlers.set(`dom.${action}`, (args) => runDom(args, action));
}

handlers.set('dom.uploadRemoteFiles', async (args) => {
  const urls = args.urls;
  if (!Array.isArray(urls) || urls.some((url) => typeof url !== 'string')) {
    throw new Error('urls must be an array of strings');
  }
  const files: DownloadedFile[] = await Promise.all(urls.map(async (rawUrl, index) => {
    const url = new URL(rawUrl as string);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
      throw new Error(`File URL must use HTTPS: ${url.origin}`);
    }
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Could not download file (HTTP ${response.status})`);
    const blob = await response.blob();
    if (blob.size > 10 * 1024 * 1024) throw new Error(`File ${index + 1} exceeds 10 MB`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return {
      base64: btoa(binary),
      name: url.pathname.split('/').pop() || `file-${index + 1}`,
      type: blob.type || 'application/octet-stream',
    };
  }));
  const selector = requiredString(args, 'selector');
  const triggerSelector = typeof args.triggerSelector === 'string' ? args.triggerSelector : '';
  const timeoutMs = Math.max(0, Math.min(Number(args.timeoutMs) || 5000, 60000));
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: requiredTabId(args) },
    world: 'MAIN',
    func: async (inputSelector, buttonSelector, downloaded, timeout) => {
      const assign = (input: HTMLInputElement): number => {
        const transfer = new DataTransfer();
        downloaded.forEach((file) => {
          const binary = atob(file.base64);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          transfer.items.add(new File([bytes], file.name, { type: file.type }));
        });
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return input.files.length;
      };
      const existing = document.querySelector(inputSelector);
      if (existing instanceof HTMLInputElement && existing.type === 'file') return assign(existing);
      if (!buttonSelector) throw new Error(`File input not found: ${inputSelector}`);
      return new Promise<number>((resolve, reject) => {
        const originalClick = window.HTMLInputElement.prototype.click;
        const timer = window.setTimeout(() => {
          window.HTMLInputElement.prototype.click = originalClick;
          reject(new Error(`Timed out waiting for file input: ${inputSelector}`));
        }, timeout);
        window.HTMLInputElement.prototype.click = function(): void {
          if (this.type !== 'file' || !this.matches(inputSelector)) {
            originalClick.call(this);
            return;
          }
          window.clearTimeout(timer);
          window.HTMLInputElement.prototype.click = originalClick;
          resolve(assign(this));
        };
        const trigger = document.querySelector(buttonSelector);
        if (!(trigger instanceof HTMLElement)) {
          window.clearTimeout(timer);
          window.HTMLInputElement.prototype.click = originalClick;
          reject(new Error(`Upload trigger not found: ${buttonSelector}`));
        } else trigger.click();
      });
    },
    args: [selector, triggerSelector, files, timeoutMs],
  });
  return { uploaded: result };
});

function lookup(reference: string, outputs: Values): unknown {
  return reference.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') throw new Error(`Unknown reference: ${reference}`);
    return (value as Values)[part];
  }, outputs);
}

function resolve(value: unknown, outputs: Values): unknown {
  if (typeof value === 'string') {
    const exact = /^\$\{([^}]+)\}$/.exec(value);
    return exact
      ? lookup(exact[1], outputs)
      : value.replace(/\$\{([^}]+)\}/g, (_, ref) => String(lookup(ref, outputs)));
  }
  if (Array.isArray(value)) return value.map((item) => resolve(item, outputs));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, outputs)]));
  }
  return value;
}

export async function executeWorkflow(
  requestId: string,
  payload: WorkflowPayload,
): Promise<Values> {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.commands)) {
    throw new Error('Invalid workflow payload or unsupported version');
  }
  if (payload.commands.length > 100) throw new Error('Workflow exceeds 100 commands');
  const outputs: Values = {};
  const workflowStartedAt = Date.now();
  console.info(LOG_PREFIX, 'workflow started', {
    requestId,
    version: payload.version,
    commandCount: payload.commands.length,
    startedAt: new Date(workflowStartedAt).toISOString(),
  });
  for (const [index, command] of payload.commands.entries()) {
    validateCommand(command, index);
    const handler = handlers.get(command.name);
    if (!handler) throw new Error(`Unknown command: ${command.name}`);
    const args = resolve(command.args ?? {}, outputs) as Values;
    const commandStartedAt = Date.now();
    console.info(LOG_PREFIX, 'command started', {
      requestId,
      stepIndex: index,
      command: command.name,
      saveAs: command.saveAs,
      args: summarizeArgs(command.name, args),
      startedAt: new Date(commandStartedAt).toISOString(),
      elapsedSinceWorkflowStartMs: commandStartedAt - workflowStartedAt,
    });
    try {
      const result = await handler(args);
      outputs[command.saveAs ?? String(index)] = result;
      console.info(LOG_PREFIX, 'command completed', {
        requestId,
        stepIndex: index,
        command: command.name,
        durationMs: Date.now() - commandStartedAt,
        elapsedSinceWorkflowStartMs: Date.now() - workflowStartedAt,
        result: summarizeResult(command.name, result),
      });
    } catch (error) {
      console.error(LOG_PREFIX, 'command failed', {
        requestId,
        stepIndex: index,
        command: command.name,
        durationMs: Date.now() - commandStartedAt,
        elapsedSinceWorkflowStartMs: Date.now() - workflowStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  console.info(LOG_PREFIX, 'workflow completed', {
    requestId,
    durationMs: Date.now() - workflowStartedAt,
    commandCount: payload.commands.length,
  });
  return outputs;
}

function summarizeArgs(command: string, args: Values): Values {
  const summary: Values = {};
  for (const key of [
    'tabId', 'url', 'urlPattern', 'selector', 'triggerSelector', 'timeoutMs',
    'durationMs', 'minDurationMs', 'maxDurationMs', 'minBeforeTypeDelayMs',
    'maxBeforeTypeDelayMs', 'minCharacterDelayMs', 'maxCharacterDelayMs', 'key', 'text',
  ]) {
    if (args[key] !== undefined) summary[key] = args[key];
  }
  if (command === 'dom.fill') summary.valueLength = String(args.value ?? '').length;
  if (command === 'dom.uploadRemoteFiles') {
    summary.fileCount = Array.isArray(args.urls) ? args.urls.length : 0;
  }
  return summary;
}

function summarizeResult(command: string, result: unknown): unknown {
  if (command === 'dom.uploadRemoteFiles' || command === 'delay' || command.startsWith('tab.')) {
    return result;
  }
  return result && typeof result === 'object' ? result : undefined;
}

function validateCommand(command: WorkflowCommand, index: number): void {
  if (!command || typeof command.name !== 'string') throw new Error(`Invalid command at index ${index}`);
  if (command.saveAs && !/^[A-Za-z][A-Za-z0-9_]*$/.test(command.saveAs)) {
    throw new Error(`Invalid saveAs at index ${index}`);
  }
}
