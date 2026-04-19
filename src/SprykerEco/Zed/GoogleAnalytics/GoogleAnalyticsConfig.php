<?php

/**
 * This file is part of the Spryker Suite.
 * For full license information, please view the LICENSE file that was distributed with this source code.
 */

declare(strict_types=1);

namespace SprykerEco\Zed\GoogleAnalytics;

use Spryker\Zed\Kernel\AbstractBundleConfig;

class GoogleAnalyticsConfig extends AbstractBundleConfig
{
    protected const string CONFIGURATION_KEY_GOOGLE_ANALYTICS_DATA_API_CONNECTION_PROPERTY_ID
        = 'google_analytics:data_api:connection:property_id';

    protected const string CONFIGURATION_KEY_GOOGLE_ANALYTICS_DATA_API_CONNECTION_SERVICE_ACCOUNT_CREDENTIALS_JSON
        = 'google_analytics:data_api:connection:service_account_credentials_json';

    protected const array DATE_RANGE_PRESETS = [
        '-1 day' => 'Last 24 hours',
        '-7 days' => 'Last 7 days',
        '-30 days' => 'Last 30 days',
    ];

    protected const string DEFAULT_DATE_RANGE_PRESET = '-7 days';

    protected const int OVERVIEW_ITEMS_LIMIT = 10;

    protected const string EVENT_NAME_SEARCH = 'search_results';

    protected const string EVENT_NAME_ZERO_SEARCH_RESULTS = 'zero_search_results';

    protected const string DEFAULT_STORE_DIMENSION_NAME = 'customEvent:store';

    protected const string DEFAULT_LOCALE_DIMENSION_NAME = 'customEvent:locale';

    /**
     * Specification:
     * - Returns the Google Analytics Data API property ID from module configuration.
     *
     * @api
     */
    public function getPropertyId(): string
    {
        return $this->getModuleConfig(
            static::CONFIGURATION_KEY_GOOGLE_ANALYTICS_DATA_API_CONNECTION_PROPERTY_ID,
            '',
        );
    }

    /**
     * Specification:
     * - Returns the service account credentials JSON string from module configuration.
     * - Used to authenticate requests to the Google Analytics Data API.
     *
     * @api
     */
    public function getServiceAccountCredentialsJson(): string
    {
        return $this->getModuleConfig(
            static::CONFIGURATION_KEY_GOOGLE_ANALYTICS_DATA_API_CONNECTION_SERVICE_ACCOUNT_CREDENTIALS_JSON,
            '',
        );
    }

    /**
     * Specification:
     * - Returns available date range presets as a map of relative date string to display label.
     *
     * @api
     *
     * @return array<string, string>
     */
    public function getDateRangePresets(): array
    {
        return static::DATE_RANGE_PRESETS;
    }

    /**
     * Specification:
     * - Returns the default date range preset applied when no date filter is provided.
     *
     * @api
     */
    public function getDefaultDateRangePreset(): string
    {
        return static::DEFAULT_DATE_RANGE_PRESET;
    }

    /**
     * Specification:
     * - Returns the maximum number of items displayed per section in the search statistics overview.
     *
     * @api
     */
    public function getOverviewItemsLimit(): int
    {
        return static::OVERVIEW_ITEMS_LIMIT;
    }

    /**
     * Specification:
     * - Returns the GA4 event name used for tracking all searches.
     *
     * @api
     */
    public function getEventNameSearch(): string
    {
        return static::EVENT_NAME_SEARCH;
    }

    /**
     * Specification:
     * - Returns the GA4 event name used for tracking searches that returned zero results.
     *
     * @api
     */
    public function getEventNameZeroSearchResults(): string
    {
        return static::EVENT_NAME_ZERO_SEARCH_RESULTS;
    }

    /**
     * Specification:
     * - Returns the GA4 Data API dimension name for the store custom event parameter.
     * - Returns null to disable store fetching when the dimension is not registered in the GA4 property.
     * - Requires a custom event dimension named "store" registered in GA4 Admin > Custom Definitions.
     *
     * @api
     */
    public function getStoreDimensionName(): ?string
    {
        return static::DEFAULT_STORE_DIMENSION_NAME;
    }

    /**
     * Specification:
     * - Returns the GA4 Data API dimension name for the locale custom event parameter.
     * - Returns null to disable locale fetching when the dimension is not registered in the GA4 property.
     * - Requires a custom event dimension named "locale" registered in GA4 Admin > Custom Definitions.
     *
     * @api
     */
    public function getLocaleDimensionName(): ?string
    {
        return static::DEFAULT_LOCALE_DIMENSION_NAME;
    }
}
