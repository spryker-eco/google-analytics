<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Business\Reader;

use DateTime;
use Generated\Shared\Transfer\ErrorTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCollectionTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventConditionsTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventTransfer;
use Google\Analytics\Data\V1beta\DateRange;
use Google\Analytics\Data\V1beta\Dimension;
use Google\Analytics\Data\V1beta\Filter;
use Google\Analytics\Data\V1beta\Filter\InListFilter;
use Google\Analytics\Data\V1beta\Filter\NumericFilter;
use Google\Analytics\Data\V1beta\Filter\NumericFilter\Operation;
use Google\Analytics\Data\V1beta\Filter\StringFilter;
use Google\Analytics\Data\V1beta\Filter\StringFilter\MatchType;
use Google\Analytics\Data\V1beta\FilterExpression;
use Google\Analytics\Data\V1beta\FilterExpressionList;
use Google\Analytics\Data\V1beta\Metric;
use Google\Analytics\Data\V1beta\NumericValue;
use Google\Analytics\Data\V1beta\OrderBy;
use Google\Analytics\Data\V1beta\OrderBy\DimensionOrderBy;
use Google\Analytics\Data\V1beta\OrderBy\MetricOrderBy;
use Google\Analytics\Data\V1beta\RunReportRequest;
use Google\Analytics\Data\V1beta\RunReportResponse;
use Google\ApiCore\ApiException;
use Google\ApiCore\ValidationException;
use Spryker\Shared\Log\LoggerTrait;
use SprykerEco\Shared\GoogleAnalytics\Exception\GoogleAnalyticsInvalidConfigException;
use SprykerEco\Zed\GoogleAnalytics\Business\Client\GoogleAnalyticsDataClientInterface;
use SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig;

class GoogleAnalyticsReader implements GoogleAnalyticsReaderInterface
{
    use LoggerTrait;

    protected const string DATE_FORMAT = 'Y-m-d';

    protected const string DATE_FORMAT_GA4 = 'Ymd';

    protected const string DIMENSION_EVENT_NAME = 'eventName';

    protected const string DIMENSION_SEARCH_TERM = 'searchTerm';

    protected const string DIMENSION_DATE = 'date';

    // These are the expected GA4 dimension names once registered in the property.
    // The actual names used come from GoogleAnalyticsConfig::getStoreDimensionName() / getLocaleDimensionName().
    // A null return from config means the dimension is not registered — it is excluded from all requests.
    protected const string METRIC_EVENT_COUNT = 'eventCount';

    // GA4 returns this sentinel when a custom dimension was not set on the event
    protected const string GA4_NOT_SET = '(not set)';

    public function __construct(
        protected GoogleAnalyticsConfig $googleAnalyticsConfig,
        protected GoogleAnalyticsDataClientInterface $client,
    ) {
    }

    public function getEventCollection(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): GoogleAnalyticsEventCollectionTransfer {
        $this->resolveConditions($googleAnalyticsEventCriteriaTransfer->getConditionsOrFail());

        try {
            // Call 1: fetch paginated search terms with event counts
            $termsResponse = $this->runTermsReport($googleAnalyticsEventCriteriaTransfer);
        } catch (GoogleAnalyticsInvalidConfigException | ApiException | ValidationException $e) {
            $this->getLogger()->error('Search statistics report failed', ['exception' => $e]);

            $googleAnalyticsEventCollectionTransfer = $this->buildEmptyCollection($googleAnalyticsEventCriteriaTransfer);

            return $googleAnalyticsEventCollectionTransfer->addError((new ErrorTransfer())->setMessage($e->getMessage()));
        }

        if ($termsResponse->getRows()->count() === 0) {
            return $this->buildEmptyCollection($googleAnalyticsEventCriteriaTransfer);
        }

        $googleAnalyticsEventCollectionTransfer = $this->buildCollection($termsResponse, $googleAnalyticsEventCriteriaTransfer);

        if (!$googleAnalyticsEventCriteriaTransfer->getConditions()?->getWithLastOccurred()) {
            return $googleAnalyticsEventCollectionTransfer;
        }

        // Call 2: fetch last occurred dates for the current page terms only.
        // A single report combining searchTerm+date dimensions cannot be paginated
        // by unique term — GA4 returns one row per (term, date) pair, so limit=50
        // gives 50 pairs, not 50 unique terms.
        try {
            $lastOccurredMap = $this->runDatesReport(
                $googleAnalyticsEventCriteriaTransfer,
                $googleAnalyticsEventCollectionTransfer,
            );
        } catch (GoogleAnalyticsInvalidConfigException | ApiException | ValidationException $e) {
            $this->getLogger()->error('Search statistics report failed', ['exception' => $e]);

            $googleAnalyticsEventCollectionTransfer = $this->buildEmptyCollection($googleAnalyticsEventCriteriaTransfer);

            return $googleAnalyticsEventCollectionTransfer->addError((new ErrorTransfer())->setMessage($e->getMessage()));
        }

        return $this->setLastOccured($googleAnalyticsEventCollectionTransfer, $lastOccurredMap);
    }

