
/* @flow */
/* eslint no-restricted-globals: off, no-console: off, no-process-exit: off, no-process-env: off, unicorn/no-process-exit: off */
import { toMatchImageSnapshot } from 'jest-image-snapshot';
import { getWebpackConfig } from '@krakenjs/grumbler-scripts/config/webpack.config';

import { getTestGlobals } from '../globals';
import globals from '../../globals';
import { testContent } from '../content';

import { webpackCompile } from './lib/compile';
import { openPage } from './lib/browser';
import { sha256, dotifyToString } from './lib/util';
import { buttonConfigs } from './config';

// set up expect for `expect(page.screenshot()).toMatchScreenshot();`
// $FlowIssue
expect.extend({ toMatchImageSnapshot });

const IMAGE_DIR = `${ __dirname }/images`;

const HEADLESS = (process.env.HEADLESS !== '0');
const DEVTOOLS = (process.env.DEVTOOLS === '1');

jest.setTimeout(120000);

const setupBrowserPage = (async () => {
    const { browser, page, open } = await openPage(await webpackCompile(getWebpackConfig({
        entry:         './test/paypal.js',
        libraryTarget: 'window',
        test:          true,
        web:           false,
        vars:          { ...getTestGlobals(globals) }
    })), { headless: HEADLESS, devtools: DEVTOOLS });

    return { browser, page, open };
})();

beforeAll(async () => {
    await setupBrowserPage;
});

afterAll(async () => {
    const { browser } = await setupBrowserPage;
    await browser.close();
});

for (const config of buttonConfigs) {
    const { only, ...buttonConfig } = config;
    const description = dotifyToString(buttonConfig) || 'base';
    const filename = sha256(JSON.stringify(buttonConfig));

    const testPromise = (async () => {
        const { page } = await setupBrowserPage;

        buttonConfig.button = buttonConfig.button || {};
        buttonConfig.button.content = testContent;

        const { x, y, width, height } = await page.evaluate(async (options) => {

            // $FlowFixMe
            document.body.innerHTML = '';

            const container = window.document.createElement('div');
            window.document.body.appendChild(container);

            if (options.fundingEligibility) {
                window.__TEST_FUNDING_ELIGIBILITY__ = options.fundingEligibility;
            }

            if (options.wallet) {
                window.__TEST_WALLET__ = options.wallet;
            }

            if (options.rememberedFunding) {
                window.__TEST_REMEMBERED_FUNDING__ = options.rememberedFunding;
            }

            if (options.container) {
                container.style.width = `${ options.container.width }px`;
            } else {
                container.style.width = '200px';
            }

            if (options.userAgent) {
                const screenHeight = 667;

                window.navigator.mockUserAgent = options.userAgent;
                window.outerHeight = screenHeight;
                window.innerHeight = 553;
                window.screen = {
                    screenHeight
                };
            }

            const renderPromise = window.paypal.Buttons(options.button || {}).render(container);

            await new Promise(resolve => setTimeout(resolve, 300));

            const frame = container.querySelector('iframe');

            if (!frame) {
                await renderPromise.timeout(500);
            }

            const rect = frame.getBoundingClientRect();

            delete window.navigator.mockUserAgent;
            delete window.__TEST_FUNDING_ELIGIBILITY__;
            delete window.__TEST_REMEMBERED_FUNDING__;

            return {
                x:      rect.left,
                y:      rect.top,
                width:  rect.width,
                height: rect.height
            };

        }, buttonConfig);

        if (width === 0) {
            throw new Error(`Button width is 0`);
        }

        if (height === 0) {
            throw new Error(`Button height is 0`);
        }

        const screenshot = await page.screenshot({
            clip: { x, y, width, height }
        });

        expect(screenshot).toMatchImageSnapshot({
            customSnapshotsDir: IMAGE_DIR,
            customSnapshotIdentifier: filename,
            comparisonMethod: 'ssim',
            failureThreshold: 0.01,
            failureThresholdType: 'percent'
        });

    });

    (only ? test.only : test)(`Render button with ${ description }`, async () => {
        console.log(`Render button with ${ description }`);
        await testPromise();
    });
}
