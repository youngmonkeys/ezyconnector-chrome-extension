export interface ZaloOaSendMessagePayload {
  zaloOaUserId?: string;
  message?: string;
  imageUrls?: string[];
}

const ZALO_OA_TAB_URL_PATTERN = 'https://oa.zalo.me/*';
const ZALO_OA_CHAT_URL = 'https://oa.zalo.me/chat';
const ZALO_OA_SEARCH_BUTTON_SELECTOR = '.func_search .btn_search';
const ZALO_OA_SEARCH_PANEL_SELECTOR = '.func_search .search_main';
const ZALO_OA_SEARCH_INPUT_SELECTOR =
  '.func_search .search_main input[type="search"]';
const ZALO_OA_SEARCH_INPUT_WAIT_MS = 15000;
const ZALO_OA_SEARCH_RESULT_SELECTOR = '.item_mess:not(.mess_links)';
const ZALO_OA_SEARCH_RESULT_WAIT_MS = 10000;
const ZALO_OA_MESSAGE_INPUT_SELECTOR =
  '.content_mess_input textarea[placeholder="Nhập nội dung tin nhắn..."]';
const ZALO_OA_MESSAGE_INPUT_WAIT_MS = 5000;
const ZALO_OA_IMAGE_BUTTON_SELECTOR =
  '.upload-container.chat_item.chat_message_instant .icon_image';
const ZALO_OA_IMAGE_INPUT_WAIT_MS = 5000;
const ZALO_OA_LOG_PREFIX = '[EzyConnector][ZaloOA]';
const MAX_MESSAGE_LENGTH = 5000;
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MIN_STEP_DELAY_MS = 350;
const MAX_STEP_DELAY_MS = 900;

interface DownloadedImage {
  base64: string;
  name: string;
  type: string;
}

function randomStepDelay(): Promise<void> {
  const durationMs = Math.floor(
    Math.random() * (MAX_STEP_DELAY_MS - MIN_STEP_DELAY_MS + 1),
  ) + MIN_STEP_DELAY_MS;
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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
  const existingTab = tabs[0];
  if (existingTab?.id !== undefined) {
    await chrome.windows.update(existingTab.windowId, { focused: true });
    await chrome.tabs.update(existingTab.id, { active: true });
    return existingTab.id;
  }
  return openZaloOaTab();
}

