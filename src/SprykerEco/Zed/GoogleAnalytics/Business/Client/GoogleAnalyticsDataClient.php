<?php

/**
 * This file is part of the Spryker Suite.
 * For full license information, please view the LICENSE file that was distributed with this source code.
 */

declare(strict_types=1);

namespace SprykerEco\Zed\GoogleAnalytics\Business\Client;

use Google\Analytics\Data\V1beta\Client\BetaAnalyticsDataClient;
use Google\Analytics\Data\V1beta\RunReportRequest;
use Google\Analytics\Data\V1beta\RunReportResponse;

class GoogleAnalyticsDataClient implements GoogleAnalyticsDataClientInterface
{
    public function __construct(protected BetaAnalyticsDataClient $client)
    {
    }

    public function runReport(RunReportRequest $request): RunReportResponse
    {
        return $this->client->runReport($request);
    }
}
