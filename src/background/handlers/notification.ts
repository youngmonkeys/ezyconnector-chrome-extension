export interface NotificationPayload {
  targetType?: string;
  data?: {
    zaloOaUserId?: string;
    message?: string;
    imageUrls?: string[];
    [key: string]: unknown;
  };
}

const ZALO_OA_TAB_URL_PATTERN = 'https://oa.zalo.me/*';
const ZALO_OA_CHAT_URL = 'https://oa.zalo.me/chat';
const ZALO_OA_SEARCH_INPUT_SELECTOR = '.func_search input[type="search"]';
const ZALO_OA_SEARCH_INPUT_WAIT_MS = 15000;
const ZALO_OA_SEARCH_RESULT_SELECTOR = '.item_mess:not(.mess_links)';
const ZALO_OA_SEARCH_RESULT_WAIT_MS = 3000;
const ZALO_OA_MESSAGE_INPUT_SELECTOR =
  '.content_mess_input textarea[placeholder="Nhập nội dung tin nhắn..."]';
const ZALO_OA_MESSAGE_INPUT_WAIT_MS = 5000;
const ZALO_OA_IMAGE_BUTTON_SELECTOR =
  '.upload-container.chat_item.chat_message_instant';
const ZALO_OA_IMAGE_INPUT_WAIT_MS = 5000;

interface DownloadedImage {
  base64: string;
  name: string;
  type: string;
}

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
  messageFilled: boolean;
  sent: boolean;
  imagesSelected: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function imageNameFromUrl(imageUrl: string, index: number, type: string): string {
  const pathname = new URL(imageUrl).pathname;
  const urlName = decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
  if (urlName) return urlName;
  const extension = type.substring(type.indexOf('/') + 1) || 'jpg';
  return `image-${index + 1}.${extension}`;
}

async function downloadImages(imageUrls: string[]): Promise<DownloadedImage[]> {
  return Promise.all(imageUrls.map(async (imageUrl, index) => {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${imageUrl} (${response.status})`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error(`URL does not return an image: ${imageUrl}`);
    }
    return {
      base64: arrayBufferToBase64(await blob.arrayBuffer()),
      name: imageNameFromUrl(imageUrl, index, blob.type),
      type: blob.type,
    };
  }));
}

async function sendZaloOaMessage(
  zaloOaUserId: string,
  message: string | undefined,
  images: DownloadedImage[],
): Promise<SearchAndSelectResult> {
  const tabId = await ensureZaloOaTabId();

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (
      inputSelector: string,
      inputWaitMs: number,
      resultSelector: string,
      resultWaitMs: number,
      messageInputSelector: string,
      messageInputWaitMs: number,
      imageButtonSelector: string,
      imageInputWaitMs: number,
      userId: string,
      messageContent: string | undefined,
      downloadedImages: DownloadedImage[],
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
        return { filled: false, selected: false, messageFilled: false, sent: false, imagesSelected: 0 };
      }

      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeValueSetter?.call(input, userId);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const firstResult = await waitForElement(resultSelector, resultWaitMs);
      if (!(firstResult instanceof HTMLElement)) {
        return { filled: true, selected: false, messageFilled: false, sent: false, imagesSelected: 0 };
      }

      firstResult.click();

      const messageInput = await waitForElement(messageInputSelector, messageInputWaitMs);
      if (!(messageInput instanceof HTMLTextAreaElement)) {
        return { filled: true, selected: true, messageFilled: false, sent: false, imagesSelected: 0 };
      }

      let imagesSelected = 0;
      if (downloadedImages.length) {
        const imageButton = await waitForElement(imageButtonSelector, messageInputWaitMs);
        if (!(imageButton instanceof HTMLElement)) {
          return { filled: true, selected: true, messageFilled: false, sent: false, imagesSelected: 0 };
        }

        imagesSelected = await new Promise<number>((resolve) => {
          const originalClick = window.HTMLInputElement.prototype.click;
          const timeout = window.setTimeout(() => {
            window.HTMLInputElement.prototype.click = originalClick;
            resolve(0);
          }, imageInputWaitMs);

          window.HTMLInputElement.prototype.click = function(): void {
            if (this.type !== 'file' || !this.accept.includes('image')) {
              originalClick.call(this);
              return;
            }

            const transfer = new DataTransfer();
            downloadedImages.forEach((image) => {
              const binary = atob(image.base64);
              const bytes = new Uint8Array(binary.length);
              for (let index = 0; index < binary.length; ++index) {
                bytes[index] = binary.charCodeAt(index);
              }
              transfer.items.add(new File([bytes], image.name, { type: image.type }));
            });
            this.files = transfer.files;
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));

            window.clearTimeout(timeout);
            window.HTMLInputElement.prototype.click = originalClick;
            resolve(transfer.files.length);
          };

          imageButton.click();
        });
        if (imagesSelected > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      let messageFilled = false;
      let sent = imagesSelected > 0;
      if (messageContent) {
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        nativeTextAreaValueSetter?.call(messageInput, messageContent);
        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        messageInput.dispatchEvent(new Event('change', { bubbles: true }));
        messageInput.focus();
        messageInput.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }));
        messageFilled = true;
        sent = true;
      }

      return { filled: true, selected: true, messageFilled, sent, imagesSelected };
    },
    args: [
      ZALO_OA_SEARCH_INPUT_SELECTOR,
      ZALO_OA_SEARCH_INPUT_WAIT_MS,
      ZALO_OA_SEARCH_RESULT_SELECTOR,
      ZALO_OA_SEARCH_RESULT_WAIT_MS,
      ZALO_OA_MESSAGE_INPUT_SELECTOR,
      ZALO_OA_MESSAGE_INPUT_WAIT_MS,
      ZALO_OA_IMAGE_BUTTON_SELECTOR,
      ZALO_OA_IMAGE_INPUT_WAIT_MS,
      zaloOaUserId,
      message,
      images,
    ],
    world: 'MAIN',
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

  const message = payload.data?.message?.trim() || undefined;
  const imageUrls = payload.data?.imageUrls ?? [];
  if (!message && !imageUrls.length) {
    throw new Error('message or imageUrls is required in notification payload');
  }

  const images = await downloadImages(imageUrls);
  const result = await sendZaloOaMessage(zaloOaUserId, message, images);
  return { ...result, zaloOaUserId };
}
