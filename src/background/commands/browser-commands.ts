import { Command, CommandContext } from './types';

interface TabArgs { tabId?: number; }
interface SelectorArgs extends TabArgs { selector: string; timeoutMs?: number; }
interface FillArgs extends SelectorArgs { value?: string; }
interface KeypressArgs extends SelectorArgs { key: string; }
interface EnsureTabArgs { url: string; urlPattern?: string; active?: boolean; }
interface UploadRemoteFilesArgs extends SelectorArgs {
  urls: string[];
  acceptContains?: string;
  triggerSelector?: string;
}

const MAX_WAIT_MS = 60000;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}

function safeTimeout(value?: number): number {
  if (value === undefined) return 10000;
  if (!Number.isFinite(value) || value < 0 || value > MAX_WAIT_MS) {
    throw new Error(`timeoutMs must be between 0 and ${MAX_WAIT_MS}`);
  }
  return value;
}

function safeUrl(value: string, name: string): string {
  const url = new URL(requiredString(value, name));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString();
}

async function resolveTabId(tabId?: number): Promise<number> {
  if (tabId !== undefined) return tabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.id === undefined) throw new Error('No active tab found');
  return tab.id;
}

async function waitForTabComplete(tabId: number, timeoutMs = 30000): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ): void => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} did not finish loading`));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function simpleCommand<TArgs>(
  name: string,
  execute: (args: TArgs) => Promise<unknown>,
): Command<TArgs> {
  return { name, execute: (_context: CommandContext, args: TArgs) => execute(args) };
}

export const browserCommands: Command[] = [
  simpleCommand<EnsureTabArgs>('tab.ensure', async (args) => {
    const url = safeUrl(args.url, 'url');
    const pattern = args.urlPattern || url;
    const tabs = await chrome.tabs.query({ url: pattern });
    let tab = tabs[0];
    if (!tab) tab = await chrome.tabs.create({ url, active: args.active ?? true });
    if (tab.id === undefined) throw new Error('Unable to resolve tab id');
    if (args.active) await chrome.tabs.update(tab.id, { active: true });
    await waitForTabComplete(tab.id);
    return { id: tab.id, url: tab.url ?? url };
  }),

  simpleCommand<TabArgs>('dom.getHtml', async (args) => {
    const tabId = await resolveTabId(args.tabId);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.outerHTML,
    });
    return result.result;
  }),

  simpleCommand<SelectorArgs>('dom.getText', async (args) => {
    const tabId = await resolveTabId(args.tabId);
    const selector = requiredString(args.selector, 'selector');
    const [result] = await chrome.scripting.executeScript({
      target: { tabId }, func: (value: string) => document.querySelector(value)?.textContent ?? null,
      args: [selector],
    });
    return result.result;
  }),

  simpleCommand<SelectorArgs>('dom.wait', async (args) => {
    const tabId = await resolveTabId(args.tabId);
    const selector = requiredString(args.selector, 'selector');
    const timeoutMs = safeTimeout(args.timeoutMs);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (value: string, waitMs: number) => {
        const deadline = Date.now() + waitMs;
        while (Date.now() <= deadline) {
          if (document.querySelector(value)) return true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
      },
      args: [selector, timeoutMs],
    });
    if (!result.result) throw new Error(`Element not found: ${selector}`);
    return true;
  }),

  simpleCommand<SelectorArgs>('dom.click', async (args) => {
    const tabId = await resolveTabId(args.tabId);
    const selector = requiredString(args.selector, 'selector');
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (value: string) => {
        const element = document.querySelector(value);
        if (!(element instanceof HTMLElement)) return false;
        element.click();
        return true;
      },
      args: [selector], world: 'MAIN',
    });
    if (!result.result) throw new Error(`Clickable element not found: ${selector}`);
    return true;
  }),

  simpleCommand<FillArgs>('dom.fill', async (args) => {
    const tabId = await resolveTabId(args.tabId);
    const selector = requiredString(args.selector, 'selector');
    const value = String(args.value ?? '');
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (cssSelector: string, text: string) => {
        const element = document.querySelector(cssSelector);
        if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
          return false;
        }
        const prototype = element instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, text);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      args: [selector, value], world: 'MAIN',
    });
    if (!result.result) throw new Error(`Input element not found: ${selector}`);
    return true;
  }),

  simpleCommand<KeypressArgs>('dom.keypress', async (args) => {
    const tabId = await resolveTabId(args.tabId);
    const selector = requiredString(args.selector, 'selector');
    const key = requiredString(args.key, 'key');
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (cssSelector: string, keyboardKey: string) => {
        const element = document.querySelector(cssSelector);
        if (!(element instanceof HTMLElement)) return false;
        element.focus();
        const code = keyboardKey.length === 1 ? `Key${keyboardKey.toUpperCase()}` : keyboardKey;
        element.dispatchEvent(new KeyboardEvent('keydown', {
          key: keyboardKey, code, bubbles: true, cancelable: true,
        }));
        element.dispatchEvent(new KeyboardEvent('keyup', {
          key: keyboardKey, code, bubbles: true, cancelable: true,
        }));
        return true;
      },
      args: [selector, key], world: 'MAIN',
    });
    if (!result.result) throw new Error(`Element not found: ${selector}`);
    return true;
  }),

  simpleCommand<UploadRemoteFilesArgs>('dom.uploadRemoteFiles', async (args) => {
    const tabId = await resolveTabId(args.tabId);
    const selector = requiredString(args.selector, 'selector');
    if (!Array.isArray(args.urls) || !args.urls.length || args.urls.length > MAX_FILES) {
      throw new Error(`urls must contain between 1 and ${MAX_FILES} items`);
    }
    const files = await Promise.all(args.urls.map(async (source, index) => {
      const url = safeUrl(source, `urls[${index}]`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
      const blob = await response.blob();
      if (blob.size > MAX_FILE_BYTES) throw new Error(`File is larger than ${MAX_FILE_BYTES} bytes`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const pathname = new URL(url).pathname;
      return {
        base64: btoa(binary),
        name: decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || `file-${index + 1}`,
        type: blob.type || 'application/octet-stream',
      };
    }));
    const timeoutMs = safeTimeout(args.timeoutMs);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (inputSelector: string, triggerSelector: string | undefined, accept: string, waitMs: number, items: typeof files) => {
        const assign = (input: HTMLInputElement): number => {
          const transfer = new DataTransfer();
          for (const item of items) {
            const binary = atob(item.base64);
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            transfer.items.add(new File([bytes], item.name, { type: item.type }));
          }
          input.files = transfer.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return transfer.files.length;
        };
        const existing = document.querySelector(inputSelector);
        if (existing instanceof HTMLInputElement && existing.type === 'file') return assign(existing);
        if (!triggerSelector) return 0;
        return new Promise<number>((resolve) => {
          const originalClick = window.HTMLInputElement.prototype.click;
          const timeout = window.setTimeout(() => {
            window.HTMLInputElement.prototype.click = originalClick;
            resolve(0);
          }, waitMs);
          window.HTMLInputElement.prototype.click = function(): void {
            if (this.type !== 'file' || (accept && !this.accept.includes(accept))) {
              originalClick.call(this);
              return;
            }
            const count = assign(this);
            window.clearTimeout(timeout);
            window.HTMLInputElement.prototype.click = originalClick;
            resolve(count);
          };
          const trigger = document.querySelector(triggerSelector);
          if (trigger instanceof HTMLElement) trigger.click();
        });
      },
      args: [selector, args.triggerSelector, args.acceptContains ?? '', timeoutMs, files],
      world: 'MAIN',
    });
    if (!result.result) throw new Error('No files were assigned to the file input');
    return { count: result.result };
  }),
];