    /**
     * @param \Generated\Shared\Transfer\GoogleAnalyticsEventCollectionTransfer $googleAnalyticsEventCollectionTransfer
     * @param array<string, string> $lastOccurredMap
     */
    protected function setLastOccured(
        GoogleAnalyticsEventCollectionTransfer $googleAnalyticsEventCollectionTransfer,
        array $lastOccurredMap,
    ): GoogleAnalyticsEventCollectionTransfer {
        foreach ($googleAnalyticsEventCollectionTransfer->getEvents() as $googleAnalyticsEventTransfer) {
            $lastOccurredKey = sprintf('%s|%s|%s', $googleAnalyticsEventTransfer->getSearchTermOrFail(), $googleAnalyticsEventTransfer->getStore(), $googleAnalyticsEventTransfer->getLocale());

            $googleAnalyticsEventTransfer
                    ->setLastOccurredAt($lastOccurredMap[$lastOccurredKey] ?? null);
        }

        return $googleAnalyticsEventCollectionTransfer;
    }

    protected function runTermsReport(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): RunReportResponse {
        $googleAnalyticsEventConditionsTransfer = $googleAnalyticsEventCriteriaTransfer->getConditionsOrFail();
        $paginationTransfer = $googleAnalyticsEventCriteriaTransfer->getPaginationOrFail();

        $request = new RunReportRequest([
            'property' => sprintf('properties/%s', $this->googleAnalyticsConfig->getPropertyId()),
            'date_ranges' => [
                new DateRange([
                    'start_date' => $googleAnalyticsEventConditionsTransfer->getStartDate(),
                    'end_date' => $googleAnalyticsEventConditionsTransfer->getEndDate(),
                ]),
            ],
            'dimensions' => $this->buildTermsDimensions(),
            'metrics' => [
                new Metric(['name' => static::METRIC_EVENT_COUNT]),
            ],
            'dimension_filter' => $this->buildTermsReportDimensionFilter($googleAnalyticsEventConditionsTransfer),
            'order_bys' => [
                new OrderBy([
                    'metric' => new MetricOrderBy(['metric_name' => static::METRIC_EVENT_COUNT]),
                    'desc' => $this->isDescendingSort($googleAnalyticsEventCriteriaTransfer),
                ]),
            ],
            'limit' => $paginationTransfer->getLimit(),
            'offset' => $paginationTransfer->getOffset(),
        ]);

        if ($googleAnalyticsEventConditionsTransfer->getMinimumCount() > 0) {
            $request->setMetricFilter(new FilterExpression([
                'filter' => new Filter([
                    'field_name' => static::METRIC_EVENT_COUNT,
                    'numeric_filter' => new NumericFilter([
                        'operation' => Operation::GREATER_THAN_OR_EQUAL,
                        'value' => new NumericValue(['int64_value' => $googleAnalyticsEventConditionsTransfer->getMinimumCount()]),
                    ]),
                ]),
            ]));
        }

        return $this->client->runReport($request);
    }

    protected function buildTermsReportDimensionFilter(GoogleAnalyticsEventConditionsTransfer $conditions): FilterExpression
    {
        $expressions = [
            new FilterExpression([
                'filter' => new Filter([
                    'field_name' => static::DIMENSION_EVENT_NAME,
                    'string_filter' => new StringFilter([
                        'value' => $conditions->getEventName(),
                        'match_type' => MatchType::EXACT,
                    ]),
                ]),
            ]),
        ];

        if ($conditions->getSearchTerm()) {
            $expressions[] = new FilterExpression([
                'filter' => new Filter([
                    'field_name' => static::DIMENSION_SEARCH_TERM,
                    'string_filter' => new StringFilter([
                        'value' => $conditions->getSearchTerm(),
                        'match_type' => MatchType::CONTAINS,
                    ]),
                ]),
            ]);
        }

        $storeDimension = $this->googleAnalyticsConfig->getStoreDimensionName();

        if ($conditions->getStore() && $storeDimension) {
            $expressions[] = new FilterExpression([
                'filter' => new Filter([
                    'field_name' => $storeDimension,
                    'string_filter' => new StringFilter([
                        'value' => $conditions->getStore(),
                        'match_type' => MatchType::EXACT,
                    ]),
                ]),
            ]);
        }

        $localeDimension = $this->googleAnalyticsConfig->getLocaleDimensionName();

        if ($conditions->getLocale() && $localeDimension) {
            $expressions[] = new FilterExpression([
                'filter' => new Filter([
                    'field_name' => $localeDimension,
                    'string_filter' => new StringFilter([
                        'value' => $conditions->getLocale(),
                        'match_type' => MatchType::EXACT,
                    ]),
                ]),
            ]);
        }

        if (count($expressions) === 1) {
            return $expressions[0];
        }

        return new FilterExpression([
            'and_group' => new FilterExpressionList([
                'expressions' => $expressions,
            ]),
        ]);
    }

