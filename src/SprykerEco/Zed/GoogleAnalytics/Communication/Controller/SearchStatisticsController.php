<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Controller;

use DateTime;
use Generated\Shared\Transfer\GoogleAnalyticsEventConditionsTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventTransfer;
use Generated\Shared\Transfer\PaginationTransfer;
use Generated\Shared\Transfer\SortTransfer;
use Spryker\Zed\Kernel\Communication\Controller\AbstractController;
use SprykerEco\Zed\GoogleAnalytics\Communication\Form\OverviewFilterForm;
use Symfony\Component\HttpFoundation\Request;

/**
 * @method \SprykerEco\Zed\GoogleAnalytics\Communication\GoogleAnalyticsCommunicationFactory getFactory()
 * @method \SprykerEco\Zed\GoogleAnalytics\Business\GoogleAnalyticsFacadeInterface getFacade()
 */
class SearchStatisticsController extends AbstractController
{
    protected const string DATE_FORMAT = 'Y-m-d';

    /**
     * @uses \SprykerEco\Zed\GoogleAnalytics\Communication\Controller\SearchTermsController::indexAction()
     */
    protected const string SEARCH_TERMS_URL = '/google-analytics/search-terms';

    /**
     * @uses \SprykerEco\Zed\GoogleAnalytics\Communication\Controller\ZeroResultsController::indexAction()
     */
    protected const string ZERO_RESULTS_URL = '/google-analytics/zero-results';

    protected const string SEARCH_TERMS_FORM_NAME = 'search_terms_filter_form';

    protected const string ZERO_RESULTS_FORM_NAME = 'zero_results_filter_form';

    protected const int OVERVIEW_PAGINATION_OFFSET = 0;

    /**
     * @param \Symfony\Component\HttpFoundation\Request $request
     *
     * @return array<string, mixed>
     */
    public function indexAction(Request $request): array
    {
        $form = $this->getFactory()->createOverviewFilterForm();
        $form->handleRequest($request);

        $formData = $form->getData() ?? [];

        return $this->viewResponse([
            'searchCollection' => $this->getFacade()->getEventCollection(
                $this->buildCriteria($this->getFactory()->getConfig()->getEventNameSearch(), $formData),
            ),
            'zeroResultsCollection' => $this->getFacade()->getEventCollection(
                $this->buildCriteria($this->getFactory()->getConfig()->getEventNameZeroSearchResults(), $formData),
            ),
            'form' => $form->createView(),
            'searchTermsViewAllUrl' => $this->buildViewAllUrl(static::SEARCH_TERMS_URL, static::SEARCH_TERMS_FORM_NAME, $formData),
            'zeroResultsViewAllUrl' => $this->buildViewAllUrl(static::ZERO_RESULTS_URL, static::ZERO_RESULTS_FORM_NAME, $formData),
        ]);
    }

    /**
     * @param string $path
     * @param string $formName
     * @param array<string, mixed> $formData
     */
    protected function buildViewAllUrl(string $path, string $formName, array $formData): string
    {
        $params = $this->extractFilterParams($formData);

        if (!$params) {
            return $path;
        }

        return sprintf('%s?%s', $path, http_build_query([$formName => $params]));
    }

    /**
     * @param array<string, mixed> $formData
     *
     * @return array<string, string>
     */
    protected function extractFilterParams(array $formData): array
    {
        $params = [];
        $preset = $formData[OverviewFilterForm::FIELD_DATE_RANGE_PRESET] ?? null;

        if ($preset) {
            $params[OverviewFilterForm::FIELD_DATE_RANGE_PRESET] = $preset;
        }

        if (!$preset) {
            $startDate = $formData[OverviewFilterForm::FIELD_START_DATE] ?? null;
            $endDate = $formData[OverviewFilterForm::FIELD_END_DATE] ?? null;

            if ($startDate instanceof DateTime) {
                $params[OverviewFilterForm::FIELD_START_DATE] = $startDate->format(static::DATE_FORMAT);
            }

            if ($endDate instanceof DateTime) {
                $params[OverviewFilterForm::FIELD_END_DATE] = $endDate->format(static::DATE_FORMAT);
            }
        }

        $store = $formData[OverviewFilterForm::FIELD_STORE] ?? null;
        $locale = $formData[OverviewFilterForm::FIELD_LOCALE] ?? null;

        if ($store) {
            $params[OverviewFilterForm::FIELD_STORE] = $store;
        }

        if ($locale) {
            $params[OverviewFilterForm::FIELD_LOCALE] = $locale;
        }

        return $params;
    }

    /**
     * @param string $eventName
     * @param array<string, mixed> $formData
     */
    protected function buildCriteria(
        string $eventName,
        array $formData,
    ): GoogleAnalyticsEventCriteriaTransfer {
        $dates = $this->getFactory()->createEventCriteriaBuilder()->resolveDateRange($formData);
        $store = $formData[OverviewFilterForm::FIELD_STORE] ?? null;
        $locale = $formData[OverviewFilterForm::FIELD_LOCALE] ?? null;

        $conditions = (new GoogleAnalyticsEventConditionsTransfer())
            ->setEventName($eventName)
            ->setStartDate($dates['startDate'] ?? null)
            ->setEndDate($dates['endDate'] ?? null)
            ->setStore($store)
            ->setLocale($locale);

        $sortTransfer = (new SortTransfer())
            ->setField(GoogleAnalyticsEventTransfer::COUNT);

        $limit = $this->getFactory()->getConfig()->getOverviewItemsLimit();

        return (new GoogleAnalyticsEventCriteriaTransfer())
            ->setConditions($conditions)
            ->addSort($sortTransfer)
            ->setPagination(
                (new PaginationTransfer())
                    ->setLimit($limit)
                    ->setOffset(static::OVERVIEW_PAGINATION_OFFSET),
            );
    }
}
