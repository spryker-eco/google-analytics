<?php

/**
 * This file is part of the Spryker Suite.
 * For full license information, please view the LICENSE file that was distributed with this source code.
 */

declare(strict_types=1);

namespace SprykerEco\Zed\GoogleAnalytics\Business;

use Google\Analytics\Data\V1beta\Client\BetaAnalyticsDataClient;
use RuntimeException;
use Spryker\Zed\Kernel\Business\AbstractBusinessFactory;
use SprykerEco\Zed\GoogleAnalytics\Business\Client\GoogleAnalyticsDataClient;
use SprykerEco\Zed\GoogleAnalytics\Business\Client\GoogleAnalyticsDataClientInterface;
use SprykerEco\Zed\GoogleAnalytics\Business\Reader\GoogleAnalyticsReader;
use SprykerEco\Zed\GoogleAnalytics\Business\Reader\GoogleAnalyticsReaderInterface;

/**
 * @method \SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig getConfig()
 */
class GoogleAnalyticsBusinessFactory extends AbstractBusinessFactory
{
    public function createGoogleAnalyticsReader(): GoogleAnalyticsReaderInterface
    {
        return new GoogleAnalyticsReader($this->getConfig(), $this->createGoogleAnalyticsDataClient());
    }

    public function createGoogleAnalyticsDataClient(): GoogleAnalyticsDataClientInterface
    {
        return new GoogleAnalyticsDataClient($this->createBetaAnalyticsDataClient());
    }

    public function createBetaAnalyticsDataClient(): BetaAnalyticsDataClient
    {
        $credentials = json_decode($this->getConfig()->getServiceAccountCredentialsJson(), true);

        if (!$credentials) {
            throw new RuntimeException('Google Analytics credentials are not configured.');
        }

        return new BetaAnalyticsDataClient([
            'credentials' => $credentials,
            'transport' => 'rest',
        ]);
    }
}
