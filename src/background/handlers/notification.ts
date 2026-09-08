export interface NotificationPayload {
  targetType?: string;
  data?: {
    zaloOaUserId?: string;
    [key: string]: unknown;
  };
}

const ZALO_OA_TAB_URL_PATTERN = 'https://oa.zalo.me/*';
const ZALO_OA_CHAT_URL = 'https://oa.zalo.me/chat';
const ZALO_OA_SEARCH_INPUT_SELECTOR = '.func_search input[type="search"]';
const ZALO_OA_SEARCH_INPUT_WAIT_MS = 15000;
const ZALO_OA_SEARCH_RESULT_SELECTOR = '.item_mess:not(.mess_links)';
const ZALO_OA_SEARCH_RESULT_WAIT_MS = 3000;

function openZaloOaTab(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: ZALO_OA_CHAT_URL, active: true }, (tab) => {
      if (!tab?.id) {
        reject(new Error('Failed to open oa.zalo.me tab'));
        return;
      }
      const tabId = tab.id;
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tabId);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

async function ensureZaloOaTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: ZALO_OA_TAB_URL_PATTERN });
  const existingTabId = tabs[0]?.id;
  if (existingTabId) {
    return existingTabId;
  }
  return openZaloOaTab();
}

interface SearchAndSelectResult {
  filled: boolean;
  selected: boolean;
}

async function fillZaloOaSearchAndSelectFirstResult(zaloOaUserId: string): Promise<SearchAndSelectResult> {
  const tabId = await ensureZaloOaTabId();

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (
      inputSelector: string,
      inputWaitMs: number,
      resultSelector: string,
      resultWaitMs: number,
      value: string,
    ): Promise<SearchAndSelectResult> => {
      async function waitForElement(selector: string, waitMs: number): Promise<Element | null> {
        const deadline = Date.now() + waitMs;
        let found: Element | null = null;
        while (Date.now() < deadline) {
          found = document.querySelector(selector);
          if (found) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return found;
      }

      const input = await waitForElement(inputSelector, inputWaitMs);
      if (!(input instanceof HTMLInputElement)) {
        return { filled: false, selected: false };
      }

      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeValueSetter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const firstResult = await waitForElement(resultSelector, resultWaitMs);
      if (!(firstResult instanceof HTMLElement)) {
        return { filled: true, selected: false };
      }

      firstResult.click();
      return { filled: true, selected: true };
    },
    args: [
      ZALO_OA_SEARCH_INPUT_SELECTOR,
      ZALO_OA_SEARCH_INPUT_WAIT_MS,
      ZALO_OA_SEARCH_RESULT_SELECTOR,
      ZALO_OA_SEARCH_RESULT_WAIT_MS,
      zaloOaUserId,
    ],
  });

  return result as SearchAndSelectResult;
}

export async function handleNotification(payload: NotificationPayload): Promise<unknown> {
  if (payload?.targetType !== 'ZALO_OA') {
    return null;
  }

  const zaloOaUserId = payload.data?.zaloOaUserId;
  if (!zaloOaUserId) {
    throw new Error('zaloOaUserId is missing in notification payload');
  }

  const { filled, selected } = await fillZaloOaSearchAndSelectFirstResult(zaloOaUserId);
  return { filled, selected, zaloOaUserId };
}