     /**
      * @param array<string> $terms
      *
      * @return array<string, string>
      */
    protected function runDatesReport(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
        GoogleAnalyticsEventCollectionTransfer $googleAnalyticsEventCollectionTransfer,
    ): array {
        $googleAnalyticsEventConditionsTransfer = $googleAnalyticsEventCriteriaTransfer->getConditionsOrFail();

        $request = new RunReportRequest([
            'property' => sprintf('properties/%s', $this->googleAnalyticsConfig->getPropertyId()),
            'date_ranges' => [
                new DateRange([
                    'start_date' => $googleAnalyticsEventConditionsTransfer->getStartDate(),
                    'end_date' => $googleAnalyticsEventConditionsTransfer->getEndDate(),
                ]),
            ],
            'dimensions' => $this->buildDatesDimensions(),
            'metrics' => [
                new Metric(['name' => static::METRIC_EVENT_COUNT]),
            ],
            'dimension_filter' => new FilterExpression([
                'and_group' => new FilterExpressionList([
                    'expressions' => [
                        new FilterExpression([
                            'filter' => new Filter([
                                'field_name' => static::DIMENSION_EVENT_NAME,
                                'string_filter' => new StringFilter([
                                    'value' => $googleAnalyticsEventConditionsTransfer->getEventName(),
                                    'match_type' => MatchType::EXACT,
                                ]),
                            ]),
                        ]),
                        new FilterExpression([
                            'filter' => new Filter([
                                'field_name' => static::DIMENSION_SEARCH_TERM,
                                'in_list_filter' => new InListFilter([
                                    'values' => array_map(function (GoogleAnalyticsEventTransfer $googleAnalyticsEventTransfer) {
                                        return $googleAnalyticsEventTransfer->getSearchTermOrFail();
                                    }, $googleAnalyticsEventCollectionTransfer->getEvents()->getArrayCopy())]),
                            ]),
                        ]),
                    ],
                ]),
            ]),
            'order_bys' => [
                new OrderBy([
                    'dimension' => new DimensionOrderBy(['dimension_name' => static::DIMENSION_DATE]),
                    'desc' => true,
                ]),
            ],
        ]);

        return $this->buildLastOccurredMap($this->client->runReport($request));
    }

    /**
     * @return array<\Google\Analytics\Data\V1beta\Dimension>
     */
    protected function buildTermsDimensions(): array
    {
        $dimensions = [new Dimension(['name' => static::DIMENSION_SEARCH_TERM])];

        if ($this->googleAnalyticsConfig->getStoreDimensionName()) {
            $dimensions[] = new Dimension(['name' => $this->googleAnalyticsConfig->getStoreDimensionName()]);
        }

        if ($this->googleAnalyticsConfig->getLocaleDimensionName()) {
            $dimensions[] = new Dimension(['name' => $this->googleAnalyticsConfig->getLocaleDimensionName()]);
        }

        return $dimensions;
    }

    /**
     * @return array<\Google\Analytics\Data\V1beta\Dimension>
     */
    protected function buildDatesDimensions(): array
    {
        $dimensions = $this->buildTermsDimensions();

        $dimensions[] = new Dimension(['name' => static::DIMENSION_DATE]);

        return $dimensions;
    }

    /**
     * Builds a map of dimension name to its index in the response row, derived from the response headers.
     *
     * @return array<string, int>
     */
    protected function buildDimensionIndexMap(RunReportResponse $response): array
    {
        $map = [];

        foreach ($response->getDimensionHeaders() as $index => $header) {
            $map[$header->getName()] = $index;
        }

        return $map;
    }

    protected function normalizeDimensionValue(string $value): ?string
    {
        if ($value === static::GA4_NOT_SET || $value === '') {
            return null;
        }

        return $value;
    }

