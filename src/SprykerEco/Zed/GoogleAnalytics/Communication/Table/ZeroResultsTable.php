<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Table;

use ArrayObject;
use Generated\Shared\Transfer\GoogleAnalyticsEventConditionsTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventTransfer;
use Generated\Shared\Transfer\PaginationTransfer;
use Generated\Shared\Transfer\SortTransfer;
use Spryker\Service\UtilText\Model\Url\Url;
use Spryker\Zed\Gui\Communication\Table\AbstractTable;
use Spryker\Zed\Gui\Communication\Table\TableConfiguration;
use SprykerEco\Zed\GoogleAnalytics\Business\GoogleAnalyticsFacadeInterface;
use SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig;

class ZeroResultsTable extends AbstractTable
{
    protected const string COL_SEARCH_TERM = 'searchTerm';

    protected const string COL_STORE = 'store';

    protected const string COL_LOCALE = 'locale';

    protected const string COL_COUNT = 'count';

    protected const string COL_LAST_OCCURRED_AT = 'lastOccurredAt';

    /**
     * @uses \SprykerEco\Zed\GoogleAnalytics\Communication\Controller\ZeroResultsController::indexAction()
     */
    protected const string BASE_URL = '/google-analytics/zero-results';

    public function __construct(
        protected GoogleAnalyticsFacadeInterface $googleAnalyticsFacade,
        protected GoogleAnalyticsConfig $googleAnalyticsConfig,
        protected GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ) {
        $this->baseUrl = static::BASE_URL;
    }

    protected function configure(TableConfiguration $config): TableConfiguration
    {
        $config->setUrl(Url::generate('/table', $this->getRequest()->query->all())->build());

        $config->setHeader([
            static::COL_SEARCH_TERM => 'Search Term',
            static::COL_STORE => 'Store',
            static::COL_LOCALE => 'Locale',
            static::COL_COUNT => 'Count',
            static::COL_LAST_OCCURRED_AT => 'Last Occurred',
        ]);

        $config->setSortable([static::COL_COUNT]);
        $config->setDefaultSortField(static::COL_COUNT, TableConfiguration::SORT_DESC);
        $config->setSearchable([static::COL_SEARCH_TERM]);

        return $config;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    protected function prepareData(TableConfiguration $config): array
    {
        $order = $this->getOrders($config);
        $isAscending = ($order[0][static::SORT_BY_DIRECTION] ?? TableConfiguration::SORT_DESC) === TableConfiguration::SORT_ASC;

        $offset = $this->getOffset();
        $limit = $this->getLimit();

        $searchTermData = $this->getSearchTerm();
        $searchValue = $searchTermData[static::PARAMETER_VALUE] ?? '';

        if (!$this->googleAnalyticsEventCriteriaTransfer->getConditions()) {
            $this->googleAnalyticsEventCriteriaTransfer->setConditions(new GoogleAnalyticsEventConditionsTransfer());
        }

        $this->googleAnalyticsEventCriteriaTransfer->getConditionsOrFail()
            ->setEventName($this->googleAnalyticsConfig->getEventNameZeroSearchResults())
            ->setWithLastOccurred(true)
            ->setSearchTerm($searchValue ?: null);

        $this->googleAnalyticsEventCriteriaTransfer
            ->setSortCollection(new ArrayObject([
                (new SortTransfer())
                    ->setField(GoogleAnalyticsEventTransfer::COUNT)
                    ->setIsAscending($isAscending),
            ]))
            ->setPagination(
                (new PaginationTransfer())
                    ->setLimit($limit)
                    ->setOffset($offset),
            );

        $googleAnalyticsEventCollectionTransfer = $this->googleAnalyticsFacade->getEventCollection($this->googleAnalyticsEventCriteriaTransfer);

        $totalCount = $googleAnalyticsEventCollectionTransfer->getPaginationOrFail()->getNbResults() ?? 0;
        $this->setTotal($totalCount);
        $this->setFiltered($totalCount);

        $results = [];

        foreach ($googleAnalyticsEventCollectionTransfer->getEvents() as $event) {
            $results[] = [
                static::COL_SEARCH_TERM => $event->getSearchTerm(),
                static::COL_STORE => $event->getStore() ?? '-',
                static::COL_LOCALE => $event->getLocale() ?? '-',
                static::COL_COUNT => $event->getCount(),
                static::COL_LAST_OCCURRED_AT => $event->getLastOccurredAt() ?? '-',
            ];
        }

        return $results;
    }
}
