export interface DomActionPayload {
  tabId?: number;
  selector?: string;
  value?: string;
}

async function resolveTabId(tabId?: number): Promise<number> {
  if (tabId !== undefined) return tabId;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error('No active tab found');
  }
  return activeTab.id;
}

function requireSelector(payload: DomActionPayload): string {
  if (!payload.selector) {
    throw new Error('selector is required');
  }
  return payload.selector;
}

export async function handleDomAction(type: string, payload: DomActionPayload): Promise<unknown> {
  const tabId = await resolveTabId(payload.tabId);

  switch (type) {
    case 'dom.getHtml': {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.outerHTML,
      });
      return result.result;
    }

    case 'dom.getText': {
      const selector = requireSelector(payload);
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel: string) => document.querySelector(sel)?.textContent ?? null,
        args: [selector],
      });
      return result.result;
    }

    case 'dom.click': {
      const selector = requireSelector(payload);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel: string) => {
          const el = document.querySelector(sel);
          if (el instanceof HTMLElement) el.click();
        },
        args: [selector],
      });
      return null;
    }

    case 'dom.fill': {
      const selector = requireSelector(payload);
      const value = payload.value ?? '';
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel: string, val: string) => {
          const el = document.querySelector(sel);
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        args: [selector, value],
      });
      return null;
    }

    default:
      throw new Error(`Unsupported dom action: ${type}`);
  }
}