interface SearchAndSelectResult {
  filled: boolean;
  selected: boolean;
  messageFilled: boolean;
  sent: boolean;
  imagesSelected: number;
  imageButtonFound?: boolean;
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

async function downloadImages(
  imageUrls: string[],
  adminOrigin: string,
  allowedImageOrigins: string[],
  runId: string,
): Promise<DownloadedImage[]> {
  const approvedOrigins = new Set([adminOrigin, ...allowedImageOrigins]);
  return Promise.all(imageUrls.map(async (imageUrl, index) => {
    const safeImageUrl = new URL(imageUrl);
    if (safeImageUrl.protocol !== 'https:' || !approvedOrigins.has(safeImageUrl.origin)) {
      throw new Error(
        `imageUrls[${index}] must use HTTPS and belong to an approved image origin`,
      );
    }
    console.info(
      ZALO_OA_LOG_PREFIX,
      runId,
      'downloading image',
      { index, url: `${safeImageUrl.origin}${safeImageUrl.pathname}` },
    );
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${imageUrl} (${response.status})`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error(`URL does not return an image: ${imageUrl}`);
    }
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error(`Image ${index + 1} exceeds the ${MAX_IMAGE_BYTES} byte limit`);
    }
    console.info(
      ZALO_OA_LOG_PREFIX,
      runId,
      'downloaded image',
      { index, size: blob.size, type: blob.type },
    );
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
  runId: string,
): Promise<SearchAndSelectResult> {
  console.info(ZALO_OA_LOG_PREFIX, runId, 'finding Zalo OA tab');
  const tabId = await ensureZaloOaTabId();
  console.info(ZALO_OA_LOG_PREFIX, runId, 'using Zalo OA tab', { tabId });
  await randomStepDelay();

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (
      searchButtonSelector: string,
      searchPanelSelector: string,
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
      executionId: string,
      minStepDelayMs: number,
      maxStepDelayMs: number,
    ): Promise<SearchAndSelectResult> => {
      const logPrefix = '[EzyConnector][ZaloOA]';
      const log = (step: string, details?: unknown): void => {
        if (details === undefined) {
          console.info(logPrefix, executionId, step);
        } else {
          console.info(logPrefix, executionId, step, details);
        }
      };

      async function waitForElement(selector: string, waitMs: number): Promise<Element | null> {
        log('waiting for element', { selector, waitMs });
        const deadline = Date.now() + waitMs;
        let found: Element | null = null;
        while (Date.now() < deadline) {
          found = document.querySelector(selector);
          if (found) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        log(found ? 'element found' : 'element wait timed out', { selector });
        return found;
      }

      async function waitForVisibleElement(
        selector: string,
        waitMs: number,
      ): Promise<Element | null> {
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
          const element = document.querySelector(selector);
          if (element && getComputedStyle(element).display !== 'none') {
            return element;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      }

      async function waitRandom(step: string): Promise<void> {
        const durationMs = Math.floor(
          Math.random() * (maxStepDelayMs - minStepDelayMs + 1),
        ) + minStepDelayMs;
        log('waiting before step', { step, durationMs });
        await new Promise((resolve) => setTimeout(resolve, durationMs));
      }

      log('page automation started', {
        hasMessage: Boolean(messageContent),
        imageCount: downloadedImages.length,
      });
      let searchPanel = document.querySelector(searchPanelSelector);
      if (!searchPanel || getComputedStyle(searchPanel).display === 'none') {
        const searchButton = await waitForElement(searchButtonSelector, inputWaitMs);
        if (!(searchButton instanceof HTMLElement)) {
          log('search button is unavailable', { searchButtonSelector });
          return { filled: false, selected: false, messageFilled: false, sent: false, imagesSelected: 0 };
        }
        await waitRandom('open recipient search');
        searchButton.click();
        searchPanel = await waitForVisibleElement(searchPanelSelector, inputWaitMs);
      }
      if (!searchPanel) {
        log('search panel is unavailable', { searchPanelSelector });
        return { filled: false, selected: false, messageFilled: false, sent: false, imagesSelected: 0 };
      }
      const input = await waitForVisibleElement(inputSelector, inputWaitMs);
      if (!(input instanceof HTMLInputElement)) {
        log('search input is unavailable');
        return { filled: false, selected: false, messageFilled: false, sent: false, imagesSelected: 0 };
      }

      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      await waitRandom('fill recipient search');
      input.focus();
      nativeValueSetter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await waitRandom('enter recipient id');
      let typedValue = '';
      for (const character of userId) {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: character,
          bubbles: true,
          cancelable: true,
        }));
        input.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: character,
          bubbles: true,
          cancelable: true,
        }));
        typedValue += character;
        nativeValueSetter?.call(input, typedValue);
        input.dispatchEvent(new InputEvent('input', {
          inputType: 'insertText',
          data: character,
          bubbles: true,
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: character,
          bubbles: true,
        }));
        await new Promise((resolve) => setTimeout(
          resolve,
          40 + Math.floor(Math.random() * 61),
        ));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      log('search user id cleared and filled again');

      const firstResult = await waitForElement(resultSelector, resultWaitMs);
      if (!(firstResult instanceof HTMLElement)) {
        log('search result is unavailable');
        return { filled: true, selected: false, messageFilled: false, sent: false, imagesSelected: 0 };
      }

      await waitRandom('select recipient');
      firstResult.click();
      log('search result clicked', {
        className: firstResult.className,
        text: firstResult.textContent?.trim().substring(0, 100),
      });

      const messageInput = await waitForElement(messageInputSelector, messageInputWaitMs);
      if (!(messageInput instanceof HTMLTextAreaElement)) {
        log('message input is unavailable after selecting user');
        return { filled: true, selected: true, messageFilled: false, sent: false, imagesSelected: 0 };
      }
      await waitRandom('prepare conversation');
      log('conversation input is ready');

      let imagesSelected = 0;
      let imageButtonFound = false;
      if (downloadedImages.length) {
        const imageButton = await waitForElement(imageButtonSelector, messageInputWaitMs);
        if (imageButton instanceof HTMLElement) {
          imageButtonFound = true;
        } else {
          log('image button is unavailable');
        }

        if (imageButtonFound) {
          await waitRandom('open image picker');
          log('installing temporary file input hook');
          imagesSelected = await new Promise<number>((resolve) => {
            const originalClick = window.HTMLInputElement.prototype.click;
            const timeout = window.setTimeout(() => {
              window.HTMLInputElement.prototype.click = originalClick;
              log('file input hook timed out');
              resolve(0);
            }, imageInputWaitMs);

            window.HTMLInputElement.prototype.click = function(): void {
              if (this.type !== 'file' || !this.accept.includes('image')) {
                originalClick.call(this);
                return;
              }

              log('detached image input captured', {
                accept: this.accept,
                multiple: this.multiple,
                connected: this.isConnected,
              });
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
              log('image files assigned', { count: transfer.files.length });
              resolve(transfer.files.length);
            };

            imageButton.click();
            log('image icon clicked');
          });
        }
        if (imagesSelected > 0) {
          await waitRandom('wait for selected images');
        }
      }

      let messageFilled = false;
      let sent = imagesSelected > 0;
      if (messageContent) {
        await waitRandom('fill message');
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        nativeTextAreaValueSetter?.call(messageInput, messageContent);
        messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        messageInput.dispatchEvent(new Event('change', { bubbles: true }));
        messageInput.focus();
        await waitRandom('send message');
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
        log('message filled and Enter dispatched');
      }

      log('page automation finished', {
        messageFilled,
        sent,
        imagesSelected,
        imageButtonFound,
      });
      return {
        filled: true,
        selected: true,
        messageFilled,
        sent,
        imagesSelected,
        imageButtonFound,
      };
    },
    args: [
      ZALO_OA_SEARCH_BUTTON_SELECTOR,
      ZALO_OA_SEARCH_PANEL_SELECTOR,
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
      runId,
      MIN_STEP_DELAY_MS,
      MAX_STEP_DELAY_MS,
    ],
    world: 'MAIN',
  });

  return result as SearchAndSelectResult;
}

export async function handleZaloOaSendMessage(
  payload: ZaloOaSendMessagePayload,
  adminOrigin: string,
  allowedImageOrigins: string[],
): Promise<unknown> {
  const zaloOaUserId = payload.zaloOaUserId?.trim();
  if (!zaloOaUserId || zaloOaUserId.length > 255) {
    throw new Error('zaloOaUserId is missing in notification payload');
  }

  const message = payload.message?.trim() || undefined;
  if (message && message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`message must not exceed ${MAX_MESSAGE_LENGTH} characters`);
  }
  const imageUrls = payload.imageUrls ?? [];
  if (!Array.isArray(imageUrls) || imageUrls.length > MAX_IMAGES) {
    throw new Error(`imageUrls must contain at most ${MAX_IMAGES} items`);
  }
  if (imageUrls.some((url) => typeof url !== 'string')) {
    throw new Error('Every imageUrls item must be a string');
  }
  if (!message && !imageUrls.length) {
    throw new Error('message or imageUrls is required in notification payload');
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.info(ZALO_OA_LOG_PREFIX, runId, 'notification received', {
    zaloOaUserId,
    hasMessage: Boolean(message),
    imageCount: imageUrls.length,
  });

  try {
    const images = await downloadImages(
      imageUrls,
      adminOrigin,
      allowedImageOrigins,
      runId,
    );
    const result = await sendZaloOaMessage(zaloOaUserId, message, images, runId);
    if (!result.filled) {
      console.warn(
        ZALO_OA_LOG_PREFIX,
        runId,
        'recipient search input was not found',
        { selector: ZALO_OA_SEARCH_INPUT_SELECTOR },
      );
    } else if (!result.selected) {
      console.warn(
        ZALO_OA_LOG_PREFIX,
        runId,
        'search result was not found or selected',
        { selector: ZALO_OA_SEARCH_RESULT_SELECTOR },
      );
    }
    if (images.length && result.selected && result.imagesSelected === 0) {
      console.warn(
        ZALO_OA_LOG_PREFIX,
        runId,
        'image input was not captured after clicking the image button',
        {
          selector: ZALO_OA_IMAGE_BUTTON_SELECTOR,
          imageButtonFound: result.imageButtonFound,
        },
      );
    }
    console.info(ZALO_OA_LOG_PREFIX, runId, 'notification completed', result);
    return { ...result, zaloOaUserId, runId };
  } catch (error) {
    console.error(ZALO_OA_LOG_PREFIX, runId, 'notification failed', error);
    throw error;
  }
}
