<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication;

use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;
use Spryker\Zed\Kernel\Communication\AbstractCommunicationFactory;
use Spryker\Zed\Locale\Business\LocaleFacadeInterface;
use Spryker\Zed\Store\Business\StoreFacadeInterface;
use SprykerEco\Zed\GoogleAnalytics\Communication\Builder\EventCriteriaResolver;
use SprykerEco\Zed\GoogleAnalytics\Communication\Builder\EventCriteriaResolverInterface;
use SprykerEco\Zed\GoogleAnalytics\Communication\Form\DataProvider\OverviewFilterFormDataProvider;
use SprykerEco\Zed\GoogleAnalytics\Communication\Form\OverviewFilterForm;
use SprykerEco\Zed\GoogleAnalytics\Communication\Form\SearchTermsFilterForm;
use SprykerEco\Zed\GoogleAnalytics\Communication\Form\ZeroResultsFilterForm;
use SprykerEco\Zed\GoogleAnalytics\Communication\Table\SearchTermsTable;
use SprykerEco\Zed\GoogleAnalytics\Communication\Table\ZeroResultsTable;
use SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsDependencyProvider;
use Symfony\Component\Form\FormInterface;

/**
 * @method \SprykerEco\Zed\GoogleAnalytics\Business\GoogleAnalyticsFacadeInterface getFacade()
 * @method \SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig getConfig()
 */
class GoogleAnalyticsCommunicationFactory extends AbstractCommunicationFactory
{
    public function createOverviewFilterForm(): FormInterface
    {
        return $this->getFormFactory()->create(
            OverviewFilterForm::class,
            null,
            $this->createOverviewFilterFormDataProvider()->getOptions(),
        );
    }

    public function createSearchTermsFilterForm(): FormInterface
    {
        return $this->getFormFactory()->create(
            SearchTermsFilterForm::class,
            null,
            $this->createOverviewFilterFormDataProvider()->getOptions(),
        );
    }

    public function createZeroResultsFilterForm(): FormInterface
    {
        return $this->getFormFactory()->create(
            ZeroResultsFilterForm::class,
            null,
            $this->createOverviewFilterFormDataProvider()->getOptions(),
        );
    }

    public function createEventCriteriaResolver(): EventCriteriaResolverInterface
    {
        return new EventCriteriaResolver();
    }

    public function createSearchTermsTable(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): SearchTermsTable {
        return new SearchTermsTable(
            $this->getFacade(),
            $this->getConfig(),
            $googleAnalyticsEventCriteriaTransfer,
        );
    }

    public function createZeroResultsTable(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): ZeroResultsTable {
        return new ZeroResultsTable(
            $this->getFacade(),
            $this->getConfig(),
            $googleAnalyticsEventCriteriaTransfer,
        );
    }

    public function createOverviewFilterFormDataProvider(): OverviewFilterFormDataProvider
    {
        return new OverviewFilterFormDataProvider(
            $this->getConfig(),
            $this->getStoreFacade(),
            $this->getLocaleFacade(),
        );
    }

    public function getStoreFacade(): StoreFacadeInterface
    {
        return $this->getProvidedDependency(GoogleAnalyticsDependencyProvider::FACADE_STORE);
    }

    public function getLocaleFacade(): LocaleFacadeInterface
    {
        return $this->getProvidedDependency(GoogleAnalyticsDependencyProvider::FACADE_LOCALE);
    }
}
