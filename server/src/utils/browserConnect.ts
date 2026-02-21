import { browserService } from '../services/browser.service.js';
import { logger } from '../lib/logger.js';

/**
 * Ensure the browser is connected, reconnecting or launching if needed.
 * Throws if connection cannot be established.
 */
export async function ensureBrowserConnected(context: string = 'browser'): Promise<void> {
  let isConnected = await browserService.verifyAndReconnect();
  if (isConnected) return;

  logger.browser(context, 'Browser not connected, attempting to launch and connect...');
  const isRunning = await browserService.checkBrowserRunning();

  if (!isRunning) {
    logger.browser(context, 'Browser not running, launching...');
    const launchResult = await browserService.launchBrowser();
    if (!launchResult.success) {
      throw new Error(`Failed to launch browser: ${launchResult.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  await browserService.connect().catch(err => {
    throw new Error(`Failed to connect to browser: ${err.message}`);
  });

  isConnected = browserService.isConnected();
  if (!isConnected) {
    throw new Error('Browser connection could not be established');
  }
  logger.ok(context, 'Browser connected successfully');
}