    /**
     * @return array<string, string> Keyed by "term|store|locale" compound key
     */
    protected function buildLastOccurredMap(RunReportResponse $response): array
    {
        $indexMap = $this->buildDimensionIndexMap($response);
        $storeDimension = $this->googleAnalyticsConfig->getStoreDimensionName();
        $localeDimension = $this->googleAnalyticsConfig->getLocaleDimensionName();

        $map = [];

        foreach ($response->getRows() as $row) {
            $dimensionValues = $row->getDimensionValues();
            $term = $dimensionValues[$indexMap[static::DIMENSION_SEARCH_TERM]]->getValue();
            $store = $storeDimension && isset($indexMap[$storeDimension])
                ? ($this->normalizeDimensionValue($dimensionValues[$indexMap[$storeDimension]]->getValue()) ?? '')
                : '';
            $locale = $localeDimension && isset($indexMap[$localeDimension])
                ? ($this->normalizeDimensionValue($dimensionValues[$indexMap[$localeDimension]]->getValue()) ?? '')
                : '';
            $date = $dimensionValues[$indexMap[static::DIMENSION_DATE]]->getValue();

            $key = sprintf('%s|%s|%s', $term, $store, $locale);

            // Response is ordered date DESC — first occurrence per compound key is the latest
            if (isset($map[$key])) {
                continue;
            }

            $dateTime = DateTime::createFromFormat(static::DATE_FORMAT_GA4, $date);
            $map[$key] = $dateTime !== false ? $dateTime->format(static::DATE_FORMAT) : $date;
        }

        return $map;
    }

    protected function buildCollection(
        RunReportResponse $response,
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): GoogleAnalyticsEventCollectionTransfer {
        $googleAnalyticsEventCollectionTransfer = new GoogleAnalyticsEventCollectionTransfer();

        $indexMap = $this->buildDimensionIndexMap($response);
        $storeDimension = $this->googleAnalyticsConfig->getStoreDimensionName();
        $localeDimension = $this->googleAnalyticsConfig->getLocaleDimensionName();

        $terms = [];

        foreach ($response->getRows() as $row) {
            $dimensionValues = $row->getDimensionValues();

            $googleAnalyticsEventCollectionTransfer->addEvent(
                (new GoogleAnalyticsEventTransfer())
                    ->setSearchTerm($dimensionValues[$indexMap[static::DIMENSION_SEARCH_TERM]]->getValue())
                    ->setStore($storeDimension && isset($indexMap[$storeDimension])
                    ? $this->normalizeDimensionValue($dimensionValues[$indexMap[$storeDimension]]->getValue())
                    : null)
                    ->setLocale($localeDimension && isset($indexMap[$localeDimension])
                    ? $this->normalizeDimensionValue($dimensionValues[$indexMap[$localeDimension]]->getValue())
                    : null)
                    ->setCount((int)($row->getMetricValues()[0] ?? null)?->getValue()),
            );
        }

        $paginationTransfer = $googleAnalyticsEventCriteriaTransfer->getPaginationOrFail();

        $paginationTransfer->setNbResults($response->getRowCount());
        $googleAnalyticsEventCollectionTransfer->setPagination($paginationTransfer);

        return $googleAnalyticsEventCollectionTransfer;
    }

    protected function buildEmptyCollection(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): GoogleAnalyticsEventCollectionTransfer {
        $paginationTransfer = $googleAnalyticsEventCriteriaTransfer->getPaginationOrFail();

        return (new GoogleAnalyticsEventCollectionTransfer())
            ->setPagination($paginationTransfer->setNbResults(0));
    }

    protected function isDescendingSort(GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer): bool
    {
        $sortCollection = $googleAnalyticsEventCriteriaTransfer->getSortCollection();

        if (!$sortCollection->count()) {
            return true;
        }

        return !$sortCollection->offsetGet(0)->getIsAscending();
    }

    protected function resolveConditions(GoogleAnalyticsEventConditionsTransfer $analyticsEventConditionsTransfer): GoogleAnalyticsEventConditionsTransfer
    {
        if (!$analyticsEventConditionsTransfer->getStartDate()) {
            $analyticsEventConditionsTransfer->setStartDate(
                (new DateTime($this->googleAnalyticsConfig->getDefaultDateRangePreset()))->format(static::DATE_FORMAT),
            );
        }

        if (!$analyticsEventConditionsTransfer->getEndDate()) {
            $analyticsEventConditionsTransfer->setEndDate(
                (new DateTime())->format(static::DATE_FORMAT),
            );
        }

        return $analyticsEventConditionsTransfer;
    }
}
